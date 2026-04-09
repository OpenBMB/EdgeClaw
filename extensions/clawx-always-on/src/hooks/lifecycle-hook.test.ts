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
    status: "active",
    sourceType: "user-command",
    budgetExceededAction: "warn",
    budgetConstraints: JSON.stringify([{ kind: "max-loops", limit: 10 }]),
    budgetUsage: JSON.stringify({ loopsUsed: 0, costUsedUsd: 0 }),
    sessionKey: "always-on:task-001",
    createdAt: Date.now(),
    runCount: 1,
    ...overrides,
  };
}

const defaultConfig: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  defaultBudgetExceededAction: "warn",
  maxConcurrentTasks: 3,
  dreamEnabled: false,
  dreamIntervalMinutes: 60,
  dreamMaxCandidates: 3,
  dreamContextMessageLimit: 40,
  logLevel: "debug",
  logRetentionDays: 30,
};

const alwaysOnSessionKeys = ["always-on:task-001", "agent:main:always-on:task-001"] as const;

describe("lifecycle hooks", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let logger: TaskLogger;
  let hooks: Record<string, (event: Record<string, unknown>, ctx: Record<string, unknown>) => void>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lifecycle-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    logger = new TaskLogger(db, defaultConfig);
    hooks = {};

    const mockApi = {
      on: vi.fn(
        (
          name: string,
          handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => void,
        ) => {
          hooks[name] = handler;
        },
      ),
    };

    const { registerLifecycleHooks } = await import("./lifecycle-hook.js");
    registerLifecycleHooks(mockApi as never, store, logger);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("before_message_write hook", () => {
    it.each(alwaysOnSessionKeys)(
      "increments loop count for assistant messages in always-on session %s",
      (sessionKey) => {
        store.createTask(makeTask());

        hooks.before_message_write!(
          {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Working on the task" }],
            },
          },
          { sessionKey },
        );

        const task = store.getTask("task-001");
        const usage = JSON.parse(task!.budgetUsage);
        expect(usage.loopsUsed).toBe(1);
        expect(usage.costUsedUsd).toBe(0);
      },
    );

    it("ignores non-assistant messages", () => {
      store.createTask(makeTask());

      hooks.before_message_write!(
        {
          message: {
            role: "user",
            content: [{ type: "text", text: "Continue" }],
          },
        },
        { sessionKey: "always-on:task-001" },
      );

      const task = store.getTask("task-001");
      const usage = JSON.parse(task!.budgetUsage);
      expect(usage.loopsUsed).toBe(0);
    });
  });

  describe("llm_output hook", () => {
    it.each(alwaysOnSessionKeys)(
      "tracks cost without changing loop count for always-on session %s",
      (sessionKey) => {
        store.createTask(makeTask());

        hooks.llm_output!({ usage: { input: 1000, output: 500 } }, { sessionKey });

        const task = store.getTask("task-001");
        const usage = JSON.parse(task!.budgetUsage);
        expect(usage.loopsUsed).toBe(0);
        expect(usage.costUsedUsd).toBeGreaterThan(0);
      },
    );

    it("ignores non-always-on sessions", () => {
      store.createTask(makeTask());

      hooks.llm_output!({ usage: { input: 1000, output: 500 } }, { sessionKey: "main-session" });

      const task = store.getTask("task-001");
      const usage = JSON.parse(task!.budgetUsage);
      expect(usage.loopsUsed).toBe(0);
      expect(usage.costUsedUsd).toBe(0);
    });

    it.each(alwaysOnSessionKeys)("handles missing usage gracefully for %s", (sessionKey) => {
      store.createTask(makeTask());

      hooks.llm_output!({}, { sessionKey });

      const task = store.getTask("task-001");
      const usage = JSON.parse(task!.budgetUsage);
      expect(usage.loopsUsed).toBe(0);
      expect(usage.costUsedUsd).toBe(0);
    });

    it.each(["suspended", "completed"] as const)(
      "updates cost usage for %s tasks after agent_end timing",
      (status) => {
        store.createTask(makeTask({ status }));

        hooks.llm_output!(
          { usage: { input: 200, output: 100 } },
          { sessionKey: "always-on:task-001" },
        );

        const task = store.getTask("task-001");
        const usage = JSON.parse(task!.budgetUsage);
        expect(usage.loopsUsed).toBe(0);
        expect(usage.costUsedUsd).toBeGreaterThan(0);
      },
    );
  });

  describe("agent_end hook", () => {
    it.each(alwaysOnSessionKeys)(
      "completes active task from final assistant reply for %s",
      (sessionKey) => {
        store.createTask(makeTask());

        hooks.agent_end!(
          {
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "Here is the finished report.\nALWAYS_ON_STATUS: completed\nALWAYS_ON_SUMMARY: Final chiikawa report ready.",
                  },
                ],
              },
            ],
            success: true,
          },
          { sessionKey },
        );

        const task = store.getTask("task-001");
        expect(task!.status).toBe("completed");
        expect(task!.resultSummary).toBe("Final chiikawa report ready.");
        expect(task!.completedAt).toBeDefined();
      },
    );

    it.each(alwaysOnSessionKeys)(
      "stores progress when final assistant reply requests resume for %s",
      (sessionKey) => {
        store.createTask(makeTask());

        hooks.agent_end!(
          {
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "Need more time.\nALWAYS_ON_STATUS: suspended\nALWAYS_ON_SUMMARY: Gathered sources and outlined the report; next step is to finish the write-up.",
                  },
                ],
              },
            ],
            success: true,
          },
          { sessionKey },
        );

        const task = store.getTask("task-001");
        expect(task!.status).toBe("suspended");
        expect(task!.progressSummary).toContain("Gathered sources");
        expect(task!.suspendedAt).toBeDefined();
      },
    );

    it.each(alwaysOnSessionKeys)(
      "suspends active task without usable final reply for %s",
      (sessionKey) => {
        store.createTask(makeTask());

        hooks.agent_end!({ messages: [], success: true }, { sessionKey });

        const task = store.getTask("task-001");
        expect(task!.status).toBe("suspended");
        expect(task!.suspendedAt).toBeDefined();
      },
    );

    it("does not affect non-always-on sessions", () => {
      store.createTask(makeTask());

      hooks.agent_end!({ messages: [], success: true }, { sessionKey: "main-session" });

      const task = store.getTask("task-001");
      expect(task!.status).toBe("active");
    });

    it.each(alwaysOnSessionKeys)("notes budget exceeded in logs for %s", (sessionKey) => {
      store.createTask(
        makeTask({
          budgetUsage: JSON.stringify({ loopsUsed: 10, costUsedUsd: 0 }),
        }),
      );

      hooks.agent_end!({ messages: [], success: true }, { sessionKey });

      const logs = logger.getLogs("task-001");
      const suspendLog = logs.find((l) => l.message.includes("suspended"));
      expect(suspendLog).toBeDefined();
      expect(suspendLog!.message).toContain("Loop limit");
    });
  });
});
