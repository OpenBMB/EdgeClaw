import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AlwaysOnConfig } from "../core/config.js";
import { TaskLogger } from "./logger.js";
import { openDatabase } from "./store.js";

function makeConfig(overrides: Partial<AlwaysOnConfig> = {}): AlwaysOnConfig {
  return {
    defaultMaxLoops: 50,
    defaultMaxCostUsd: 1.0,
    maxConcurrentTasks: 3,
    logLevel: "debug",
    logRetentionDays: 30,
    ...overrides,
  };
}

describe("TaskLogger", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let logger: TaskLogger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-log-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and retrieves logs", () => {
    logger = new TaskLogger(db, makeConfig());
    logger.info("task-1", "Started execution");
    logger.warn("task-1", "Budget nearing limit");

    const logs = logger.getLogs("task-1");
    expect(logs).toHaveLength(2);
    // getLogs returns DESC order (most recent first)
    expect(logs[0].level).toBe("warn");
    expect(logs[0].message).toBe("Budget nearing limit");
    expect(logs[1].level).toBe("info");
    expect(logs[1].message).toBe("Started execution");
  });

  it("filters by log level", () => {
    logger = new TaskLogger(db, makeConfig({ logLevel: "warn" }));
    logger.debug("task-1", "Debug message");
    logger.info("task-1", "Info message");
    logger.warn("task-1", "Warn message");
    logger.error("task-1", "Error message");

    const logs = logger.getLogs("task-1");
    expect(logs).toHaveLength(2);
  });

  it("updates log filtering when config changes", () => {
    logger = new TaskLogger(db, makeConfig({ logLevel: "warn" }));
    logger.info("task-1", "before update");
    expect(logger.getLogs("task-1")).toHaveLength(0);

    logger.updateConfig(makeConfig({ logLevel: "info" }));
    logger.info("task-1", "after update");

    const logs = logger.getLogs("task-1");
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("after update");
  });

  it("respects limit parameter", () => {
    logger = new TaskLogger(db, makeConfig());
    for (let i = 0; i < 10; i++) {
      logger.info("task-1", `Message ${i}`);
    }

    const logs = logger.getLogs("task-1", 5);
    expect(logs).toHaveLength(5);
  });

  it("forwards to plugin logger", () => {
    const pluginLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    logger = new TaskLogger(db, makeConfig(), pluginLogger);
    logger.info("task-1", "Hello");

    expect(pluginLogger.info).toHaveBeenCalledWith("[always-on:task-1] Hello");
  });

  it("stores metadata as JSON", () => {
    logger = new TaskLogger(db, makeConfig());
    logger.info("task-1", "Budget check", { loopsUsed: 5, limit: 50 });

    const logs = logger.getLogs("task-1");
    expect(logs[0].metadata).toBe('{"loopsUsed":5,"limit":50}');
  });

  it("cleans up old logs", () => {
    logger = new TaskLogger(db, makeConfig({ logRetentionDays: 1 }));
    // Insert a log with an old timestamp directly
    db.prepare(
      "INSERT INTO always_on_logs (taskId, level, message, metadata, timestamp) VALUES (?, ?, ?, ?, ?)",
    ).run("task-1", "info", "Old message", null, Date.now() - 2 * 24 * 60 * 60 * 1000);

    expect(logger.getLogs("task-1")).toHaveLength(1);
    const deleted = logger.cleanup();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(logger.getLogs("task-1")).toHaveLength(0);
  });
});
