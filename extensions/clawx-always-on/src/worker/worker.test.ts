import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlwaysOnConfig } from "../core/config.js";
import type { AlwaysOnTask } from "../core/types.js";
import { SubagentExecutor } from "../executor/executor.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";
import { AlwaysOnWorker } from "./worker.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Test task",
    status: "queued",
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
  defaultMaxCostUsd: 1,
  maxConcurrentTasks: 3,
  logLevel: "debug",
  logRetentionDays: 30,
};

describe("AlwaysOnWorker", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-worker-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("launches queued tasks through the executor", async () => {
    const mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: "run-123" }),
    };
    const executor = new SubagentExecutor(mockSubagent, store, logger);
    const worker = new AlwaysOnWorker(store, logger, executor, undefined, 5);

    store.createTask(makeTask());
    worker.start();

    await vi.waitFor(() => {
      expect(mockSubagent.run).toHaveBeenCalledTimes(1);
      expect(store.getTask("task-001")?.status).toBe("active");
    });

    expect(mockSubagent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "always-on:task-001",
        idempotencyKey: "always-on:task-001:run:1",
      }),
    );

    worker.stop();
  });

  it("marks queued tasks as failed when launch throws", async () => {
    const executor = {
      launch: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as SubagentExecutor;
    const worker = new AlwaysOnWorker(store, logger, executor, undefined, 5);

    store.createTask(makeTask());
    worker.start();

    await vi.waitFor(() => {
      expect(executor.launch).toHaveBeenCalledTimes(1);
      expect(store.getTask("task-001")?.status).toBe("failed");
    });

    const logs = logger.getLogs("task-001");
    expect(logs.some((entry) => entry.message.includes("Failed to launch: Error: boom"))).toBe(
      true,
    );

    worker.stop();
  });

  it("launches queued tasks only up to maxConcurrentTasks", async () => {
    const executor = {
      launch: vi.fn().mockResolvedValue("run-1"),
    } as unknown as SubagentExecutor;
    const worker = new AlwaysOnWorker(store, logger, executor, undefined, 5, 2);

    store.createTask(makeTask({ id: "task-001", createdAt: 100 }));
    store.createTask(makeTask({ id: "task-002", createdAt: 200 }));
    store.createTask(makeTask({ id: "task-003", createdAt: 300 }));
    worker.start();

    await vi.waitFor(() => {
      expect(executor.launch).toHaveBeenCalledTimes(2);
    });

    expect(store.getTask("task-001")?.status).toBe("launching");
    expect(store.getTask("task-002")?.status).toBe("launching");
    expect(store.getTask("task-003")?.status).toBe("queued");
    expect(store.countRunningTasks()).toBe(2);

    worker.stop();
  });

  it("applies updated maxConcurrentTasks while running", async () => {
    const executor = {
      launch: vi.fn().mockResolvedValue("run-1"),
    } as unknown as SubagentExecutor;
    const worker = new AlwaysOnWorker(store, logger, executor, undefined, 5, 1);

    store.createTask(makeTask({ id: "task-001", createdAt: 100 }));
    store.createTask(makeTask({ id: "task-002", createdAt: 200 }));
    worker.start();

    await vi.waitFor(() => {
      expect(executor.launch).toHaveBeenCalledTimes(1);
    });
    expect(store.getTask("task-002")?.status).toBe("queued");

    worker.updateMaxConcurrentTasks(2);

    await vi.waitFor(() => {
      expect(executor.launch).toHaveBeenCalledTimes(2);
    });
    expect(store.getTask("task-002")?.status).toBe("launching");

    worker.stop();
  });

  it("re-queues tasks left in launching state on start before retrying launch", async () => {
    const executor = {
      launch: vi.fn().mockResolvedValue("run-1"),
    } as unknown as SubagentExecutor;
    const worker = new AlwaysOnWorker(store, logger, executor, undefined, 5);

    store.createTask(makeTask({ status: "launching" }));
    worker.start();

    await vi.waitFor(() => {
      expect(executor.launch).toHaveBeenCalledTimes(1);
      expect(store.getTask("task-001")?.status).toBe("launching");
    });

    const logs = logger.getLogs("task-001");
    expect(
      logs.some((entry) => entry.message.includes("Recovered task stuck in launching state")),
    ).toBe(true);

    worker.stop();
  });
});
