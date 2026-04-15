import { mkdtempSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/core/index.js";

const repositories: MemoryRepository[] = [];

afterEach(() => {
  while (repositories.length > 0) {
    repositories.pop()?.close();
  }
});

describe("MemoryRepository.clearAllMemoryData", () => {
  it("clears formal memory and tmp staging together", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clawxmemory-dream-sqlite-"));
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });
    repositories.push(repository);
    const store = repository.getFileMemoryStore();

    store.upsertCandidate({
      type: "user",
      scope: "global",
      name: "user-profile",
      description: "Stable user profile.",
      profile: "The user works on AI products.",
    });
    store.upsertProjectMeta({
      projectId: "project_aster",
      projectName: "aster",
      description: "Formal project memory.",
      aliases: ["aster"],
    });
    store.upsertCandidate({
      type: "project",
      scope: "project",
      projectId: "project_aster",
      name: "aster",
      description: "Formal project memory.",
      stage: "Formal project exists already.",
    });
    store.upsertCandidate({
      type: "feedback",
      scope: "project",
      name: "collaboration-rule",
      description: "Tmp feedback rule.",
      rule: "先说完成了什么，再说风险。",
    });

    expect(store.listMemoryEntries({ limit: 100, includeTmp: true })).toHaveLength(3);

    repository.clearAllMemoryData();

    expect(store.listMemoryEntries({ limit: 100, includeTmp: true })).toHaveLength(0);
    expect(store.getOverview()).toMatchObject({
      totalMemoryFiles: 0,
      totalProjectMemories: 0,
      totalFeedbackMemories: 0,
      totalUserMemories: 0,
      tmpTotalFiles: 0,
      tmpProjectMemories: 0,
      tmpFeedbackMemories: 0,
    });

    await expect(readFile(join(dir, "memory", "global", "MEMORY.md"), "utf-8")).resolves.toContain("# Global Memory");
    await expect(readFile(join(dir, "memory", "projects", "_tmp", "MEMORY.md"), "utf-8")).resolves.toContain("# Temporary Project Memory");
    await expect(readdir(join(dir, "memory", "projects", "_tmp", "Project"))).resolves.toEqual([]);
    await expect(readdir(join(dir, "memory", "projects", "_tmp", "Feedback"))).resolves.toEqual([]);
    await expect(access(join(dir, "memory", "projects", "project_aster"))).rejects.toBeTruthy();
  });
});
