import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("clawx-always-on plugin entry", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers all components when registrationMode is full", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "plugin-entry-test-"));

    const registeredTools: { name?: string }[] = [];
    const registeredCommands: { name: string }[] = [];
    const registeredHooks: string[] = [];
    const registeredServices: { id: string }[] = [];

    const mockApi = {
      registrationMode: "full",
      config: {},
      pluginConfig: {},
      runtime: {
        state: {
          resolveStateDir: () => tmpDir,
        },
        subagent: {
          run: vi.fn().mockResolvedValue({ runId: "test-run" }),
          waitForRun: vi.fn(),
          getSessionMessages: vi.fn(),
          getSession: vi.fn(),
          deleteSession: vi.fn(),
        },
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      registerTool: vi.fn((_tool: unknown, opts?: { name?: string }) => {
        registeredTools.push({ name: opts?.name });
      }),
      registerCommand: vi.fn((cmd: { name: string }) => {
        registeredCommands.push({ name: cmd.name });
      }),
      registerService: vi.fn((service: { id: string }) => {
        registeredServices.push({ id: service.id });
      }),
      on: vi.fn((hookName: string) => {
        registeredHooks.push(hookName);
      }),
    };

    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("clawx-always-on");
    expect(plugin.name).toBe("ClawXAlwaysOn");

    plugin.register(mockApi as never);

    expect(registeredTools).toHaveLength(2);
    expect(registeredTools.map((t) => t.name).sort()).toEqual([
      "always_on_complete",
      "always_on_progress",
    ]);

    expect(registeredCommands).toHaveLength(1);
    expect(registeredCommands[0].name).toBe("always-on");
    expect(registeredServices).toEqual([{ id: "clawx-always-on-worker" }]);

    expect(registeredHooks).toContain("before_prompt_build");
    expect(registeredHooks).toContain("llm_output");
    expect(registeredHooks).toContain("agent_end");
  });

  it("skips registration when registrationMode is not full", async () => {
    const mockApi = {
      registrationMode: "metadata",
      config: {},
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerService: vi.fn(),
      on: vi.fn(),
    };

    const { default: plugin } = await import("./index.js");
    plugin.register(mockApi as never);

    expect(mockApi.registerTool).not.toHaveBeenCalled();
    expect(mockApi.registerCommand).not.toHaveBeenCalled();
    expect(mockApi.registerService).not.toHaveBeenCalled();
    expect(mockApi.on).not.toHaveBeenCalled();
  });
});
