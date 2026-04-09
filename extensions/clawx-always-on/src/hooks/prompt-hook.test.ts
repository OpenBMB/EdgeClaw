import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AlwaysOnTask } from "../core/types.js";
import { openDatabase, TaskStore } from "../storage/store.js";

function makeTask(overrides: Partial<AlwaysOnTask> = {}): AlwaysOnTask {
  return {
    id: "task-001",
    title: "Research AI trends",
    status: "active",
    sourceType: "user-command",
    budgetExceededAction: "warn",
    budgetConstraints: JSON.stringify([{ kind: "max-loops", limit: 50 }]),
    budgetUsage: JSON.stringify({ loopsUsed: 5, costUsedUsd: 0.1 }),
    sessionKey: "always-on:task-001",
    createdAt: Date.now(),
    runCount: 1,
    ...overrides,
  };
}

const alwaysOnSessionKeys = ["always-on:task-001", "agent:main:always-on:task-001"] as const;

describe("prompt-hook", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let store: TaskStore;
  let hookHandler: ((event: unknown, ctx: Record<string, unknown>) => unknown) | undefined;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "prompt-hook-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);

    const mockApi = {
      on: vi.fn(
        (name: string, handler: (event: unknown, ctx: Record<string, unknown>) => unknown) => {
          if (name === "before_prompt_build") {
            hookHandler = handler;
          }
        },
      ),
    };

    const { registerPromptHook } = await import("./prompt-hook.js");
    registerPromptHook(mockApi as never, store);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(alwaysOnSessionKeys)("injects context for always-on session %s", (sessionKey) => {
    store.createTask(makeTask());

    const result = hookHandler!({}, { sessionKey });
    expect(result).toBeDefined();
    const r = result as { prependContext: string };
    expect(r.prependContext).toContain("Research AI trends");
    expect(r.prependContext).toContain("always_on_progress");
  });

  it("does nothing for non-always-on sessions", () => {
    const result = hookHandler!({}, { sessionKey: "main" });
    expect(result).toBeUndefined();
  });

  it("does nothing when no matching task exists", () => {
    const result = hookHandler!({}, { sessionKey: "always-on:nonexistent" });
    expect(result).toBeUndefined();
  });

  it("does nothing for non-active tasks", () => {
    store.createTask(makeTask({ status: "suspended" }));
    const result = hookHandler!({}, { sessionKey: "always-on:task-001" });
    expect(result).toBeUndefined();
  });

  it.each(alwaysOnSessionKeys)("includes budget status in prompt for %s", (sessionKey) => {
    store.createTask(makeTask());
    const result = hookHandler!({}, { sessionKey }) as { prependContext: string };
    expect(result.prependContext).toContain("Budget Status");
    expect(result.prependContext).toContain("5/50");
  });

  it.each(alwaysOnSessionKeys)("includes previous progress for resumed task %s", (sessionKey) => {
    store.createTask(makeTask({ runCount: 2, progressSummary: "Completed step A" }));
    const result = hookHandler!({}, { sessionKey }) as { prependContext: string };
    expect(result.prependContext).toContain("Previous Progress");
    expect(result.prependContext).toContain("Completed step A");
  });

  it("uses reply-based completion guidance when explicit tools are unavailable", async () => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });

    tmpDir = mkdtempSync(join(tmpdir(), "prompt-hook-test-"));
    db = openDatabase(join(tmpDir, "test.sqlite"));
    store = new TaskStore(db);
    hookHandler = undefined;

    const mockApi = {
      on: vi.fn(
        (name: string, handler: (event: unknown, ctx: Record<string, unknown>) => unknown) => {
          if (name === "before_prompt_build") {
            hookHandler = handler;
          }
        },
      ),
    };

    const { registerPromptHook } = await import("./prompt-hook.js");
    registerPromptHook(mockApi as never, store, {
      explicitToolsAvailable: false,
      profile: "coding",
    });

    store.createTask(makeTask());
    const result = hookHandler!({}, { sessionKey: "always-on:task-001" }) as {
      prependContext: string;
    };

    expect(result.prependContext).toContain("Explicit always-on tools are unavailable");
    expect(result.prependContext).toContain("ALWAYS_ON_STATUS: completed");
    expect(result.prependContext).not.toContain("always_on_progress");
  });
});
