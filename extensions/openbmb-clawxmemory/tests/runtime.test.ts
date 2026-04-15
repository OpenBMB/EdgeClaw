import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPluginRuntime, applyManagedMemoryBoundaryConfig } from "../src/runtime.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("MemoryPluginRuntime", () => {
  const cleanupPaths: string[] = [];
  const runtimes: MemoryPluginRuntime[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    for (const runtime of runtimes.splice(0)) {
      runtime.stop();
    }
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("applies managed memory boundary config without overwriting unrelated settings", () => {
    const source = {
      plugins: {
        slots: {
          memory: "memory-core",
        },
        entries: {
          "memory-core": {
            enabled: true,
          },
          "openbmb-clawxmemory": {
            enabled: false,
            hooks: {
              allowPromptInjection: false,
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: true,
            },
          },
        },
      },
      agents: {
        defaults: {
          workspace: "/tmp/custom-workspace",
          memorySearch: {
            enabled: true,
          },
          compaction: {
            memoryFlush: {
              enabled: true,
            },
          },
        },
      },
      tools: {
        alsoAllow: ["custom_tool", "memory_list"],
      },
      custom: {
        untouched: true,
      },
    };

    const result = applyManagedMemoryBoundaryConfig(source);

    expect(result.changed).toBe(true);
    expect(result.changedPaths).toEqual(expect.arrayContaining([
      "plugins.slots.memory",
      "plugins.entries.openbmb-clawxmemory.enabled",
      "plugins.entries.openbmb-clawxmemory.hooks.allowPromptInjection",
      "plugins.entries.memory-core.enabled",
      "hooks.internal.entries.session-memory.enabled",
      "agents.defaults.memorySearch.enabled",
      "agents.defaults.compaction.memoryFlush.enabled",
      "tools.alsoAllow",
    ]));
    expect(result.config).toMatchObject({
      plugins: {
        slots: {
          memory: "openbmb-clawxmemory",
        },
        entries: {
          "memory-core": {
            enabled: false,
          },
          "openbmb-clawxmemory": {
            enabled: true,
            hooks: {
              allowPromptInjection: true,
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: false,
            },
          },
        },
      },
      agents: {
        defaults: {
          workspace: "/tmp/custom-workspace",
          memorySearch: {
            enabled: false,
          },
          compaction: {
            memoryFlush: {
              enabled: false,
            },
          },
        },
      },
      custom: {
        untouched: true,
      },
    });
    expect(result.config.tools).toMatchObject({
      alsoAllow: ["custom_tool", "memory_list", "memory_overview", "memory_flush", "memory_dream"],
    });
    expect(source).toMatchObject({
      plugins: {
        slots: {
          memory: "memory-core",
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: true,
            },
          },
        },
      },
    });
  });

  it("returns a no-op when the managed memory boundary is already healthy", () => {
    const healthy = applyManagedMemoryBoundaryConfig({
      agents: {
        defaults: {
          workspace: "/tmp/healthy-workspace",
        },
      },
      tools: {
        alsoAllow: ["custom_tool"],
      },
    }).config;

    const result = applyManagedMemoryBoundaryConfig(healthy);

    expect(result.changed).toBe(false);
    expect(result.changedPaths).toEqual([]);
    expect(result.config).toEqual(healthy);
  });

  it("injects dynamic recall through prependSystemContext", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    (runtime as { retriever: { retrieve: ReturnType<typeof vi.fn> } }).retriever = {
      retrieve: vi.fn().mockResolvedValue({
        query: "What happened yesterday?",
        intent: "project_memory",
        context: "2026-03-23: OpenClaw plugin SDK migration started.",
        debug: {
          mode: "local_fallback",
          elapsedMs: 25,
          cacheHit: false,
        },
      }),
    };

    const result = await runtime.handleBeforePromptBuild(
      { prompt: "What happened yesterday?", messages: [] },
      {},
    );

    expect(result).toMatchObject({
      prependSystemContext: expect.stringContaining("## ClawXMemory Recall"),
    });
    expect(result).not.toHaveProperty("prependContext");

    runtime.stop();
  });

  it("passes cleaned recent messages into retrieval without duplicating the current prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const retrieve = vi.fn().mockResolvedValue({
      query: "不够详细",
      intent: "project_memory",
      context: "expanded note",
      debug: {
        mode: "llm",
        elapsedMs: 20,
        cacheHit: false,
      },
    });
    (runtime as { retriever: { retrieve: typeof retrieve } }).retriever = { retrieve };

    await runtime.handleBeforePromptBuild(
      {
        prompt: "不够详细",
        messages: [
          { role: "user", content: "我在西北旺都做了什么" },
          { role: "assistant", content: "你主要在西北旺处理了几个工作点。" },
          { role: "user", content: "不够详细" },
        ],
      } as never,
      { sessionKey: "session-followup" } as never,
    );

    expect(retrieve).toHaveBeenCalledWith(
      "不够详细",
      expect.objectContaining({
        retrievalMode: "auto",
        recentMessages: [
          { role: "user", content: "我在西北旺都做了什么" },
          { role: "assistant", content: "你主要在西北旺处理了几个工作点。" },
        ],
      }),
    );

    runtime.stop();
  });

  it("skips answer-time recall for explicit remember turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const retrieve = vi.fn();
    (runtime as { retriever: { retrieve: typeof retrieve } }).retriever = { retrieve };

    const result = await runtime.handleBeforePromptBuild(
      {
        prompt: "再记一个长期信息：我现在常用 TypeScript 和 Node.js。",
        messages: [],
      } as never,
      { sessionKey: "session-remember" } as never,
    );

    expect(result).toBeUndefined();
    expect(retrieve).not.toHaveBeenCalled();

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    const steps = (((records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string; outputSummary?: string }> } })?.trace?.steps) ?? []);
    expect(steps.map((step) => step.kind)).toEqual(["recall_start", "recall_skipped"]);
    expect(steps[1]?.outputSummary).toContain("memory write request");

    runtime.stop();
  });

  it("isolates workspace USER.md and MEMORY.md and restores them when ClawXMemory no longer owns memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = join(dir, "workspace");
    const dataDir = join(dir, "data");
    const configPath = join(dir, "openclaw.json");
    cleanupPaths.push(dir);

    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, "USER.md"), "legacy user memory\n", "utf-8");
    await writeFile(join(workspaceDir, "MEMORY.md"), "legacy workspace memory\n", "utf-8");
    await writeFile(configPath, `${JSON.stringify({
      plugins: {
        slots: { memory: "openbmb-clawxmemory" },
        entries: { "openbmb-clawxmemory": { enabled: true } },
      },
      agents: {
        defaults: { workspace: workspaceDir },
      },
    }, null, 2)}\n`, "utf-8");
    vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {
        plugins: {
          slots: { memory: "openbmb-clawxmemory" },
          entries: { "openbmb-clawxmemory": { enabled: true } },
        },
        agents: {
          defaults: { workspace: workspaceDir },
        },
      },
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        dataDir,
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    expect((runtime as never as { reconcileManagedWorkspaceBoundary: () => string }).reconcileManagedWorkspaceBoundary()).toBe("isolated");
    await expect(readFile(join(workspaceDir, "USER.md"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(workspaceDir, "MEMORY.md"), "utf-8")).rejects.toThrow();

    const state = (runtime as never as {
      readManagedBoundaryState: (workspaceDir: string) => { files: Array<{ name: string; status: string }> } | undefined;
    }).readManagedBoundaryState(workspaceDir);
    expect(state?.files.map((file) => `${file.name}:${file.status}`)).toEqual([
      "USER.md:isolated",
      "MEMORY.md:isolated",
    ]);

    await writeFile(join(workspaceDir, "USER.md"), "recreated user memory\n", "utf-8");
    expect((runtime as never as { reconcileManagedWorkspaceBoundary: () => string }).reconcileManagedWorkspaceBoundary()).toBe("conflict");
    await expect(readFile(join(workspaceDir, "USER.md"), "utf-8")).rejects.toThrow();

    const conflictState = (runtime as never as {
      readManagedBoundaryState: (workspaceDir: string) => { files: Array<{ name: string; status: string; conflictPath?: string }> } | undefined;
    }).readManagedBoundaryState(workspaceDir);
    const userConflict = conflictState?.files.find((file) => file.name === "USER.md");
    expect(userConflict).toMatchObject({
      name: "USER.md",
      status: "conflict",
      conflictPath: expect.stringContaining("USER.clawxmemory-conflict-active-"),
    });
    const userConflictPath = userConflict?.conflictPath;
    expect(userConflictPath).toBeTruthy();

    await writeFile(configPath, `${JSON.stringify({
      plugins: {
        slots: { memory: "memory-core" },
        entries: { "openbmb-clawxmemory": { enabled: false } },
      },
      agents: {
        defaults: { workspace: workspaceDir },
      },
    }, null, 2)}\n`, "utf-8");

    runtime.stop();

    await expect(readFile(join(workspaceDir, "USER.md"), "utf-8")).resolves.toBe("legacy user memory\n");
    await expect(readFile(join(workspaceDir, "MEMORY.md"), "utf-8")).resolves.toBe("legacy workspace memory\n");
    await expect(readFile(userConflictPath!, "utf-8")).resolves.toBe("recreated user memory\n");
    expect((runtime as never as { readManagedBoundaryState: (workspaceDir: string) => unknown }).readManagedBoundaryState(workspaceDir)).toBeUndefined();
  });

  it("records real-turn case traces with retrieval, tool summaries, and final answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    (runtime as { retriever: { retrieve: ReturnType<typeof vi.fn> } }).retriever = {
      retrieve: vi.fn().mockResolvedValue({
        query: "我上周项目进展如何",
        intent: "project_memory",
        context: "## Evidence Note\n上周主要在推进检索链路改造。",
        trace: {
          traceId: "trace-1",
          query: "我上周项目进展如何",
          mode: "auto",
          startedAt: "2026-04-01T00:00:00.000Z",
          finishedAt: "2026-04-01T00:00:01.000Z",
          steps: [
            {
              stepId: "trace-1:1",
              kind: "recall_start",
              title: "Recall Started",
              status: "info",
              inputSummary: "我上周项目进展如何",
              outputSummary: "mode=auto",
            },
            {
              stepId: "trace-1:2",
              kind: "memory_gate",
              title: "Memory Gate",
              status: "success",
              inputSummary: "query + recent user messages",
              outputSummary: "route=project_memory",
            },
            {
              stepId: "trace-1:3",
              kind: "project_shortlist_built",
              title: "Project Shortlist Built",
              status: "success",
              inputSummary: "formal projects",
              outputSummary: "top 3 shortlist",
            },
            {
              stepId: "trace-1:4",
              kind: "project_selected",
              title: "Project Selected",
              status: "success",
              inputSummary: "shortlist",
              outputSummary: "project resolved",
            },
            {
              stepId: "trace-1:5",
              kind: "manifest_scanned",
              title: "Manifest Scanned",
              status: "success",
              inputSummary: "project files",
              outputSummary: "2 candidates",
            },
            {
              stepId: "trace-1:6",
              kind: "manifest_selected",
              title: "Manifest Selected",
              status: "success",
              inputSummary: "evidence",
              outputSummary: "2 selected",
            },
          ],
        },
        debug: {
          mode: "llm",
          elapsedMs: 12,
          cacheHit: false,
          path: "auto",
        },
      }),
    };

    runtime.handleInternalMessageReceived({
      type: "message",
      action: "received",
      sessionKey: "session-case",
      context: {
        content: "我上周项目进展如何",
      },
    } as never);

    await runtime.handleBeforePromptBuild(
      { prompt: "我上周项目进展如何", messages: [] } as never,
      { sessionKey: "session-case" } as never,
    );

    runtime.handleBeforeToolCall(
      {
        toolName: "memory_search",
        params: { query: "上周项目进展" },
        toolCallId: "tool-1",
      },
      { sessionKey: "session-case" } as never,
    );
    runtime.handleAfterToolCall(
      {
        toolName: "memory_search",
        params: { query: "上周项目进展" },
        toolCallId: "tool-1",
        result: { refs: { files: ["projects/demo/Project/current-stage.md"] } },
        durationMs: 32,
      },
      { sessionKey: "session-case" } as never,
    );

    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "我上周项目进展如何" },
          { role: "assistant", content: "上周主要在推进检索链路改造。" },
        ],
      } as never,
      { sessionKey: "session-case" } as never,
    );

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sessionKey: "session-case",
      query: "我上周项目进展如何",
      status: "completed",
      assistantReply: "上周主要在推进检索链路改造。",
      retrieval: {
        intent: "project_memory",
        injected: true,
        contextPreview: "## Evidence Note\n上周主要在推进检索链路改造。",
      },
    });
    expect((records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string }> } })?.trace?.steps?.map((step) => step.kind)).toEqual([
      "recall_start",
      "memory_gate",
      "project_shortlist_built",
      "project_selected",
      "manifest_scanned",
      "manifest_selected",
    ]);
    expect((records[0]?.toolEvents as Array<Record<string, unknown>>)?.map((event) => event.phase)).toEqual(["start", "result"]);
    expect((records[0]?.toolEvents as Array<Record<string, unknown>>)?.[0]?.summaryI18n).toMatchObject({
      key: "trace.tool.summary.started",
    });
    expect((records[0]?.toolEvents as Array<Record<string, unknown>>)?.[1]?.summaryI18n).toMatchObject({
      key: "trace.tool.summary.completed",
    });

    runtime.stop();
  });

  it("marks the previous case interrupted when a new user turn arrives in the same session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "第一个问题",
        },
      } as never,
      { sessionKey: "session-interrupt" } as never,
    );
    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "第二个问题",
        },
      } as never,
      { sessionKey: "session-interrupt" } as never,
    );

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ query: "第二个问题", status: "running" });
    expect(records[1]).toMatchObject({ query: "第一个问题", status: "interrupted" });

    runtime.stop();
  });

  it("blocks tool writes to workspace or plugin-managed memory files and records the blocked tool event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = await mkdtemp(join(homedir(), "clawxmemory-workspace-"));
    const managedMemoryDir = join(dir, "managed-memory");
    cleanupPaths.push(dir);
    cleanupPaths.push(workspaceDir);
    await mkdir(managedMemoryDir, { recursive: true });

    const runtime = new MemoryPluginRuntime({
      apiConfig: {
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      },
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        memoryDir: managedMemoryDir,
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "记住这件事。",
        },
      } as never,
      { sessionKey: "session-boundary" } as never,
    );

    const blockedUser = runtime.handleBeforeToolCall(
      {
        toolName: "write",
        params: { path: "USER.md", content: "bad" },
        toolCallId: "tool-user",
      } as never,
      { sessionKey: "session-boundary" } as never,
    );
    expect(blockedUser).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("USER.md"),
    });

    const blockedManifest = runtime.handleBeforeToolCall(
      {
        toolName: "edit",
        params: { file_path: "MEMORY.md", old_string: "", new_string: "bad" },
        toolCallId: "tool-manifest",
      } as never,
      { sessionKey: "session-boundary" } as never,
    );
    expect(blockedManifest).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("MEMORY.md"),
    });

    const blockedMemoryFile = runtime.handleBeforeToolCall(
      {
        toolName: "write",
        params: { path: "memory/2026-04-10.md", content: "bad" },
        toolCallId: "tool-memory",
      } as never,
      { sessionKey: "session-boundary" } as never,
    );
    expect(blockedMemoryFile).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("memory/2026-04-10.md"),
    });

    const tildeWorkspaceMemoryPath = `~/${relative(homedir(), join(workspaceDir, "memory", "2026-04-10.md")).replace(/\\/g, "/")}`;
    const blockedTildeWorkspaceMemory = runtime.handleBeforeToolCall(
      {
        toolName: "write",
        params: { path: tildeWorkspaceMemoryPath, content: "bad" },
        toolCallId: "tool-memory-tilde",
      } as never,
      { sessionKey: "session-boundary" } as never,
    );
    expect(blockedTildeWorkspaceMemory).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("memory/2026-04-10.md"),
    });

    const blockedManagedMemory = runtime.handleBeforeToolCall(
      {
        toolName: "write",
        params: { path: join(managedMemoryDir, "projects", "_tmp", "Project", "memory-item.md"), content: "bad" },
        toolCallId: "tool-managed-memory",
      } as never,
      { sessionKey: "session-boundary" } as never,
    );
    expect(blockedManagedMemory).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("managed-memory/projects/_tmp/Project/memory-item.md"),
    });

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect((records[0]?.toolEvents as Array<Record<string, unknown>>)?.map((event) => [event.phase, event.status])).toEqual([
      ["start", "running"],
      ["result", "error"],
      ["start", "running"],
      ["result", "error"],
      ["start", "running"],
      ["result", "error"],
      ["start", "running"],
      ["result", "error"],
      ["start", "running"],
      ["result", "error"],
    ]);
    expect((records[0]?.toolEvents as Array<Record<string, unknown>>)?.map((event) => event.resultPreview)).toEqual([
      undefined,
      "Blocked path: USER.md",
      undefined,
      "Blocked path: MEMORY.md",
      undefined,
      "Blocked path: memory/2026-04-10.md",
      undefined,
      "Blocked path: memory/2026-04-10.md",
      undefined,
      "Blocked path: managed-memory/projects/_tmp/Project/memory-item.md",
    ]);

    runtime.stop();
  });

  it("allows tool writes to normal workspace files outside the managed memory boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = join(dir, "workspace");
    cleanupPaths.push(dir);
    await mkdir(workspaceDir, { recursive: true });

    const runtime = new MemoryPluginRuntime({
      apiConfig: {
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      },
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "帮我更新项目文档。",
        },
      } as never,
      { sessionKey: "session-allowed-write" } as never,
    );

    const allowed = runtime.handleBeforeToolCall(
      {
        toolName: "write",
        params: { path: "docs/plan.md", content: "# plan" },
        toolCallId: "tool-doc",
      } as never,
      { sessionKey: "session-allowed-write" } as never,
    );

    expect(allowed).toBeUndefined();

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect((records[0]?.toolEvents as Array<Record<string, unknown>>)?.map((event) => [event.phase, event.status, event.summary])).toEqual([
      ["start", "running", "write started."],
    ]);

    runtime.stop();
  });

  it("merges control-ui metadata prompts and cleaned user messages into one case", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const retrieve = vi.fn().mockResolvedValue({
      query: "我对于天津旅游的规划是什么",
      intent: "project_memory",
      context: "## Evidence Note\n4月1日未制定新的天津旅游规划，但已有相关天津项目在推进。",
      trace: {
        traceId: "trace-merge",
        query: "我对于天津旅游的规划是什么",
        mode: "auto",
        startedAt: "2026-04-01T00:00:00.000Z",
        finishedAt: "2026-04-01T00:00:01.000Z",
        steps: [
          {
            stepId: "trace-merge:1",
            kind: "recall_start",
            title: "Recall Started",
            status: "info",
            inputSummary: "我对于天津旅游的规划是什么",
            outputSummary: "mode=auto",
          },
        ],
      },
      debug: {
        mode: "llm",
        elapsedMs: 12,
        cacheHit: false,
      },
    });
    (runtime as { retriever: { retrieve: typeof retrieve } }).retriever = { retrieve };

    await runtime.handleBeforePromptBuild(
      {
        prompt: [
          "Sender (untrusted metadata):",
          "```json",
          "{",
          "  \"label\": \"openclaw-control-ui\",",
          "  \"id\": \"openclaw-control-ui\"",
          "}",
          "```",
          "",
          "[Wed 2026-04-01 15:20 GMT+8] 我对于天津旅游的规划是什么",
        ].join("\n"),
        messages: [],
      } as never,
      { sessionKey: "session-merge" } as never,
    );

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "我对于天津旅游的规划是什么",
        },
      } as never,
      { sessionKey: "session-merge" } as never,
    );

    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "我对于天津旅游的规划是什么" },
          { role: "assistant", content: "你目前主要在推进清明假期天津穷游攻略。" },
        ],
      } as never,
      { sessionKey: "session-merge" } as never,
    );

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect(retrieve).toHaveBeenCalledWith(
      "我对于天津旅游的规划是什么",
      expect.objectContaining({ retrievalMode: "auto" }),
    );
    expect(records[0]).toMatchObject({
      sessionKey: "session-merge",
      query: "我对于天津旅游的规划是什么",
      status: "completed",
      retrieval: {
        intent: "project_memory",
        injected: true,
      },
    });
    expect((records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string }> } })?.trace?.steps?.map((step) => step.kind)).toEqual([
      "recall_start",
    ]);

    runtime.stop();
  });

  it("creates a case from user message write even when retrieval data is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "这是一个没有触发 recall 记录的测试问题",
        },
      } as never,
      { sessionKey: "session-write-only" } as never,
    );

    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "这是一个没有触发 recall 记录的测试问题" },
          { role: "assistant", content: "这是最终回答。" },
        ],
      } as never,
      { sessionKey: "session-write-only" } as never,
    );

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sessionKey: "session-write-only",
      query: "这是一个没有触发 recall 记录的测试问题",
      status: "completed",
      assistantReply: "这是最终回答。",
      retrieval: {
        intent: "none",
        injected: false,
      },
    });
    expect((records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string }> } })?.trace?.steps?.map((step) => step.kind)).toEqual([
      "recall_start",
      "recall_skipped",
    ]);

    runtime.stop();
  });

  it("captures normal turns without immediate indexing and flushes explicit remember turns immediately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const requestIndexRun = vi.spyOn(runtime as never as {
      requestIndexRun: (reason: string, sessionKeys?: string[]) => Promise<unknown>;
    }, "requestIndexRun").mockResolvedValue({
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    });

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
        },
      } as never,
      { sessionKey: "session-batch" } as never,
    );

    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。" },
          { role: "assistant", content: "好的，我记下 Boreal 了。" },
        ],
      } as never,
      { sessionKey: "session-batch" } as never,
    );

    expect(requestIndexRun).not.toHaveBeenCalled();
    expect(runtime.repository.listPendingSessionKeys()).toEqual(["session-batch"]);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "记住，在这个项目里，你给我汇报时要先说完成了什么，再说风险。",
        },
      } as never,
      { sessionKey: "session-batch" } as never,
    );

    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "记住，在这个项目里，你给我汇报时要先说完成了什么，再说风险。" },
          { role: "assistant", content: "好的，我记住这条项目内规则。" },
        ],
      } as never,
      { sessionKey: "session-batch" } as never,
    );

    expect(requestIndexRun).toHaveBeenCalledWith("explicit_remember", ["session-batch"]);
    runtime.stop();
  });

  it("normalizes contaminated inbound user turns before case tracing and L0 capture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const contaminatedUserTurn = [
      "Project state maintained by ClawXContext.",
      "Current git branch: main",
      "Git status summary: clean working tree",
      "",
      "我昨天把排位打上新段位了",
    ].join("\n");

    runtime.handleInternalMessageReceived({
      type: "message",
      action: "received",
      sessionKey: "session-noise-filter",
      context: {
        content: contaminatedUserTurn,
      },
    } as never);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: contaminatedUserTurn,
        },
      } as never,
      { sessionKey: "session-noise-filter" } as never,
    );

    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: contaminatedUserTurn },
          { role: "assistant", content: "这确实值得记下来，后面再复盘你的上分节奏。" },
        ],
      } as never,
      { sessionKey: "session-noise-filter" } as never,
    );

    const records = (runtime as never as {
      listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
    }).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      query: "我昨天把排位打上新段位了",
    });
    expect(runtime.repository.listRecentL0(10)).toMatchObject([
      {
        sessionKey: "session-noise-filter",
        messages: [
          { role: "user", content: "我昨天把排位打上新段位了" },
          { role: "assistant", content: "这确实值得记下来，后面再复盘你的上分节奏。" },
        ],
      },
    ]);

    runtime.stop();
  });

  it("sanitizes recall scaffolding when agent_end falls back to raw event messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    await runtime.handleAgentEnd(
      {
        messages: [
          {
            role: "user",
            content: [
              "## ClawXMemory Recall",
              "",
              "Use the following retrieved ClawXMemory evidence for this turn.",
              "",
              "## ClawXMemory Retrieved Evidence",
              "intent=general",
              "enoughAt=l0",
              "",
              "Treat the selected evidence above as authoritative historical memory for this turn when it is relevant.",
              "If the needed answer is already shown above, do not claim that memory is missing or that this is a fresh conversation.",
              "",
              "[Tue 2026-03-24 16:24 GMT+8] 感觉冒菜可以",
            ].join("\n"),
          },
          {
            role: "assistant",
            content: "胃菜不错！热乎又管饱。",
          },
        ],
      } as never,
      {
        sessionKey: "session-recall-fallback",
      } as never,
    );

    const record = runtime.repository.listRecentL0(1)[0];
    expect(record).toBeDefined();
    expect(record?.messages).toEqual([
      { role: "user", content: "感觉冒菜可以" },
      { role: "assistant", content: "胃菜不错！热乎又管饱。" },
    ]);

    runtime.stop();
  });

  it("drops assistant-only plugin status scaffolding during agent_end fallback capture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    await runtime.handleAgentEnd(
      {
        messages: [
          {
            role: "user",
            content: "帮我记一下我昨晚把排位打上新段位了",
          },
          {
            role: "assistant",
            content: [
              "Project state maintained by ClawXContext.",
              "Current git branch: main",
              "Git status summary: clean working tree",
            ].join("\n"),
          },
        ],
      } as never,
      {
        sessionKey: "session-status-only-assistant",
      } as never,
    );

    const record = runtime.repository.listRecentL0(1)[0];
    expect(record?.messages).toEqual([
      { role: "user", content: "帮我记一下我昨晚把排位打上新段位了" },
    ]);

    runtime.stop();
  });

  it("starts only once even if the plugin service start hook is invoked repeatedly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const rescheduleBackgroundTasks = vi
      .spyOn(runtime as never as { rescheduleBackgroundTasks: () => void }, "rescheduleBackgroundTasks")
      .mockImplementation(() => {});
    const runStartupInitialization = vi
      .spyOn(runtime as never as { runStartupInitialization: () => Promise<void> }, "runStartupInitialization")
      .mockResolvedValue(undefined);

    runtime.start();
    runtime.start();

    expect(rescheduleBackgroundTasks).toHaveBeenCalledTimes(1);
    expect(runStartupInitialization).toHaveBeenCalledTimes(1);
  });

  it("skips command-only turns until the next real user turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "/new",
        },
      } as never,
      { sessionKey: "session-command-only" } as never,
    );
    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "assistant",
          content: "Started a new session.",
        },
      } as never,
      { sessionKey: "session-command-only" } as never,
    );

    expect(runtime.repository.listRecentL0(10)).toEqual([]);

    runtime.handleBeforeMessageWrite(
      {
        message: {
          role: "user",
          content: "真正的问题",
        },
      } as never,
      { sessionKey: "session-command-only" } as never,
    );
    await runtime.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "真正的问题" },
          { role: "assistant", content: "这是实际回答。" },
        ],
      } as never,
      { sessionKey: "session-command-only" } as never,
    );

    expect(runtime.repository.listRecentL0(10)).toMatchObject([
      {
        sessionKey: "session-command-only",
        messages: [
          { role: "user", content: "真正的问题" },
          { role: "assistant", content: "这是实际回答。" },
        ],
      },
    ]);
  });

  it("rotates exactly one conversation window for /new and /reset startup markers", async () => {
    for (const action of ["new", "reset"] as const) {
      const dir = await mkdtemp(join(tmpdir(), `clawxmemory-runtime-${action}-`));
      cleanupPaths.push(dir);

      const runtime = new MemoryPluginRuntime({
        apiConfig: {},
        pluginRuntime: undefined,
        pluginConfig: {
          dbPath: join(dir, "memory.sqlite"),
          uiEnabled: false,
        },
        logger: undefined,
      });
      runtimes.push(runtime);

      runtime.handleInternalCommandEvent(
        {
          type: "command",
          action,
          sessionKey: `session-${action}`,
        } as never,
      );
      const blocked = runtime.handleBeforeMessageWrite(
        {
          message: {
            role: "user",
            content: "A new session was started via /new or /reset.",
          },
        } as never,
        { sessionKey: `session-${action}` } as never,
      );

      expect(blocked).toEqual({ block: true });
      expect((runtime as never as {
        getEffectiveSessionKey: (sessionKey: string) => string;
      }).getEffectiveSessionKey(`session-${action}`)).toBe(`session-${action}#window:1`);
      runtime.handleBeforeMessageWrite(
        {
          message: {
            role: "assistant",
            content: "",
          },
        } as never,
        { sessionKey: `session-${action}` } as never,
      );

      runtime.handleBeforeMessageWrite(
        {
          message: {
            role: "user",
            content: `跟进${action}后的真实问题`,
          },
        } as never,
        { sessionKey: `session-${action}` } as never,
      );
      await runtime.handleAgentEnd(
        {
          success: true,
          messages: [
            { role: "user", content: `跟进${action}后的真实问题` },
            { role: "assistant", content: `这是${action}后的回答。` },
          ],
        } as never,
        { sessionKey: `session-${action}` } as never,
      );

      expect(runtime.repository.listRecentL0(10)).toMatchObject([
        {
          sessionKey: `session-${action}#window:1`,
          messages: [
            { role: "user", content: `跟进${action}后的真实问题` },
            { role: "assistant", content: `这是${action}后的回答。` },
          ],
        },
      ]);
    }
  });

  it("repairs contaminated l0 records on startup and requeues rebuild", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.repository.insertL0Session({
      l0IndexId: "l0-contaminated",
      sessionKey: "session-repair",
      timestamp: "2026-03-24T08:24:13.000Z",
      source: "openclaw",
      indexed: true,
      createdAt: "2026-03-24T08:24:13.000Z",
      messages: [
        {
          role: "user",
          content: [
            "Project state maintained by ClawXContext.",
            "Current git branch: main",
            "Git status summary: clean working tree",
            "",
            "## ClawXMemory Recall",
            "",
            "Use the following retrieved ClawXMemory evidence for this turn.",
            "",
            "## ClawXMemory Retrieved Evidence",
            "intent=general",
            "enoughAt=l0",
            "",
            "Treat the selected evidence above as authoritative historical memory for this turn when it is relevant.",
            "If the needed answer is already shown above, do not claim that memory is missing or that this is a fresh conversation.",
            "",
            "System: [2026-03-24 16:24:10] Gateway restart update ok (npm)",
            "",
            "[Tue 2026-03-24 16:24 GMT+8] 感觉冒菜可以",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "胃菜不错！热乎又管饱。",
        },
      ],
    });

    const runHeartbeat = vi.spyOn(runtime.indexer, "runHeartbeat").mockResolvedValue({
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    });

    runtime.start();

    await vi.waitFor(() => {
      const record = runtime.repository.listRecentL0(1)[0];
      expect(record?.messages).toEqual([
        { role: "user", content: "感觉冒菜可以" },
        { role: "assistant", content: "胃菜不错！热乎又管饱。" },
      ]);
      expect(record?.indexed).toBe(false);
      expect(runHeartbeat).toHaveBeenCalledWith({ reason: "repair" });
    });

    runtime.stop();
  });

  it("removes historical l0 rows that only contain plugin state scaffolding during startup repair", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.repository.insertL0Session({
      l0IndexId: "l0-plugin-noise-only",
      sessionKey: "session-noise-only",
      timestamp: "2026-04-03T04:19:44.000Z",
      source: "openclaw",
      indexed: true,
      createdAt: "2026-04-03T04:19:44.000Z",
      messages: [
        {
          role: "user",
          content: [
            "Project state maintained by ClawXContext.",
            "Current git branch: main",
            "Git status summary: clean working tree",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "📊 **Session Status** - **Agent:** main - **Host:** Example Laptop - **Workspace:** /Users/example/openclaw/workspace - **OS:** Darwin 25.4.0 - **Node:** v22.18.0",
        },
      ],
    });

    const runHeartbeat = vi.spyOn(runtime.indexer, "runHeartbeat").mockResolvedValue({
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    });

    runtime.start();

    await vi.waitFor(() => {
      expect(runtime.repository.listRecentL0(10)).toEqual([]);
      expect(runHeartbeat).toHaveBeenCalledWith({ reason: "repair" });
    });

    runtime.stop();
  });

  it("starts lazily from gateway hook activity and exposes a 4.2 memory runtime adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const startSpy = vi.spyOn(runtime, "start").mockImplementation(() => {});

    runtime.handleInternalCommandEvent({
      type: "command",
      action: "status",
      sessionKey: "session-command-bootstrap",
    } as never);

    expect(startSpy).toHaveBeenCalledTimes(1);

    const adapter = runtime.getMemoryRuntimeAdapter();
    expect(adapter.resolveMemoryBackendConfig()).toEqual({ backend: "builtin" });
    await expect(adapter.getMemorySearchManager()).resolves.toEqual({
      manager: null,
      error: "ClawXMemory manages dynamic session memory and does not expose OpenClaw file-memory search managers.",
    });
    expect(startSpy).toHaveBeenCalledTimes(3);
  });

  it("writes managed config and requests a gateway restart on first startup when native memory is still enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clawxmemory-workspace-"));
    cleanupPaths.push(dir, workspaceDir);

    const loadConfig = vi.fn().mockResolvedValue({
      plugins: {
        slots: {
          memory: "memory-core",
        },
        entries: {
          "memory-core": {
            enabled: true,
          },
          "openbmb-clawxmemory": {
            enabled: false,
            hooks: {
              allowPromptInjection: false,
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: true,
            },
          },
        },
      },
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            enabled: true,
          },
          compaction: {
            memoryFlush: {
              enabled: true,
            },
          },
        },
      },
      tools: {
        alsoAllow: ["custom_tool"],
      },
      custom: {
        untouched: true,
      },
    });
    const writeConfigFile = vi.fn().mockResolvedValue(undefined);
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: {
        version: "test",
        config: {
          loadConfig,
          writeConfigFile,
        },
        system: {
          runCommandWithTimeout,
        },
      } as never,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const startBackgroundRepair = vi
      .spyOn(runtime as never as { startBackgroundRepair: () => void }, "startBackgroundRepair")
      .mockImplementation(() => {});

    runtime.start();

    await vi.waitFor(() => {
      expect(writeConfigFile).toHaveBeenCalledTimes(1);
      expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    });

    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      ["openclaw", "gateway", "restart"],
      { timeoutMs: expect.any(Number) },
    );
    expect(writeConfigFile.mock.calls[0]?.[0]).toMatchObject({
      plugins: {
        slots: {
          memory: "openbmb-clawxmemory",
        },
        entries: {
          "memory-core": {
            enabled: false,
          },
          "openbmb-clawxmemory": {
            enabled: true,
            hooks: {
              allowPromptInjection: true,
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: false,
            },
          },
        },
      },
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            enabled: false,
          },
          compaction: {
            memoryFlush: {
              enabled: false,
            },
          },
        },
      },
      custom: {
        untouched: true,
      },
    });
    expect(writeConfigFile.mock.calls[0]?.[0]?.tools).toMatchObject({
      alsoAllow: ["custom_tool", "memory_overview", "memory_list", "memory_flush", "memory_dream"],
    });

    const overview = (runtime as never as {
      getRuntimeOverview: () => Record<string, unknown>;
    }).getRuntimeOverview();
    expect(overview).toMatchObject({
      runtimeIssues: [],
    });
    expect(startBackgroundRepair).not.toHaveBeenCalled();
  });

  it("skips config writes and restart when the managed boundary is already healthy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clawxmemory-workspace-"));
    cleanupPaths.push(dir, workspaceDir);

    const healthyConfig = applyManagedMemoryBoundaryConfig({
      agents: {
        defaults: {
          workspace: workspaceDir,
        },
      },
      tools: {
        alsoAllow: ["custom_tool"],
      },
    }).config;
    const loadConfig = vi.fn().mockResolvedValue(healthyConfig);
    const writeConfigFile = vi.fn().mockResolvedValue(undefined);
    const runCommandWithTimeout = vi.fn();

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: {
        version: "test",
        config: {
          loadConfig,
          writeConfigFile,
        },
        system: {
          runCommandWithTimeout,
        },
      } as never,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const startBackgroundRepair = vi
      .spyOn(runtime as never as { startBackgroundRepair: () => void }, "startBackgroundRepair")
      .mockImplementation(() => {});

    runtime.start();

    await vi.waitFor(() => {
      expect(startBackgroundRepair).toHaveBeenCalledTimes(1);
    });

    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(runCommandWithTimeout).not.toHaveBeenCalled();

    const overview = (runtime as never as {
      getRuntimeOverview: () => Record<string, unknown>;
    }).getRuntimeOverview();
    expect(overview).toMatchObject({
      runtimeIssues: [],
    });
  });

  it("surfaces startup repair failure when config write fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clawxmemory-workspace-"));
    cleanupPaths.push(dir, workspaceDir);

    const loadConfig = vi.fn().mockResolvedValue({
      plugins: {
        slots: {
          memory: "memory-core",
        },
      },
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            enabled: true,
          },
          compaction: {
            memoryFlush: {
              enabled: true,
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: true,
            },
          },
        },
      },
    });
    const writeConfigFile = vi.fn().mockRejectedValue(new Error("config write denied"));
    const runCommandWithTimeout = vi.fn();

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: {
        version: "test",
        config: {
          loadConfig,
          writeConfigFile,
        },
        system: {
          runCommandWithTimeout,
        },
      } as never,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const startBackgroundRepair = vi
      .spyOn(runtime as never as { startBackgroundRepair: () => void }, "startBackgroundRepair")
      .mockImplementation(() => {});

    runtime.start();

    await vi.waitFor(() => {
      const overview = (runtime as never as {
        getRuntimeOverview: () => Record<string, unknown>;
      }).getRuntimeOverview();
      expect(overview.startupRepairMessage).toBe("config write denied");
    });

    const overview = (runtime as never as {
      getRuntimeOverview: () => Record<string, unknown>;
    }).getRuntimeOverview();
    expect(overview.startupRepairMessage).toBe("config write denied");
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(startBackgroundRepair).not.toHaveBeenCalled();
  });

  it("surfaces startup repair failure when the restart request fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clawxmemory-workspace-"));
    cleanupPaths.push(dir, workspaceDir);

    const loadConfig = vi.fn().mockResolvedValue({
      plugins: {
        slots: {
          memory: "memory-core",
        },
      },
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            enabled: true,
          },
          compaction: {
            memoryFlush: {
              enabled: true,
            },
          },
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: true,
            },
          },
        },
      },
    });
    const writeConfigFile = vi.fn().mockResolvedValue(undefined);
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "gateway restart failed",
      timedOut: false,
    });

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: {
        version: "test",
        config: {
          loadConfig,
          writeConfigFile,
        },
        system: {
          runCommandWithTimeout,
        },
      } as never,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const startBackgroundRepair = vi
      .spyOn(runtime as never as { startBackgroundRepair: () => void }, "startBackgroundRepair")
      .mockImplementation(() => {});

    runtime.start();

    await vi.waitFor(() => {
      const overview = (runtime as never as {
        getRuntimeOverview: () => Record<string, unknown>;
      }).getRuntimeOverview();
      expect(overview.startupRepairMessage).toBe("gateway restart failed");
    });

    const overview = (runtime as never as {
      getRuntimeOverview: () => Record<string, unknown>;
    }).getRuntimeOverview();
    expect(overview.startupRepairMessage).toBe("gateway restart failed");
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    expect(startBackgroundRepair).not.toHaveBeenCalled();
  });

  it("runs Dream after pending queue work and prep-flushes before reconstruction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const pendingQueue = deferred<{
      capturedSessions: number;
      writtenFiles: number;
      writtenProjectFiles: number;
      writtenFeedbackFiles: number;
      userProfilesUpdated: number;
      failedSessions: number;
    }>();
    (runtime as never as { queuePromise: Promise<unknown> }).queuePromise = pendingQueue.promise;

    const prepFlush = {
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    };
    const dreamOutcome = {
      reviewedFiles: 3,
      rewrittenProjects: 1,
      deletedProjects: 0,
      deletedFiles: 0,
      profileUpdated: true,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      summary: "ok",
    };
    const dreamSpy = vi.spyOn((runtime as never as {
      dreamRewriter: { run: () => Promise<typeof dreamOutcome> };
    }).dreamRewriter, "run").mockResolvedValue(dreamOutcome);

    const dreamPromise = (runtime as never as {
      runDreamNow: (trigger: "manual") => Promise<Record<string, unknown>>;
    }).runDreamNow("manual");
    expect(dreamSpy).not.toHaveBeenCalled();

    pendingQueue.resolve({
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    });

    await vi.waitFor(() => {
      expect(dreamSpy).toHaveBeenCalledTimes(1);
    });

    const result = await dreamPromise;
    expect(result).toMatchObject({
      prepFlush,
      reviewedFiles: 3,
      rewrittenProjects: 1,
    });
  });

  it("queues heartbeat work while Dream is running and rejects concurrent Dream runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const dreamDeferred = deferred<{
      reviewedFiles: number;
      rewrittenProjects: number;
      deletedProjects: number;
      deletedFiles: number;
      profileUpdated: boolean;
      duplicateTopicCount: number;
      conflictTopicCount: number;
      summary: string;
    }>();
    vi.spyOn((runtime as never as {
      dreamRewriter: { run: () => Promise<unknown> };
    }).dreamRewriter, "run").mockImplementation(() => dreamDeferred.promise);

    const drainSpy = vi.spyOn(runtime as never as {
      drainIndexQueue: () => Promise<Record<string, number>>;
    }, "drainIndexQueue").mockResolvedValue({
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    });

    const dreamPromise = (runtime as never as {
      runDreamNow: (trigger: "manual") => Promise<unknown>;
    }).runDreamNow("manual");
    await vi.waitFor(() => {
      expect((runtime as never as { dreamRunLocked: boolean }).dreamRunLocked).toBe(true);
    });

    await expect((runtime as never as {
      runDreamNow: (trigger: "manual") => Promise<unknown>;
    }).runDreamNow("manual")).resolves.toMatchObject({
      status: "skipped",
      skipReason: "already_running",
      trigger: "manual",
    });

    const queuedIndexPromise = (runtime as never as {
      requestIndexRun: (reason: string, sessionKeys?: string[]) => Promise<unknown>;
    }).requestIndexRun("scheduled", ["session-a"]);
    expect(drainSpy).not.toHaveBeenCalled();

    dreamDeferred.resolve({
      reviewedFiles: 2,
      rewrittenProjects: 1,
      deletedProjects: 0,
      deletedFiles: 0,
      profileUpdated: true,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      summary: "done",
    });

    await queuedIndexPromise;
    await dreamPromise;
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it("schedules auto index and auto Dream timers and rebuilds them after settings changes", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    vi.spyOn(runtime as never as {
      runStartupInitialization: () => Promise<void>;
    }, "runStartupInitialization").mockResolvedValue(undefined);
    const indexSpy = vi.spyOn(runtime as never as {
      requestIndexRun: (reason: string, sessionKeys?: string[]) => Promise<unknown>;
    }, "requestIndexRun").mockResolvedValue({
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    });
    const dreamSpy = vi.spyOn(runtime as never as {
      runDreamNow: (trigger: "manual" | "scheduled") => Promise<unknown>;
    }, "runDreamNow").mockResolvedValue({
      prepFlush: {
        capturedSessions: 0,
        writtenFiles: 0,
        writtenProjectFiles: 0,
        writtenFeedbackFiles: 0,
        userProfilesUpdated: 0,
        failedSessions: 0,
      },
      reviewedFiles: 0,
      rewrittenProjects: 0,
      deletedProjects: 0,
      deletedFiles: 0,
      profileUpdated: false,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      summary: "noop",
      status: "skipped",
      trigger: "scheduled",
      skipReason: "no_memory_updates_since_last_dream",
    });

    runtime.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(indexSpy).toHaveBeenCalledWith("scheduled");
    expect(dreamSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(dreamSpy).toHaveBeenCalledWith("scheduled");

    indexSpy.mockClear();
    dreamSpy.mockClear();

    (runtime as never as {
      applyIndexingSettings: (partial: Record<string, unknown>) => unknown;
    }).applyIndexingSettings({
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 60,
    });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(indexSpy).not.toHaveBeenCalled();
    expect(dreamSpy).toHaveBeenCalledWith("scheduled");

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(indexSpy).toHaveBeenCalledWith("scheduled");
  });

  it("skips scheduled Dream when no memory files changed since the last Dream run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const prepFlush = {
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    };
    runtime.repository.setPipelineState("lastDreamAt", "2026-04-10T00:00:00.000Z");
    const dreamSpy = vi.spyOn((runtime as never as {
      dreamRewriter: { run: () => Promise<unknown> };
    }).dreamRewriter, "run").mockResolvedValue({
      reviewedFiles: 1,
      rewrittenProjects: 1,
      deletedProjects: 0,
      deletedFiles: 0,
      profileUpdated: true,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      summary: "should not run",
    });

    const result = await (runtime as never as {
      runDreamNow: (trigger: "scheduled") => Promise<Record<string, unknown>>;
    }).runDreamNow("scheduled");

    expect(dreamSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "skipped",
      trigger: "scheduled",
      prepFlush,
      skipReason: "no_memory_updates_since_last_dream",
    });
    expect(runtime.repository.getPipelineState("lastDreamStatus")).toBe("skipped");
  });

  it("runs scheduled Dream when memory files changed since the last Dream run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    const store = runtime.repository.getFileMemoryStore();
    runtime.repository.setPipelineState("lastDreamAt", "2026-04-10T00:00:00.000Z");
    store.upsertCandidate({
      type: "feedback",
      scope: "project",
      name: "rule-0",
      description: "rule-0",
      rule: "rule-0",
      why: "test",
      howToApply: "test",
    });

    const prepFlush = {
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    };
    const dreamSpy = vi.spyOn((runtime as never as {
      dreamRewriter: { run: () => Promise<unknown> };
    }).dreamRewriter, "run").mockResolvedValue({
      reviewedFiles: 10,
      rewrittenProjects: 2,
      deletedProjects: 1,
      deletedFiles: 0,
      profileUpdated: true,
      duplicateTopicCount: 1,
      conflictTopicCount: 0,
      summary: "scheduled ok",
    });

    const result = await (runtime as never as {
      runDreamNow: (trigger: "scheduled") => Promise<Record<string, unknown>>;
    }).runDreamNow("scheduled");

    expect(dreamSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      trigger: "scheduled",
      reviewedFiles: 10,
      rewrittenProjects: 2,
    });
    expect(runtime.repository.getPipelineState("lastDreamStatus")).toBe("success");
  });

  it("does not apply the auto Dream threshold to manual Dream runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-runtime-"));
    cleanupPaths.push(dir);

    const runtime = new MemoryPluginRuntime({
      apiConfig: {},
      pluginRuntime: undefined,
      pluginConfig: {
        dbPath: join(dir, "memory.sqlite"),
        uiEnabled: false,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    runtime.repository.getFileMemoryStore().upsertCandidate({
      type: "feedback",
      scope: "project",
      name: "single-feedback",
      description: "single feedback",
      rule: "先说完成，再说风险。",
    });

    const prepFlush = {
      capturedSessions: 0,
      writtenFiles: 0,
      writtenProjectFiles: 0,
      writtenFeedbackFiles: 0,
      userProfilesUpdated: 0,
      failedSessions: 0,
    };
    const dreamSpy = vi.spyOn((runtime as never as {
      dreamRewriter: { run: () => Promise<unknown> };
    }).dreamRewriter, "run").mockResolvedValue({
      reviewedFiles: 1,
      rewrittenProjects: 1,
      deletedProjects: 0,
      deletedFiles: 0,
      profileUpdated: true,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      summary: "manual ok",
    });

    const result = await (runtime as never as {
      runDreamNow: (trigger: "manual") => Promise<Record<string, unknown>>;
    }).runDreamNow("manual");

    expect(dreamSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      trigger: "manual",
      reviewedFiles: 1,
    });
  });
});
