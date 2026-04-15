import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/core/index.js";

const cleanupDirs: string[] = [];
const repositories: MemoryRepository[] = [];
const FORMAL_PROJECT_ID = "project_demo123";

async function createRepository() {
  const dir = await mkdtemp(join(tmpdir(), "clawxmemory-actions-"));
  cleanupDirs.push(dir);
  const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
    memoryDir: join(dir, "memory"),
  });
  repositories.push(repository);
  return {
    repository,
    store: repository.getFileMemoryStore(),
  };
}

function seedFormalProject(store: ReturnType<MemoryRepository["getFileMemoryStore"]>) {
  const meta = store.upsertProjectMeta({
    projectId: FORMAL_PROJECT_ID,
    projectName: "初夏通勤穿搭爆文",
    description: "帮时尚博主批量生成小红书通勤穿搭文案",
    aliases: ["初夏通勤穿搭爆文"],
  });
  const projectRecord = store.upsertCandidate({
    type: "project",
    scope: "project",
    projectId: FORMAL_PROJECT_ID,
    name: "current-stage",
    description: "项目还在风格摸索阶段",
    stage: "项目还在风格摸索阶段",
    nextSteps: ["确定风格模板"],
  });
  return { meta, projectRecord };
}

function seedFormalFeedback(store: ReturnType<MemoryRepository["getFileMemoryStore"]>) {
  return store.upsertCandidate({
    type: "feedback",
    scope: "project",
    projectId: FORMAL_PROJECT_ID,
    name: "delivery-rule",
    description: "先给标题，再给正文，再给封面文案",
    rule: "先给标题，再给正文，再给封面文案",
    why: "这样更方便选题决策",
    howToApply: "每次交付保持同样顺序",
  });
}

function seedTmpProject(store: ReturnType<MemoryRepository["getFileMemoryStore"]>, name = "秋日城市散步爆文") {
  return store.upsertCandidate({
    type: "project",
    scope: "project",
    name,
    description: "给生活方式博主批量生成城市散步主题小红书文案",
    stage: "刚开始确定选题风格",
  });
}

function seedTmpFeedback(store: ReturnType<MemoryRepository["getFileMemoryStore"]>, name = "delivery-rule") {
  return store.upsertCandidate({
    type: "feedback",
    scope: "project",
    name,
    description: "每次交付都先给标题，再给正文",
    rule: "每次交付都先给标题，再给正文",
  });
}

afterEach(async () => {
  while (repositories.length > 0) {
    repositories.pop()?.close();
  }
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("manual file-memory actions", () => {
  it("edits project meta and preserves the old name as an alias", async () => {
    const { repository, store } = await createRepository();
    seedFormalProject(store);

    const meta = repository.editProjectMeta({
      projectId: FORMAL_PROJECT_ID,
      projectName: "夏日通勤穿搭内容工厂",
      description: "用于批量生产通勤穿搭内容",
      aliases: ["通勤穿搭内容工厂"],
      status: "in_progress",
    });

    expect(meta.projectName).toBe("夏日通勤穿搭内容工厂");
    expect(meta.description).toBe("用于批量生产通勤穿搭内容");
    expect(meta.status).toBe("in_progress");
    expect(meta.aliases).toEqual(expect.arrayContaining([
      "初夏通勤穿搭爆文",
      "通勤穿搭内容工厂",
      "夏日通勤穿搭内容工厂",
    ]));
  });

  it("edits a formal project memory entry with structured fields", async () => {
    const { repository, store } = await createRepository();
    const { projectRecord } = seedFormalProject(store);

    const record = repository.editMemoryEntry({
      id: projectRecord.relativePath,
      name: "current-stage",
      description: "项目已经进入模板验证阶段",
      fields: {
        stage: "项目已经进入模板验证阶段",
        nextSteps: ["补充 3 个爆款模板", "验证封面标题一致性"],
        blockers: ["还缺稳定的封面模板"],
      },
    });

    expect(record.description).toBe("项目已经进入模板验证阶段");
    expect(record.content).toContain("## Current Stage");
    expect(record.content).toContain("项目已经进入模板验证阶段");
    expect(record.content).toContain("- 补充 3 个爆款模板");
    expect(record.content).toContain("- 还缺稳定的封面模板");
  });

  it("edits a tmp feedback entry with structured fields before archive", async () => {
    const { repository, store } = await createRepository();
    const tmp = seedTmpFeedback(store);

    const record = repository.editMemoryEntry({
      id: tmp.relativePath,
      name: "delivery-rule",
      description: "交付时追加评论区引导",
      fields: {
        rule: "交付时先标题、再正文、再封面、最后给评论区引导",
        why: "方便一次性审核",
        howToApply: "每次交付保持固定结构",
        notes: ["评论区引导限制在 30 字内"],
      },
    });

    expect(record.description).toBe("交付时追加评论区引导");
    expect(record.content).toContain("## Rule");
    expect(record.content).toContain("最后给评论区引导");
    expect(record.content).toContain("## Why");
    expect(record.content).toContain("方便一次性审核");
    expect(record.content).toContain("- 评论区引导限制在 30 字内");
  });

  it("edits a formal feedback entry with structured fields", async () => {
    const { repository, store } = await createRepository();
    seedFormalProject(store);
    const feedback = seedFormalFeedback(store);

    const record = repository.editMemoryEntry({
      id: feedback.relativePath,
      name: "delivery-rule",
      description: "交付时追加评论区引导",
      fields: {
        rule: "交付时先标题、再正文、再封面，最后给一句评论区引导",
        why: "方便一次性审核交付结构",
        howToApply: "评论区引导限制在 30 字内",
      },
    });

    expect(record.description).toBe("交付时追加评论区引导");
    expect(record.content).toContain("交付时先标题、再正文、再封面");
    expect(record.content).toContain("方便一次性审核交付结构");
    expect(record.content).toContain("评论区引导限制在 30 字内");
  });

  it("deprecates and restores a formal memory file without exposing it to default lists or recall scanning", async () => {
    const { repository, store } = await createRepository();
    const { projectRecord } = seedFormalProject(store);

    const deprecated = repository.deprecateMemoryEntries([projectRecord.relativePath]);
    expect(deprecated.mutatedIds).toEqual([projectRecord.relativePath]);
    expect(repository.listMemoryEntries({ scope: "project", projectId: FORMAL_PROJECT_ID })).toEqual([]);
    expect(store.scanRecallHeaderEntries({ projectId: FORMAL_PROJECT_ID, limit: 200 })).toEqual([]);

    const restored = repository.restoreMemoryEntries([projectRecord.relativePath]);
    expect(restored.mutatedIds).toEqual([projectRecord.relativePath]);
    expect(repository.listMemoryEntries({ scope: "project", projectId: FORMAL_PROJECT_ID })).toHaveLength(1);
    expect(store.scanRecallHeaderEntries({ projectId: FORMAL_PROJECT_ID, limit: 200 })).toHaveLength(1);
    const exported = repository.exportMemoryBundle();
    expect(exported.files.find((item) => item.relativePath === projectRecord.relativePath)?.content).not.toContain("deprecated: true");
  });

  it("requires deprecating a memory file before deleting it", async () => {
    const { repository, store } = await createRepository();
    const { projectRecord } = seedFormalProject(store);

    expect(() => repository.deleteMemoryEntries([projectRecord.relativePath])).toThrow("Only deprecated memory can be deleted");

    repository.deprecateMemoryEntries([projectRecord.relativePath]);
    const result = repository.deleteMemoryEntries([projectRecord.relativePath]);

    expect(result.mutatedIds).toEqual([projectRecord.relativePath]);
    expect(result.deletedProjectIds).toEqual([FORMAL_PROJECT_ID]);
    expect(store.getProjectMeta(FORMAL_PROJECT_ID)).toBeUndefined();
  });

  it("rejects editing deprecated memory and restoring active memory", async () => {
    const { repository, store } = await createRepository();
    const { projectRecord } = seedFormalProject(store);

    repository.deprecateMemoryEntries([projectRecord.relativePath]);

    expect(() => repository.editMemoryEntry({
      id: projectRecord.relativePath,
      name: "current-stage",
      description: "不会保存",
    })).toThrow("Deprecated memory must be restored before editing");
    expect(() => repository.restoreMemoryEntries(["projects/missing.md"])).not.toThrow();
    repository.restoreMemoryEntries([projectRecord.relativePath]);
    expect(() => repository.restoreMemoryEntries([projectRecord.relativePath])).toThrow("Only deprecated memory can be restored");
  });

  it("archives a tmp project into a newly created formal project and blocks deprecated tmp archive", async () => {
    const { repository, store } = await createRepository();
    const tmp = seedTmpProject(store);

    repository.editMemoryEntry({
      id: tmp.relativePath,
      name: "current-stage",
      description: "秋日城市散步项目已进入模板验证阶段",
      fields: {
        stage: "秋日城市散步项目已进入模板验证阶段",
      },
    });

    repository.deprecateMemoryEntries([tmp.relativePath]);
    expect(() => repository.archiveTmpEntries({
      ids: [tmp.relativePath],
      newProjectName: "秋日城市散步爆文",
    })).toThrow("Deprecated tmp memory must be restored before archiving");

    repository.restoreMemoryEntries([tmp.relativePath]);
    const result = repository.archiveTmpEntries({
      ids: [tmp.relativePath],
      newProjectName: "秋日城市散步爆文",
    });

    expect(result.createdProjectId).toBeTruthy();
    expect(store.listTmpEntries()).toEqual([]);
    expect(store.getProjectMeta(result.targetProjectId)?.projectName).toBe("秋日城市散步爆文");
    expect(repository.listMemoryEntries({ scope: "project", projectId: result.targetProjectId })).toHaveLength(1);
  });

  it("rejects editing and deleting user profile through manual maintenance", async () => {
    const { repository, store } = await createRepository();
    const user = store.upsertCandidate({
      type: "user",
      scope: "global",
      name: "user-profile",
      description: "用户更习惯中文交流",
      profile: "用户更习惯中文交流",
      preferences: ["中文"],
    });

    expect(() => repository.editMemoryEntry({
      id: user.relativePath,
      name: "user-profile",
      description: "不会保存",
    })).toThrow("User profile cannot be edited from manual maintenance");
    expect(() => repository.deprecateMemoryEntries([user.relativePath])).toThrow("User profile cannot be deprecated");
    expect(() => repository.deleteMemoryEntries([user.relativePath])).toThrow("User profile cannot be deleted from manual maintenance");
  });

  it("archives tmp feedback into an existing formal project", async () => {
    const { repository, store } = await createRepository();
    seedFormalProject(store);
    const tmp = seedTmpFeedback(store);

    const result = repository.archiveTmpEntries({
      ids: [tmp.relativePath],
      targetProjectId: FORMAL_PROJECT_ID,
    });

    expect(result.targetProjectId).toBe(FORMAL_PROJECT_ID);
    expect(store.listTmpEntries()).toEqual([]);
    const entries = repository.listMemoryEntries({ scope: "project", projectId: FORMAL_PROJECT_ID });
    expect(entries.some((entry) => entry.type === "feedback")).toBe(true);
  });
});
