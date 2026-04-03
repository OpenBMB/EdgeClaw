import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalProfileRecord, L0SessionRecord, L1WindowRecord, L2ProjectIndexRecord } from "../src/core/index.js";
import { LlmMemoryExtractor } from "../src/core/index.js";

function createExtractor() {
  return new LlmMemoryExtractor({}, undefined, undefined);
}

function createProfile(): GlobalProfileRecord {
  return {
    recordId: "global_profile_record",
    profileText: "User likes spicy food and speaks Chinese.",
    sourceL1Ids: ["l1-profile"],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function createL1(): L1WindowRecord {
  return {
    l1IndexId: "l1-1",
    sessionKey: "session-1",
    timePeriod: "2026-04-01 morning",
    startedAt: "2026-04-01T08:00:00.000Z",
    endedAt: "2026-04-01T09:00:00.000Z",
    summary: "Discussed travel and retrieval debugging.",
    facts: [],
    situationTimeInfo: "Confirmed the project plan.",
    projectTags: ["travel"],
    projectDetails: [],
    l0Source: ["l0-1"],
    createdAt: "2026-04-01T09:00:00.000Z",
  };
}

function createL0(): L0SessionRecord {
  return {
    l0IndexId: "l0-1",
    sessionKey: "session-1",
    timestamp: "2026-04-01T09:30:00.000Z",
    messages: [
      { role: "user", content: "我对于天津旅游的规划是什么" },
      { role: "assistant", content: "你在推进清明假期天津穷游攻略。" },
    ],
    source: "openclaw",
    indexed: true,
    createdAt: "2026-04-01T09:30:00.000Z",
  };
}

function createProject(): L2ProjectIndexRecord {
  return {
    l2IndexId: "l2-project-1",
    projectKey: "travel",
    projectName: "Travel",
    summary: "Travel planning is underway.",
    currentStatus: "in_progress",
    latestProgress: "Budget route planning.",
    l1Source: ["l1-1", "l1-stale"],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T10:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LlmMemoryExtractor hop debug trace", () => {
  it("emits full prompt debug on successful hop1 parsing", async () => {
    const extractor = createExtractor();
    const debugTrace = vi.fn();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        query_scope: "continuation",
        effective_query: "更详细地回忆我对于天津旅游的规划是什么",
        memory_relevant: true,
        base_only: false,
        lookup_queries: [
          {
            target_types: ["time", "project"],
            lookup_query: "天津旅游规划",
            time_range: { start_date: "2026-04-01", end_date: "2026-04-01" },
          },
        ],
      }));

    const result = await extractor.decideMemoryLookup({
      query: "我对于天津旅游的规划是什么",
      profile: createProfile(),
      recentMessages: [
        { role: "user", content: "我对于天津旅游的规划是什么" },
        { role: "assistant", content: "你在推进清明假期天津穷游攻略。" },
      ],
      debugTrace,
    });

    expect(result.queryScope).toBe("continuation");
    expect(result.effectiveQuery).toBe("更详细地回忆我对于天津旅游的规划是什么");
    expect(result.lookupQueries[0]?.lookupQuery).toBe("天津旅游规划");
    const hop1Debug = debugTrace.mock.calls[0]?.[0];
    expect(debugTrace).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "Hop1 lookup",
      systemPrompt: expect.stringContaining("first-hop planner"),
      userPrompt: expect.any(String),
      rawResponse: expect.stringContaining("lookup_queries"),
      parsedResult: expect.objectContaining({
        base_only: false,
      }),
    }));
    expect(hop1Debug?.userPrompt).toContain("current_local_date");
    expect(hop1Debug?.userPrompt).toContain("recent_messages");
    expect(hop1Debug?.userPrompt).toContain("global_profile");
  });

  it("falls back to standalone query metadata when hop1 omits new fields", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        memory_relevant: true,
        base_only: false,
        lookup_queries: [
          {
            target_types: ["project"],
            lookup_query: "天津旅游规划",
          },
        ],
      }));

    const result = await extractor.decideMemoryLookup({
      query: "我对于天津旅游的规划是什么",
      profile: createProfile(),
      recentMessages: [],
    });

    expect(result.queryScope).toBe("standalone");
    expect(result.effectiveQuery).toBe("我对于天津旅游的规划是什么");
    expect(result.lookupQueries[0]?.lookupQuery).toBe("天津旅游规划");
  });

  it("emits full prompt debug on successful hop2 parsing with english scaffolding", async () => {
    const extractor = createExtractor();
    const debugTrace = vi.fn();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        intent: "project",
        evidence_note: "The user is actively planning a budget Tianjin trip for the Qingming holiday.",
        enough_at: "l2",
      }));

    const result = await extractor.selectL2FromCatalog({
      query: "我对于天津旅游的规划是什么",
      profile: createProfile(),
      lookupQueries: [
        {
          targetTypes: ["project"],
          lookupQuery: "天津旅游规划",
          timeRange: null,
        },
      ],
      l2Entries: [
        {
          id: "l2-project-1",
          type: "project",
          label: "天津穷游攻略",
          lookupKeys: ["天津", "穷游"],
          compressedContent: "正在推进天津穷游路线和预算整理。",
        },
      ],
      debugTrace,
    });

    expect(result.enoughAt).toBe("l2");
    expect(debugTrace).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "Hop2 L2 selection",
      systemPrompt: expect.stringContaining("second-hop planner"),
      rawResponse: expect.stringContaining("evidence_note"),
    }));
    expect(debugTrace.mock.calls[0]?.[0]?.systemPrompt).not.toContain("第二跳规划器");
  });

  it("emits errored prompt debug when raw hop output cannot be parsed", async () => {
    const extractor = createExtractor();
    const debugTrace = vi.fn();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue("not-json-at-all");

    const result = await extractor.selectL1FromEvidence({
      query: "我对于天津旅游的规划是什么",
      evidenceNote: "L2 note",
      selectedL2Entries: [
        {
          id: "l2-project-1",
          type: "project",
          label: "天津穷游攻略",
          lookupKeys: ["天津", "穷游"],
          compressedContent: "正在推进天津穷游路线和预算整理。",
        },
      ],
      l1Windows: [createL1()],
      debugTrace,
    });

    expect(result.enoughAt).toBe("none");
    expect(debugTrace).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "Hop3 L1 selection",
      errored: true,
      rawResponse: "not-json-at-all",
      errorMessage: expect.any(String),
    }));
  });

  it("marks timeout in hop debug when the model call times out", async () => {
    const extractor = createExtractor();
    const debugTrace = vi.fn();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockRejectedValue(new Error("Hop4 L0 selection request timed out after 5000ms"));

    const result = await extractor.selectL0FromEvidence({
      query: "你上次推荐我的店叫什么",
      evidenceNote: "Need exact venue name",
      selectedL2Entries: [
        {
          id: "l2-project-1",
          type: "project",
          label: "北京烧烤推荐",
          lookupKeys: ["北京", "烧烤"],
          compressedContent: "之前讨论过几家烧烤店。",
        },
      ],
      selectedL1Windows: [createL1()],
      l0Sessions: [createL0()],
      debugTrace,
    });

    expect(result.enoughAt).toBe("none");
    expect(debugTrace).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "Hop4 L0 selection",
      errored: true,
      timedOut: true,
    }));
  });

  it("parses Dream review output into grouped findings", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        summary: "Recent L1 windows suggest one project summary should be rebuilt.",
        project_rebuild: [
          {
            title: "Project summary lags recent L1",
            rationale: "The newest L1 windows carry a clearer project stage than the current L2 project summary.",
            confidence: 0.84,
            target: "l2_project",
            evidence_refs: ["l1:l1-1", "l2_project:l2-project-1"],
          },
        ],
        profile_suggestions: [
          {
            title: "Promote stable preference into profile",
            rationale: "Two recent L1 windows reinforce the same planning preference.",
            confidence: 0.71,
            target: "global_profile",
            evidence_refs: ["profile:global_profile_record", "l1:l1-1"],
          },
        ],
        cleanup: [],
        ambiguous: [],
        no_action: [],
      }));

    const result = await extractor.reviewDream({
      focus: "all",
      profile: createProfile(),
      l2Projects: [
        {
          l2IndexId: "l2-project-1",
          projectKey: "travel",
          projectName: "Travel",
          summary: "Travel planning is underway.",
          currentStatus: "in_progress",
          latestProgress: "Budget route planning.",
          l1Source: ["l1-1"],
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T10:00:00.000Z",
        },
      ],
      l1Windows: [createL1()],
      l0Sessions: [createL0()],
      timeLayerNotes: [],
      evidenceRefs: [
        { refId: "profile:global_profile_record", level: "profile", id: "global_profile_record", label: "Global Profile", summary: "User likes spicy food." },
        { refId: "l2_project:l2-project-1", level: "l2_project", id: "l2-project-1", label: "Travel", summary: "Travel planning is underway." },
        { refId: "l1:l1-1", level: "l1", id: "l1-1", label: "2026-04-01 morning", summary: "Discussed travel and retrieval debugging." },
      ],
    });

    expect(result.summary).toContain("project summary");
    expect(result.projectRebuild).toEqual([
      expect.objectContaining({
        title: "Project summary lags recent L1",
        target: "l2_project",
        evidenceRefs: ["l1:l1-1", "l2_project:l2-project-1"],
      }),
    ]);
    expect(result.profileSuggestions).toEqual([
      expect.objectContaining({
        target: "global_profile",
      }),
    ]);
  });

  it("falls back to an empty Dream review when the model output is malformed", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue("not-json");

    const result = await extractor.reviewDream({
      focus: "projects",
      profile: createProfile(),
      l2Projects: [],
      l1Windows: [createL1()],
      l0Sessions: [],
      timeLayerNotes: [],
      evidenceRefs: [
        { refId: "l1:l1-1", level: "l1", id: "l1-1", label: "2026-04-01 morning", summary: "Discussed travel and retrieval debugging." },
      ],
    });

    expect(result.summary).toContain("No reliable Dream findings");
    expect(result.projectRebuild).toEqual([]);
    expect(result.profileSuggestions).toEqual([]);
  });

  it("parses Dream project rebuild output into exact retained project sources", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        summary: "Merged duplicate travel topics into one project.",
        duplicate_topic_count: 1,
        conflict_topic_count: 0,
        projects: [
          {
            project_key: "travel-plan",
            project_name: "Travel Plan",
            current_status: "in_progress",
            summary: "The travel project was consolidated from recent L1 windows.",
            latest_progress: "Kept only the strongest recent L1 window.",
            retained_l1_ids: ["l1-1"],
          },
        ],
        deleted_project_keys: ["travel"],
        l1_issues: [
          {
            issue_type: "duplicate",
            title: "Recent L1 windows describe the same travel topic",
            l1_ids: ["l1-1"],
            related_project_keys: ["travel", "travel-plan"],
          },
        ],
      }));

    const result = await extractor.planDreamProjectRebuild({
      currentProjects: [createProject()],
      profile: createProfile(),
      l1Windows: [createL1()],
      l0Sessions: [createL0()],
      clusters: [
        {
          clusterId: "cluster-1",
          label: "Travel Plan",
          candidateKeys: ["travel"],
          candidateNames: ["Travel"],
          currentProjectKeys: ["travel"],
          l1Ids: ["l1-1"],
          statuses: ["in_progress"],
          summaries: ["Travel planning is underway."],
          latestProgresses: ["Budget route planning."],
          issueHints: ["duplicate"],
          representativeWindows: [{ l1IndexId: "l1-1", endedAt: "2026-04-01T09:00:00.000Z", summary: "Discussed travel and retrieval debugging." }],
        },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      duplicateTopicCount: 1,
      conflictTopicCount: 0,
      deletedProjectKeys: ["travel"],
      projects: [
        expect.objectContaining({
          projectKey: "travel-plan",
          retainedL1Ids: ["l1-1"],
        }),
      ],
      l1Issues: [
        expect.objectContaining({
          issueType: "duplicate",
          l1Ids: ["l1-1"],
        }),
      ],
    }));
  });

  it("forwards a custom timeout to Dream project rebuild planning", async () => {
    const extractor = createExtractor();
    const callStructuredJson = vi.spyOn(
      extractor as never as { callStructuredJson: (input: { timeoutMs?: number }) => Promise<string> },
      "callStructuredJson",
    ).mockResolvedValue(JSON.stringify({
      summary: "Merged duplicate travel topics into one project.",
      duplicate_topic_count: 0,
      conflict_topic_count: 0,
      projects: [
        {
          project_key: "travel-plan",
          project_name: "Travel Plan",
          current_status: "in_progress",
          summary: "The travel project was consolidated from recent L1 windows.",
          latest_progress: "Kept only the strongest recent L1 window.",
          retained_l1_ids: ["l1-1"],
        },
      ],
      deleted_project_keys: [],
      l1_issues: [],
    }));

    await extractor.planDreamProjectRebuild({
      currentProjects: [createProject()],
      profile: createProfile(),
      l1Windows: [createL1()],
      l0Sessions: [createL0()],
      clusters: [],
      timeoutMs: 42_000,
    });

    expect(callStructuredJson).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "Dream project rebuild",
      timeoutMs: 42_000,
    }));
  });

  it("does not register an abort timer when the Dream rebuild timeout is disabled", async () => {
    const extractor = createExtractor();
    vi.spyOn(
      extractor as never as { resolveSelection: (agentId?: string) => unknown },
      "resolveSelection",
    ).mockReturnValue({
      provider: "openai",
      model: "gpt-test",
      api: "chat",
      baseUrl: "https://example.test/v1",
      headers: {},
    });
    vi.spyOn(
      extractor as never as { resolveApiKey: (provider: string) => Promise<string> },
      "resolveApiKey",
    ).mockResolvedValue("test-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "{\"ok\":true}",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const raw = await (extractor as never as {
      callStructuredJson: (input: {
        systemPrompt: string;
        userPrompt: string;
        requestLabel: string;
        timeoutMs?: number;
      }) => Promise<string>;
    }).callStructuredJson({
      systemPrompt: "system",
      userPrompt: "user",
      requestLabel: "Dream project rebuild",
      timeoutMs: 0,
    });

    expect(raw).toBe("{\"ok\":true}");
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("parses Dream global profile rewrites with exact supporting L1 ids", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        profile_text: "用户偏好中文沟通，并会反复打磨检索与记忆架构。",
        source_l1_ids: ["l1-1"],
        conflict_with_existing: true,
      }));

    const result = await extractor.rewriteDreamGlobalProfile({
      existingProfile: createProfile(),
      l1Windows: [createL1()],
      currentProjects: [createProject()],
      plannedProjects: [
        {
          projectKey: "travel-plan",
          projectName: "Travel Plan",
          currentStatus: "in_progress",
          summary: "Consolidated travel project memory.",
          latestProgress: "Kept one retained L1.",
          retainedL1Ids: ["l1-1"],
        },
      ],
      l1Issues: [],
    });

    expect(result).toEqual({
      profileText: "用户偏好中文沟通，并会反复打磨检索与记忆架构。",
      sourceL1Ids: ["l1-1"],
      conflictWithExisting: true,
    });
  });

  it("throws when Dream project rebuild output is malformed or empty", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue("not-json");

    await expect(extractor.planDreamProjectRebuild({
      currentProjects: [createProject()],
      profile: createProfile(),
      l1Windows: [createL1()],
      l0Sessions: [createL0()],
      clusters: [],
    })).rejects.toThrow();
  });

  it("throws when Dream global profile rewrite output is malformed", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue("not-json");

    await expect(extractor.rewriteDreamGlobalProfile({
      existingProfile: createProfile(),
      l1Windows: [createL1()],
      currentProjects: [createProject()],
      plannedProjects: [
        {
          projectKey: "travel-plan",
          projectName: "Travel Plan",
          currentStatus: "in_progress",
          summary: "Consolidated travel project memory.",
          latestProgress: "Kept one retained L1.",
          retainedL1Ids: ["l1-1"],
        },
      ],
      l1Issues: [],
    })).rejects.toThrow();
  });
});
