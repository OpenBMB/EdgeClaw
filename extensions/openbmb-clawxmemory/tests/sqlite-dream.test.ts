import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/core/index.js";

const repositories: MemoryRepository[] = [];

function createRepository(): MemoryRepository {
  const dir = mkdtempSync(join(tmpdir(), "clawxmemory-dream-sqlite-"));
  const repository = new MemoryRepository(join(dir, "memory.sqlite"));
  repositories.push(repository);
  return repository;
}

afterEach(() => {
  while (repositories.length > 0) {
    repositories.pop()?.close();
  }
});

describe("MemoryRepository.applyDreamRewrite", () => {
  it("replaces L2 project sources and global profile sources without touching L2Time", () => {
    const repository = createRepository();

    repository.insertL1Window({
      l1IndexId: "l1-1",
      sessionKey: "session-1",
      timePeriod: "2026-04-01 morning",
      startedAt: "2026-04-01T08:00:00.000Z",
      endedAt: "2026-04-01T09:00:00.000Z",
      summary: "First L1",
      facts: [],
      situationTimeInfo: "First situation",
      projectTags: ["dream"],
      projectDetails: [],
      l0Source: [],
      createdAt: "2026-04-01T09:00:00.000Z",
    });
    repository.insertL1Window({
      l1IndexId: "l1-2",
      sessionKey: "session-2",
      timePeriod: "2026-04-02 morning",
      startedAt: "2026-04-02T08:00:00.000Z",
      endedAt: "2026-04-02T09:00:00.000Z",
      summary: "Second L1",
      facts: [],
      situationTimeInfo: "Second situation",
      projectTags: ["dream"],
      projectDetails: [],
      l0Source: [],
      createdAt: "2026-04-02T09:00:00.000Z",
    });

    repository.upsertL2TimeIndex({
      l2IndexId: "l2-time-1",
      dateKey: "2026-04-02",
      summary: "Timeline summary",
      l1Source: ["l1-1"],
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    repository.upsertL2ProjectIndex({
      l2IndexId: "l2-project-1",
      projectKey: "dream-review",
      projectName: "Dream Review",
      summary: "Old summary",
      currentStatus: "in_progress",
      latestProgress: "Old progress",
      l1Source: ["l1-1", "l1-stale"],
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });
    repository.upsertGlobalProfile("Old profile", ["l1-1", "l1-stale"]);
    repository.insertLink("l2", "l2-project-1", "l1", "l1-1");
    repository.insertLink("l2", "l2-time-1", "l1", "l1-1");

    repository.applyDreamRewrite({
      projects: [
        {
          l2IndexId: "l2-project-1",
          projectKey: "dream-review",
          projectName: "Dream Review",
          summary: "New summary",
          currentStatus: "in_progress",
          latestProgress: "New progress",
          l1Source: ["l1-2"],
          createdAt: "2026-04-01T10:00:00.000Z",
          updatedAt: "2026-04-02T10:00:00.000Z",
        },
      ],
      profileText: "New profile",
      profileSourceL1Ids: ["l1-2"],
    });

    expect(repository.listAllL2Projects()).toEqual([
      expect.objectContaining({
        projectKey: "dream-review",
        summary: "New summary",
        l1Source: ["l1-2"],
      }),
    ]);
    expect(repository.getGlobalProfileRecord()).toEqual(
      expect.objectContaining({
        profileText: "New profile",
        sourceL1Ids: ["l1-2"],
      }),
    );
    expect(repository.listAllL2Time()).toEqual([
      expect.objectContaining({
        l2IndexId: "l2-time-1",
        l1Source: ["l1-1"],
      }),
    ]);
    expect(repository.listAllIndexLinks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromId: "l2-project-1", toId: "l1-2" }),
        expect.objectContaining({ fromId: "l2-time-1", toId: "l1-1" }),
      ]),
    );
    expect(repository.listAllIndexLinks()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ fromId: "l2-project-1", toId: "l1-1" })]),
    );
  });
});
