import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GlobalProfileRecord,
  L0SessionRecord,
  L1WindowRecord,
  L2ProjectIndexRecord,
  L2SearchResult,
  L2TimeIndexRecord,
} from "../src/core/index.js";
import { ReasoningRetriever } from "../src/core/index.js";

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    reasoningMode: "accuracy_first",
    recallTopK: 10,
    autoIndexIntervalMinutes: 60,
    autoDreamIntervalMinutes: 360,
    autoDreamMinNewL1: 10,
    dreamProjectRebuildTimeoutMs: 180_000,
    ...overrides,
  };
}

function createSkillsRuntime() {
  return {
    intentRules: { timeKeywords: [], projectKeywords: [], factKeywords: [] },
    extractionRules: {
      projectPatterns: [],
      factRules: [],
      maxProjectTags: 8,
      maxFacts: 16,
      projectTagMinLength: 2,
      projectTagMaxLength: 50,
      summaryLimits: { head: 80, tail: 80, assistant: 80 },
    },
    projectStatusRules: { defaultStatus: "in_progress", rules: [] },
    contextTemplate: [
      "intent={{intent}}",
      "enoughAt={{enoughAt}}",
      "{{profileBlock}}",
      "{{evidenceNoteBlock}}",
      "{{l2Block}}",
      "{{l1Block}}",
      "{{l0Block}}",
    ].join("\n"),
    metadata: {
      source: "fallback" as const,
      skillsDir: "",
      errors: [],
    },
  };
}

function createProfile(text = "User prefers Chinese."): GlobalProfileRecord {
  return {
    recordId: "global_profile_record",
    profileText: text,
    sourceL1Ids: ["l1-profile"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  };
}

function createL2Time(overrides: Partial<L2TimeIndexRecord> = {}): L2TimeIndexRecord {
  return {
    l2IndexId: "l2-time-1",
    dateKey: "2026-03-31",
    summary: "Worked on retrieval pipeline.",
    l1Source: ["l1-1"],
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T08:00:00.000Z",
    ...overrides,
  };
}

function createL2Project(overrides: Partial<L2ProjectIndexRecord> = {}): L2ProjectIndexRecord {
  return {
    l2IndexId: "l2-project-1",
    projectKey: "clawxmemory",
    projectName: "ClawXMemory",
    summary: "Refactoring retrieval pipeline.",
    currentStatus: "in_progress",
    latestProgress: "Implemented deterministic L2 routing.",
    l1Source: ["l1-1"],
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T09:00:00.000Z",
    ...overrides,
  };
}

function createL1(overrides: Partial<L1WindowRecord> = {}): L1WindowRecord {
  return {
    l1IndexId: "l1-1",
    sessionKey: "session-main",
    timePeriod: "2026-03-31 morning",
    startedAt: "2026-03-31T08:00:00.000Z",
    endedAt: "2026-03-31T09:00:00.000Z",
    summary: "Discussed retrieval refactor.",
    facts: [],
    situationTimeInfo: "Validated new retrieval hops.",
    projectTags: ["ClawXMemory"],
    projectDetails: [],
    l0Source: ["l0-1"],
    createdAt: "2026-03-31T09:00:00.000Z",
    ...overrides,
  };
}

function createL0(overrides: Partial<L0SessionRecord> = {}): L0SessionRecord {
  return {
    l0IndexId: "l0-1",
    sessionKey: "session-main",
    timestamp: "2026-03-31T09:30:00.000Z",
    messages: [
      { role: "user", content: "What changed in the retrieval flow?" },
      { role: "assistant", content: "We switched to deterministic candidates plus evidence notes." },
    ],
    source: "openclaw",
    indexed: true,
    createdAt: "2026-03-31T09:30:00.000Z",
    ...overrides,
  };
}

function createRepository(overrides: Record<string, unknown> = {}) {
  return {
    getSnapshotVersion: vi.fn().mockReturnValue("snapshot-1"),
    getGlobalProfileRecord: vi.fn().mockReturnValue(createProfile()),
    getL2TimeByDate: vi.fn().mockReturnValue(undefined),
    searchL2TimeIndexes: vi.fn().mockReturnValue([]),
    searchL2ProjectIndexes: vi.fn().mockReturnValue([]),
    getL1ByIds: vi.fn().mockReturnValue([]),
    getL0ByIds: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function createExtractor(overrides: Record<string, unknown> = {}) {
  return {
    decideMemoryLookup: vi.fn().mockResolvedValue({
      queryScope: "standalone",
      effectiveQuery: "default",
      memoryRelevant: true,
      baseOnly: false,
      lookupQueries: [{ targetTypes: ["time", "project"], lookupQuery: "default", timeRange: null }],
    }),
    selectL2FromCatalog: vi.fn().mockResolvedValue({
      intent: "general",
      evidenceNote: "L2 note",
      enoughAt: "l2",
    }),
    selectL1FromEvidence: vi.fn().mockResolvedValue({
      evidenceNote: "L1 note",
      enoughAt: "l1",
    }),
    selectL0FromEvidence: vi.fn().mockResolvedValue({
      evidenceNote: "L0 note",
      enoughAt: "l0",
    }),
    ...overrides,
  };
}

function emitPromptDebug(input: { debugTrace?: (debug: Record<string, unknown>) => void } | undefined, requestLabel: string, parsedResult: unknown) {
  input?.debugTrace?.({
    requestLabel,
    systemPrompt: `${requestLabel} system prompt`,
    userPrompt: `${requestLabel} user prompt`,
    rawResponse: JSON.stringify(parsedResult),
    parsedResult,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReasoningRetriever", () => {
  it("returns no memory when hop1 says memory is not relevant", async () => {
    const repository = createRepository({
      getGlobalProfileRecord: vi.fn().mockReturnValue(createProfile("")),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: false,
        baseOnly: false,
        lookupQueries: [],
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("hello", { retrievalMode: "explicit" });

    expect(result.enoughAt).toBe("none");
    expect(result.context).toBe("");
    expect(result.evidenceNote).toBe("");
    expect(result.trace?.steps.map((step) => step.kind)).toEqual([
      "recall_start",
      "hop1_decision",
      "recall_skipped",
      "context_rendered",
    ]);
  });

  it("returns profile-only context for base_only queries", async () => {
    const repository = createRepository();
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: true,
        lookupQueries: [],
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("介绍一下我", { retrievalMode: "explicit" });

    expect(result.enoughAt).toBe("profile");
    expect(result.profile?.profileText).toContain("Chinese");
    expect(result.l2Results).toEqual([]);
    expect(result.context).toContain("Global Profile");
  });

  it("passes recent messages into hop1 and uses effectiveQuery after hop1", async () => {
    const time = createL2Time({ dateKey: "2026-04-02", summary: "Handled several work items in Xibeiwang." });
    const repository = createRepository({
      searchL2TimeIndexes: vi.fn().mockReturnValue([{ level: "l2_time", score: 0.9, item: time }]),
    });
    const selectL2FromCatalog = vi.fn().mockResolvedValue({
      intent: "time",
      evidenceNote: "Expanded Xibeiwang activity details.",
      enoughAt: "l2",
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockImplementation(async (input: { recentMessages?: Array<{ role: string; content: string }> }) => {
        expect(input.recentMessages).toEqual([
          { role: "user", content: "我在西北旺都做了什么" },
          { role: "assistant", content: "你主要在西北旺处理了几个工作点。" },
        ]);
        return {
          queryScope: "continuation",
          effectiveQuery: "更详细地回忆我在西北旺都做了什么",
          memoryRelevant: true,
          baseOnly: false,
          lookupQueries: [{ targetTypes: ["time"], lookupQuery: "西北旺 做了什么", timeRange: null }],
        };
      }),
      selectL2FromCatalog,
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("不够详细", {
      retrievalMode: "explicit",
      recentMessages: [
        { role: "user", content: "我在西北旺都做了什么" },
        { role: "assistant", content: "你主要在西北旺处理了几个工作点。" },
      ],
    });

    expect(result.query).toBe("不够详细");
    expect((repository.searchL2TimeIndexes as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("西北旺 做了什么", 10);
    expect(selectL2FromCatalog).toHaveBeenCalledWith(expect.objectContaining({
      query: "更详细地回忆我在西北旺都做了什么",
    }));
    expect(result.debug).toMatchObject({
      hop1QueryScope: "continuation",
      hop1EffectiveQuery: "更详细地回忆我在西北旺都做了什么",
    });
  });

  it("uses direct date-key reads for time-range retrieval", async () => {
    const time = createL2Time();
    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
      searchL2TimeIndexes: vi.fn().mockReturnValue([]),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["time"], lookupQuery: "今天做了什么", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "time",
        evidenceNote: "2026-03-31 focused on retrieval pipeline work.",
        enoughAt: "l2",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("我今天都在忙什么", { retrievalMode: "explicit" });

    expect(result.intent).toBe("time");
    expect(result.l2Results.map((item) => item.item.l2IndexId)).toEqual(["l2-time-1"]);
    expect(result.evidenceNote).toContain("2026-03-31");
    expect((repository.getL2TimeByDate as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("2026-03-31");
    expect((repository.searchL2TimeIndexes as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("uses BM25-style project retrieval for project-only queries", async () => {
    const project = createL2Project();
    const projectHits: L2SearchResult[] = [{ level: "l2_project", score: 0.9, item: project }];
    const repository = createRepository({
      searchL2ProjectIndexes: vi.fn().mockReturnValue(projectHits),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["project"], lookupQuery: "ClawXMemory 进展", timeRange: null }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "project",
        evidenceNote: "ClawXMemory is currently refactoring retrieval and has implemented deterministic L2 routing.",
        enoughAt: "l2",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("ClawXMemory 项目进展", { retrievalMode: "explicit" });

    expect(result.intent).toBe("project");
    expect(result.l2Results).toHaveLength(1);
    expect(result.l2Results[0]?.level).toBe("l2_project");
    expect((repository.searchL2ProjectIndexes as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("ClawXMemory 进展", 10);
  });

  it("keeps time hits ahead of project hits for mixed queries", async () => {
    const time = createL2Time();
    const project = createL2Project();
    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
      searchL2ProjectIndexes: vi.fn().mockReturnValue([{ level: "l2_project", score: 0.9, item: project }]),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["time", "project"], lookupQuery: "今天 ClawXMemory 进展", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "general",
        evidenceNote: "Today the project work focused on retrieval routing.",
        enoughAt: "l2",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings({ recallTopK: 4 }) },
    );

    const result = await retriever.retrieve("我今天这个项目进展如何", { retrievalMode: "explicit", l2Limit: 4 });

    expect(result.l2Results.map((item) => item.level)).toEqual(["l2_time", "l2_project"]);
  });

  it("descends to L1 and L0 in accuracy_first mode and dedupes/sorts candidates", async () => {
    const time = createL2Time({ l1Source: ["l1-1", "l1-2"] });
    const project = createL2Project({ l2IndexId: "l2-project-2", l1Source: ["l1-2", "l1-3"] });
    const l1A = createL1({ l1IndexId: "l1-1", endedAt: "2026-03-31T09:00:00.000Z", l0Source: ["l0-1", "l0-2"] });
    const l1B = createL1({ l1IndexId: "l1-2", endedAt: "2026-03-31T10:00:00.000Z", l0Source: ["l0-2", "l0-3"] });
    const l1C = createL1({ l1IndexId: "l1-3", endedAt: "2026-03-31T08:00:00.000Z", l0Source: ["l0-4"] });
    const l0A = createL0({ l0IndexId: "l0-1", timestamp: "2026-03-31T09:30:00.000Z" });
    const l0B = createL0({ l0IndexId: "l0-2", timestamp: "2026-03-31T10:30:00.000Z" });
    const l0C = createL0({ l0IndexId: "l0-3", timestamp: "2026-03-31T10:45:00.000Z" });

    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
      searchL2ProjectIndexes: vi.fn().mockReturnValue([{ level: "l2_project", score: 0.9, item: project }]),
      getL1ByIds: vi.fn().mockImplementation((ids: string[]) => [l1A, l1B, l1C].filter((item) => ids.includes(item.l1IndexId))),
      getL0ByIds: vi.fn().mockImplementation((ids: string[]) => [l0A, l0B, l0C].filter((item) => ids.includes(item.l0IndexId))),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockImplementation(async (input: { debugTrace?: (debug: Record<string, unknown>) => void }) => {
        const parsed = {
          memoryRelevant: true,
          baseOnly: false,
          lookupQueries: [{ targetTypes: ["time", "project"], lookupQuery: "最近一周 ClawXMemory 进展", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
        };
        emitPromptDebug(input, "Hop1 lookup", parsed);
        return parsed;
      }),
      selectL2FromCatalog: vi.fn().mockImplementation(async (input: { debugTrace?: (debug: Record<string, unknown>) => void }) => {
        const parsed = {
          intent: "general",
          evidenceNote: "L2 note",
          enoughAt: "descend_l1",
        };
        emitPromptDebug(input, "Hop2 L2 selection", parsed);
        return parsed;
      }),
      selectL1FromEvidence: vi.fn().mockImplementation(async (input: { debugTrace?: (debug: Record<string, unknown>) => void }) => {
        const parsed = {
          evidenceNote: "L1 note",
          enoughAt: "descend_l0",
        };
        emitPromptDebug(input, "Hop3 L1 selection", parsed);
        return parsed;
      }),
      selectL0FromEvidence: vi.fn().mockImplementation(async (input: { debugTrace?: (debug: Record<string, unknown>) => void }) => {
        const parsed = {
          evidenceNote: "Final note with exact conversation details.",
          enoughAt: "l0",
        };
        emitPromptDebug(input, "Hop4 L0 selection", parsed);
        return parsed;
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings({ recallTopK: 2 }) },
    );

    const result = await retriever.retrieve("最近一周 ClawXMemory 进展", { retrievalMode: "auto" });

    expect(result.enoughAt).toBe("l0");
    expect(result.l1Results.map((item) => item.item.l1IndexId)).toEqual(["l1-2", "l1-1"]);
    expect(result.l0Results.map((item) => item.item.l0IndexId)).toEqual(["l0-3", "l0-2"]);
    expect(result.evidenceNote).toContain("exact conversation details");
    expect(result.context).toContain("Evidence Note");
    expect(result.trace?.steps.map((step) => step.kind)).toEqual([
      "recall_start",
      "hop1_decision",
      "l2_candidates",
      "hop2_decision",
      "l1_candidates",
      "hop3_decision",
      "l0_candidates",
      "hop4_decision",
      "context_rendered",
    ]);
    expect(result.trace?.steps.find((step) => step.kind === "hop2_decision")?.details?.length).toBeGreaterThan(0);
    expect(result.trace?.steps.find((step) => step.kind === "hop4_decision")?.promptDebug).toMatchObject({
      requestLabel: "Hop4 L0 selection",
      systemPrompt: expect.stringContaining("Hop4 L0 selection"),
      userPrompt: expect.stringContaining("Hop4 L0 selection"),
      parsedResult: expect.objectContaining({
        enoughAt: "l0",
      }),
    });
  });

  it("continues descending when hop2 and hop3 return none in accuracy_first mode", async () => {
    const time = createL2Time();
    const l1 = createL1();
    const l0 = createL0();
    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
      getL1ByIds: vi.fn().mockImplementation((ids: string[]) => [l1].filter((item) => ids.includes(item.l1IndexId))),
      getL0ByIds: vi.fn().mockImplementation((ids: string[]) => [l0].filter((item) => ids.includes(item.l0IndexId))),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["time"], lookupQuery: "今天做了什么", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "time",
        evidenceNote: "L2 note",
        enoughAt: "none",
      }),
      selectL1FromEvidence: vi.fn().mockResolvedValue({
        evidenceNote: "L1 note",
        enoughAt: "none",
      }),
      selectL0FromEvidence: vi.fn().mockResolvedValue({
        evidenceNote: "L0 note with direct session evidence.",
        enoughAt: "l0",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("我今天都在忙什么", { retrievalMode: "auto" });

    expect(result.enoughAt).toBe("l0");
    expect(result.l1Results.map((item) => item.item.l1IndexId)).toEqual(["l1-1"]);
    expect(result.l0Results.map((item) => item.item.l0IndexId)).toEqual(["l0-1"]);
    expect((extractor.selectL1FromEvidence as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((extractor.selectL0FromEvidence as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("marks missing L1 candidates instead of pretending L2 was model-confirmed", async () => {
    const time = createL2Time({ l1Source: [] });
    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
      getL1ByIds: vi.fn().mockReturnValue([]),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["time"], lookupQuery: "今天做了什么", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "time",
        evidenceNote: "Need deeper evidence before confirming the answer.",
        enoughAt: "none",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("我今天都在忙什么", { retrievalMode: "auto" });

    expect(result.enoughAt).toBe("l2");
    expect(result.debug?.corrections).toContain("missing_l1_candidates");
    expect((extractor.selectL1FromEvidence as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("marks missing L0 candidates when hop3 cannot descend further", async () => {
    const time = createL2Time();
    const l1 = createL1({ l0Source: [] });
    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
      getL1ByIds: vi.fn().mockImplementation((ids: string[]) => [l1].filter((item) => ids.includes(item.l1IndexId))),
      getL0ByIds: vi.fn().mockReturnValue([]),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["time"], lookupQuery: "今天做了什么", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "time",
        evidenceNote: "L2 note",
        enoughAt: "descend_l1",
      }),
      selectL1FromEvidence: vi.fn().mockResolvedValue({
        evidenceNote: "L1 note",
        enoughAt: "none",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings() },
    );

    const result = await retriever.retrieve("我今天都在忙什么", { retrievalMode: "auto" });

    expect(result.enoughAt).toBe("l1");
    expect(result.debug?.corrections).toContain("missing_l0_candidates");
    expect((extractor.selectL0FromEvidence as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("stays at L2 in answer_first auto mode even when hop2 wants deeper evidence", async () => {
    const time = createL2Time();
    const repository = createRepository({
      getL2TimeByDate: vi.fn().mockImplementation((dateKey: string) => (dateKey === "2026-03-31" ? time : undefined)),
    });
    const extractor = createExtractor({
      decideMemoryLookup: vi.fn().mockResolvedValue({
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [{ targetTypes: ["time"], lookupQuery: "今天做了什么", timeRange: { startDate: "2026-03-31", endDate: "2026-03-31" } }],
      }),
      selectL2FromCatalog: vi.fn().mockResolvedValue({
        intent: "time",
        evidenceNote: "L2 note only.",
        enoughAt: "descend_l1",
      }),
    });

    const retriever = new ReasoningRetriever(
      repository as never,
      createSkillsRuntime() as never,
      extractor as never,
      { getSettings: () => createSettings({ reasoningMode: "answer_first" }) },
    );

    const result = await retriever.retrieve("我今天都在忙什么", { retrievalMode: "auto" });

    expect(result.enoughAt).toBe("l2");
    expect(result.l1Results).toEqual([]);
    expect(result.l0Results).toEqual([]);
    expect(result.debug?.corrections).toContain("hop2_unverified_shallow_stop");
    expect((extractor.selectL1FromEvidence as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(result.trace?.steps.map((step) => step.kind)).toEqual([
      "recall_start",
      "hop1_decision",
      "l2_candidates",
      "hop2_decision",
      "fallback_applied",
      "context_rendered",
    ]);
  });
});
