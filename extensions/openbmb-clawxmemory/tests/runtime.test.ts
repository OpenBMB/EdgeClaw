import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function setRuntimeRetriever(
  runtime: MemoryPluginRuntime,
  retrieve: MemoryPluginRuntime["retriever"]["retrieve"],
): void {
  Object.defineProperty(runtime, "retriever", {
    value: { retrieve },
    configurable: true,
    writable: true,
  });
}

describe("MemoryPluginRuntime", () => {
  const cleanupPaths: string[] = [];
  const runtimes: MemoryPluginRuntime[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const runtime of runtimes.splice(0)) {
      runtime.stop();
    }
    await Promise.all(
      cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
    );
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
    expect(result.changedPaths).toEqual(
      expect.arrayContaining([
        "plugins.slots.memory",
        "plugins.entries.openbmb-clawxmemory.enabled",
        "plugins.entries.openbmb-clawxmemory.hooks.allowPromptInjection",
        "plugins.entries.memory-core.enabled",
        "hooks.internal.entries.session-memory.enabled",
        "agents.defaults.memorySearch.enabled",
        "agents.defaults.compaction.memoryFlush.enabled",
        "tools.alsoAllow",
      ]),
    );
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
      alsoAllow: ["custom_tool", "memory_list", "memory_overview", "memory_flush"],
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

    setRuntimeRetriever(
      runtime,
      vi.fn().mockResolvedValue({
        query: "What happened yesterday?",
        intent: "time",
        enoughAt: "l2",
        profile: null,
        evidenceNote: "2026-03-23: OpenClaw plugin SDK migration started.",
        l2Results: [],
        l1Results: [],
        l0Results: [],
        context: "2026-03-23: OpenClaw plugin SDK migration started.",
        debug: {
          mode: "local_fallback",
          elapsedMs: 25,
          cacheHit: false,
        },
      }),
    );

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
      intent: "time",
      enoughAt: "l2",
      profile: null,
      evidenceNote: "expanded note",
      l2Results: [],
      l1Results: [],
      l0Results: [],
      context: "expanded note",
      debug: {
        mode: "llm",
        elapsedMs: 20,
        cacheHit: false,
      },
    });
    setRuntimeRetriever(runtime, retrieve);

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

    setRuntimeRetriever(
      runtime,
      vi.fn().mockResolvedValue({
        query: "我上周项目进展如何",
        intent: "project",
        enoughAt: "l1",
        profile: null,
        evidenceNote: "上周主要在推进检索链路改造。",
        l2Results: [],
        l1Results: [],
        l0Results: [],
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
              kind: "hop1_decision",
              title: "Hop 1 Decision",
              status: "success",
              inputSummary: "query",
              outputSummary: "memoryRelevant=yes",
            },
            {
              stepId: "trace-1:3",
              kind: "l2_candidates",
              title: "L2 Candidates",
              status: "success",
              inputSummary: "lookup",
              outputSummary: "project candidates",
            },
            {
              stepId: "trace-1:4",
              kind: "hop2_decision",
              title: "Hop 2 Decision",
              status: "success",
              inputSummary: "l2",
              outputSummary: "descend_l1",
            },
            {
              stepId: "trace-1:5",
              kind: "l1_candidates",
              title: "L1 Candidates",
              status: "success",
              inputSummary: "l1 lookup",
              outputSummary: "l1-1",
            },
            {
              stepId: "trace-1:6",
              kind: "hop3_decision",
              title: "Hop 3 Decision",
              status: "success",
              inputSummary: "evidence",
              outputSummary: "enoughAt=l1",
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
    );

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
        result: { evidenceNote: "note" },
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

    const records = (
      runtime as never as {
        listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
      }
    ).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sessionKey: "session-case",
      query: "我上周项目进展如何",
      status: "completed",
      assistantReply: "上周主要在推进检索链路改造。",
      retrieval: {
        intent: "project",
        enoughAt: "l1",
        injected: true,
        pathSummary: "l2->l1",
        evidenceNotePreview: "上周主要在推进检索链路改造。",
      },
    });
    expect(
      (records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string }> } })?.trace?.steps?.map(
        (step) => step.kind,
      ),
    ).toEqual([
      "recall_start",
      "hop1_decision",
      "l2_candidates",
      "hop2_decision",
      "l1_candidates",
      "hop3_decision",
    ]);
    expect(
      (records[0]?.toolEvents as Array<Record<string, unknown>>)?.map((event) => event.phase),
    ).toEqual(["start", "result"]);

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

    const records = (
      runtime as never as {
        listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
      }
    ).listRecentCaseTraces(10);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ query: "第二个问题", status: "running" });
    expect(records[1]).toMatchObject({ query: "第一个问题", status: "interrupted" });

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
      intent: "time",
      enoughAt: "l1",
      profile: null,
      evidenceNote: "4月1日未制定新的天津旅游规划，但已有相关天津项目在推进。",
      l2Results: [],
      l1Results: [],
      l0Results: [],
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
    setRuntimeRetriever(runtime, retrieve);

    await runtime.handleBeforePromptBuild(
      {
        prompt: [
          "Sender (untrusted metadata):",
          "```json",
          "{",
          '  "label": "openclaw-control-ui",',
          '  "id": "openclaw-control-ui"',
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

    const records = (
      runtime as never as {
        listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
      }
    ).listRecentCaseTraces(10);
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
        intent: "time",
        enoughAt: "l1",
        injected: true,
      },
    });
    expect(
      (records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string }> } })?.trace?.steps?.map(
        (step) => step.kind,
      ),
    ).toEqual(["recall_start"]);

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

    const records = (
      runtime as never as {
        listRecentCaseTraces: (limit: number) => Array<Record<string, unknown>>;
      }
    ).listRecentCaseTraces(10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sessionKey: "session-write-only",
      query: "这是一个没有触发 recall 记录的测试问题",
      status: "completed",
      assistantReply: "这是最终回答。",
      retrieval: {
        enoughAt: "none",
        injected: false,
      },
    });
    expect(
      (records[0]?.retrieval as { trace?: { steps?: Array<{ kind: string }> } })?.trace?.steps?.map(
        (step) => step.kind,
      ),
    ).toEqual(["recall_start", "recall_skipped"]);

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
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
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

    expect(runCommandWithTimeout).toHaveBeenCalledWith(["openclaw", "gateway", "restart"], {
      timeoutMs: expect.any(Number),
    });
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
      alsoAllow: ["custom_tool", "memory_overview", "memory_list", "memory_flush"],
    });

    const overview = (
      runtime as never as {
        getRuntimeOverview: () => Record<string, unknown>;
      }
    ).getRuntimeOverview();
    expect(overview).toMatchObject({
      slotOwner: "openbmb-clawxmemory",
      dynamicMemoryRuntime: "ClawXMemory",
      memoryRuntimeHealthy: true,
      runtimeIssues: [],
      startupRepairStatus: "running",
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

    const overview = (
      runtime as never as {
        getRuntimeOverview: () => Record<string, unknown>;
      }
    ).getRuntimeOverview();
    expect(overview).toMatchObject({
      slotOwner: "openbmb-clawxmemory",
      memoryRuntimeHealthy: true,
      runtimeIssues: [],
      startupRepairStatus: "idle",
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
      const overview = (
        runtime as never as {
          getRuntimeOverview: () => Record<string, unknown>;
        }
      ).getRuntimeOverview();
      expect(overview.startupRepairStatus).toBe("failed");
    });

    const overview = (
      runtime as never as {
        getRuntimeOverview: () => Record<string, unknown>;
      }
    ).getRuntimeOverview();
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
      const overview = (
        runtime as never as {
          getRuntimeOverview: () => Record<string, unknown>;
        }
      ).getRuntimeOverview();
      expect(overview.startupRepairStatus).toBe("failed");
    });

    const overview = (
      runtime as never as {
        getRuntimeOverview: () => Record<string, unknown>;
      }
    ).getRuntimeOverview();
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
      l0Captured: number;
      l1Created: number;
      l2TimeUpdated: number;
      l2ProjectUpdated: number;
      profileUpdated: number;
      failed: number;
    }>();
    (runtime as never as { queuePromise: Promise<unknown> }).queuePromise = pendingQueue.promise;

    const prepFlush = {
      l0Captured: 1,
      l1Created: 1,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    };
    const flushSpy = vi
      .spyOn(
        runtime as never as {
          flushAllNow: (
            reason: string,
            options?: { allowWhileDream?: boolean },
          ) => Promise<typeof prepFlush>;
        },
        "flushAllNow",
      )
      .mockResolvedValue(prepFlush);
    const dreamOutcome = {
      reviewedL1: 3,
      rewrittenProjects: 1,
      deletedProjects: 0,
      profileUpdated: true,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      prunedProjectL1Refs: 1,
      prunedProfileL1Refs: 1,
      summary: "ok",
    };
    const dreamSpy = vi
      .spyOn(
        (
          runtime as never as {
            dreamRewriter: { run: () => Promise<typeof dreamOutcome> };
          }
        ).dreamRewriter,
        "run",
      )
      .mockResolvedValue(dreamOutcome);

    const dreamPromise = (
      runtime as never as {
        runDreamNow: (trigger: "manual") => Promise<Record<string, unknown>>;
      }
    ).runDreamNow("manual");
    expect(flushSpy).not.toHaveBeenCalled();
    expect(dreamSpy).not.toHaveBeenCalled();

    pendingQueue.resolve({
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    });

    await vi.waitFor(() => {
      expect(flushSpy).toHaveBeenCalledWith("dream_prep", { allowWhileDream: true });
    });
    await vi.waitFor(() => {
      expect(dreamSpy).toHaveBeenCalledTimes(1);
    });

    const result = await dreamPromise;
    expect(flushSpy.mock.invocationCallOrder[0]).toBeLessThan(dreamSpy.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({
      prepFlush,
      reviewedL1: 3,
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

    const prepFlush = {
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    };
    vi.spyOn(
      runtime as never as {
        flushAllNow: (
          reason: string,
          options?: { allowWhileDream?: boolean },
        ) => Promise<typeof prepFlush>;
      },
      "flushAllNow",
    ).mockResolvedValue(prepFlush);

    const dreamDeferred = deferred<{
      reviewedL1: number;
      rewrittenProjects: number;
      deletedProjects: number;
      profileUpdated: boolean;
      duplicateTopicCount: number;
      conflictTopicCount: number;
      prunedProjectL1Refs: number;
      prunedProfileL1Refs: number;
      summary: string;
    }>();
    vi.spyOn(
      (
        runtime as never as {
          dreamRewriter: { run: () => Promise<unknown> };
        }
      ).dreamRewriter,
      "run",
    ).mockImplementation(() => dreamDeferred.promise);

    const drainSpy = vi
      .spyOn(
        runtime as never as {
          drainIndexQueue: () => Promise<typeof prepFlush>;
        },
        "drainIndexQueue",
      )
      .mockResolvedValue(prepFlush);

    const dreamPromise = (
      runtime as never as {
        runDreamNow: (trigger: "manual") => Promise<unknown>;
      }
    ).runDreamNow("manual");
    await vi.waitFor(() => {
      expect((runtime as never as { dreamRunLocked: boolean }).dreamRunLocked).toBe(true);
    });

    await expect(
      (
        runtime as never as {
          runDreamNow: (trigger: "manual") => Promise<unknown>;
        }
      ).runDreamNow("manual"),
    ).rejects.toThrow("already running");

    const queuedIndexPromise = (
      runtime as never as {
        requestIndexRun: (reason: string, sessionKeys?: string[]) => Promise<unknown>;
      }
    ).requestIndexRun("scheduled", ["session-a"]);
    expect(drainSpy).not.toHaveBeenCalled();

    dreamDeferred.resolve({
      reviewedL1: 2,
      rewrittenProjects: 1,
      deletedProjects: 0,
      profileUpdated: true,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      prunedProjectL1Refs: 0,
      prunedProfileL1Refs: 0,
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
        autoDreamMinNewL1: 10,
      },
      logger: undefined,
    });
    runtimes.push(runtime);

    vi.spyOn(
      runtime as never as {
        runStartupInitialization: () => Promise<void>;
      },
      "runStartupInitialization",
    ).mockResolvedValue(undefined);
    const indexSpy = vi
      .spyOn(
        runtime as never as {
          requestIndexRun: (reason: string, sessionKeys?: string[]) => Promise<unknown>;
        },
        "requestIndexRun",
      )
      .mockResolvedValue({
        l0Captured: 0,
        l1Created: 0,
        l2TimeUpdated: 0,
        l2ProjectUpdated: 0,
        profileUpdated: 0,
        failed: 0,
      });
    const dreamSpy = vi
      .spyOn(
        runtime as never as {
          runDreamNow: (trigger: "manual" | "scheduled") => Promise<unknown>;
        },
        "runDreamNow",
      )
      .mockResolvedValue({
        prepFlush: {
          l0Captured: 0,
          l1Created: 0,
          l2TimeUpdated: 0,
          l2ProjectUpdated: 0,
          profileUpdated: 0,
          failed: 0,
        },
        reviewedL1: 0,
        rewrittenProjects: 0,
        deletedProjects: 0,
        profileUpdated: false,
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        prunedProjectL1Refs: 0,
        prunedProfileL1Refs: 0,
        summary: "noop",
        status: "skipped",
        trigger: "scheduled",
        skipReason: "new_l1_below_threshold",
      });

    runtime.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(indexSpy).toHaveBeenCalledWith("scheduled");
    expect(dreamSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(dreamSpy).toHaveBeenCalledWith("scheduled");

    indexSpy.mockClear();
    dreamSpy.mockClear();

    (
      runtime as never as {
        applyIndexingSettings: (partial: Record<string, unknown>) => unknown;
      }
    ).applyIndexingSettings({
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 60,
    });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(indexSpy).not.toHaveBeenCalled();
    expect(dreamSpy).toHaveBeenCalledWith("scheduled");

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(indexSpy).toHaveBeenCalledWith("scheduled");
  });

  it("skips scheduled Dream when new L1 count is below the configured threshold", async () => {
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
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    };
    vi.spyOn(
      runtime as never as {
        flushAllNow: (
          reason: string,
          options?: { allowWhileDream?: boolean },
        ) => Promise<typeof prepFlush>;
      },
      "flushAllNow",
    ).mockResolvedValue(prepFlush);
    const dreamSpy = vi
      .spyOn(
        (
          runtime as never as {
            dreamRewriter: { run: () => Promise<unknown> };
          }
        ).dreamRewriter,
        "run",
      )
      .mockResolvedValue({
        reviewedL1: 1,
        rewrittenProjects: 1,
        deletedProjects: 0,
        profileUpdated: true,
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        prunedProjectL1Refs: 0,
        prunedProfileL1Refs: 0,
        summary: "should not run",
      });

    const result = await (
      runtime as never as {
        runDreamNow: (trigger: "scheduled") => Promise<Record<string, unknown>>;
      }
    ).runDreamNow("scheduled");

    expect(dreamSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "skipped",
      skipReason: "new_l1_below_threshold",
      prepFlush,
    });
    expect(runtime.repository.getPipelineState("lastDreamStatus")).toBe("skipped");
  });

  it("runs scheduled Dream after 10 new L1 windows and records the latest successful cutoff", async () => {
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

    for (let index = 0; index < 10; index += 1) {
      const minutes = String(index).padStart(2, "0");
      runtime.repository.insertL1Window({
        l1IndexId: `l1-${index}`,
        sessionKey: `session-${index}`,
        timePeriod: `2026-04-01 ${minutes}:00`,
        startedAt: `2026-04-01T00:${minutes}:00.000Z`,
        endedAt: `2026-04-01T00:${minutes}:30.000Z`,
        summary: `summary-${index}`,
        facts: [],
        situationTimeInfo: "",
        projectTags: [],
        projectDetails: [],
        l0Source: [],
        createdAt: `2026-04-01T00:${minutes}:30.000Z`,
      });
    }

    const prepFlush = {
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    };
    vi.spyOn(
      runtime as never as {
        flushAllNow: (
          reason: string,
          options?: { allowWhileDream?: boolean },
        ) => Promise<typeof prepFlush>;
      },
      "flushAllNow",
    ).mockResolvedValue(prepFlush);
    const dreamSpy = vi
      .spyOn(
        (
          runtime as never as {
            dreamRewriter: { run: () => Promise<unknown> };
          }
        ).dreamRewriter,
        "run",
      )
      .mockResolvedValue({
        reviewedL1: 10,
        rewrittenProjects: 2,
        deletedProjects: 1,
        profileUpdated: true,
        duplicateTopicCount: 1,
        conflictTopicCount: 0,
        prunedProjectL1Refs: 3,
        prunedProfileL1Refs: 1,
        summary: "scheduled ok",
      });

    const result = await (
      runtime as never as {
        runDreamNow: (trigger: "scheduled") => Promise<Record<string, unknown>>;
      }
    ).runDreamNow("scheduled");

    expect(dreamSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      trigger: "scheduled",
      reviewedL1: 10,
      rewrittenProjects: 2,
    });
    expect(runtime.repository.getPipelineState("lastDreamStatus")).toBe("success");
    expect(runtime.repository.getPipelineState("lastDreamL1EndedAt")).toBe(
      "2026-04-01T00:09:30.000Z",
    );
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

    runtime.repository.insertL1Window({
      l1IndexId: "l1-only",
      sessionKey: "session-only",
      timePeriod: "2026-04-01",
      startedAt: "2026-04-01T00:00:00.000Z",
      endedAt: "2026-04-01T00:05:00.000Z",
      summary: "single l1",
      facts: [],
      situationTimeInfo: "",
      projectTags: [],
      projectDetails: [],
      l0Source: [],
      createdAt: "2026-04-01T00:05:00.000Z",
    });

    const prepFlush = {
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    };
    vi.spyOn(
      runtime as never as {
        flushAllNow: (
          reason: string,
          options?: { allowWhileDream?: boolean },
        ) => Promise<typeof prepFlush>;
      },
      "flushAllNow",
    ).mockResolvedValue(prepFlush);
    const dreamSpy = vi
      .spyOn(
        (
          runtime as never as {
            dreamRewriter: { run: () => Promise<unknown> };
          }
        ).dreamRewriter,
        "run",
      )
      .mockResolvedValue({
        reviewedL1: 1,
        rewrittenProjects: 1,
        deletedProjects: 0,
        profileUpdated: true,
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        prunedProjectL1Refs: 0,
        prunedProfileL1Refs: 0,
        summary: "manual ok",
      });

    const result = await (
      runtime as never as {
        runDreamNow: (trigger: "manual") => Promise<Record<string, unknown>>;
      }
    ).runDreamNow("manual");

    expect(dreamSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      trigger: "manual",
      reviewedL1: 1,
    });
  });
});
