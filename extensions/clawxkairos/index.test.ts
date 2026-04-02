import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

type HookHandler = (...args: any[]) => any;

function createMockApi(pluginConfig?: Record<string, unknown>) {
  const hooks: Record<string, HookHandler> = {};
  const commands: Record<string, HookHandler> = {};
  const tools: Array<{ name: string; tool: any }> = [];

  const api = {
    pluginConfig: pluginConfig ?? {},
    config: {
      agents: {
        list: [{ id: "test-agent", default: true }],
      },
    },
    id: "clawxkairos",
    name: "ClawXKairos",
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    on: vi.fn((hookName: string, handler: HookHandler) => {
      // For hooks registered multiple times (before_tool_call),
      // the raw mock.calls are used directly in tests.
      // This map stores the LAST handler per hook name for simple access.
      hooks[hookName] = handler;
    }),
    registerTool: vi.fn((tool: any, opts?: { name?: string }) => {
      tools.push({ name: opts?.name ?? tool.name, tool });
    }),
    registerCommand: vi.fn((cmd: { name: string; handler: HookHandler }) => {
      commands[cmd.name] = cmd.handler;
    }),
    runtime: {
      system: {
        requestHeartbeatNow: vi.fn(),
        runHeartbeatOnce: vi.fn(),
        enqueueSystemEvent: vi.fn(),
      },
      subagent: {
        run: vi.fn().mockResolvedValue({ runId: "mock-run-id" }),
      },
    },
  };

  return { api, hooks, commands, tools };
}

describe("clawxkairos plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("registration", () => {
    it("registers Sleep tool, hooks, and /kairos command", () => {
      const { api, hooks, commands, tools } = createMockApi();
      register.register(api as any);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("Sleep");

      expect(hooks.agent_end).toBeDefined();
      expect(hooks.before_prompt_build).toBeDefined();
      expect(hooks.before_tool_call).toBeDefined();
      expect(hooks.llm_output).toBeDefined();
      expect(commands.kairos).toBeDefined();
    });

    it("registers gateway_start hook when startMode is on-gateway-start", () => {
      const { api, hooks } = createMockApi({ startMode: "on-gateway-start" });
      register.register(api as any);

      expect(hooks.gateway_start).toBeDefined();
    });

    it("does not register gateway_start hook for on-message startMode", () => {
      const { api, hooks } = createMockApi({ startMode: "on-message" });
      register.register(api as any);

      expect(hooks.gateway_start).toBeUndefined();
    });
  });

  describe("Sleep tool", () => {
    it("clamps duration to min/max bounds", async () => {
      const { api, tools } = createMockApi({ minSleepMs: 5000, maxSleepMs: 10000 });
      register.register(api as any);
      const sleepTool = tools[0].tool;

      // Too short → clamps to min
      const promise1 = sleepTool.execute("call-1", { duration_ms: 100 });
      vi.advanceTimersByTime(5000);
      const result1 = await promise1;
      expect(result1.text).toBe("Slept for 5000ms.");

      // Too long → clamps to max
      const promise2 = sleepTool.execute("call-2", { duration_ms: 999999 });
      vi.advanceTimersByTime(10000);
      const result2 = await promise2;
      expect(result2.text).toBe("Slept for 10000ms.");
    });

    it("respects abort signal", async () => {
      const { api, tools } = createMockApi();
      register.register(api as any);
      const sleepTool = tools[0].tool;

      const controller = new AbortController();
      const promise = sleepTool.execute("call-1", { duration_ms: 60000 }, controller.signal);

      controller.abort();
      const result = await promise;
      expect(result.text).toContain("Slept");
    });
  });

  describe("tick scheduler (agent_end)", () => {
    it("schedules tick after heartbeat-triggered agent_end", () => {
      const { api, hooks } = createMockApi({ tickDelayMs: 100 });
      register.register(api as any);

      hooks.agent_end({}, { trigger: "heartbeat" });
      expect(api.runtime.system.runHeartbeatOnce).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledWith({
        reason: "hook:kairos-tick",
        heartbeat: { target: "last" },
      });
    });

    it("schedules tick after first user message to kick off the loop", () => {
      const { api, hooks } = createMockApi({ tickDelayMs: 50 });
      register.register(api as any);

      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(50);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);
    });

    it("does not schedule tick for subsequent user messages", () => {
      const { api, hooks } = createMockApi({ tickDelayMs: 50 });
      register.register(api as any);

      // First user message → kicks off loop
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(50);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // Second user message → turnCount was reset but incremented to 1
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(50);
      // Should be called again since turnCount was reset
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(2);
    });

    it("stops at maxTurnsPerSession", () => {
      const { api, hooks } = createMockApi({ maxTurnsPerSession: 3, tickDelayMs: 10 });
      register.register(api as any);

      // Kick off with user message
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // Turn 2
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(2);

      // Turn 3 → reaches max, should NOT schedule
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(2);
    });

    it("resets turn count on user message", () => {
      const { api, hooks } = createMockApi({ maxTurnsPerSession: 2, tickDelayMs: 10 });
      register.register(api as any);

      // Turn 1 (user kick-off): turnCount 0→1, schedules tick
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // Turn 2 (heartbeat): turnCount 1→2, hits maxTurns=2, does NOT schedule
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // User sends new message → resets turnCount to 0, then 0→1, schedules tick
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(2);
    });

    it("does nothing when state.active is false", () => {
      const { api, hooks, commands } = createMockApi({ tickDelayMs: 10 });
      register.register(api as any);

      // Turn off
      commands.kairos({ args: "off" } as any);

      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(100);
      expect(api.runtime.system.runHeartbeatOnce).not.toHaveBeenCalled();
    });
  });

  describe("prompt hook (before_prompt_build)", () => {
    it("injects full kairos prompt for heartbeat triggers", () => {
      const { api, hooks } = createMockApi();
      register.register(api as any);

      const result = hooks.before_prompt_build({}, { trigger: "heartbeat" });
      expect(result.appendSystemContext).toContain("# Autonomous work");
      expect(result.prependContext).toContain("<tick>");
    });

    it("injects brief prompt for user triggers", () => {
      const { api, hooks } = createMockApi();
      register.register(api as any);

      const result = hooks.before_prompt_build({}, { trigger: "user" });
      expect(result.appendSystemContext).toContain("autonomous mode");
      expect(result.prependContext).toBeUndefined();
    });

    it("returns undefined when inactive", () => {
      const { api, hooks, commands } = createMockApi();
      register.register(api as any);

      commands.kairos({ args: "off" } as any);
      const result = hooks.before_prompt_build({}, { trigger: "heartbeat" });
      expect(result).toBeUndefined();
    });
  });

  describe("background commands (before_tool_call)", () => {
    it("injects yieldMs for exec calls in heartbeat mode", () => {
      const { api, hooks } = createMockApi({ autoBackgroundAfterMs: 15000 });
      register.register(api as any);

      // before_tool_call is registered multiple times (bg + async subagent).
      // Collect all registered handlers.
      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      const bgHandler = btcCalls[0][1];

      const result = bgHandler(
        { toolName: "exec", params: { command: "npm test" } },
        { trigger: "heartbeat" },
      );

      expect(result).toEqual({
        params: { command: "npm test", yieldMs: 15000 },
      });
    });

    it("does not override existing yieldMs", () => {
      const { api } = createMockApi({ autoBackgroundAfterMs: 15000 });
      register.register(api as any);

      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      const bgHandler = btcCalls[0][1];

      const result = bgHandler(
        { toolName: "exec", params: { command: "npm test", yieldMs: 5000 } },
        { trigger: "heartbeat" },
      );

      expect(result).toBeUndefined();
    });

    it("skips non-exec tools", () => {
      const { api } = createMockApi();
      register.register(api as any);

      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      const bgHandler = btcCalls[0][1];

      const result = bgHandler({ toolName: "cron", params: {} }, { trigger: "heartbeat" });

      expect(result).toBeUndefined();
    });

    it("skips user-triggered calls", () => {
      const { api } = createMockApi();
      register.register(api as any);

      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      const bgHandler = btcCalls[0][1];

      const result = bgHandler(
        { toolName: "exec", params: { command: "ls" } },
        { trigger: "user" },
      );

      expect(result).toBeUndefined();
    });
  });

  describe("async subagent (before_tool_call)", () => {
    it("intercepts sessions_spawn and blocks synchronous execution", () => {
      const { api } = createMockApi({ asyncSubagents: true });
      register.register(api as any);

      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      // Second before_tool_call handler is the async subagent one
      const asyncHandler = btcCalls[1][1];

      const result = asyncHandler(
        { toolName: "sessions_spawn", params: { task: "run all tests" } },
        { trigger: "heartbeat", sessionKey: "main-session" },
      );

      expect(result).toEqual({
        block: true,
        blockReason: expect.stringContaining("asynchronously"),
      });
      expect(api.runtime.subagent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "run all tests",
          deliver: false,
        }),
      );
    });

    it("does not intercept when asyncSubagents is false", () => {
      const { api } = createMockApi({ asyncSubagents: false });
      register.register(api as any);

      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      // Only 1 before_tool_call registered (background commands), not 2
      expect(btcCalls).toHaveLength(1);
    });

    it("passes through non-spawn tool calls", () => {
      const { api } = createMockApi({ asyncSubagents: true });
      register.register(api as any);

      const btcCalls = api.on.mock.calls.filter(([name]: [string]) => name === "before_tool_call");
      const asyncHandler = btcCalls[1][1];

      const result = asyncHandler(
        { toolName: "exec", params: { command: "ls" } },
        { trigger: "heartbeat" },
      );

      expect(result).toBeUndefined();
    });
  });

  describe("/kairos command", () => {
    it("toggles active state on/off", () => {
      const { api, hooks, commands } = createMockApi();
      register.register(api as any);

      // Default is on
      const status1 = commands.kairos({ args: "status" } as any);
      expect(status1.text).toContain("ON");

      // Turn off
      const off = commands.kairos({ args: "off" } as any);
      expect(off.text).toContain("OFF");

      // Confirm off
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(1000);
      expect(api.runtime.system.runHeartbeatOnce).not.toHaveBeenCalled();

      // Turn back on
      const on = commands.kairos({ args: "on" } as any);
      expect(on.text).toContain("ON");
    });

    it("shows usage for unknown args", () => {
      const { api, commands } = createMockApi();
      register.register(api as any);

      const result = commands.kairos({ args: "" } as any);
      expect(result.text).toContain("Usage");
    });

    it("resets turn count on 'on'", () => {
      const { api, hooks, commands } = createMockApi({
        maxTurnsPerSession: 2,
        tickDelayMs: 10,
      });
      register.register(api as any);

      // Turn 1 (user kick-off): schedules tick
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // Turn 2 (heartbeat): hits maxTurns, stops
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // Toggle off then on → resets turnCount
      commands.kairos({ args: "off" } as any);
      commands.kairos({ args: "on" } as any);

      // New user message after reset → schedules tick again
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(10);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(2);
    });
  });

  describe("gateway_start cold start", () => {
    it("calls runHeartbeatOnce after delay", () => {
      const { api, hooks } = createMockApi({ startMode: "on-gateway-start" });
      register.register(api as any);

      hooks.gateway_start({ port: 3000 }, { port: 3000 });
      expect(api.runtime.system.runHeartbeatOnce).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledWith({
        reason: "hook:kairos-cold-start",
        heartbeat: { target: "last" },
      });
    });

    it("does not fire if inactive", () => {
      const { api, hooks, commands } = createMockApi({ startMode: "on-gateway-start" });
      register.register(api as any);

      commands.kairos({ args: "off" } as any);
      hooks.gateway_start({ port: 3000 }, { port: 3000 });
      vi.advanceTimersByTime(5000);
      expect(api.runtime.system.runHeartbeatOnce).not.toHaveBeenCalled();
    });
  });

  describe("HEARTBEAT_OK fallback (llm_output + tick scheduler)", () => {
    it("delays next tick by minSleepMs when model replies HEARTBEAT_OK", () => {
      const { api, hooks } = createMockApi({ tickDelayMs: 100, minSleepMs: 5000 });
      register.register(api as any);

      // Simulate model replying HEARTBEAT_OK
      hooks.llm_output({ assistantTexts: ["HEARTBEAT_OK"] }, { trigger: "heartbeat" });

      // agent_end fires → should use minSleepMs (5000) instead of tickDelayMs (100)
      hooks.agent_end({}, { trigger: "heartbeat" });

      vi.advanceTimersByTime(100);
      expect(api.runtime.system.runHeartbeatOnce).not.toHaveBeenCalled();

      vi.advanceTimersByTime(4900);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);
    });

    it("uses normal tickDelayMs when model calls Sleep (no HEARTBEAT_OK)", () => {
      const { api, hooks } = createMockApi({ tickDelayMs: 100, minSleepMs: 5000 });
      register.register(api as any);

      // Simulate normal response (no HEARTBEAT_OK)
      hooks.llm_output({ assistantTexts: ["I'll check the logs now."] }, { trigger: "heartbeat" });

      hooks.agent_end({}, { trigger: "heartbeat" });

      vi.advanceTimersByTime(100);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);
    });

    it("resets lastReplyWasAck after consuming it", () => {
      const { api, hooks } = createMockApi({ tickDelayMs: 100, minSleepMs: 5000 });
      register.register(api as any);

      // First turn: HEARTBEAT_OK → uses minSleepMs
      hooks.llm_output({ assistantTexts: ["HEARTBEAT_OK"] }, { trigger: "heartbeat" });
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(5000);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);

      // Second turn: normal response → uses tickDelayMs
      hooks.llm_output({ assistantTexts: ["Working on it."] }, { trigger: "heartbeat" });
      hooks.agent_end({}, { trigger: "heartbeat" });
      vi.advanceTimersByTime(100);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(2);
    });

    it("does not detect HEARTBEAT_OK when inactive", () => {
      const { api, hooks, commands } = createMockApi({ tickDelayMs: 100, minSleepMs: 5000 });
      register.register(api as any);

      commands.kairos({ args: "off" } as any);

      hooks.llm_output({ assistantTexts: ["HEARTBEAT_OK"] }, { trigger: "heartbeat" });
      // Should not set flag since inactive
      commands.kairos({ args: "on" } as any);
      hooks.agent_end({}, { trigger: "user" });
      vi.advanceTimersByTime(100);
      expect(api.runtime.system.runHeartbeatOnce).toHaveBeenCalledTimes(1);
    });
  });
});
