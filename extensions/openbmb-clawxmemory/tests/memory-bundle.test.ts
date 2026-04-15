import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MEMORY_EXPORT_FORMAT_VERSION,
  MemoryRepository,
} from "../src/core/index.js";

async function createRepositoryHarness() {
  const dir = await mkdtemp(join(tmpdir(), "clawxmemory-bundle-"));
  const repository = new MemoryRepository(join(dir, "memory.sqlite"), { memoryDir: join(dir, "memory") });
  return { dir, repository };
}

async function seedFileMemory(repository: MemoryRepository): Promise<void> {
  const store = repository.getFileMemoryStore();
  store.upsertCandidate({
    type: "user",
    scope: "global",
    name: "user-profile",
    description: "Prefers concise updates",
    profile: "Prefers concise updates and TypeScript-first examples.",
    preferences: ["TypeScript", "Lead with the outcome"],
  });
  store.upsertProjectMeta({
    projectId: "project_alpha",
    projectName: "Alpha Retrieval",
    description: "Alpha retrieval refactor",
    aliases: ["Alpha Retrieval"],
  });
  store.upsertCandidate({
    type: "project",
    scope: "project",
    projectId: "project_alpha",
    name: "Alpha Retrieval",
    description: "Alpha retrieval refactor",
    stage: "Shipping the file-memory retriever",
    decisions: ["Use MEMORY.md as manifest"],
  });
  store.upsertCandidate({
    type: "feedback",
    scope: "project",
    projectId: "project_alpha",
    name: "review-style",
    description: "Keep status updates concise",
    rule: "Keep status updates concise",
    why: "Faster review",
    howToApply: "Lead with outcome, then key risk",
  });
  store.upsertCandidate({
    type: "project",
    scope: "project",
    projectId: "_tmp",
    name: "Unresolved Idea",
    description: "Pending project grouping",
    stage: "Still being grouped by Dream",
  });
  repository.setPipelineState("lastIndexedAt", "2026-04-09T08:00:00.000Z");
  repository.setPipelineState("lastDreamAt", "2026-04-09T08:30:00.000Z");
  repository.setPipelineState("lastDreamStatus", "success");
  repository.setPipelineState("lastDreamSummary", "Organized current file memories.");
  repository.setPipelineState("recentCaseTraces", [
    {
      caseId: "case_exported",
      sessionKey: "session_exported",
      query: "what is the current status",
      startedAt: "2026-04-09T08:31:00.000Z",
      status: "completed",
      toolEvents: [{
        eventId: "tool_exported",
        phase: "result",
        toolName: "memory_search",
        occurredAt: "2026-04-09T08:31:05.000Z",
        status: "success",
        summary: "memory_search completed.",
        summaryI18n: {
          key: "trace.tool.summary.completed",
          args: ["memory_search"],
          fallback: "memory_search completed.",
        },
      }],
      assistantReply: "Here is the status.",
    },
  ]);
  repository.setPipelineState("recentIndexTraces", [
    {
      indexTraceId: "index_exported",
      sessionKey: "session_exported",
      trigger: "manual_sync",
      startedAt: "2026-04-09T08:32:00.000Z",
      status: "completed",
      batchSummary: {
        l0Ids: [],
        segmentCount: 0,
        focusUserTurnCount: 0,
        fromTimestamp: "2026-04-09T08:00:00.000Z",
        toTimestamp: "2026-04-09T08:32:00.000Z",
      },
      steps: [{
        stepId: "index_step_exported",
        kind: "batch_loaded",
        title: "Batch Loaded",
        titleI18n: {
          key: "trace.step.batch_loaded",
          fallback: "Batch Loaded",
        },
        status: "success",
        inputSummary: "1 segments from 2026-04-09T08:00:00.000Z to 2026-04-09T08:32:00.000Z",
        inputSummaryI18n: {
          key: "trace.text.batch_loaded.input",
          args: ["1", "2026-04-09T08:00:00.000Z", "2026-04-09T08:32:00.000Z"],
          fallback: "1 segments from 2026-04-09T08:00:00.000Z to 2026-04-09T08:32:00.000Z",
        },
        outputSummary: "1 messages loaded into batch context.",
        outputSummaryI18n: {
          key: "trace.text.batch_loaded.output",
          args: ["1"],
          fallback: "1 messages loaded into batch context.",
        },
        details: [{
          key: "batch-summary",
          label: "Batch Summary",
          labelI18n: {
            key: "trace.detail.batch_summary",
            fallback: "Batch Summary",
          },
          kind: "kv",
          entries: [{ label: "sessionKey", value: "session_exported" }],
        }],
      }],
      storedResults: [],
    },
  ]);
  repository.setPipelineState("recentDreamTraces", [
    {
      dreamTraceId: "dream_exported",
      trigger: "manual",
      startedAt: "2026-04-09T08:33:00.000Z",
      status: "completed",
      snapshotSummary: {
        formalProjectCount: 1,
        tmpProjectCount: 1,
        tmpFeedbackCount: 0,
        formalProjectFileCount: 1,
        formalFeedbackFileCount: 1,
        hasUserProfile: true,
      },
      steps: [],
      mutations: [],
      outcome: {
        rewrittenProjects: 1,
        deletedProjects: 0,
        deletedFiles: 0,
        profileUpdated: false,
        summary: "Dream complete",
        summaryI18n: {
          key: "trace.text.dream_finished.output.completed_summary",
          args: ["4", "1", "0", "0", "0"],
          fallback: "Dream complete",
        },
      },
    },
  ]);
}

describe("memory bundle import/export", () => {
  const cleanupDirs: string[] = [];
  const repositories: MemoryRepository[] = [];

  afterEach(async () => {
    for (const repository of repositories.splice(0)) {
      repository.close();
    }
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function createRepository(): Promise<MemoryRepository> {
    const { dir, repository } = await createRepositoryHarness();
    cleanupDirs.push(dir);
    repositories.push(repository);
    return repository;
  }

  it("exports a v3 snapshot from the real memory directory", async () => {
    const repository = await createRepository();
    await seedFileMemory(repository);
    const rootDir = repository.getFileMemoryStore().getRootDir();
    await mkdir(join(rootDir, "projects", "project_alpha", "Project", "Archive"), { recursive: true });
    await writeFile(
      join(rootDir, "projects", "project_alpha", "Project", "Archive", "archived-note.md"),
      "# Archived note\n\nKeep for migration coverage.\n",
      "utf-8",
    );

    const bundle = repository.exportMemoryBundle();
    const bundlePaths = bundle.files.map((record) => record.relativePath);

    expect(bundle.formatVersion).toBe(MEMORY_EXPORT_FORMAT_VERSION);
    expect("l0Sessions" in (bundle as Record<string, unknown>)).toBe(false);
    expect("projectMetas" in (bundle as Record<string, unknown>)).toBe(false);
    expect(bundlePaths).toEqual(expect.arrayContaining([
      "global/MEMORY.md",
      "global/User/user-profile.md",
      "projects/_tmp/MEMORY.md",
      "projects/project_alpha/MEMORY.md",
      "projects/project_alpha/project.meta.md",
      "projects/project_alpha/Feedback/review-style.md",
      "projects/project_alpha/Project/Archive/archived-note.md",
    ]));
    expect(bundlePaths.some((path) => path.startsWith("projects/_tmp/Project/unresolved-idea"))).toBe(true);
    expect(bundlePaths.some((path) => path.startsWith("projects/project_alpha/Project/alpha-retrieval"))).toBe(true);
    expect(bundle.files.find((record) => record.relativePath === "projects/project_alpha/Project/Archive/archived-note.md")?.content)
      .toContain("Archived note");
    expect(bundle.lastDreamStatus).toBe("success");
    expect(bundle.recentCaseTraces?.[0]?.caseId).toBe("case_exported");
    expect(bundle.recentCaseTraces?.[0]?.toolEvents?.[0]?.summaryI18n).toMatchObject({ key: "trace.tool.summary.completed" });
    expect(bundle.recentIndexTraces?.[0]?.indexTraceId).toBe("index_exported");
    expect(bundle.recentIndexTraces?.[0]?.steps?.[0]?.titleI18n).toMatchObject({ key: "trace.step.batch_loaded" });
    expect(bundle.recentDreamTraces?.[0]?.dreamTraceId).toBe("dream_exported");
    expect(bundle.recentDreamTraces?.[0]?.outcome?.summaryI18n).toMatchObject({
      key: "trace.text.dream_finished.output.completed_summary",
    });
  });

  it("round-trips v3 snapshots, restores recent traces, and clears old runtime queue", async () => {
    const source = await createRepository();
    await seedFileMemory(source);
    const bundle = source.exportMemoryBundle();

    const target = await createRepository();
    target.insertL0Session({
      l0IndexId: "l0_1",
      sessionKey: "session_alpha",
      timestamp: "2026-04-09T08:45:00.000Z",
      messages: [{ role: "user", content: "remember this" }],
      source: "openclaw",
      indexed: false,
      createdAt: "2026-04-09T08:45:00.000Z",
    });
    target.setPipelineState("recentCaseTraces", [{ caseId: "case_1", startedAt: "2026-04-09T08:45:00.000Z" }]);
    target.setPipelineState("recentIndexTraces", [{ indexTraceId: "index_1", startedAt: "2026-04-09T08:46:00.000Z" }]);
    target.setPipelineState("recentDreamTraces", [{ dreamTraceId: "dream_1", startedAt: "2026-04-09T08:47:00.000Z" }]);
    target.setPipelineState("indexingSettings", {
      reasoningMode: "accuracy_first",
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 240,
    });

    const result = target.importMemoryBundle(bundle);

    expect(result.formatVersion).toBe(MEMORY_EXPORT_FORMAT_VERSION);
    expect(result.imported.managedFiles).toBe(bundle.files.length);
    expect(result.imported.memoryFiles).toBe(4);
    expect(result.imported.projectMetas).toBe(1);
    expect(result.imported.project).toBe(1);
    expect(result.imported.feedback).toBe(1);
    expect(result.imported.user).toBe(1);
    expect(result.imported.tmp).toBe(1);
    expect(target.getPipelineState("lastIndexedAt")).toBe("2026-04-09T08:00:00.000Z");
    expect(target.getPipelineState("lastDreamStatus")).toBe("success");
    expect(result.recentCaseTraces?.[0]?.caseId).toBe("case_exported");
    expect(result.recentIndexTraces?.[0]?.indexTraceId).toBe("index_exported");
    expect(result.recentDreamTraces?.[0]?.dreamTraceId).toBe("dream_exported");
    expect(result.recentIndexTraces?.[0]?.steps?.[0]?.titleI18n).toMatchObject({ key: "trace.step.batch_loaded" });
    expect((target.getPipelineState("recentCaseTraces") as Array<Record<string, unknown>> | undefined)?.[0]?.caseId).toBe("case_exported");
    expect((target.getPipelineState("recentIndexTraces") as Array<Record<string, unknown>> | undefined)?.[0]?.indexTraceId).toBe("index_exported");
    expect((target.getPipelineState("recentDreamTraces") as Array<Record<string, unknown>> | undefined)?.[0]?.dreamTraceId).toBe("dream_exported");
    expect((target.getPipelineState("recentDreamTraces") as Array<Record<string, unknown>> | undefined)?.[0]?.outcome?.summaryI18n)
      .toMatchObject({ key: "trace.text.dream_finished.output.completed_summary" });
    expect(target.getPipelineState("indexingSettings")).toEqual({
      reasoningMode: "accuracy_first",
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 240,
    });
    expect(target.listAllL0()).toHaveLength(0);

    const userSummary = target.getFileMemoryStore().getUserSummary();
    expect(userSummary.profile).toContain("Prefers concise updates");
    const projectEntries = target.listMemoryEntries({
      scope: "project",
      projectId: "project_alpha",
      limit: 20,
    });
    expect(projectEntries).toHaveLength(2);
    const tmpEntries = target.listMemoryEntries({
      scope: "project",
      projectId: "_tmp",
      includeTmp: true,
      limit: 20,
    });
    expect(tmpEntries).toHaveLength(1);
  });

  it("rejects legacy v2 bundles as unsupported", async () => {
    const source = await createRepository();
    await seedFileMemory(source);
    const legacyBundle = {
      formatVersion: "clawxmemory-file-memory-bundle.v2",
      exportedAt: "2026-04-09T09:00:00.000Z",
      projectMetas: [],
      memoryFiles: [],
    };

    expect(() => source.importMemoryBundle(legacyBundle as never)).toThrow("Unsupported memory bundle formatVersion");
  });

  it("rejects invalid v3 snapshot paths without mutating the current live memory", async () => {
    const repository = await createRepository();
    await seedFileMemory(repository);
    const before = repository.exportMemoryBundle();

    expect(() => repository.importMemoryBundle({
      formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
      exportedAt: "2026-04-09T09:00:00.000Z",
      files: [{ relativePath: "../escape.md", content: "bad" }],
    })).toThrow("Invalid files[0].relativePath");

    const after = repository.exportMemoryBundle();
    expect(after.files).toEqual(before.files);
    expect(after.lastIndexedAt).toBe(before.lastIndexedAt);
    expect(after.lastDreamAt).toBe(before.lastDreamAt);
    expect(after.lastDreamStatus).toBe(before.lastDreamStatus);
    expect(after.lastDreamSummary).toBe(before.lastDreamSummary);
  });

  it("deduplicates tmp entries from the same source turn even when model phrasing drifts", async () => {
    const repository = await createRepository();
    const store = repository.getFileMemoryStore();

    store.upsertCandidate({
      type: "feedback",
      scope: "project",
      projectId: "_tmp",
      name: "delivery-rule",
      description: "每次交付时先给3个标题，再给正文，再给结尾互动引导。",
      rule: "每次交付时先给3个标题，再给正文，再给结尾互动引导。",
      howToApply: "在打工人午餐便当爆文项目的交付时。",
      sourceSessionKey: "agent:main:main",
      capturedAt: "2026-04-14T05:17:41.733Z",
    });
    store.upsertCandidate({
      type: "feedback",
      scope: "project",
      projectId: "_tmp",
      name: "delivery-rule",
      description: "每次交付时先给3个标题，再给正文，再给结尾互动引导。",
      rule: "每次交付时先给3个标题，再给正文，再给结尾互动引导。",
      howToApply: "在打工人午餐便当爆文项目的交付中",
      sourceSessionKey: "agent:main:main",
      capturedAt: "2026-04-14T05:17:41.733Z",
    });

    const tmpEntries = store.listTmpEntries(20);
    expect(tmpEntries).toHaveLength(1);
    expect(tmpEntries[0]?.type).toBe("feedback");
    const record = tmpEntries[0] ? store.getMemoryRecord(tmpEntries[0].relativePath, 5000) : undefined;
    expect(record?.content).toContain("在打工人午餐便当爆文项目的交付中");
  });
});
