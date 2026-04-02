import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryRepository,
  type L2ProjectIndexRecord,
  type L2TimeIndexRecord,
} from "../src/core/index.js";

function createTimeIndex(overrides: Partial<L2TimeIndexRecord> = {}): L2TimeIndexRecord {
  return {
    l2IndexId: "l2-time-1",
    dateKey: "2026-03-31",
    summary: "Alpha retrieval work happened today.",
    l1Source: ["l1-1"],
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T08:00:00.000Z",
    ...overrides,
  };
}

function createProjectIndex(overrides: Partial<L2ProjectIndexRecord> = {}): L2ProjectIndexRecord {
  return {
    l2IndexId: "l2-project-1",
    projectKey: "alpha-project",
    projectName: "Alpha Project",
    summary: "Alpha retrieval project summary.",
    currentStatus: "in_progress",
    latestProgress: "Alpha project is refactoring search ranking.",
    l1Source: ["l1-1"],
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T09:00:00.000Z",
    ...overrides,
  };
}

describe("MemoryRepository L2 search", () => {
  const cleanupPaths: string[] = [];
  const repositories: MemoryRepository[] = [];

  afterEach(async () => {
    for (const repository of repositories.splice(0)) {
      repository.close();
    }
    await Promise.all(
      cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
    );
  });

  async function createRepository(): Promise<MemoryRepository> {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-sqlite-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"));
    repositories.push(repository);
    return repository;
  }

  it("keeps project-only search from being displaced by time hits", async () => {
    const repository = await createRepository();
    repository.upsertL2TimeIndex(
      createTimeIndex({ l2IndexId: "l2-time-1", dateKey: "2026-03-31" }),
    );
    repository.upsertL2TimeIndex(
      createTimeIndex({
        l2IndexId: "l2-time-2",
        dateKey: "2026-03-30",
        summary: "Alpha work continued yesterday.",
      }),
    );
    repository.upsertL2ProjectIndex(createProjectIndex());

    const hits = repository.searchL2ProjectIndexes("Alpha", 1);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.level).toBe("l2_project");
    expect(hits[0]?.item.l2IndexId).toBe("l2-project-1");
  });

  it("keeps time-only search from being displaced by project hits", async () => {
    const repository = await createRepository();
    repository.upsertL2ProjectIndex(
      createProjectIndex({ l2IndexId: "l2-project-1", projectName: "Release Board" }),
    );
    repository.upsertL2ProjectIndex(
      createProjectIndex({
        l2IndexId: "l2-project-2",
        projectKey: "release-api",
        projectName: "Release API",
        summary: "Release planning summary.",
        latestProgress: "Release tasks are blocked on QA.",
      }),
    );
    repository.upsertL2TimeIndex(
      createTimeIndex({
        l2IndexId: "l2-time-3",
        dateKey: "2026-03-29",
        summary: "Release day notes and testing timeline.",
      }),
    );

    const hits = repository.searchL2TimeIndexes("Release", 1);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.level).toBe("l2_time");
    expect(hits[0]?.item.l2IndexId).toBe("l2-time-3");
  });

  it("merges per-type top-k results for mixed L2 search", async () => {
    const repository = await createRepository();
    repository.upsertL2TimeIndex(
      createTimeIndex({ l2IndexId: "l2-time-mixed", summary: "Beta work happened today." }),
    );
    repository.upsertL2ProjectIndex(
      createProjectIndex({
        l2IndexId: "l2-project-mixed",
        projectKey: "beta-project",
        projectName: "Beta Project",
        summary: "Beta project summary.",
        latestProgress: "Beta project shipped the retrieval patch.",
      }),
    );

    const hits = repository.searchL2Hits("Beta", 2);

    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.level)).toEqual(expect.arrayContaining(["l2_time", "l2_project"]));
  });
});
