import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { MemoryPluginRuntime } from "../src/runtime.js";

describe("plugin entry", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("registers memory prompt section, tools, hooks, and service", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-plugin-"));
    cleanupPaths.push(dir);

    const registerTool = vi.fn();
    const registerHook = vi.fn();
    const registerService = vi.fn();
    const registerMemoryPromptSection = vi.fn();
    const registerMemoryRuntime = vi.fn();
    const on = vi.fn();

    plugin.register({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      source: "/tmp/clawxmemory-test",
      registrationMode: "full",
      config: {},
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      runtime: {} as never,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      registerTool,
      registerHook,
      registerHttpRoute: vi.fn(),
      registerChannel: vi.fn(),
      registerGatewayMethod: vi.fn(),
      registerCli: vi.fn(),
      registerCliBackend: vi.fn(),
      registerService,
      registerProvider: vi.fn(),
      registerSpeechProvider: vi.fn(),
      registerMediaUnderstandingProvider: vi.fn(),
      registerImageGenerationProvider: vi.fn(),
      registerWebSearchProvider: vi.fn(),
      registerInteractiveHandler: vi.fn(),
      onConversationBindingResolved: vi.fn(),
      registerCommand: vi.fn(),
      registerContextEngine: vi.fn(),
      registerMemoryPromptSection,
      registerMemoryFlushPlan: vi.fn(),
      registerMemoryRuntime,
      registerMemoryEmbeddingProvider: vi.fn(),
      resolvePath: (value: string) => value,
      on,
    });

    expect(registerMemoryPromptSection).toHaveBeenCalledTimes(1);
    expect(registerMemoryRuntime).toHaveBeenCalledTimes(1);
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerHook).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledTimes(6);
    expect(on.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
      "before_prompt_build",
      "before_tool_call",
      "after_tool_call",
      "before_message_write",
      "agent_end",
      "before_reset",
    ]));
    expect(registerService).toHaveBeenCalledTimes(1);
    const originalStop = MemoryPluginRuntime.prototype.stop;
    const startSpy = vi.spyOn(MemoryPluginRuntime.prototype, "start").mockImplementation(() => {});
    const stopSpy = vi.spyOn(MemoryPluginRuntime.prototype, "stop").mockImplementation(function (this: MemoryPluginRuntime) {
      originalStop.call(this);
    });
    const service = registerService.mock.calls[0]?.[0] as { start: () => void; stop: () => void };
    const memoryRuntime = registerMemoryRuntime.mock.calls[0]?.[0] as {
      getMemorySearchManager: (params: { cfg: Record<string, unknown>; agentId: string }) => Promise<{ manager: null; error: string }>;
      resolveMemoryBackendConfig: (params: { cfg: Record<string, unknown>; agentId: string }) => { backend: "builtin" };
    };
    expect(service).toMatchObject({ id: "openbmb-clawxmemory-runtime" });
    expect(memoryRuntime.resolveMemoryBackendConfig({ cfg: {}, agentId: "main" })).toEqual({ backend: "builtin" });
    await expect(memoryRuntime.getMemorySearchManager({ cfg: {}, agentId: "main" })).resolves.toEqual({
      manager: null,
      error: "ClawXMemory manages dynamic session memory and does not expose OpenClaw file-memory search managers.",
    });
    service.start();
    service.stop();
    expect(startSpy).toHaveBeenCalledTimes(3);
    expect(stopSpy).toHaveBeenCalledTimes(1);

    const toolFactory = registerTool.mock.calls[0]![0] as () => Array<{ name: string }>;
    expect(toolFactory().map((tool) => tool.name)).toEqual([
      "memory_search",
      "memory_overview",
      "memory_list",
      "memory_get",
      "memory_flush",
      "memory_dream",
    ]);

    const promptBuilder = registerMemoryPromptSection.mock.calls[0]?.[0] as (input: {
      availableTools: Set<string>;
      citationsMode: "off" | "inline";
    }) => string[];
    const promptLines = promptBuilder({
      availableTools: new Set(["memory_search", "memory_get", "memory_overview", "memory_flush", "memory_dream"]),
      citationsMode: "inline",
    });
    expect(promptLines.join("\n")).toContain("Do not create or maintain long-term memory in workspace files such as memory/*.md, USER.md, or MEMORY.md, and do not write directly into ClawXMemory's managed memory directory.");
  });

  it("skips runtime registration during cli metadata discovery", () => {
    const registerTool = vi.fn();
    const registerHook = vi.fn();
    const registerService = vi.fn();
    const registerMemoryPromptSection = vi.fn();
    const registerMemoryRuntime = vi.fn();

    expect(() => {
      plugin.register({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        source: "/tmp/clawxmemory-test",
        registrationMode: "cli-metadata",
        config: {},
        pluginConfig: {
          dbPath: `${String.fromCharCode(0)}invalid`,
          uiEnabled: false,
        },
        runtime: {} as never,
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
        registerTool,
        registerHook,
        registerHttpRoute: vi.fn(),
        registerChannel: vi.fn(),
        registerGatewayMethod: vi.fn(),
        registerCli: vi.fn(),
        registerCliBackend: vi.fn(),
        registerService,
        registerProvider: vi.fn(),
        registerSpeechProvider: vi.fn(),
        registerMediaUnderstandingProvider: vi.fn(),
        registerImageGenerationProvider: vi.fn(),
        registerWebSearchProvider: vi.fn(),
        registerInteractiveHandler: vi.fn(),
        onConversationBindingResolved: vi.fn(),
        registerCommand: vi.fn(),
        registerContextEngine: vi.fn(),
        registerMemoryPromptSection,
        registerMemoryFlushPlan: vi.fn(),
        registerMemoryRuntime,
        registerMemoryEmbeddingProvider: vi.fn(),
        resolvePath: (value: string) => value,
        on: vi.fn(),
      });
    }).not.toThrow();

    expect(registerMemoryPromptSection).not.toHaveBeenCalled();
    expect(registerMemoryRuntime).not.toHaveBeenCalled();
    expect(registerTool).not.toHaveBeenCalled();
    expect(registerHook).not.toHaveBeenCalled();
    expect(registerService).not.toHaveBeenCalled();
  });
});
