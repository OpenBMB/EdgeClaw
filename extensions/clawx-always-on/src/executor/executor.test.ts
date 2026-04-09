import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AlwaysOnConfig } from "../core/config.js";
import type { AlwaysOnTask } from "../core/types.js";
import { serializeUserCommandSourceMetadata } from "../source/user-command-source.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";
import { SubagentExecutor } from "./executor.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Test task",
    status: "pending",
    sourceType: "user-command",
    budgetConstraints: "[]",
    budgetUsage: '{"loopsUsed":0,"costUsedUsd":0}',
    createdAt: Date.now(),
    runCount: 0,
    ...overrides,
  };
}

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  maxConcurrentTasks: 3,
  logLevel: "info",
  logRetentionDays: 30,
};

describe("SubagentExecutor", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "executor-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("launches a task as active with correct session and idempotency keys", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-123" }),
    };
    const executor = new SubagentExecutor(mockSubagent, store, logger);

    const task = makeTask();
    store.createTask(task);

    const runId = await executor.launch(task);

    expect(runId).toBe("run-123");
    expect(mockSubagent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "always-on:task-001",
        idempotencyKey: "always-on:task-001:run:1",
        lane: "always-on",
        deliver: false,
      }),
    );

    const updated = store.getTask("task-001");
    expect(updated!.status).toBe("active");
    expect(updated!.sessionKey).toBe("always-on:task-001");
    expect(updated!.runCount).toBe(1);
  });

  it("includes progress summary for resumed tasks", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-456" }),
    };
    const executor = new SubagentExecutor(mockSubagent, store, logger);

    const task = makeTask({ runCount: 1, progressSummary: "Step 1 done" });
    store.createTask(task);

    await executor.launch(task);

    const callArgs = mockSubagent.run.mock.calls[0][0];
    expect(callArgs.idempotencyKey).toBe("always-on:task-001:run:2");
    expect(callArgs.message).toContain("Previous Progress");
    expect(callArgs.message).toContain("Step 1 done");

    const updated = store.getTask("task-001");
    expect(updated!.runCount).toBe(2);
  });

  it("uses reply-based completion instructions when explicit tools are unavailable", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-789" }),
    };
    const executor = new SubagentExecutor(mockSubagent, store, logger, {
      explicitToolsAvailable: false,
      profile: "coding",
    });

    const task = makeTask();
    store.createTask(task);

    await executor.launch(task);

    const callArgs = mockSubagent.run.mock.calls[0][0];
    expect(callArgs.message).toContain("Explicit always-on tools are unavailable");
    expect(callArgs.message).toContain("ALWAYS_ON_STATUS: completed");
    expect(callArgs.message).not.toContain("call `always_on_complete`");
  });

  it("prefers the stored planned prompt over the display title", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-999" }),
    };
    const executor = new SubagentExecutor(mockSubagent, store, logger);

    const task = makeTask({
      title: "Short display title",
      sourceMetadata: serializeUserCommandSourceMetadata({
        mode: "plan",
        prompt: "Expanded autonomous research prompt with steps and deliverables.",
      }),
    });
    store.createTask(task);

    await executor.launch(task);

    const callArgs = mockSubagent.run.mock.calls[0][0];
    expect(callArgs.message).toContain("Short display title");
    expect(callArgs.message).toContain(
      "Expanded autonomous research prompt with steps and deliverables.",
    );
  });
});
