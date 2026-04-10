import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AlwaysOnConfig } from "../core/config.js";
import type { AlwaysOnTask } from "../core/types.js";
import { TaskLogger } from "../storage/logger.js";
import { openDatabase, TaskStore } from "../storage/store.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Test task",
    status: "pending",
    sourceType: "user-command",
    budgetExceededAction: "warn",
    budgetConstraints: JSON.stringify([{ kind: "max-loops", limit: 50 }]),
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
  maxConcurrentTasks: 2,
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

describe("commands", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  type CommandResult = { text?: string; continueWithBody?: string };
  let commandHandler: (ctx: {
    args?: string;
    channel?: string;
    from?: string;
    to?: string;
    accountId?: string;
    messageThreadId?: string | number;
    config?: unknown;
  }) => Promise<CommandResult> | CommandResult;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "commands-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);

    const mockApi = {
      config: defaultApiConfig,
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("continues bare /always-on with a bootstrap prompt", async () => {
    const result = await commandHandler({ args: "" });
    expect(result).toMatchObject({
      continueWithBody: expect.stringContaining("Always-On background tasks can keep working"),
    });
  });

  it("shows help for unknown subcommands", async () => {
    const result = await commandHandler({ args: "wat" });
    expect(result).toMatchObject({
      text: expect.stringContaining("/always-on"),
    });
    expect(result).toMatchObject({
      text: expect.stringContaining("create"),
    });
  });

  it("creates a task", async () => {
    const result = await commandHandler({ args: "create Research AI trends" });
    expect(result.text).toContain("created and queued");
    expect(result.text).toContain("Research AI trends");

    const tasks = store.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Research AI trends");
    expect(tasks[0].status).toBe("queued");
  });

  it("creates a task with explicit model and budget options", async () => {
    const result = await commandHandler({
      args: "create Research AI trends --model openai-codex/gpt-5.4 --max-loops 20 --max-cost-usd 2.5 --budget-exceeded-action terminate",
    });

    expect(result.text).toContain("20 loops");
    expect(result.text).toContain("$2.5 max cost");
    expect(result.text).toContain("provider=openai-codex");
    expect(result.text).toContain("model=gpt-5.4");
    expect(result.text).toContain("budgetAction=terminate");

    const task = store.listTasks()[0];
    expect(task?.provider).toBe("openai-codex");
    expect(task?.model).toBe("gpt-5.4");
    expect(task?.budgetExceededAction).toBe("terminate");
    expect(task?.budgetConstraints).toContain('"kind":"max-loops"');
    expect(task?.budgetConstraints).toContain('"limit":20');
    expect(task?.budgetConstraints).toContain('"kind":"max-cost-usd"');
    expect(task?.budgetConstraints).toContain('"limitUsd":2.5');
  });

  it("shows a usage error for invalid create options", async () => {
    const result = await commandHandler({
      args: "create Research AI trends --model invalid-model-ref",
    });

    expect(result.text).toContain("must be in `provider/model_name` format");
    expect(result.text).toContain("Usage:");
  });

  it("rejects create when the requested model differs from the agent default and the plugin is not trusted for background overrides", async () => {
    const result = await commandHandler({
      args: "create Research AI trends --model anthropic/claude-sonnet-4-6",
    });

    expect(result.text).toContain("background model override");
    expect(result.text).toContain("subagent.allowModelOverride");
    expect(store.listTasks()).toHaveLength(0);
  });

  it("delegates planning requests to the plan handler", async () => {
    const startPlan = vi.fn().mockResolvedValue({ text: "planning started" });
    const cancelPlan = vi.fn().mockReturnValue({ text: "planning cancelled" });
    const mockApi = {
      config: defaultApiConfig,
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, undefined, {
      startPlan,
      cancelPlan,
    });

    const result = await commandHandler({
      args: "plan Research an always-on market scan",
      channel: "webchat",
      from: "webchat:user-123",
      to: "webchat:user-123",
    });

    expect(result.text).toBe("planning started");
    expect(startPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webchat",
        from: "webchat:user-123",
      }),
      {
        prompt: "Research an always-on market scan",
        options: {},
      },
    );
    expect(cancelPlan).not.toHaveBeenCalled();
  });

  it("parses model and budget options before delegating planning requests", async () => {
    const startPlan = vi.fn().mockResolvedValue({ text: "planning started" });
    const cancelPlan = vi.fn().mockReturnValue({ text: "planning cancelled" });
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, undefined, {
      startPlan,
      cancelPlan,
    });

    await commandHandler({
      args: "plan Research an always-on market scan --model openai-codex/gpt-5.4 --max-loops 25 --max-cost-usd 3 --budget-exceeded-action terminate",
      channel: "webchat",
      from: "webchat:user-123",
      to: "webchat:user-123",
    });

    expect(startPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webchat",
        from: "webchat:user-123",
      }),
      {
        prompt: "Research an always-on market scan",
        options: {
          modelRef: "openai-codex/gpt-5.4",
          maxLoops: 25,
          maxCostUsd: 3,
          budgetExceededAction: "terminate",
        },
      },
    );
    expect(cancelPlan).not.toHaveBeenCalled();
  });

  it("delegates plan cancellation to the plan handler", async () => {
    const startPlan = vi.fn().mockResolvedValue({ text: "planning started" });
    const cancelPlan = vi.fn().mockReturnValue({ text: "planning cancelled" });
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, undefined, {
      startPlan,
      cancelPlan,
    });

    const result = await commandHandler({
      args: "plan cancel",
      channel: "webchat",
      from: "webchat:user-123",
      to: "webchat:user-123",
    });

    expect(result.text).toBe("planning cancelled");
    expect(cancelPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webchat",
        from: "webchat:user-123",
      }),
    );
    expect(startPlan).not.toHaveBeenCalled();
  });

  it("adds degraded-mode note when explicit tools are unavailable", async () => {
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, {
      explicitToolsAvailable: false,
      profile: "coding",
    });

    const result = await commandHandler({ args: "create Research AI trends" });
    expect(result.text).toContain("reply-based completion fallback");
    expect(result.text).toContain('tools.alsoAllow: ["clawx-always-on"]');
  });

  it.each(["queued", "launching", "active"] as const)(
    "still queues create when another task is %s",
    async (status) => {
      store.createTask(makeTask({ id: "existing", status, title: "Existing" }));

      const result = await commandHandler({ args: "create New task" });
      expect(result.text).toContain("created and queued");
      expect(result.text).not.toContain("already in progress");
      expect(store.listTasks()).toHaveLength(2);
    },
  );

  it("lists tasks", async () => {
    store.createTask(makeTask({ id: "t1", title: "Task 1" }));
    store.createTask(makeTask({ id: "t2", title: "Task 2", status: "completed" }));

    const result = await commandHandler({ args: "list" });
    expect(result.text).toContain("Task 1");
    expect(result.text).toContain("Task 2");
  });

  it("shows task details", async () => {
    store.createTask(makeTask({ id: "t1", title: "Research task" }));

    const result = await commandHandler({ args: "show t1" });
    expect(result.text).toContain("Research task");
    expect(result.text).toContain("pending");
  });

  it("cancels a task", async () => {
    store.createTask(makeTask({ id: "t1" }));

    const result = await commandHandler({ args: "cancel t1" });
    expect(result.text).toContain("cancelled");

    const task = store.getTask("t1");
    expect(task!.status).toBe("cancelled");
  });

  it("resumes a suspended task", async () => {
    store.createTask(makeTask({ id: "t1", status: "suspended" }));

    const result = await commandHandler({ args: "resume t1" });
    expect(result.text).toContain("queued to resume");

    const task = store.getTask("t1");
    expect(task!.status).toBe("queued");
    expect(task!.suspendedAt).toBeUndefined();
  });

  it("resumes a failed task", async () => {
    store.createTask(makeTask({ id: "t1", status: "failed" }));

    const result = await commandHandler({ args: "resume t1" });
    expect(result.text).toContain("queued to resume");

    const task = store.getTask("t1");
    expect(task!.status).toBe("queued");
  });

  it("starts a pending task", async () => {
    store.createTask(makeTask({ id: "t1", status: "pending" }));

    const result = await commandHandler({ args: "start t1" });
    expect(result.text).toContain("moved from **pending** to **queued**");
    expect(store.getTask("t1")?.status).toBe("queued");
  });

  it("queues resume even when another task is already running", async () => {
    store.createTask(makeTask({ id: "active-task", status: "active", title: "Existing active" }));
    store.createTask(makeTask({ id: "t1", status: "suspended" }));

    const result = await commandHandler({ args: "resume t1" });
    expect(result.text).toContain("queued to resume");
    expect(result.text).not.toContain("already in progress");
    expect(store.getTask("t1")?.status).toBe("queued");
  });

  it("includes degraded-mode note when resuming without explicit tools", async () => {
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, {
      explicitToolsAvailable: false,
      profile: "coding",
    });

    store.createTask(makeTask({ id: "t1", status: "suspended" }));
    const result = await commandHandler({ args: "resume t1" });
    expect(result.text).toContain("reply-based completion fallback");
  });

  it("reads the latest config from a provider", async () => {
    let currentConfig = { ...defaultConfig };
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, () => currentConfig);

    currentConfig = {
      ...currentConfig,
      defaultMaxLoops: 88,
      defaultMaxCostUsd: 2.5,
      maxConcurrentTasks: 5,
    };

    const createResult = await commandHandler({ args: "create Dynamic config task" });
    const statusResult = await commandHandler({ args: "status" });

    expect(createResult.text).toContain("88 loops");
    expect(createResult.text).toContain("$2.5 max cost");
    expect(statusResult.text).toContain("Concurrent run limit");
    expect(statusResult.text).toContain("5");
  });

  it("rejects resume of non-suspended task", async () => {
    store.createTask(makeTask({ id: "t1", status: "pending" }));

    const result = await commandHandler({ args: "resume t1" });
    expect(result.text).toContain("only suspended or failed");
  });

  it("shows task logs", async () => {
    store.createTask(makeTask({ id: "t1" }));
    logger.info("t1", "Task started");

    const result = await commandHandler({ args: "logs t1" });
    expect(result.text).toContain("Task started");
  });

  it("shows system status", async () => {
    store.createTask(makeTask({ id: "t1", status: "active" }));
    store.createTask(makeTask({ id: "t2", status: "launching", title: "Task 2" }));
    store.createTask(makeTask({ id: "t3", status: "completed" }));

    const result = await commandHandler({ args: "status" });
    expect(result.text).toContain("Total tasks");
    expect(result.text).toContain("3");
    expect(result.text).toContain("Concurrent run limit");
    expect(result.text).toContain("t1");
    expect(result.text).toContain("Task 2");
  });

  it("delegates dream requests to the dream handler", async () => {
    const runDream = vi.fn().mockResolvedValue({ text: "dreamed tasks" });
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, undefined, undefined, {
      runDream,
    });

    const result = await commandHandler({
      args: "dream",
      channel: "webchat",
      from: "webchat:user-123",
      to: "webchat:user-123",
      config: {} as never,
    });

    expect(result.text).toBe("dreamed tasks");
    expect(runDream).toHaveBeenCalledTimes(1);
    expect(runDream).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webchat",
        from: "webchat:user-123",
      }),
      {},
    );
  });

  it("passes the parsed model to dream", async () => {
    const runDream = vi.fn().mockResolvedValue({ text: "dreamed tasks" });
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, undefined, undefined, {
      runDream,
    });

    await commandHandler({
      args: "dream --model openai-codex/gpt-5.4",
      channel: "webchat",
      from: "webchat:user-123",
      to: "webchat:user-123",
      config: {} as never,
    });

    expect(runDream).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webchat",
        from: "webchat:user-123",
      }),
      {
        modelRef: "openai-codex/gpt-5.4",
      },
    );
  });

  it("rejects unsupported dream options", async () => {
    const runDream = vi.fn().mockResolvedValue({ text: "dreamed tasks" });
    const mockApi = {
      config: {},
      registerCommand: vi.fn((cmd: { handler: typeof commandHandler }) => {
        commandHandler = cmd.handler;
      }),
    };

    const { registerCommands } = await import("./commands.js");
    registerCommands(mockApi as never, store, logger, defaultConfig, undefined, undefined, {
      runDream,
    });

    const result = await commandHandler({
      args: "dream --max-loops 20",
      channel: "webchat",
      from: "webchat:user-123",
      to: "webchat:user-123",
      config: {} as never,
    });

    expect(result.text).toContain("not supported here");
    expect(result.text).toContain("Usage:");
    expect(runDream).not.toHaveBeenCalled();
  });
});
