import type { BudgetCheckResult, BudgetConstraint, BudgetUsage } from "../core/types.js";

export class MaxLoopsBudget implements BudgetConstraint {
  readonly kind = "max-loops";
  constructor(readonly limit: number) {}

  serialize(): Record<string, unknown> {
    return { kind: this.kind, limit: this.limit };
  }

  check(usage: BudgetUsage): BudgetCheckResult {
    if (usage.loopsUsed < this.limit) return { ok: true };
    return { ok: false, reason: `Loop limit reached: ${usage.loopsUsed}/${this.limit}` };
  }
}
