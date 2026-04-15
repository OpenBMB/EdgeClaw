import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  it("drops legacy recallTopK and autoDreamMinTmpEntries values from persisted settings", () => {
    const repository = createRepository();
    const defaults = {
      reasoningMode: "answer_first" as const,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    };

    repository.setPipelineState("indexingSettings", {
      reasoningMode: "accuracy_first",
      recallTopK: 10,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinTmpEntries: 10,
      dreamProjectRebuildTimeoutMs: 180_000,
    });

    expect(repository.getIndexingSettings(defaults)).toEqual({
      reasoningMode: "accuracy_first",
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    });
  });

  it("fills in new auto scheduling defaults when reading legacy settings", () => {
    const repository = createRepository();
    const defaults = {
      reasoningMode: "answer_first" as const,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    };

    repository.saveIndexingSettings({
      reasoningMode: "accuracy_first",
    }, defaults);

    expect(repository.getIndexingSettings(defaults)).toEqual({
      reasoningMode: "accuracy_first",
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    });
  });

  it("drops legacy dream rebuild timeout values from persisted settings", () => {
    const repository = createRepository();
    const defaults = {
      reasoningMode: "answer_first" as const,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    };

    expect(repository.saveIndexingSettings({
      dreamProjectRebuildTimeoutMs: 0,
    } as never, defaults)).toEqual(defaults);

    expect(repository.saveIndexingSettings({
      dreamProjectRebuildTimeoutMs: -1,
    } as never, defaults)).toEqual(defaults);

    expect(repository.saveIndexingSettings({
      dreamProjectRebuildTimeoutMs: "bad",
    } as never, defaults)).toEqual(defaults);
  });

  it("migrates legacy pipeline_state rows from state_value and clears stale temp tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawxmemory-settings-"));
    const dbPath = join(dir, "memory.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE pipeline_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO pipeline_state (state_key, state_value, updated_at)
      VALUES ('lastIndexedAt', '"2026-04-15T00:00:00.000Z"', '2026-04-15T00:00:00.000Z');
      CREATE TABLE pipeline_state_v2 (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO pipeline_state_v2 (state_key, state_json, updated_at)
      VALUES ('stale', '"stale"', '2026-04-14T00:00:00.000Z');
    `);
    db.close();

    const repository = new MemoryRepository(dbPath);
    repositories.push(repository);

    expect(repository.getPipelineState("lastIndexedAt")).toBe("2026-04-15T00:00:00.000Z");

    const migratedDb = new DatabaseSync(dbPath);
    const columnNames = migratedDb.prepare("PRAGMA table_info(pipeline_state)").all()
      .map((column) => String((column as { name?: unknown }).name ?? ""));
    const leftoverTable = migratedDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pipeline_state_v2'")
      .get();
    migratedDb.close();

    expect(columnNames).toContain("state_json");
    expect(columnNames).not.toContain("state_value");
    expect(leftoverTable).toBeUndefined();
  });
});
