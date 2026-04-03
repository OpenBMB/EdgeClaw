import type { IntentType } from "../types.js";
import type { SkillsRuntime } from "./types.js";

export function classifyIntent(query: string, skills: SkillsRuntime): IntentType {
  const normalized = query.toLowerCase();
  const score = {
    time: skills.intentRules.timeKeywords.filter((word) => normalized.includes(word.toLowerCase())).length,
    project: skills.intentRules.projectKeywords.filter((word) => normalized.includes(word.toLowerCase())).length,
    fact: skills.intentRules.factKeywords.filter((word) => normalized.includes(word.toLowerCase())).length,
  };

  if (score.project > 0 && score.project >= score.time && score.project >= score.fact) return "project";
  if (score.time > 0 && score.time >= score.fact) return "time";
  if (score.fact > 0) return "fact";
  return "general";
}
