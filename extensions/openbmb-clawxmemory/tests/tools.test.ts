import { describe, expect, it, vi } from "vitest";
import type {
  DashboardOverview,
  HeartbeatStats,
  MemoryRepository,
  ReasoningRetriever,
  RetrievalResult,
} from "../src/core/index.js";
import { buildPluginTools } from "../src/tools.js";

function readDetails<T>(result: { details?: unknown }): T {
  return result.details as T;
}

const retrievalResult: RetrievalResult = {
  query: "project status",
  intent: "project",
  enoughAt: "l2",
  profile: null,
  evidenceNote: "ClawXMemory is in SDK migration and the latest progress is plugin-sdk migration.",
  l2Results: [
    {
      level: "l2_project",
      score: 0.88,
      item: {
        l2IndexId: "l2-project-1",
        projectKey: "clawxmemory",
        projectName: "ClawXMemory",
        summary: "SDK migration in progress",
        currentStatus: "in_progress",
        latestProgress: "plugin-sdk migration",
        l1Source: ["l1-1"],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T01:00:00.000Z",
      },
    },
  ],
  l1Results: [
    {
      score: 0.73,
      item: {
        l1IndexId: "l1-1",
        sessionKey: "agent:main",
        timePeriod: "2026-03-24 morning",
        startedAt: "2026-03-24T00:10:00.000Z",
        endedAt: "2026-03-24T00:20:00.000Z",
        summary: "Discussed plugin migration",
        facts: [],
        situationTimeInfo: "2026-03-24",
        projectTags: ["clawxmemory"],
        projectDetails: [],
        l0Source: ["l0-1"],
        createdAt: "2026-03-24T00:20:00.000Z",
      },
    },
  ],
  l0Results: [
    {
      score: 0.61,
      item: {
        l0IndexId: "l0-1",
        sessionKey: "agent:main",
        timestamp: "2026-03-24T00:15:00.000Z",
        messages: [{ role: "user", content: "How is the migration going?" }],
        source: "openclaw",
        indexed: true,
        createdAt: "2026-03-24T00:15:00.000Z",
      },
    },
  ],
  context: "SDK migration is underway.",
  debug: {
    mode: "local_fallback",
    elapsedMs: 42,
    cacheHit: false,
  },
};

const baseOverview: DashboardOverview = {
  totalL0: 3,
  pendingL0: 1,
  openTopics: 1,
  totalL1: 2,
  totalL2Time: 1,
  totalL2Project: 1,
  totalProfiles: 1,
  queuedSessions: 0,
  lastRecallMs: 20,
  recallTimeouts: 0,
  lastRecallMode: "local_fallback",
  currentReasoningMode: "answer_first",
  lastRecallPath: "explicit",
  lastRecallBudgetLimited: false,
  lastShadowDeepQueued: false,
  lastRecallInjected: true,
  lastRecallEnoughAt: "l2",
  lastRecallCacheHit: false,
  slotOwner: "openbmb-clawxmemory",
  dynamicMemoryRuntime: "healthy",
  workspaceBootstrapPresent: true,
  memoryRuntimeHealthy: true,
  runtimeIssues: [],
  lastIndexedAt: "2026-03-24T01:00:00.000Z",
  startupRepairStatus: "idle",
};

function createRepository() {
  const l2Project = {
    l2IndexId: "l2-project-1",
    projectKey: "clawxmemory",
    projectName: "ClawXMemory",
    summary: "SDK migration in progress",
    currentStatus: "in_progress" as const,
    latestProgress: "plugin-sdk migration",
    l1Source: ["l1-1"],
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T01:00:00.000Z",
  };
  const l2Time = {
    l2IndexId: "l2-time-1",
    dateKey: "2026-03-24",
    summary: "Worked on SDK migration",
    l1Source: ["l1-1"],
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T02:00:00.000Z",
  };
  const l1 = {
    l1IndexId: "l1-1",
    sessionKey: "agent:main",
    timePeriod: "2026-03-24 morning",
    startedAt: "2026-03-24T00:10:00.000Z",
    endedAt: "2026-03-24T00:20:00.000Z",
    summary: "Discussed plugin migration",
    facts: [],
    situationTimeInfo: "2026-03-24",
    projectTags: ["clawxmemory"],
    projectDetails: [],
    l0Source: ["l0-1"],
    createdAt: "2026-03-24T00:20:00.000Z",
  };
  const l0First = {
    l0IndexId: "l0-1",
    sessionKey: "agent:main",
    timestamp: "2026-03-24T00:15:00.000Z",
    messages: [{ role: "user", content: "First memory preview" }],
    source: "openclaw",
    indexed: false,
    createdAt: "2026-03-24T00:15:00.000Z",
  };
  const l0Second = {
    l0IndexId: "l0-2",
    sessionKey: "agent:main",
    timestamp: "2026-03-24T00:25:00.000Z",
    messages: [{ role: "assistant", content: "Second memory preview" }],
    source: "openclaw",
    indexed: true,
    createdAt: "2026-03-24T00:25:00.000Z",
  };

  return {
    getOverview: vi.fn().mockReturnValue(baseOverview),
    getL2ProjectByIds: vi.fn().mockReturnValue([l2Project]),
    getL2TimeByIds: vi.fn().mockReturnValue([l2Time]),
    getL1ByIds: vi.fn().mockReturnValue([l1]),
    getL0ByIds: vi.fn().mockReturnValue([l0First]),
    listRecentL2Projects: vi.fn().mockReturnValue([l2Project]),
    listRecentL2Time: vi.fn().mockReturnValue([l2Time]),
    searchL2Hits: vi.fn().mockReturnValue([
      { level: "l2_time" as const, score: 0.9, item: l2Time },
      { level: "l2_project" as const, score: 0.8, item: l2Project },
    ]),
    searchL2ProjectIndexes: vi
      .fn()
      .mockReturnValue([{ level: "l2_project" as const, score: 0.8, item: l2Project }]),
    searchL2TimeIndexes: vi
      .fn()
      .mockReturnValue([{ level: "l2_time" as const, score: 0.9, item: l2Time }]),
    listRecentL1: vi.fn().mockReturnValue([l1]),
    searchL1: vi.fn().mockReturnValue([l1]),
    listRecentL0: vi.fn().mockReturnValue([l0Second, l0First]),
    searchL0: vi.fn().mockReturnValue([l0First, l0Second]),
  } as unknown as MemoryRepository;
}

function createRetriever() {
  return {
    retrieve: vi.fn().mockResolvedValue(retrievalResult),
  } as unknown as ReasoningRetriever;
}

describe("buildPluginTools", () => {
  it("exposes search, overview, list, get, and flush tools", async () => {
    const repository = createRepository();
    const retriever = createRetriever();
    const getOverview = vi.fn().mockReturnValue(baseOverview);
    const flushAll = vi.fn().mockResolvedValue({
      l0Captured: 1,
      l1Created: 1,
      l2TimeUpdated: 1,
      l2ProjectUpdated: 1,
      profileUpdated: 0,
      failed: 0,
    } satisfies HeartbeatStats);
    const tools = buildPluginTools(repository, retriever, { getOverview, flushAll });
    expect(tools.map((tool) => tool.name)).toEqual([
      "memory_search",
      "memory_overview",
      "memory_list",
      "memory_get",
      "memory_flush",
    ]);
    expect(tools.map((tool) => tool.name)).not.toContain("memory_recall");

    const searchResult = await tools[0]!.execute("call-1", { query: "project status", limit: 5 });
    expect(searchResult.details).toMatchObject({
      ok: true,
      intent: "project",
      enoughAt: "l2",
      evidenceNote: retrievalResult.evidenceNote,
      refs: {
        l2: [{ id: "l2-project-1", level: "l2_project" }],
      },
    });

    const overviewTool = tools.find((tool) => tool.name === "memory_overview");
    const overviewResult = await overviewTool!.execute("call-2", {});
    expect(overviewResult.details).toMatchObject({
      ok: true,
      overview: baseOverview,
    });

    const getTool = tools.find((tool) => tool.name === "memory_get");
    const getResult = await getTool!.execute("call-3", {
      level: "l2_project",
      ids: ["l2-project-1"],
    });
    expect(getResult.details).toMatchObject({
      ok: true,
      level: "l2_project",
      foundIds: ["l2-project-1"],
      missingIds: [],
      count: 1,
    });
  });

  it("lists compact browse items and validates inputs", async () => {
    const repository = createRepository();
    const tools = buildPluginTools(repository, createRetriever(), {
      getOverview: () => baseOverview,
      flushAll: async () => ({
        l0Captured: 0,
        l1Created: 0,
        l2TimeUpdated: 0,
        l2ProjectUpdated: 0,
        profileUpdated: 0,
        failed: 0,
      }),
    });
    const memoryList = tools.find((tool) => tool.name === "memory_list");
    expect(memoryList).toBeDefined();

    const defaultList = await memoryList!.execute("call-4", {});
    expect(defaultList.details).toMatchObject({
      ok: true,
      level: "l2",
      query: "",
      limit: 10,
      offset: 0,
      count: 2,
    });
    expect(
      readDetails<{
        items: Array<Record<string, unknown>>;
      }>(defaultList).items,
    ).toEqual([
      {
        level: "l2_time",
        id: "l2-time-1",
        dateKey: "2026-03-24",
        summary: "Worked on SDK migration",
        updatedAt: "2026-03-24T02:00:00.000Z",
      },
      {
        level: "l2_project",
        id: "l2-project-1",
        projectKey: "clawxmemory",
        projectName: "ClawXMemory",
        summary: "SDK migration in progress",
        currentStatus: "in_progress",
        updatedAt: "2026-03-24T01:00:00.000Z",
      },
    ]);

    const searchedL0 = await memoryList!.execute("call-5", {
      level: "l0",
      query: "migration",
      limit: 1,
      offset: 1,
    });
    expect(repository.searchL0).toHaveBeenCalledWith("migration", 2);
    expect(searchedL0.details).toMatchObject({
      ok: true,
      level: "l0",
      query: "migration",
      limit: 1,
      offset: 1,
      count: 1,
      items: [
        {
          level: "l0",
          id: "l0-2",
          sessionKey: "agent:main",
          indexed: true,
          messageCount: 1,
          preview: "Second memory preview",
        },
      ],
    });

    const invalidLevel = await memoryList!.execute("call-6", { level: "profile" });
    expect(invalidLevel.details).toMatchObject({ ok: false });
  });

  it("flushes memory and returns before and after overview snapshots", async () => {
    const repository = createRepository();
    const beforeOverview = {
      ...baseOverview,
      pendingL0: 2,
      queuedSessions: 1,
      lastIndexedAt: "2026-03-24T00:59:00.000Z",
    } satisfies DashboardOverview;
    const afterOverview = {
      ...baseOverview,
      pendingL0: 0,
      queuedSessions: 0,
      lastIndexedAt: "2026-03-24T01:05:00.000Z",
    } satisfies DashboardOverview;
    const getOverview = vi
      .fn<() => DashboardOverview>()
      .mockReturnValueOnce(beforeOverview)
      .mockReturnValueOnce(afterOverview);
    const flushAll = vi.fn().mockResolvedValue({
      l0Captured: 2,
      l1Created: 1,
      l2TimeUpdated: 1,
      l2ProjectUpdated: 1,
      profileUpdated: 1,
      failed: 0,
    } satisfies HeartbeatStats);

    const tools = buildPluginTools(repository, createRetriever(), { getOverview, flushAll });
    const memoryFlush = tools.find((tool) => tool.name === "memory_flush");
    expect(memoryFlush).toBeDefined();

    const flushResult = await memoryFlush!.execute("call-7", {});
    expect(flushAll).toHaveBeenCalledTimes(1);
    expect(flushResult.details).toMatchObject({
      ok: true,
      scope: "all",
      reason: "manual",
      beforeOverview,
      afterOverview,
      stats: {
        l0Captured: 2,
        l1Created: 1,
        l2TimeUpdated: 1,
        l2ProjectUpdated: 1,
        profileUpdated: 1,
        failed: 0,
      },
    });
  });

  it("returns structured errors for invalid memory_get input", async () => {
    const repository = createRepository();
    const tools = buildPluginTools(repository, createRetriever(), {
      getOverview: () => baseOverview,
      flushAll: async () => ({
        l0Captured: 0,
        l1Created: 0,
        l2TimeUpdated: 0,
        l2ProjectUpdated: 0,
        profileUpdated: 0,
        failed: 0,
      }),
    });
    const memoryGet = tools.find((tool) => tool.name === "memory_get");
    expect(memoryGet).toBeDefined();

    const invalidLevel = await memoryGet!.execute("call-8", { level: "profile", ids: ["x"] });
    expect(invalidLevel.details).toMatchObject({ ok: false });

    const missingIds = await memoryGet!.execute("call-9", { level: "l1", ids: [] });
    expect(missingIds.details).toMatchObject({ ok: false });
  });

  it("does not expose the legacy memory_dream_review tool", async () => {
    const repository = createRepository();
    const tools = buildPluginTools(repository, createRetriever(), {
      getOverview: () => baseOverview,
      flushAll: async () => ({
        l0Captured: 0,
        l1Created: 0,
        l2TimeUpdated: 0,
        l2ProjectUpdated: 0,
        profileUpdated: 0,
        failed: 0,
      }),
    });

    expect(tools.find((tool) => tool.name === "memory_dream_review")).toBeUndefined();
  });
});
