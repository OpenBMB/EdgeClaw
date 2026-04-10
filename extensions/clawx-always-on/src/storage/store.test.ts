import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AlwaysOnTask } from "../core/types.js";
import type { AlwaysOnPlan } from "../plan/types.js";
import { openDatabase, TaskStore } from "./store.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "test-001",
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

function makePlan(overrides: Partial<AlwaysOnPlan> = {}): AlwaysOnPlan {
  return {
    id: "plan-001",
    conversationKey: "webchat:default:user-123",
    status: "active",
    initialPrompt: "Plan a better task",
    turnsJson: "[]",
    roundCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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

  it("merges budget usage updates across multiple writes", () => {
    store.createTask(makeTask());

    store.updateBudgetUsage("test-001", (usage) => {
      usage.loopsUsed += 1;
    });
    store.updateBudgetUsage("test-001", (usage) => {
      usage.costUsedUsd += 0.25;
    });

    const usage = JSON.parse(store.getTask("test-001")!.budgetUsage);
    expect(usage.loopsUsed).toBe(1);
    expect(usage.costUsedUsd).toBe(0.25);
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

  it("counts running tasks from active and launching statuses", () => {
    store.createTask(makeTask({ id: "queued", status: "queued" }));
    store.createTask(makeTask({ id: "launching", status: "launching" }));
    store.createTask(makeTask({ id: "active", status: "active" }));

    expect(store.countRunningTasks()).toBe(2);
  });

  it("lists running tasks with active tasks first", () => {
    store.createTask(makeTask({ id: "launching", status: "launching", createdAt: 200 }));
    store.createTask(makeTask({ id: "active", status: "active", createdAt: 100 }));

    expect(store.listRunningTasks().map((task) => task.id)).toEqual(["active", "launching"]);
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

  it("gets resumable suspended and failed tasks", () => {
    store.createTask(makeTask({ id: "t1", status: "suspended", suspendedAt: 100 }));
    store.createTask(makeTask({ id: "t2", status: "suspended", suspendedAt: 200 }));
    store.createTask(makeTask({ id: "t3", status: "failed", createdAt: 300 }));
    store.createTask(makeTask({ id: "t4", status: "completed" }));

    const resumable = store.getResumableTasks();
    expect(resumable).toHaveLength(3);
    expect(resumable[0].id).toBe("t3");
    expect(resumable[1].id).toBe("t2");
  });

  it("lists tasks with status filter", () => {
    store.createTask(makeTask({ id: "t1", status: "pending" }));
    store.createTask(makeTask({ id: "t2", status: "active" }));
    store.createTask(makeTask({ id: "t3", status: "pending" }));

    const pending = store.listTasks({ status: "pending" });
    expect(pending).toHaveLength(2);
  });

  it("starts pending tasks explicitly", () => {
    store.createTask(makeTask({ id: "t1", status: "pending" }));
    expect(store.startPendingTask("t1")).toBe(true);
    expect(store.getTask("t1")?.status).toBe("queued");
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

  it("stores task runs and checkpoints", () => {
    store.createTask(makeTask({ id: "t1", status: "active", runCount: 1 }));
    const runId = store.createTaskRun({
      taskId: "t1",
      runOrdinal: 1,
      sessionKey: "always-on:t1",
      status: "active",
      startedAt: 100,
      createdAt: 100,
    });
    store.updateTaskRun("t1", 1, {
      runId: "run-1",
      budgetUsageSnapshot: '{"loopsUsed":2,"costUsedUsd":0.01}',
      endedAt: 200,
      status: "completed",
    });
    store.appendTaskCheckpoint({
      taskId: "t1",
      runOrdinal: 1,
      kind: "completion",
      content: "Finished successfully",
      createdAt: 200,
    });

    expect(runId).toBeGreaterThan(0);
    expect(store.getLatestTaskRun("t1")?.runId).toBe("run-1");
    expect(store.listTaskCheckpoints("t1")[0]?.content).toBe("Finished successfully");
  });

  it("stores dream runs", () => {
    store.createDreamRun({
      id: "dream-1",
      status: "running",
      trigger: "manual",
      sourceSessionKey: "agent:main:webchat:user-123",
      createdTaskIdsJson: "[]",
      createdAt: 100,
    });
    store.updateDreamRun("dream-1", {
      status: "completed",
      summary: "Created one useful candidate.",
      createdTaskIdsJson: '["task-1"]',
      completedAt: 120,
    });

    const run = store.getDreamRun("dream-1");
    expect(run?.status).toBe("completed");
    expect(run?.createdTaskIdsJson).toBe('["task-1"]');
  });

  it("creates and retrieves active plans by conversation key", () => {
    store.createPlan(makePlan());

    const plan = store.getActivePlanByConversationKey("webchat:default:user-123");
    expect(plan).toBeDefined();
    expect(plan!.id).toBe("plan-001");
  });

  it("retrieves active plans by bound session key", () => {
    store.createPlan(makePlan({ originSessionKey: "agent:main:webchat:dm:user-123" }));

    const plan = store.getActivePlanBySessionKey("agent:main:webchat:dm:user-123");
    expect(plan?.id).toBe("plan-001");
  });

  it("appends turns and updates timestamps for plans", () => {
    store.createPlan(makePlan());

    const updated = store.appendPlanTurn("plan-001", {
      role: "assistant",
      content: "Need one more detail",
      timestamp: 456,
    });

    expect(updated).toBeDefined();
    expect(updated!.updatedAt).toBe(456);
    expect(JSON.parse(updated!.turnsJson)).toEqual([
      {
        role: "assistant",
        content: "Need one more detail",
        timestamp: 456,
      },
    ]);
  });
});
