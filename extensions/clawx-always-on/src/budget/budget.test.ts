import { describe, it, expect } from "vitest";
import type { BudgetUsage } from "../core/types.js";
import { MaxCostUsdBudget } from "./max-cost-usd.js";
import { MaxLoopsBudget } from "./max-loops.js";
import { serializeBudgetConstraints, deserializeBudgetConstraints } from "./registry.js";

describe("MaxLoopsBudget", () => {
  it("passes when under limit", () => {
    const budget = new MaxLoopsBudget(10);
    const usage: BudgetUsage = { loopsUsed: 5, costUsedUsd: 0 };
    expect(budget.check(usage)).toEqual({ ok: true });
  });

  it("fails when at limit", () => {
    const budget = new MaxLoopsBudget(10);
    const usage: BudgetUsage = { loopsUsed: 10, costUsedUsd: 0 };
    const result = budget.check(usage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("10/10");
    }
  });

  it("serializes correctly", () => {
    const budget = new MaxLoopsBudget(25);
    expect(budget.serialize()).toEqual({ kind: "max-loops", limit: 25 });
  });
});

describe("MaxCostUsdBudget", () => {
  it("passes when under limit", () => {
    const budget = new MaxCostUsdBudget(1.0);
    const usage: BudgetUsage = { loopsUsed: 0, costUsedUsd: 0.5 };
    expect(budget.check(usage)).toEqual({ ok: true });
  });

  it("fails when at limit", () => {
    const budget = new MaxCostUsdBudget(1.0);
    const usage: BudgetUsage = { loopsUsed: 0, costUsedUsd: 1.5 };
    const result = budget.check(usage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Cost limit");
    }
  });

  it("serializes correctly", () => {
    const budget = new MaxCostUsdBudget(2.5);
    expect(budget.serialize()).toEqual({ kind: "max-cost-usd", limitUsd: 2.5 });
  });
});

describe("Budget serialization roundtrip", () => {
  it("serializes and deserializes constraints", () => {
    const original = [new MaxLoopsBudget(50), new MaxCostUsdBudget(1.0)];
    const json = serializeBudgetConstraints(original);
    const restored = deserializeBudgetConstraints(json);

    expect(restored).toHaveLength(2);
    expect(restored[0].kind).toBe("max-loops");
    expect(restored[1].kind).toBe("max-cost-usd");

    const usage: BudgetUsage = { loopsUsed: 5, costUsedUsd: 0.1 };
    expect(restored[0].check(usage)).toEqual({ ok: true });
    expect(restored[1].check(usage)).toEqual({ ok: true });
  });

  it("skips unknown constraint kinds", () => {
    const json = JSON.stringify([
      { kind: "max-loops", limit: 10 },
      { kind: "unknown-future-kind", data: 42 },
    ]);
    const restored = deserializeBudgetConstraints(json);
    expect(restored).toHaveLength(1);
    expect(restored[0].kind).toBe("max-loops");
  });
});
