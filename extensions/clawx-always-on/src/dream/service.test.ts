import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginCommandContext, OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnConfig } from "../core/config.js";
import type { AlwaysOnTask } from "../core/types.js";
import { parseUserCommandSourceMetadata } from "../source/user-command-source.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";
import { AlwaysOnDreamService } from "./service.js";

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  defaultBudgetExceededAction: "warn",
  maxConcurrentTasks: 2,
  dreamEnabled: true,
  dreamIntervalMinutes: 60,
  dreamMaxCandidates: 3,
  dreamContextMessageLimit: 40,
  logLevel: "info",
  logRetentionDays: 30,
};

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Existing task",
    status: "completed",
    sourceType: "user-command",
    budgetExceededAction: "warn",
    budgetConstraints: "[]",
    budgetUsage: '{"loopsUsed":0,"costUsedUsd":0}',
    createdAt: Date.now(),
    runCount: 1,
    ...overrides,
  };
}

function makeCommandContext(config: PluginCommandContext["config"]): PluginCommandContext {
  return {
    senderId: "user-123",
    channel: "webchat",
    isAuthorizedSender: true,
    commandBody: "/always-on dream",
    config,
    from: "webchat:user-123",
    to: "webchat:user-123",
    requestConversationBinding: async () => ({ status: "error", message: "unused" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  };
}

describe("AlwaysOnDreamService", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  let api: OpenClawPluginApi;
  let runEmbeddedPiAgent: ReturnType<typeof vi.fn>;
  let getSessionMessages: ReturnType<typeof vi.fn>;
  let enqueueSystemEvent: ReturnType<typeof vi.fn>;
  let runHeartbeatOnce: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "always-on-dream-service-"));
    mkdirSync(join(tmpDir, "memory"), { recursive: true });
    writeFileSync(join(tmpDir, "MEMORY.md"), "Remember to watch release notes.");
    writeFileSync(join(tmpDir, "memory", "2026-04-09.md"), "User asked about npm releases.");

    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);

    runEmbeddedPiAgent = vi.fn();
    getSessionMessages = vi.fn().mockResolvedValue([
      {
        role: "user",
        content: [{ type: "text", text: "Please keep an eye on OpenClaw release changes." }],
      },
    ]);
    enqueueSystemEvent = vi.fn();
    runHeartbeatOnce = vi.fn().mockResolvedValue({});

    api = {
      config: {
        agents: {
          defaults: {
            workspace: tmpDir,
          },
        },
      },
      runtime: {
        agent: {
          runEmbeddedPiAgent,
          resolveAgentWorkspaceDir: vi.fn(() => tmpDir),
        },
        subagent: {
          getSessionMessages,
        },
        channel: {
          routing: {
            resolveAgentRoute: vi.fn().mockReturnValue({
              agentId: "main",
              sessionKey: "agent:main:webchat:dm:user-123",
            }),
          },
        },
        system: {
          enqueueSystemEvent,
          runHeartbeatOnce,
        },
      },
    } as never as OpenClawPluginApi;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates pending dream tasks from a command", async () => {
    store.createTask(
      makeTask({
        id: "parent-task",
        resultSummary: "Release notes often mention new plugins and migrations.",
      }),
    );
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [
        {
          text: JSON.stringify({
            summary: "A release-monitoring candidate looks useful right now.",
            candidates: [
              {
                taskTitle: "Track OpenClaw releases",
                taskPrompt: "Monitor OpenClaw release notes and summarize noteworthy changes.",
                rationale: "The user explicitly asked for release monitoring.",
                parentTaskIds: ["parent-task"],
              },
            ],
          }),
        },
      ],
    });

    const service = new AlwaysOnDreamService(api, store, logger, defaultConfig);
    const result = await service.runFromCommand(makeCommandContext(api.config));

    expect(result.text).toContain("Track OpenClaw releases");
    expect(result.text).toContain("/always-on start");

    const dreamTasks = store.listTasks({ sourceType: "dream" });
    expect(dreamTasks).toHaveLength(1);
    expect(dreamTasks[0]?.status).toBe("pending");
    expect(dreamTasks[0]?.deliverySessionKey).toBe("agent:main:webchat:dm:user-123");
    expect(parseUserCommandSourceMetadata(dreamTasks[0]?.sourceMetadata)?.dreamRunId).toBeDefined();
    expect(store.listDreamRuns()).toHaveLength(1);
    expect(store.listDreamRuns()[0]?.status).toBe("completed");
  });

  it("returns a plugin-scoped failure reply when manual dream planning fails", async () => {
    runEmbeddedPiAgent.mockRejectedValue(new Error("planner timeout"));

    const service = new AlwaysOnDreamService(api, store, logger, defaultConfig);
    const result = await service.runFromCommand(makeCommandContext(api.config));

    expect(result.text).toContain("Always-On dream could not generate task candidates");
    expect(result.text).not.toContain("Command failed");
    expect(store.listDreamRuns()).toHaveLength(1);
    expect(store.listDreamRuns()[0]?.status).toBe("failed");
    expect(store.listDreamRuns()[0]?.failureReason).toContain("planner timeout");
  });

  it("announces scheduled dream candidates back to the latest known session", async () => {
    store.createTask(
      makeTask({
        id: "seed-task",
        deliverySessionKey: "agent:main:webchat:dm:user-123",
      }),
    );
    runEmbeddedPiAgent.mockResolvedValue({
      payloads: [
        {
          text: JSON.stringify({
            summary: "A follow-up monitoring candidate is worth surfacing.",
            candidates: [
              {
                taskTitle: "Follow release candidates",
                taskPrompt: "Watch prerelease announcements and summarize noteworthy changes.",
                rationale: "The seed task already tracks releases.",
                parentTaskIds: ["seed-task"],
              },
            ],
          }),
        },
      ],
    });

    const service = new AlwaysOnDreamService(api, store, logger, defaultConfig);
    await service.runScheduled();

    expect(enqueueSystemEvent).toHaveBeenCalledWith(
      expect.stringContaining("Follow release candidates"),
      expect.objectContaining({ sessionKey: "agent:main:webchat:dm:user-123", trusted: true }),
    );
    expect(runHeartbeatOnce).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "agent:main:webchat:dm:user-123" }),
    );
  });
});
