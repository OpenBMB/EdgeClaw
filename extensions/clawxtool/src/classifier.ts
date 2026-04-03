import { ALL_PATTERNS, type SecurityLevel, type CommandPattern } from "./bash-patterns.js";
import { analyzeHeuristics } from "./heuristics.js";

export interface SecurityVerdict {
  level: SecurityLevel;
  reason: string;
  details: string[];
}

function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  // Strip leading env assignments (e.g. VAR=val cmd)
  const withoutEnv = trimmed.replace(/^(?:\w+=\S+\s+)+/, "");
  return withoutEnv;
}

function classifySingleCommand(
  command: string,
  patterns: CommandPattern[],
  autoApprove: string[],
  alwaysBlock: string[],
): SecurityVerdict {
  const baseCmd = extractBaseCommand(command);

  // Check always-block patterns first
  for (const block of alwaysBlock) {
    if (command.includes(block)) {
      return {
        level: "dangerous",
        reason: `Matches always-block pattern: "${block}"`,
        details: [`Blocked by custom rule: ${block}`],
      };
    }
  }

  // Check auto-approve patterns
  for (const approve of autoApprove) {
    if (baseCmd.startsWith(approve)) {
      return {
        level: "safe",
        reason: `Auto-approved: matches "${approve}"`,
        details: [`Approved by custom whitelist: ${approve}`],
      };
    }
  }

  // Run heuristics (these take priority for dangerous findings)
  const heuristics = analyzeHeuristics(command);
  const dangerousHeuristics = heuristics.filter((h) => h.level === "dangerous");
  if (dangerousHeuristics.length > 0) {
    return {
      level: "dangerous",
      reason: dangerousHeuristics[0].reason,
      details: heuristics.map((h) => `[${h.level}] ${h.reason}`),
    };
  }

  // Match against pattern rules
  for (const rule of patterns) {
    if (rule.pattern.test(baseCmd) || rule.pattern.test(command)) {
      const approvalHeuristics = heuristics.filter((h) => h.level === "needs_approval");
      const details = [rule.reason, ...approvalHeuristics.map((h) => `[heuristic] ${h.reason}`)];

      // Escalate if heuristics suggest
      const effectiveLevel: SecurityLevel =
        approvalHeuristics.length > 0 && rule.level === "safe" ? "needs_approval" : rule.level;

      return { level: effectiveLevel, reason: rule.reason, details };
    }
  }

  // Unknown command — check heuristics for approval requirement
  if (heuristics.length > 0) {
    const worstLevel = heuristics.some((h) => h.level === "needs_approval")
      ? ("needs_approval" as const)
      : ("unknown" as const);
    return {
      level: worstLevel,
      reason: heuristics[0].reason,
      details: heuristics.map((h) => `[heuristic] ${h.reason}`),
    };
  }

  return {
    level: "unknown",
    reason: "Unrecognized command — cannot determine safety",
    details: [],
  };
}

export function classifyCommand(
  command: string,
  options?: { autoApprove?: string[]; alwaysBlock?: string[] },
): SecurityVerdict {
  const autoApprove = options?.autoApprove ?? [];
  const alwaysBlock = options?.alwaysBlock ?? [];

  // Split on pipes and chains to analyze each part
  const parts = command.split(/\s*(?:\|(?!\|))\s*/);

  let worstLevel: SecurityLevel = "safe";
  const allDetails: string[] = [];
  let worstReason = "";

  const levelOrder: Record<SecurityLevel, number> = {
    safe: 0,
    unknown: 1,
    needs_approval: 2,
    dangerous: 3,
  };

  for (const part of parts) {
    // Further split on && and ; for chained commands
    const subparts = part.split(/\s*(?:&&|;)\s*/);
    for (const sub of subparts) {
      const trimmed = sub.trim();
      if (!trimmed) continue;

      const verdict = classifySingleCommand(trimmed, ALL_PATTERNS, autoApprove, alwaysBlock);
      allDetails.push(...verdict.details.map((d) => `[${trimmed.split(/\s/)[0]}] ${d}`));

      if (levelOrder[verdict.level] > levelOrder[worstLevel]) {
        worstLevel = verdict.level;
        worstReason = verdict.reason;
      }
    }
  }

  return {
    level: worstLevel,
    reason: worstReason || "No issues detected",
    details: allDetails,
  };
}
