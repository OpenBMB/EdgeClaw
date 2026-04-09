import { describe, it, expect } from "vitest";
import { MaxCostUsdBudget } from "../budget/max-cost-usd.js";
import { MaxLoopsBudget } from "../budget/max-loops.js";
import { TaskSourceRegistry } from "./registry.js";
import {
  parseUserCommandSourceMetadata,
  serializeUserCommandSourceMetadata,
  UserCommandTaskSource,
} from "./user-command-source.js";

describe("UserCommandTaskSource", () => {
  it("creates a task with correct defaults", () => {
    const source = new UserCommandTaskSource();
    const task = source.createTask({
      title: "Research topic",
      budgetConstraints: [new MaxLoopsBudget(50), new MaxCostUsdBudget(1.0)],
    });

    expect(task.id).toBeDefined();
    expect(task.id.length).toBeGreaterThan(0);
    expect(task.title).toBe("Research topic");
    expect(task.status).toBe("queued");
    expect(task.sourceType).toBe("user-command");
    expect(task.runCount).toBe(0);
    expect(task.createdAt).toBeGreaterThan(0);

    const constraints = JSON.parse(task.budgetConstraints);
    expect(constraints).toHaveLength(2);
    expect(constraints[0].kind).toBe("max-loops");
    expect(constraints[1].kind).toBe("max-cost-usd");

    const usage = JSON.parse(task.budgetUsage);
    expect(usage.loopsUsed).toBe(0);
    expect(usage.costUsedUsd).toBe(0);
  });

  it("generates unique IDs", () => {
    const source = new UserCommandTaskSource();
    const constraints = [new MaxLoopsBudget(10)];
    const t1 = source.createTask({ title: "A", budgetConstraints: constraints });
    const t2 = source.createTask({ title: "B", budgetConstraints: constraints });
    expect(t1.id).not.toBe(t2.id);
  });

  it("persists structured source metadata when provided", () => {
    const source = new UserCommandTaskSource();
    const task = source.createTask({
      title: "Research topic",
      budgetConstraints: [new MaxLoopsBudget(50)],
      sourceMetadata: serializeUserCommandSourceMetadata({
        mode: "plan",
        prompt: "Do the full research task",
        planId: "plan-1",
      }),
    });

    expect(parseUserCommandSourceMetadata(task.sourceMetadata)).toEqual({
      mode: "plan",
      prompt: "Do the full research task",
      planId: "plan-1",
      originConversationKey: undefined,
      originSessionKey: undefined,
    });
  });
});

describe("TaskSourceRegistry", () => {
  it("registers and retrieves sources", () => {
    const registry = new TaskSourceRegistry();
    const source = new UserCommandTaskSource();
    registry.register(source);

    expect(registry.get("user-command")).toBe(source);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered sources", () => {
    const registry = new TaskSourceRegistry();
    registry.register(new UserCommandTaskSource());
    expect(registry.getAll()).toHaveLength(1);
  });
});
