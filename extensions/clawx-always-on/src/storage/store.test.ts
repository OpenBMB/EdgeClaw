import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AlwaysOnTask } from "../core/types.js";
import { openDatabase, TaskStore } from "./store.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "test-001",
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

describe("TaskStore", () => {
  let tmpDir: string;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-test-"));
    const db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a task", () => {
    const task = makeTask();
    store.createTask(task);

    const retrieved = store.getTask("test-001");
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test task");
    expect(retrieved!.status).toBe("pending");
  });

  it("updates task fields", () => {
    store.createTask(makeTask());
    store.updateTask("test-001", { status: "active", startedAt: 12345 });

    const task = store.getTask("test-001");
    expect(task!.status).toBe("active");
    expect(task!.startedAt).toBe(12345);
  });

  it("finds task by session key", () => {
    store.createTask(makeTask({ sessionKey: "always-on:test-001" }));

    const task = store.getTaskBySessionKey("always-on:test-001");
    expect(task).toBeDefined();
    expect(task!.id).toBe("test-001");
  });

  it("finds task by namespaced session key", () => {
    store.createTask(makeTask({ sessionKey: "always-on:test-001" }));

    const task = store.getTaskBySessionKey("agent:main:always-on:test-001");
    expect(task).toBeDefined();
    expect(task!.id).toBe("test-001");
  });

  it("returns undefined for missing session key", () => {
    const task = store.getTaskBySessionKey("nonexistent");
    expect(task).toBeUndefined();
  });

  it("gets active task", () => {
    store.createTask(makeTask({ status: "active" }));
    const active = store.getActiveTask();
    expect(active).toBeDefined();
    expect(active!.id).toBe("test-001");
  });

  it("prefers active tasks when resolving in-flight work", () => {
    store.createTask(makeTask({ id: "queued", status: "queued", createdAt: 100 }));
    store.createTask(makeTask({ id: "launching", status: "launching", createdAt: 50 }));
    store.createTask(makeTask({ id: "active", status: "active", createdAt: 10 }));

    const active = store.getInFlightTask();
    expect(active?.id).toBe("active");
  });

  it("lists queued tasks oldest first", () => {
    store.createTask(makeTask({ id: "t1", status: "queued", createdAt: 100 }));
    store.createTask(makeTask({ id: "t2", status: "queued", createdAt: 200 }));

    const queued = store.getQueuedTasks();
    expect(queued.map((task) => task.id)).toEqual(["t1", "t2"]);
  });

  it("claims queued tasks once", () => {
    store.createTask(makeTask({ status: "queued" }));

    expect(store.claimQueuedTask("test-001")).toBe(true);
    expect(store.claimQueuedTask("test-001")).toBe(false);
    expect(store.getTask("test-001")?.status).toBe("launching");
  });

  it("returns undefined when no active task", () => {
    store.createTask(makeTask({ status: "pending" }));
    expect(store.getActiveTask()).toBeUndefined();
  });

  it("gets resumable (suspended) tasks", () => {
    store.createTask(makeTask({ id: "t1", status: "suspended", suspendedAt: 100 }));
    store.createTask(makeTask({ id: "t2", status: "suspended", suspendedAt: 200 }));
    store.createTask(makeTask({ id: "t3", status: "completed" }));

    const resumable = store.getResumableTasks();
    expect(resumable).toHaveLength(2);
    expect(resumable[0].id).toBe("t2");
  });

  it("lists tasks with status filter", () => {
    store.createTask(makeTask({ id: "t1", status: "pending" }));
    store.createTask(makeTask({ id: "t2", status: "active" }));
    store.createTask(makeTask({ id: "t3", status: "pending" }));

    const pending = store.listTasks({ status: "pending" });
    expect(pending).toHaveLength(2);
  });

  it("lists all tasks ordered by creation time desc", () => {
    store.createTask(makeTask({ id: "t1", createdAt: 100 }));
    store.createTask(makeTask({ id: "t2", createdAt: 200 }));

    const all = store.listTasks();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("t2");
  });

  it("handles nullable fields correctly", () => {
    store.createTask(makeTask());
    const task = store.getTask("test-001");
    expect(task!.sourceMetadata).toBeUndefined();
    expect(task!.sessionKey).toBeUndefined();
    expect(task!.progressSummary).toBeUndefined();
    expect(task!.resultSummary).toBeUndefined();
    expect(task!.startedAt).toBeUndefined();
    expect(task!.suspendedAt).toBeUndefined();
    expect(task!.completedAt).toBeUndefined();
  });
});
