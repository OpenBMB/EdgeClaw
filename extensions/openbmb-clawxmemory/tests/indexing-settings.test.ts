import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/core/index.js";

const repositories: MemoryRepository[] = [];

function createRepository(): MemoryRepository {
  const dir = mkdtempSync(join(tmpdir(), "clawxmemory-settings-"));
  const repository = new MemoryRepository(join(dir, "memory.sqlite"));
  repositories.push(repository);
  return repository;
}

afterEach(() => {
  while (repositories.length > 0) {
    repositories.pop()?.close();
  }
});

describe("MemoryRepository indexing settings", () => {
  it("fills in new auto scheduling defaults when reading legacy settings", () => {
    const repository = createRepository();
    const defaults = {
      reasoningMode: "answer_first" as const,
      recallTopK: 10,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinNewL1: 10,
      dreamProjectRebuildTimeoutMs: 180_000,
    };

    repository.saveIndexingSettings({
      reasoningMode: "accuracy_first",
      recallTopK: 7,
    }, defaults);

    expect(repository.getIndexingSettings(defaults)).toEqual({
      reasoningMode: "accuracy_first",
      recallTopK: 7,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinNewL1: 10,
      dreamProjectRebuildTimeoutMs: 180_000,
    });
  });

  it("preserves zero and falls back invalid dream rebuild timeout values", () => {
    const repository = createRepository();
    const defaults = {
      reasoningMode: "answer_first" as const,
      recallTopK: 10,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinNewL1: 10,
      dreamProjectRebuildTimeoutMs: 180_000,
    };

    expect(repository.saveIndexingSettings({
      dreamProjectRebuildTimeoutMs: 0,
    }, defaults)).toEqual(expect.objectContaining({
      dreamProjectRebuildTimeoutMs: 0,
    }));

    expect(repository.saveIndexingSettings({
      dreamProjectRebuildTimeoutMs: -1,
    } as never, defaults)).toEqual(expect.objectContaining({
      dreamProjectRebuildTimeoutMs: 180_000,
    }));

    expect(repository.saveIndexingSettings({
      dreamProjectRebuildTimeoutMs: "bad",
    } as never, defaults)).toEqual(expect.objectContaining({
      dreamProjectRebuildTimeoutMs: 180_000,
    }));
  });
});
