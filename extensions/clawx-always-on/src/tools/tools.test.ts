import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AlwaysOnConfig } from "../core/config.js";
import type { AlwaysOnTask } from "../core/types.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";
import { createCompleteToolFactory } from "./complete-tool.js";
import { createProgressToolFactory } from "./progress-tool.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Test task",
    status: "active",
    sourceType: "user-command",
    budgetExceededAction: "warn",
    budgetConstraints: "[]",
    budgetUsage: '{"loopsUsed":0,"costUsedUsd":0}',
    sessionKey: "always-on:task-001",
    createdAt: Date.now(),
    runCount: 1,
    ...overrides,
  };
}

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  defaultBudgetExceededAction: "warn",
  maxConcurrentTasks: 3,
  dreamEnabled: false,
  dreamIntervalMinutes: 60,
  dreamMaxCandidates: 3,
  dreamContextMessageLimit: 40,
  logLevel: "info",
  logRetentionDays: 30,
};

const alwaysOnSessionKeys = ["always-on:task-001", "agent:main:always-on:task-001"] as const;

describe("always_on_progress tool", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tools-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for non-always-on sessions", () => {
    const factory = createProgressToolFactory(store, logger);
    const tool = factory({ sessionKey: "main-session" });
    expect(tool).toBeNull();
  });

  it.each(alwaysOnSessionKeys)("saves progress summary for %s", async (sessionKey) => {
    store.createTask(makeTask());
    const factory = createProgressToolFactory(store, logger);
    const tool = factory({ sessionKey });
    expect(tool).not.toBeNull();

    const result = await tool!.execute("call-1", { summary: "Step 1 complete" });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Progress saved successfully." }],
      details: { status: "saved" },
    });

    const task = store.getTask("task-001");
    expect(task!.progressSummary).toBe("Step 1 complete");
  });
});

describe("always_on_complete tool", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tools-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for non-always-on sessions", () => {
    const factory = createCompleteToolFactory(store, logger);
    const tool = factory({ sessionKey: "main-session" });
    expect(tool).toBeNull();
  });

  it.each(alwaysOnSessionKeys)("marks task as completed with result for %s", async (sessionKey) => {
    store.createTask(makeTask());
    const factory = createCompleteToolFactory(store, logger);
    const tool = factory({ sessionKey });
    expect(tool).not.toBeNull();

    const result = await tool!.execute("call-1", { result: "Task done successfully" });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Task marked as completed." }],
      details: { status: "completed" },
    });

    const task = store.getTask("task-001");
    expect(task!.status).toBe("completed");
    expect(task!.resultSummary).toBe("Task done successfully");
    expect(task!.completedAt).toBeDefined();
  });
});
