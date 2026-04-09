import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AlwaysOnConfig } from "./core/config.js";
import type { AlwaysOnTask } from "./core/types.js";
import { createAlwaysOnHttpHandler } from "./http.js";
import { TaskLogger } from "./storage/logger.js";
import { openDatabase, TaskStore } from "./storage/store.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Investigate regressions",
    status: "queued",
    sourceType: "user-command",
    budgetConstraints: JSON.stringify([
      { kind: "max-loops", limit: 50 },
      { kind: "max-cost-usd", limitUsd: 1.25 },
    ]),
    budgetUsage: '{"loopsUsed":0,"costUsedUsd":0}',
    createdAt: Date.now(),
    runCount: 0,
    ...overrides,
  };
}

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.25,
  maxConcurrentTasks: 3,
  logLevel: "info",
  logRetentionDays: 30,
};

describe("createAlwaysOnHttpHandler", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-http-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);

    const handler = createAlwaysOnHttpHandler({
      store,
      logger,
      config: defaultConfig,
    });

    server = createServer((req, res) => {
      void Promise.resolve(handler(req, res))
        .then((handled) => {
          if (!handled && !res.writableEnded) {
            res.statusCode = 404;
            res.end("Unhandled");
          }
        })
        .catch((error) => {
          res.statusCode = 500;
          res.end(String(error));
        });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves the dashboard shell", async () => {
    const response = await fetch(`${baseUrl}/plugins/clawx-always-on/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("ClawX Always-On");
    expect(html).toContain("Create a background task");
  });

  it("returns dashboard status and running task counts", async () => {
    store.createTask(makeTask({ id: "queued-task", status: "queued" }));
    store.createTask(makeTask({ id: "active-task", status: "active", title: "Active task" }));

    const response = await fetch(`${baseUrl}/plugins/clawx-always-on/api/status`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.totalTasks).toBe(2);
    expect(payload.countsByStatus.queued).toBe(1);
    expect(payload.countsByStatus.active).toBe(1);
    expect(payload.runningTasks[0].id).toBe("active-task");
  });

  it("creates tasks from the dashboard API", async () => {
    const response = await fetch(`${baseUrl}/plugins/clawx-always-on/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Review yesterday's integration failures",
        maxLoops: 80,
        maxCostUsd: 2.5,
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.task.title).toBe("Review yesterday's integration failures");
    expect(payload.task.status).toBe("queued");
    expect(payload.task.budgetConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "max-loops", limit: 80 }),
        expect.objectContaining({ kind: "max-cost-usd", limitUsd: 2.5 }),
      ]),
    );
    expect(store.listTasks()).toHaveLength(1);
  });

  it("returns task detail and recent logs", async () => {
    store.createTask(
      makeTask({
        id: "task-detail",
        status: "active",
        progressSummary: "Checked the failing test shards.",
        runCount: 1,
      }),
    );
    logger.info("task-detail", "Task picked up by worker");

    const detailResponse = await fetch(`${baseUrl}/plugins/clawx-always-on/api/tasks/task-detail`);
    const detailPayload = await detailResponse.json();
    const logsResponse = await fetch(
      `${baseUrl}/plugins/clawx-always-on/api/tasks/task-detail/logs`,
    );
    const logsPayload = await logsResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.task.progressSummary).toContain("failing test shards");
    expect(logsResponse.status).toBe(200);
    expect(logsPayload.logs[0].message).toContain("Task picked up by worker");
  });

  it("resumes suspended tasks", async () => {
    store.createTask(
      makeTask({
        id: "task-resume",
        status: "suspended",
        suspendedAt: Date.now(),
      }),
    );

    const response = await fetch(
      `${baseUrl}/plugins/clawx-always-on/api/tasks/task-resume/resume`,
      {
        method: "POST",
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.task.status).toBe("queued");
    expect(store.getTask("task-resume")?.status).toBe("queued");
  });

  it("cancels active tasks", async () => {
    store.createTask(
      makeTask({
        id: "task-cancel",
        status: "active",
      }),
    );

    const response = await fetch(
      `${baseUrl}/plugins/clawx-always-on/api/tasks/task-cancel/cancel`,
      {
        method: "POST",
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.task.status).toBe("cancelled");
    expect(store.getTask("task-cancel")?.status).toBe("cancelled");
  });

  it("rejects task creation without a title", async () => {
    const response = await fetch(`${baseUrl}/plugins/clawx-always-on/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Task title is required");
  });
});
