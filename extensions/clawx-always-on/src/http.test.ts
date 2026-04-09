import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import type { AlwaysOnConfig } from "./core/config.js";
import type { AlwaysOnTask } from "./core/types.js";
import { createAlwaysOnHttpHandler } from "./http.js";
import { AlwaysOnWebPlanService } from "./plan/web-service.js";
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

const MOCK_ASK_RESPONSE = {
  action: "ask",
  questions: [
    {
      id: "q1",
      text: "你希望关注哪类信息？",
      options: ["A. 行业新闻", "B. 竞品动态", "C. 自定义（请说明）"],
    },
  ],
  defaultPlan: {
    taskTitle: "Competitor Monitor (default)",
    taskPrompt: "Monitor competitors with default settings.",
    assumptions: ["Uses public sources only."],
  },
};

const MOCK_CREATE_RESPONSE = {
  action: "create",
  taskTitle: "Competitor Monitor",
  taskPrompt:
    "Monitor competitor changelogs, blog posts, and launch announcements. Summarize notable changes every run.",
  assumptions: ["Use public web sources only."],
};

describe("createAlwaysOnHttpHandler", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  let runEmbeddedPiAgent: ReturnType<typeof vi.fn>;
  let planService: AlwaysOnWebPlanService;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-http-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
    runEmbeddedPiAgent = vi.fn();
    const api = {
      config: {},
      runtime: {
        agent: {
          runEmbeddedPiAgent,
          resolveAgentWorkspaceDir: () => tmpDir,
          resolveAgentTimeoutMs: () => 30_000,
        },
      },
    } as never as OpenClawPluginApi;
    planService = new AlwaysOnWebPlanService(api, store, logger, defaultConfig);

    const handler = createAlwaysOnHttpHandler({
      store,
      logger,
      config: defaultConfig,
      planService,
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

  describe("plan api", () => {
    it("starts and reads a web planner session", async () => {
      runEmbeddedPiAgent.mockResolvedValue({
        payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
      });

      const startResponse = await fetch(`${baseUrl}/plugins/clawx-always-on/api/plan/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "Build me a useful always-on competitor monitor",
        }),
      });
      const startPayload = await startResponse.json();

      expect(startResponse.status).toBe(201);
      expect(startPayload.plan.status).toBe("active");
      expect(startPayload.plan.pendingQuestions[0].id).toBe("q1");

      const detailResponse = await fetch(
        `${baseUrl}/plugins/clawx-always-on/api/plan/${startPayload.plan.id}`,
      );
      const detailPayload = await detailResponse.json();

      expect(detailResponse.status).toBe(200);
      expect(detailPayload.plan.id).toBe(startPayload.plan.id);
      expect(detailPayload.plan.defaultPlan.taskTitle).toBe("Competitor Monitor (default)");
    });

    it("answers a web planner session and creates a task", async () => {
      runEmbeddedPiAgent
        .mockResolvedValueOnce({
          payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
        })
        .mockResolvedValueOnce({
          payloads: [{ text: JSON.stringify(MOCK_CREATE_RESPONSE) }],
        });

      const startResponse = await fetch(`${baseUrl}/plugins/clawx-always-on/api/plan/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "Build me a useful always-on competitor monitor",
        }),
      });
      const startPayload = await startResponse.json();

      const answerResponse = await fetch(
        `${baseUrl}/plugins/clawx-always-on/api/plan/${startPayload.plan.id}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "A" }),
        },
      );
      const answerPayload = await answerResponse.json();

      expect(answerResponse.status).toBe(200);
      expect(answerPayload.plan.status).toBe("completed");
      expect(answerPayload.task.title).toBe("Competitor Monitor");
      expect(answerPayload.plan.createdTaskId).toBe(answerPayload.task.id);
      expect(store.getTask(answerPayload.task.id)?.status).toBe("queued");
    });

    it("cancels a web planner session", async () => {
      runEmbeddedPiAgent.mockResolvedValue({
        payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
      });

      const startResponse = await fetch(`${baseUrl}/plugins/clawx-always-on/api/plan/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "Build me a useful always-on competitor monitor",
        }),
      });
      const startPayload = await startResponse.json();

      const cancelResponse = await fetch(
        `${baseUrl}/plugins/clawx-always-on/api/plan/${startPayload.plan.id}/cancel`,
        {
          method: "POST",
        },
      );
      const cancelPayload = await cancelResponse.json();

      expect(cancelResponse.status).toBe(200);
      expect(cancelPayload.plan.status).toBe("cancelled");
    });
  });

  describe("v2 dashboard", () => {
    it("redirects /v2 to /v2/", async () => {
      const response = await fetch(`${baseUrl}/plugins/clawx-always-on/v2`, {
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/plugins/clawx-always-on/v2/");
    });

    it("serves the v2 dashboard shell", async () => {
      const response = await fetch(`${baseUrl}/plugins/clawx-always-on/v2/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("ClawX Always-On");
      expect(html).toContain("Launch a background task");
    });

    it("serves v2 static assets", async () => {
      const jsResponse = await fetch(`${baseUrl}/plugins/clawx-always-on/v2/app.js`);
      expect(jsResponse.status).toBe(200);
      expect(jsResponse.headers.get("content-type")).toContain("text/javascript");

      const cssResponse = await fetch(`${baseUrl}/plugins/clawx-always-on/v2/styles.css`);
      expect(cssResponse.status).toBe(200);
      expect(cssResponse.headers.get("content-type")).toContain("text/css");
    });

    it("returns 404 for unknown v2 paths", async () => {
      const response = await fetch(`${baseUrl}/plugins/clawx-always-on/v2/unknown.js`);
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload.error).toBe("Not found");
    });
  });
});
