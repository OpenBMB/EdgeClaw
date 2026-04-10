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
    budgetExceededAction: "warn",
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
  defaultBudgetExceededAction: "warn",
  maxConcurrentTasks: 3,
  dreamEnabled: false,
  dreamIntervalMinutes: 60,
  dreamMaxCandidates: 3,
  dreamContextMessageLimit: 40,
  logLevel: "info",
  logRetentionDays: 30,
};

const defaultApiConfig = {
  agents: {
    defaults: {
      model: "openai-codex/gpt-5.4",
    },
  },
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

  it("does not pass a model override when the task matches the current agent default model", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-default-model" }),
    };
    const executor = new SubagentExecutor(
      mockSubagent,
      store,
      logger,
      { explicitToolsAvailable: true },
      defaultApiConfig,
    );

    const task = makeTask({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
    store.createTask(task);

    await executor.launch(task);

    const callArgs = mockSubagent.run.mock.calls[0][0];
    expect(callArgs.provider).toBeUndefined();
    expect(callArgs.model).toBeUndefined();
  });

  it("fails before launch when the task needs an unauthorized background model override", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-should-not-happen" }),
    };
    const executor = new SubagentExecutor(
      mockSubagent,
      store,
      logger,
      { explicitToolsAvailable: true },
      defaultApiConfig,
    );

    const task = makeTask({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    store.createTask(task);

    await expect(executor.launch(task)).rejects.toThrow(/background model override/);
    expect(mockSubagent.run).not.toHaveBeenCalled();
    expect(store.getTask("task-001")?.status).toBe("launching");
    expect(store.getLatestTaskRun(task.id)?.status).toBe("failed");
  });
});
