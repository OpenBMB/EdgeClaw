import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnConfig } from "../core/config.js";
import { parseUserCommandSourceMetadata } from "../source/user-command-source.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";
import { AlwaysOnWebPlanService } from "./web-service.js";

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  maxConcurrentTasks: 2,
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
    {
      id: "q2",
      text: "输出格式偏好？",
      options: ["A. 简明摘要", "B. 详细报告", "C. 自定义（请说明）"],
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

describe("AlwaysOnWebPlanService", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  let runEmbeddedPiAgent: ReturnType<typeof vi.fn>;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-web-plan-service-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
    runEmbeddedPiAgent = vi.fn();
    api = {
      config: {},
      runtime: {
        agent: {
          runEmbeddedPiAgent,
          resolveAgentWorkspaceDir: () => tmpDir,
          resolveAgentTimeoutMs: () => 30_000,
        },
      },
    } as never as OpenClawPluginApi;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts a web plan and returns structured questions", async () => {
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
    });
    const service = new AlwaysOnWebPlanService(api, store, logger, defaultConfig);

    const result = await service.startPlan("Build me a useful always-on competitor monitor");

    expect(result.plan.status).toBe("active");
    expect(result.plan.pendingQuestions).toEqual(MOCK_ASK_RESPONSE.questions);
    expect(result.plan.defaultPlan).toEqual(MOCK_ASK_RESPONSE.defaultPlan);
    expect(result.plan.turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Build me a useful always-on competitor monitor",
        }),
        expect.objectContaining({
          role: "assistant",
        }),
      ]),
    );
  });

  it("finalizes a web plan and creates a queued task", async () => {
    runEmbeddedPiAgent
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
      })
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(MOCK_CREATE_RESPONSE) }],
      });
    const service = new AlwaysOnWebPlanService(api, store, logger, defaultConfig);

    const start = await service.startPlan("Build me a useful always-on competitor monitor");
    const result = await service.answerPlan(start.plan.id, "A, A");

    expect(result.plan.status).toBe("completed");
    expect(result.task).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: "Competitor Monitor",
      }),
    );

    const task = store.listTasks()[0];
    expect(task.title).toBe("Competitor Monitor");
    expect(parseUserCommandSourceMetadata(task.sourceMetadata)).toEqual({
      mode: "plan",
      prompt:
        "Monitor competitor changelogs, blog posts, and launch announcements. Summarize notable changes every run.",
      planId: start.plan.id,
      originConversationKey: `always-on:web:${start.plan.id}`,
      originSessionKey: undefined,
    });
  });

  it("marks the web plan as failed when finalization fails", async () => {
    runEmbeddedPiAgent
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
      })
      .mockRejectedValueOnce(new Error("planner unavailable"));
    const service = new AlwaysOnWebPlanService(api, store, logger, defaultConfig);

    const start = await service.startPlan("Build me a useful always-on competitor monitor");
    const result = await service.answerPlan(start.plan.id, "A, A");

    expect(result.plan.status).toBe("failed");
    expect(result.plan.failureReason).toContain("planner unavailable");
    expect(result.task).toBeUndefined();
    expect(store.listTasks()).toHaveLength(0);
  });

  it("cancels active web plans", async () => {
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
    });
    const service = new AlwaysOnWebPlanService(api, store, logger, defaultConfig);

    const start = await service.startPlan("Build me a useful always-on competitor monitor");
    const cancelled = service.cancelPlan(start.plan.id);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.completedAt).toBeTypeOf("number");
  });
});
