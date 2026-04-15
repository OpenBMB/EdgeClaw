import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DreamRewriteRunner, LlmMemoryExtractor, MemoryRepository } from "../src/core/index.js";

function createDreamExtractor(overrides: Record<string, unknown> = {}) {
  return {
    planDreamFileMemory: async () => ({
      summary: "noop",
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      projects: [],
      deletedProjectIds: [],
      deletedEntryIds: [],
    }),
    rewriteDreamFileProject: async () => ({
      summary: "noop",
      projectMeta: {
        projectName: "Dream Project",
        description: "Dream Project",
        aliases: [],
        status: "active",
      },
      files: [],
      deletedEntryIds: [],
    }),
    rewriteUserProfile: async (_input: unknown) => null,
    ...overrides,
  } as never as LlmMemoryExtractor;
}

describe("DreamRewriteRunner", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("returns a no-op summary when no file-based memory exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const runner = new DreamRewriteRunner(repository, createDreamExtractor());

    const result = await runner.run();

    expect(result).toMatchObject({
      reviewedFiles: 0,
      rewrittenProjects: 0,
      profileUpdated: false,
    });
    expect(result.summary).toContain("No file-based memory exists yet");
    const traces = repository.listRecentDreamTraces(5);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.status).toBe("completed");
    expect(traces[0]?.steps[0]?.titleI18n).toMatchObject({ key: "trace.step.dream_start" });
    expect(traces[0]?.outcome.summaryI18n).toMatchObject({ key: "trace.text.dream_finished.output.no_memory" });
    expect(traces[0]?.steps.map((step) => step.kind)).toEqual([
      "dream_start",
      "snapshot_loaded",
      "dream_finished",
    ]);
    repository.close();
  });

  it("promotes tmp memory into a formal project without generating overview files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const memoryDir = join(dir, "memory");
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), { memoryDir });
    const store = repository.getFileMemoryStore();

    const tmpFeedback = store.upsertCandidate({
      type: "feedback",
      scope: "project",
      name: "delivery-rule",
      description: "交付顺序要求",
      rule: "先给3个标题，再给正文，再给封面文案。",
      howToApply: "每次交付小红书文案时执行",
    });
    const tmpProject = store.upsertCandidate({
      type: "project",
      scope: "project",
      name: "初夏通勤穿搭爆文",
      description: "帮时尚博主批量生成通勤穿搭小红书文案。",
      stage: "目前还在选题和风格摸索阶段。",
      nextSteps: ["收敛标题风格"],
    });

    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      planDreamFileMemory: async () => ({
        summary: "Attach tmp files into one final project.",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [{
          planKey: "summer-commute",
          projectName: "初夏通勤穿搭爆文",
          description: "帮时尚博主批量生成通勤穿搭小红书文案。",
          aliases: ["初夏通勤穿搭爆文"],
          status: "active",
          evidenceEntryIds: [],
          retainedEntryIds: [tmpProject.relativePath, tmpFeedback.relativePath],
        }],
        deletedProjectIds: [],
        deletedEntryIds: [],
      }),
      rewriteDreamFileProject: async () => ({
        summary: "Rewrite project and feedback.",
        projectMeta: {
          projectName: "初夏通勤穿搭爆文",
          description: "帮时尚博主批量生成通勤穿搭小红书文案，目前处于选题与风格探索阶段。",
          aliases: ["初夏通勤穿搭爆文"],
          status: "active",
        },
        files: [
          {
            type: "project",
            name: "current-stage",
            description: "当前项目状态",
            sourceEntryIds: [tmpProject.relativePath],
            stage: "目前还在选题和风格摸索阶段。",
            nextSteps: ["收敛标题风格"],
          },
          {
            type: "feedback",
            name: "delivery-rule",
            description: "交付顺序要求",
            sourceEntryIds: [tmpFeedback.relativePath],
            rule: "先给3个标题，再给正文，再给封面文案。",
            howToApply: "每次交付小红书文案时执行",
          },
        ],
        deletedEntryIds: [],
      }),
    }));

    const result = await runner.run();

    const projectIds = store.listProjectIds().filter((projectId) => projectId !== "_tmp");
    expect(projectIds).toHaveLength(1);
    const projectId = projectIds[0]!;
    const meta = store.getProjectMeta(projectId)!;
    expect(meta.projectName).toBe("初夏通勤穿搭爆文");
    const entries = store.listMemoryEntries({ scope: "project", projectId, limit: 20 });
    expect(entries.map((entry) => entry.relativePath).sort()).toEqual([
      `projects/${projectId}/Feedback/delivery-rule.md`,
      `projects/${projectId}/Project/current-stage.md`,
    ]);
    expect(store.listTmpEntries()).toHaveLength(0);
    expect(result.rewrittenProjects).toBe(1);
    expect(result.deletedProjects).toBe(0);
    const traces = repository.listRecentDreamTraces(5);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.steps.some((step) => step.kind === "global_plan_generated")).toBe(true);
    expect(traces[0]?.steps.some((step) => step.kind === "project_rewrite_generated")).toBe(true);
    expect(traces[0]?.steps.some((step) => step.kind === "project_mutations_applied")).toBe(true);
    expect(traces[0]?.steps.find((step) => step.kind === "project_rewrite_generated")?.titleI18n)
      .toMatchObject({ key: "trace.text.project_rewrite_generated.title" });
    expect(traces[0]?.steps.find((step) => step.kind === "manifests_repaired")?.outputSummaryI18n)
      .toMatchObject({ key: "trace.text.manifests_repaired.output" });
    expect(traces[0]?.mutations.some((mutation) => mutation.action === "write")).toBe(true);
    repository.close();
  });

  it("merges legacy duplicate tmp project files before asking Dream for a plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const store = repository.getFileMemoryStore();

    store.writeCandidateToRelativePath("projects/_tmp/Project/boreal-a.md", {
      type: "project",
      scope: "project",
      projectId: "_tmp",
      name: "Boreal”",
      description: "本地知识库整理工具",
      capturedAt: "2026-04-11T09:00:00.000Z",
      sourceSessionKey: "seed-quoted",
      stage: "初始定义",
    });
    store.writeCandidateToRelativePath("projects/_tmp/Project/boreal-b.md", {
      type: "project",
      scope: "project",
      projectId: "_tmp",
      name: "Boreal",
      description: "本地知识库整理工具",
      capturedAt: "2026-04-11T09:00:00.000Z",
      sourceSessionKey: "seed-quoted",
      stage: "补充了下一步",
      nextSteps: ["整理目录结构"],
    });

    let observedProjectRecordCount = 0;
    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      planDreamFileMemory: async (input: { records: Array<{ type: string; entryId: string }> }) => {
        observedProjectRecordCount = input.records.filter((record) => record.type === "project").length;
        return {
          summary: "noop",
          duplicateTopicCount: 0,
          conflictTopicCount: 0,
          projects: [],
          deletedProjectIds: [],
          deletedEntryIds: [],
        };
      },
    }));

    await runner.run();

    expect(observedProjectRecordCount).toBe(1);
    const tmpEntries = store.listTmpEntries(20).filter((entry) => entry.type === "project");
    expect(tmpEntries).toHaveLength(1);
    expect(tmpEntries[0]?.name).toBe("Boreal");
    repository.close();
  });

  it("allows one source file to support multiple rewritten outputs when target paths stay distinct", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const store = repository.getFileMemoryStore();

    const tmpProject = store.upsertCandidate({
      type: "project",
      scope: "project",
      name: "Boreal",
      description: "本地知识库整理工具。",
      stage: "目前只有一份粗项目记忆。",
      decisions: ["后续需要拆成项目状态和协作规则"],
    });

    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      planDreamFileMemory: async () => ({
        summary: "Promote one tmp project into a formal project.",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [{
          planKey: "boreal",
          projectName: "Boreal",
          description: "本地知识库整理工具。",
          aliases: ["Boreal"],
          status: "active",
          evidenceEntryIds: [tmpProject.relativePath],
          retainedEntryIds: [tmpProject.relativePath],
        }],
        deletedProjectIds: [],
        deletedEntryIds: [],
      }),
      rewriteDreamFileProject: async () => ({
        summary: "Split one source project note into project state plus collaboration rule.",
        projectMeta: {
          projectName: "Boreal",
          description: "本地知识库整理工具。",
          aliases: ["Boreal"],
          status: "active",
        },
        files: [
          {
            type: "project",
            name: "current-stage",
            description: "当前项目状态",
            sourceEntryIds: [tmpProject.relativePath],
            stage: "已经拆出稳定的项目状态文件。",
          },
          {
            type: "feedback",
            name: "collaboration-rule",
            description: "协作交付规则",
            sourceEntryIds: [tmpProject.relativePath],
            rule: "汇报时先说完成了什么，再说风险。",
            howToApply: "每次汇报项目前都应用。",
          },
        ],
        deletedEntryIds: [],
      }),
    }));

    const result = await runner.run();

    expect(result.rewrittenProjects).toBe(1);
    const projectId = store.listProjectIds().find((item) => item !== "_tmp");
    expect(projectId).toBeTruthy();
    const entries = store.listMemoryEntries({ scope: "project", projectId: projectId!, limit: 20 });
    expect(entries.map((entry) => entry.relativePath).sort()).toEqual([
      `projects/${projectId}/Feedback/collaboration-rule.md`,
      `projects/${projectId}/Project/current-stage.md`,
    ]);
    repository.close();
  });

  it("can merge two formal projects into one survivor and delete the absorbed project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const store = repository.getFileMemoryStore();

    const survivorId = "project_survivor";
    const absorbedId = "project_absorbed";
    store.upsertProjectMeta({
      projectId: survivorId,
      projectName: "城市咖啡探店爆文",
      description: "旧版项目描述 A",
      aliases: ["城市咖啡探店爆文"],
      status: "active",
    });
    store.upsertProjectMeta({
      projectId: absorbedId,
      projectName: "城市咖啡馆探店爆文",
      description: "旧版项目描述 B",
      aliases: ["城市咖啡馆探店爆文"],
      status: "active",
    });
    const projectA = store.writeCandidateToRelativePath(`projects/${survivorId}/Project/current-stage.md`, {
      type: "project",
      scope: "project",
      projectId: survivorId,
      name: "current-stage",
      description: "项目 A 状态",
      stage: "还在测试探店标题。",
    });
    const projectB = store.writeCandidateToRelativePath(`projects/${absorbedId}/Project/current-stage.md`, {
      type: "project",
      scope: "project",
      projectId: absorbedId,
      name: "current-stage",
      description: "项目 B 状态",
      stage: "已经开始收集门店素材。",
      notes: ["这个项目其实和 A 是同一个项目"],
    });

    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      planDreamFileMemory: async () => ({
        summary: "Merge overlapping formal projects.",
        duplicateTopicCount: 1,
        conflictTopicCount: 0,
        projects: [{
          planKey: "coffee",
          targetProjectId: survivorId,
          projectName: "城市咖啡探店爆文",
          description: "统一后的咖啡探店项目。",
          aliases: ["城市咖啡探店爆文", "城市咖啡馆探店爆文"],
          status: "active",
          mergeReason: "duplicate_formal_project",
          evidenceEntryIds: [projectA.relativePath, projectB.relativePath],
          retainedEntryIds: [projectA.relativePath, projectB.relativePath],
        }],
        deletedProjectIds: [absorbedId],
        deletedEntryIds: [],
      }),
      rewriteDreamFileProject: async () => ({
        summary: "Rewrite merged project.",
        projectMeta: {
          projectName: "城市咖啡探店爆文",
          description: "统一后的咖啡探店项目。",
          aliases: ["城市咖啡探店爆文", "城市咖啡馆探店爆文"],
          status: "active",
        },
        files: [{
          type: "project",
          name: "current-stage",
          description: "统一后的项目状态",
          sourceEntryIds: [projectA.relativePath, projectB.relativePath],
          stage: "正在统一标题风格并收集门店素材。",
          notes: ["由两个重复 formal project 合并而来"],
        }],
        deletedEntryIds: [],
      }),
    }));

    const result = await runner.run();

    expect(store.getProjectMeta(absorbedId)).toBeUndefined();
    expect(store.getProjectMeta(survivorId)?.aliases).toContain("城市咖啡馆探店爆文");
    const entries = store.listMemoryEntries({ scope: "project", projectId: survivorId, limit: 20 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.relativePath).toBe(`projects/${survivorId}/Project/current-stage.md`);
    expect(result.deletedProjects).toBe(1);
    repository.close();
  });

  it("keeps unresolved tmp memory untouched when the global plan does not attach or delete it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const store = repository.getFileMemoryStore();

    store.upsertCandidate({
      type: "feedback",
      scope: "project",
      name: "ad-tone",
      description: "语气要求",
      rule: "标题不要太像广告。",
    });

    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      planDreamFileMemory: async () => ({
        summary: "No safe attachment was found.",
        duplicateTopicCount: 0,
        conflictTopicCount: 1,
        projects: [],
        deletedProjectIds: [],
        deletedEntryIds: [],
      }),
    }));

    const result = await runner.run();

    expect(store.listProjectIds().filter((projectId) => projectId !== "_tmp")).toHaveLength(0);
    expect(store.listTmpEntries()).toHaveLength(1);
    expect(result.rewrittenProjects).toBe(0);
    expect(result.conflictTopicCount).toBe(1);
    repository.close();
  });

  it("rejects umbrella merges that collapse distinct explicit tmp project names without strong evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const store = repository.getFileMemoryStore();

    const projectA = store.upsertCandidate({
      type: "project",
      scope: "project",
      name: "初夏通勤穿搭爆文",
      description: "帮时尚博主批量生成通勤穿搭小红书文案。",
      stage: "还在选题和风格摸索阶段。",
    });
    const projectB = store.upsertCandidate({
      type: "project",
      scope: "project",
      name: "城市咖啡探店爆文",
      description: "给本地生活博主批量生成咖啡店和餐厅探店小红书文案。",
      stage: "正在收集门店素材。",
    });

    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      planDreamFileMemory: async () => ({
        summary: "Merge both projects into one content super-project.",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [{
          planKey: "content-super-project",
          projectName: "小红书文案批量生成",
          description: "为多类博主批量生成小红书文案。",
          aliases: ["小红书文案"],
          status: "active",
          evidenceEntryIds: [projectA.relativePath, projectB.relativePath],
          retainedEntryIds: [projectA.relativePath, projectB.relativePath],
        }],
        deletedProjectIds: [],
        deletedEntryIds: [],
      }),
    }));

    await expect(runner.run()).rejects.toThrow(/distinct explicit projects/i);
    repository.close();
  });

  it("rewrites the global user profile without requiring project rewrites", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-dream-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    const store = repository.getFileMemoryStore();

    store.upsertCandidate({
      type: "user",
      scope: "global",
      name: "user-profile",
      description: "用户画像",
      profile: "用户是做小红书图文选题策划的。",
      preferences: ["更习惯中文", "常用飞书表格和 Notion"],
      constraints: ["很在意标题和封面文案的一致性"],
      relationships: ["长期与博主团队合作"],
    });
    const runner = new DreamRewriteRunner(repository, createDreamExtractor({
      rewriteUserProfile: async () => ({
        type: "user",
        scope: "global",
        name: "user-profile",
        description: "Dream rewritten user profile",
        profile: "用户是做小红书图文选题策划的，长期服务于内容团队。",
        preferences: ["更习惯中文", "常用飞书表格和 Notion"],
        constraints: ["很在意标题和封面文案的一致性"],
        relationships: ["长期与博主团队合作"],
      }),
    }));

    const result = await runner.run();

    const userRecord = store.getMemoryRecord("global/User/user-profile.md", 5000);
    expect(userRecord?.content).toContain("## Profile");
    expect(userRecord?.content).toContain("长期服务于内容团队");
    expect(result.profileUpdated).toBe(true);
    const traces = repository.listRecentDreamTraces(5);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.steps.some((step) => step.kind === "user_profile_rewritten")).toBe(true);
    expect(traces[0]?.mutations.some((mutation) => mutation.action === "rewrite_user_profile")).toBe(true);
    repository.close();
  });
});
