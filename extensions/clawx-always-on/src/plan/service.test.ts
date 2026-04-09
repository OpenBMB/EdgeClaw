import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginCommandContext, OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnConfig } from "../core/config.js";
import { parseUserCommandSourceMetadata } from "../source/user-command-source.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";
import { AlwaysOnPlanService } from "./service.js";

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  defaultBudgetExceededAction: "warn",
  maxConcurrentTasks: 2,
  dreamEnabled: false,
  dreamIntervalMinutes: 60,
  dreamMaxCandidates: 3,
  dreamContextMessageLimit: 40,
  logLevel: "info",
  logRetentionDays: 30,
};

function makeCommandContext(overrides: Partial<PluginCommandContext> = {}): PluginCommandContext {
  return {
    senderId: "user-123",
    channel: "webchat",
    isAuthorizedSender: true,
    commandBody: "/always-on plan",
    config: {} as PluginCommandContext["config"],
    from: undefined,
    to: undefined,
    requestConversationBinding: async () => ({ status: "error", message: "unused" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
    ...overrides,
  };
}

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

describe("AlwaysOnPlanService", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  let runEmbeddedPiAgent: ReturnType<typeof vi.fn>;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-plan-service-"));
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

  it("presents multiple-choice questions on startPlan", async () => {
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
    });
    const service = new AlwaysOnPlanService(api, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });

    const result = await service.startPlan(
      makeCommandContext(),
      "Build me a useful always-on competitor monitor",
    );

    expect(result.text).toContain("我会帮你把这个想法打磨成一条更好的后台任务");
    expect(result.text).toContain("**1. 你希望关注哪类信息？**");
    expect(result.text).toContain("A. 行业新闻");
    expect(result.text).toContain("**2. 输出格式偏好？**");
    expect(result.text).toContain("直接回复选项字母");

    const plan = store.getActivePlanByConversationKey("webchat:default:user-123");
    expect(plan).toBeDefined();
    expect(plan!.roundCount).toBe(1);
  });

  it("passes configured provider and model to the embedded agent", async () => {
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
    });
    const configuredApi = {
      ...api,
      config: { agents: { defaults: { model: "openai-codex/gpt-5.4" } } },
    } as never as OpenClawPluginApi;
    const service = new AlwaysOnPlanService(configuredApi, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });
    await service.startPlan(makeCommandContext(), "test task");
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        model: "gpt-5.4",
      }),
    );
  });

  it("finalizes the task when user answers via before_dispatch", async () => {
    runEmbeddedPiAgent
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
      })
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(MOCK_CREATE_RESPONSE) }],
      });

    const service = new AlwaysOnPlanService(api, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });

    await service.startPlan(makeCommandContext(), "Build me a useful always-on competitor monitor");
    const activePlan = store.getActivePlanByConversationKey("webchat:default:user-123");
    expect(activePlan).toBeDefined();

    const followUp = await service.handleBeforeDispatch(
      { content: "A, A" },
      {
        channelId: "webchat",
        accountId: "default",
        conversationId: undefined,
        senderId: "user-123",
        sessionKey: "agent:main:webchat:dm:user-123",
      },
    );

    expect(followUp).toEqual(expect.objectContaining({ handled: true }));
    expect(followUp?.text).toContain("created from the planning flow");
    expect(followUp?.text).toContain("Competitor Monitor");

    const completedPlan = store.getPlan(activePlan!.id);
    expect(completedPlan?.status).toBe("completed");
    expect(completedPlan?.createdTaskId).toBeDefined();

    const task = store.listTasks()[0];
    expect(task.title).toBe("Competitor Monitor");
    expect(parseUserCommandSourceMetadata(task.sourceMetadata)).toEqual({
      mode: "plan",
      prompt:
        "Monitor competitor changelogs, blog posts, and launch announcements. Summarize notable changes every run.",
      planId: expect.any(String),
      originConversationKey: "webchat:default:user-123",
      originSessionKey: "agent:main:webchat:dm:user-123",
    });
  });

  it("finds active plan via senderId when conversationId is undefined", async () => {
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: JSON.stringify(MOCK_ASK_RESPONSE) }],
    });
    const service = new AlwaysOnPlanService(api, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });

    await service.startPlan(makeCommandContext(), "test task");

    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: JSON.stringify(MOCK_CREATE_RESPONSE) }],
    });

    const result = await service.handleBeforeDispatch(
      { content: "B" },
      {
        channelId: "webchat",
        accountId: undefined,
        conversationId: undefined,
        senderId: "user-123",
        sessionKey: undefined,
      },
    );

    expect(result).toEqual(expect.objectContaining({ handled: true }));
    expect(result?.text).toContain("created from the planning flow");
  });

  it("does not intercept messages when no plan is active", async () => {
    const service = new AlwaysOnPlanService(api, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });

    const result = await service.handleBeforeDispatch(
      { content: "hello" },
      {
        channelId: "webchat",
        conversationId: undefined,
        senderId: "user-123",
      },
    );

    expect(result).toBeUndefined();
  });
});
