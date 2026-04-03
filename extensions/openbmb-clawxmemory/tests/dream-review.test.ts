import { describe, expect, it, vi } from "vitest";
import type {
  DreamReviewResult,
  GlobalProfileRecord,
  L0SessionRecord,
  L1WindowRecord,
  L2ProjectIndexRecord,
} from "../src/core/index.js";
import { DreamReviewRunner, DreamRewriteRunner } from "../src/core/index.js";

function createL1(overrides: Partial<L1WindowRecord> = {}): L1WindowRecord {
  return {
    l1IndexId: "l1-1",
    sessionKey: "session-1",
    timePeriod: "2026-04-01 morning",
    startedAt: "2026-04-01T08:00:00.000Z",
    endedAt: "2026-04-01T09:00:00.000Z",
    summary: "Discussed Dream review and project status.",
    facts: [],
    situationTimeInfo: "Project state changed.",
    projectTags: ["dream-review"],
    projectDetails: [
      {
        key: "dream-review",
        name: "Dream Review",
        status: "in_progress",
        summary: "Reviewing how Dream should govern project memories.",
        latestProgress: "Narrowed Dream to L1 -> L2Project governance.",
        confidence: 0.88,
      },
    ],
    l0Source: ["l0-1"],
    createdAt: "2026-04-01T09:00:00.000Z",
    ...overrides,
  };
}

function createSecondL1(overrides: Partial<L1WindowRecord> = {}): L1WindowRecord {
  return createL1({
    l1IndexId: "l1-2",
    sessionKey: "session-2",
    timePeriod: "2026-04-02 morning",
    startedAt: "2026-04-02T08:00:00.000Z",
    endedAt: "2026-04-02T09:00:00.000Z",
    summary: "Merged Dream rebuild direction around project memory reconstruction.",
    situationTimeInfo: "Project summaries should be rebuilt from L1.",
    projectDetails: [
      {
        key: "dream-review",
        name: "Dream Review",
        status: "in_progress",
        summary: "Rebuilding L2 project memory from all L1 windows.",
        latestProgress: "Confirmed exact L1 source pruning for rebuilt projects.",
        confidence: 0.93,
      },
    ],
    createdAt: "2026-04-02T09:00:00.000Z",
    ...overrides,
  });
}

function createProfile(): GlobalProfileRecord {
  return {
    recordId: "global_profile_record",
    profileText: "User prefers Chinese planning docs and iterative architecture reviews.",
    sourceL1Ids: ["l1-profile"],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function createProject(): L2ProjectIndexRecord {
  return {
    l2IndexId: "l2-project-1",
    projectKey: "dream-review",
    projectName: "Dream Review",
    summary: "Dream governance work is underway.",
    currentStatus: "in_progress",
    latestProgress: "Still deciding which layer should be governed.",
    l1Source: ["l1-1"],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T10:00:00.000Z",
  };
}

function createL0(): L0SessionRecord {
  return {
    l0IndexId: "l0-1",
    sessionKey: "session-1",
    timestamp: "2026-04-01T08:30:00.000Z",
    messages: [
      { role: "user", content: "dream 应该重新看 l1" },
      { role: "assistant", content: "可以把 Dream 收敛到项目层治理。" },
    ],
    source: "openclaw",
    indexed: true,
    createdAt: "2026-04-01T08:30:00.000Z",
  };
}

describe("DreamReviewRunner", () => {
  it("returns a no-signal review when indexed memory is empty", async () => {
    const extractor = {
      reviewDream: vi.fn(),
    } as never;
    const runner = new DreamReviewRunner({
      listRecentL1: () => [],
      getL2ProjectByKey: () => undefined,
      getGlobalProfileRecord: () => ({
        recordId: "global_profile_record",
        profileText: "",
        sourceL1Ids: [],
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
      getL0ByL1Ids: () => [],
      getL2TimeByDate: () => undefined,
    }, extractor);

    const result = await runner.review("all");
    expect(result.summary).toContain("Not enough indexed memory evidence");
    expect(result.projectRebuild).toEqual([]);
    expect(result.timeLayerNotes).toEqual([]);
    expect(extractor.reviewDream).not.toHaveBeenCalled();
  });

  it("adds deterministic time integrity notes but leaves semantic review to the extractor", async () => {
    const extractorResult: Omit<DreamReviewResult, "timeLayerNotes" | "evidenceRefs"> = {
      summary: "Recent L1 windows suggest one project summary should be rebuilt.",
      projectRebuild: [
        {
          title: "Project summary lags recent L1",
          rationale: "The latest L1 shows a clearer project stage transition than the current L2Project summary.",
          confidence: 0.83,
          target: "l2_project",
          evidenceRefs: ["l1:l1-1", "l2_project:l2-project-1"],
        },
      ],
      profileSuggestions: [],
      cleanup: [],
      ambiguous: [],
      noAction: [],
    };
    const extractor = {
      reviewDream: vi.fn().mockResolvedValue(extractorResult),
    } as never;
    const runner = new DreamReviewRunner({
      listRecentL1: () => [createL1()],
      getL2ProjectByKey: () => createProject(),
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      getL2TimeByDate: () => undefined,
    }, extractor);

    const result = await runner.review("all");

    expect(extractor.reviewDream).toHaveBeenCalledTimes(1);
    expect(result.projectRebuild).toHaveLength(1);
    expect(result.timeLayerNotes).toEqual([
      expect.objectContaining({
        target: "time_note",
        title: "Missing L2Time summary for 2026-04-01",
      }),
    ]);
    expect(result.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ refId: "l1:l1-1", level: "l1" }),
      expect.objectContaining({ refId: "l2_project:l2-project-1", level: "l2_project" }),
      expect.objectContaining({ refId: "profile:global_profile_record", level: "profile" }),
    ]));
  });
});

describe("DreamRewriteRunner", () => {
  it("rewrites project memory and profile using exact retained L1 sources", async () => {
    const applyDreamRewrite = vi.fn();
    const extractor = {
      planDreamProjectRebuild: vi.fn().mockResolvedValue({
        summary: "Merged duplicate Dream project summaries into one canonical project.",
        duplicateTopicCount: 1,
        conflictTopicCount: 0,
        projects: [
          {
            projectKey: "dream-review",
            projectName: "Dream Review",
            currentStatus: "in_progress",
            summary: "Dream now rebuilds L2 project memory from validated L1 windows.",
            latestProgress: "Exact L1 references were pruned for the rebuilt project.",
            retainedL1Ids: ["l1-2"],
          },
        ],
        deletedProjectKeys: ["old-dream-review"],
        l1Issues: [
          {
            issueType: "duplicate",
            title: "Two L1 windows described the same Dream topic cluster",
            l1Ids: ["l1-1", "l1-2"],
            relatedProjectKeys: ["dream-review", "old-dream-review"],
          },
        ],
      }),
      rewriteDreamGlobalProfile: vi.fn().mockResolvedValue({
        profileText: "用户偏好用中文做规划，并且会迭代式地整理 memory 架构。",
        sourceL1Ids: ["l1-1", "l1-2"],
        conflictWithExisting: false,
      }),
    } as never;

    const currentProject: L2ProjectIndexRecord = {
      ...createProject(),
      l1Source: ["l1-1", "l1-2", "l1-stale"],
    };
    const duplicateProject: L2ProjectIndexRecord = {
      ...createProject(),
      l2IndexId: "l2-project-2",
      projectKey: "old-dream-review",
      projectName: "Dream Review Old",
      l1Source: ["l1-1"],
      updatedAt: "2026-04-01T11:00:00.000Z",
    };
    const runner = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [currentProject, duplicateProject],
      getGlobalProfileRecord: () => ({
        ...createProfile(),
        sourceL1Ids: ["l1-profile", "l1-1", "l1-stale"],
      }),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractor);

    const result = await runner.run();

    expect(extractor.planDreamProjectRebuild).toHaveBeenCalledTimes(1);
    expect(extractor.rewriteDreamGlobalProfile).toHaveBeenCalledTimes(1);
    expect(applyDreamRewrite).toHaveBeenCalledWith({
      projects: [
        expect.objectContaining({
          projectKey: "dream-review",
          l1Source: ["l1-2"],
        }),
      ],
      profileText: "用户偏好用中文做规划，并且会迭代式地整理 memory 架构。",
      profileSourceL1Ids: ["l1-2", "l1-1"],
    });
    expect(result).toMatchObject({
      reviewedL1: 2,
      rewrittenProjects: 1,
      deletedProjects: 1,
      profileUpdated: true,
      duplicateTopicCount: 1,
      conflictTopicCount: 0,
      prunedProjectL1Refs: 3,
      prunedProfileL1Refs: 1,
    });
  });

  it("passes the configured Dream rebuild timeout into project planning", async () => {
    const applyDreamRewrite = vi.fn();
    const extractor = {
      planDreamProjectRebuild: vi.fn().mockResolvedValue({
        summary: "Merged duplicate Dream project summaries into one canonical project.",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [
          {
            projectKey: "dream-review",
            projectName: "Dream Review",
            currentStatus: "in_progress",
            summary: "Dream now rebuilds L2 project memory from validated L1 windows.",
            latestProgress: "Exact L1 references were pruned for the rebuilt project.",
            retainedL1Ids: ["l1-2"],
          },
        ],
        deletedProjectKeys: [],
        l1Issues: [],
      }),
      rewriteDreamGlobalProfile: vi.fn().mockResolvedValue({
        profileText: "用户偏好用中文做规划，并且会迭代式地整理 memory 架构。",
        sourceL1Ids: ["l1-1", "l1-2"],
        conflictWithExisting: false,
      }),
    } as never;

    const runner = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [createProject()],
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractor, {
      getDreamProjectRebuildTimeoutMs: () => 42_000,
    });

    await runner.run();

    expect(extractor.planDreamProjectRebuild).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 42_000,
    }));
  });

  it("fails closed when project rebuild planning fails", async () => {
    const applyDreamRewrite = vi.fn();
    const extractor = {
      planDreamProjectRebuild: vi.fn().mockRejectedValue(new Error("project rebuild failed")),
      rewriteDreamGlobalProfile: vi.fn(),
    } as never;
    const runner = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [createProject()],
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractor);

    await expect(runner.run()).rejects.toThrow("project rebuild failed");
    expect(extractor.rewriteDreamGlobalProfile).not.toHaveBeenCalled();
    expect(applyDreamRewrite).not.toHaveBeenCalled();
  });

  it("fails closed when profile rewrite fails or does not meet the source gate", async () => {
    const applyDreamRewrite = vi.fn();
    const projectPlan = {
      summary: "ok",
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      projects: [
        {
          projectKey: "dream-review",
          projectName: "Dream Review",
          currentStatus: "in_progress" as const,
          summary: "Dream project summary",
          latestProgress: "Dream latest progress",
          retainedL1Ids: ["l1-1", "l1-2"],
        },
      ],
      deletedProjectKeys: [],
      l1Issues: [],
    };

    const extractorFail = {
      planDreamProjectRebuild: vi.fn().mockResolvedValue(projectPlan),
      rewriteDreamGlobalProfile: vi.fn().mockRejectedValue(new Error("profile rewrite failed")),
    } as never;
    const runnerFail = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [createProject()],
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractorFail);

    await expect(runnerFail.run()).rejects.toThrow("profile rewrite failed");
    expect(applyDreamRewrite).not.toHaveBeenCalled();

    const extractorGate = {
      planDreamProjectRebuild: vi.fn().mockResolvedValue(projectPlan),
      rewriteDreamGlobalProfile: vi.fn().mockResolvedValue({
        profileText: "Too weak",
        sourceL1Ids: [],
        conflictWithExisting: false,
      }),
    } as never;
    const runnerGate = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [createProject()],
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractorGate);

    await expect(runnerGate.run()).rejects.toThrow("source support gate");
    expect(applyDreamRewrite).not.toHaveBeenCalled();
  });

  it("fails closed when the project rebuild result is empty", async () => {
    const applyDreamRewrite = vi.fn();
    const extractor = {
      planDreamProjectRebuild: vi.fn().mockResolvedValue({
        summary: "empty",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [],
        deletedProjectKeys: [],
        l1Issues: [],
      }),
      rewriteDreamGlobalProfile: vi.fn(),
    } as never;
    const runner = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [createProject()],
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractor);

    await expect(runner.run()).rejects.toThrow("no valid projects");
    expect(applyDreamRewrite).not.toHaveBeenCalled();
  });

  it("fails closed when the rebuild plan does not explain current project rows", async () => {
    const applyDreamRewrite = vi.fn();
    const extractor = {
      planDreamProjectRebuild: vi.fn().mockResolvedValue({
        summary: "missing explanation",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [
          {
            projectKey: "dream-review",
            projectName: "Dream Review",
            currentStatus: "in_progress",
            summary: "Only kept one project",
            latestProgress: "No deletion explanation",
            retainedL1Ids: ["l1-1", "l1-2"],
          },
        ],
        deletedProjectKeys: [],
        l1Issues: [],
      }),
      rewriteDreamGlobalProfile: vi.fn(),
    } as never;
    const runner = new DreamRewriteRunner({
      listAllL1: () => [createL1(), createSecondL1()],
      listAllL2Projects: () => [createProject(), {
        ...createProject(),
        l2IndexId: "l2-project-old",
        projectKey: "old-dream-review",
        projectName: "Old Dream Review",
      }],
      getGlobalProfileRecord: () => createProfile(),
      getL0ByL1Ids: () => [createL0()],
      applyDreamRewrite,
    }, extractor);

    await expect(runner.run()).rejects.toThrow("did not explain current projects");
    expect(applyDreamRewrite).not.toHaveBeenCalled();
  });
});
