import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn(),
    wrapWithSandbox: vi.fn().mockResolvedValue("bwrap --ro-bind / / -- /bin/sh -c 'echo hello'"),
    isSupportedPlatform: vi.fn().mockReturnValue(true),
    cleanupAfterCommand: vi.fn(),
  },
}));

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import {
  bwrapSandboxBackendManager,
  createBwrapSandboxBackendFactory,
  resetBwrapState,
} from "../src/bwrap-backend.js";
import type { ClawXSandboxPluginConfig } from "../src/config.js";

function makeParams(overrides?: Record<string, unknown>) {
  return {
    sessionKey: "test-session",
    scopeKey: "test-scope",
    workspaceDir: "/home/agent/workspace",
    agentWorkspaceDir: "/home/agent/openclaw",
    cfg: {
      mode: "all" as const,
      backend: "bwrap",
      scope: "agent" as const,
      workspaceAccess: "rw" as const,
      workspaceRoot: "/home/agent/sandboxes",
      docker: {
        image: "debian:bookworm-slim",
        containerPrefix: "openclaw-sandbox-",
        workdir: "/workspace",
        readOnlyRoot: true,
        tmpfs: ["/tmp"],
        network: "none",
        capDrop: ["ALL"],
        env: { LANG: "C.UTF-8" },
      },
      ssh: {
        command: "ssh",
        workspaceRoot: "/tmp/openclaw-sandboxes",
        strictHostKeyChecking: true,
        updateHostKeys: true,
      },
      browser: {
        enabled: false,
        image: "openclaw-sandbox-browser:latest",
        containerPrefix: "openclaw-browser-",
        network: "openclaw-sandbox-browser",
        cdpPort: 9222,
        vncPort: 5900,
        noVncPort: 6080,
        headless: false,
        enableNoVnc: true,
        allowHostControl: false,
        autoStart: true,
        autoStartTimeoutMs: 30000,
      },
      tools: { allow: undefined, deny: undefined },
      prune: { idleHours: 24, maxAgeDays: 7 },
    },
    ...overrides,
  };
}

describe("createBwrapSandboxBackendFactory", () => {
  let pluginConfig: ClawXSandboxPluginConfig;

  beforeEach(() => {
    pluginConfig = {};
    resetBwrapState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetBwrapState();
  });

  it("initializes SandboxManager on first call", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    await factory(makeParams());
    expect(SandboxManager.initialize).toHaveBeenCalledOnce();
  });

  it("updates config on subsequent calls instead of re-initializing", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    await factory(makeParams());
    await factory(makeParams({ scopeKey: "other-scope" }));
    expect(SandboxManager.initialize).toHaveBeenCalledOnce();
    expect(SandboxManager.updateConfig).toHaveBeenCalledOnce();
  });

  it("returns a handle with correct id and runtimeId", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    const handle = await factory(makeParams());
    expect(handle.id).toBe("bwrap");
    expect(handle.runtimeId).toBe("bwrap-test-scope");
    expect(handle.workdir).toBe("/home/agent/workspace");
  });

  it("passes docker.env as handle env", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    const handle = await factory(makeParams());
    expect(handle.env).toEqual({ LANG: "C.UTF-8" });
  });
});

describe("buildExecSpec", () => {
  let pluginConfig: ClawXSandboxPluginConfig;

  beforeEach(() => {
    pluginConfig = {};
    resetBwrapState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetBwrapState();
  });

  it("wraps command via SandboxManager.wrapWithSandbox", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    const handle = await factory(makeParams());
    const spec = await handle.buildExecSpec({
      command: "echo hello",
      env: { LANG: "C.UTF-8" },
      usePty: false,
    });
    expect(SandboxManager.wrapWithSandbox).toHaveBeenCalledWith("echo hello");
    expect(spec.argv).toEqual(["/bin/sh", "-c", "bwrap --ro-bind / / -- /bin/sh -c 'echo hello'"]);
  });

  it("sets stdinMode to pipe-closed when usePty is false", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    const handle = await factory(makeParams());
    const spec = await handle.buildExecSpec({
      command: "ls",
      env: {},
      usePty: false,
    });
    expect(spec.stdinMode).toBe("pipe-closed");
  });

  it("sets stdinMode to pipe-open when usePty is true", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    const handle = await factory(makeParams());
    const spec = await handle.buildExecSpec({
      command: "vim",
      env: {},
      usePty: true,
    });
    expect(spec.stdinMode).toBe("pipe-open");
  });

  it("merges process.env with provided env", async () => {
    const factory = createBwrapSandboxBackendFactory(() => pluginConfig);
    const handle = await factory(makeParams());
    const spec = await handle.buildExecSpec({
      command: "echo",
      env: { CUSTOM_VAR: "value" },
      usePty: false,
    });
    expect(spec.env.CUSTOM_VAR).toBe("value");
    expect(spec.env.PATH).toBeDefined();
  });
});

describe("bwrapSandboxBackendManager", () => {
  it("describeRuntime returns running based on platform support", async () => {
    const result = await bwrapSandboxBackendManager.describeRuntime({
      entry: {} as never,
      config: {} as never,
    });
    expect(result.running).toBe(true);
    expect(result.configLabelMatch).toBe(true);
  });

  it("removeRuntime is a no-op", async () => {
    await expect(
      bwrapSandboxBackendManager.removeRuntime({
        entry: {} as never,
        config: {} as never,
      }),
    ).resolves.toBeUndefined();
  });
});
