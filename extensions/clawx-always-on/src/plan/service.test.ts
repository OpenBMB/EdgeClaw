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
  maxConcurrentTasks: 2,
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
    from: "webchat:user-123",
    to: "webchat:user-123",
    requestConversationBinding: async () => ({ status: "error", message: "unused" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
    ...overrides,
  };
}

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

  it("asks a follow-up question before creating a task", async () => {
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [
        {
          text: JSON.stringify({
            action: "ask",
            assistantReply: "What sources should this background task monitor?",
          }),
        },
      ],
    });
    const service = new AlwaysOnPlanService(api, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });

    const result = await service.startPlan(
      makeCommandContext(),
      "Build me a useful always-on competitor monitor",
    );

    expect(result.text).toContain("I’ll refine this into a better always-on task");
    expect(result.text).toContain("What sources should this background task monitor?");

    const plan = store.getActivePlanByConversationKey("webchat:default:user-123");
    expect(plan?.roundCount).toBe(1);
    expect(JSON.parse(plan!.turnsJson)).toHaveLength(2);
  });

  it("continues the planning flow and creates a planned task", async () => {
    runEmbeddedPiAgent
      .mockResolvedValueOnce({
        payloads: [
          {
            text: JSON.stringify({
              action: "ask",
              assistantReply: "What sources should this background task monitor?",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        payloads: [
          {
            text: JSON.stringify({
              action: "create",
              taskTitle: "Competitor Monitor",
              taskPrompt:
                "Monitor competitor changelogs, blog posts, and launch announcements. Summarize notable changes every run.",
              assumptions: ["Use public web sources only."],
            }),
          },
        ],
      });
    const service = new AlwaysOnPlanService(api, store, logger, defaultConfig, {
      explicitToolsAvailable: true,
    });

    await service.startPlan(makeCommandContext(), "Build me a useful always-on competitor monitor");
    const activePlan = store.getActivePlanByConversationKey("webchat:default:user-123");
    expect(activePlan).toBeDefined();

    const followUp = await service.handleBeforeDispatch(
      {
        content: "Use public changelogs, product blogs, and launch announcements.",
      },
      {
        channelId: "webchat",
        accountId: "default",
        conversationId: "user-123",
        sessionKey: "agent:main:webchat:dm:user-123",
      },
    );

    expect(followUp).toEqual(
      expect.objectContaining({
        handled: true,
      }),
    );
    expect(followUp?.text).toContain("created from the planning flow");
    expect(followUp?.text).toContain("Competitor Monitor");
    expect(followUp?.text).toContain("Use public web sources only.");

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
});
