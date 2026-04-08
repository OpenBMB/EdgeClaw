import type { BudgetConstraint } from "../core/types.js";
import { MaxCostUsdBudget } from "./max-cost-usd.js";
import { MaxLoopsBudget } from "./max-loops.js";

type BudgetDeserializer = (data: Record<string, unknown>) => BudgetConstraint;

const deserializers = new Map<string, BudgetDeserializer>();

export function registerBudgetDeserializer(kind: string, fn: BudgetDeserializer): void {
  deserializers.set(kind, fn);
}

registerBudgetDeserializer("max-loops", (data) => new MaxLoopsBudget(data.limit as number));
registerBudgetDeserializer("max-cost-usd", (data) => new MaxCostUsdBudget(data.limitUsd as number));

export function serializeBudgetConstraints(constraints: BudgetConstraint[]): string {
  return JSON.stringify(constraints.map((c) => c.serialize()));
}

export function deserializeBudgetConstraints(json: string): BudgetConstraint[] {
  const items = JSON.parse(json) as Record<string, unknown>[];
  return items
    .map((item) => {
      const fn = deserializers.get(item.kind as string);
      return fn ? fn(item) : undefined;
    })
    .filter((c): c is BudgetConstraint => c !== undefined);
}
