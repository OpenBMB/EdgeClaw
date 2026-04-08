import type { BudgetCheckResult, BudgetConstraint, BudgetUsage } from "../core/types.js";

export class MaxCostUsdBudget implements BudgetConstraint {
  readonly kind = "max-cost-usd";
  constructor(readonly limitUsd: number) {}

  serialize(): Record<string, unknown> {
    return { kind: this.kind, limitUsd: this.limitUsd };
  }

  check(usage: BudgetUsage): BudgetCheckResult {
    if (usage.costUsedUsd < this.limitUsd) return { ok: true };
    return {
      ok: false,
      reason: `Cost limit reached: $${usage.costUsedUsd.toFixed(4)}/$${this.limitUsd.toFixed(2)}`,
    };
  }
}
