import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

type RiskLevel = "read" | "workspace_write" | "exec" | "network" | "subagent_control" | "unknown";
type RiskAction = "allow" | "requireApproval" | "block";

interface RiskRules {
  levels: Record<string, { tools: string[]; action: RiskAction }>;
  defaultAction: RiskAction;
  blockPatterns: { tool: string; paramMatch: string; action: RiskAction }[];
  loopDetection: { windowSize: number; maxRepeats: number };
}

const DEFAULT_RISK_RULES: RiskRules = {
  levels: {
    read: {
      tools: [
        "find",
        "grep",
        "read",
        "glob",
        "search",
        "list",
        "inspect",
        "budget_check",
        "classify",
        "audit_query",
        "summarize",
        "note_read",
        "note_search",
        "note_append",
        "context_inspect",
        "context_budget",
        "context_force",
        "tool_risk",
        "tool_audit",
        "tool_result",
        "session_note",
      ],
      action: "allow",
    },
    workspace_write: { tools: ["edit", "write", "apply_patch", "create"], action: "allow" },
    exec: { tools: ["exec", "code_execution", "shell", "bash"], action: "requireApproval" },
    network: { tools: ["web_search", "fetch", "tavily", "firecrawl"], action: "allow" },
    subagent_control: {
      tools: ["sessions_spawn", "sessions_send", "subagent"],
      action: "requireApproval",
    },
  },
  defaultAction: "allow",
  blockPatterns: [
    { tool: "exec", paramMatch: "rm -rf /", action: "block" },
    { tool: "exec", paramMatch: ":(){ :|:& };:", action: "block" },
    { tool: "exec", paramMatch: "mkfs", action: "block" },
    { tool: "exec", paramMatch: "dd if=/dev/zero", action: "block" },
    { tool: "shell", paramMatch: "rm -rf /", action: "block" },
    { tool: "bash", paramMatch: "rm -rf /", action: "block" },
  ],
  loopDetection: { windowSize: 10, maxRepeats: 3 },
};

function classifyTool(
  toolName: string,
  rules: RiskRules,
): { level: RiskLevel; action: RiskAction } {
  for (const [level, config] of Object.entries(rules.levels)) {
    if (config.tools.some((t) => toolName.toLowerCase().includes(t.toLowerCase()))) {
      return { level: level as RiskLevel, action: config.action };
    }
  }
  return { level: "unknown", action: rules.defaultAction };
}

function matchesBlockPattern(toolName: string, params: unknown, rules: RiskRules): string | null {
  const paramsStr = typeof params === "string" ? params : JSON.stringify(params ?? {});
  for (const pattern of rules.blockPatterns) {
    if (
      toolName.toLowerCase().includes(pattern.tool.toLowerCase()) &&
      paramsStr.includes(pattern.paramMatch)
    ) {
      return `Blocked: "${pattern.paramMatch}" is a dangerous pattern for tool "${toolName}"`;
    }
  }
  return null;
}

const TOOL_GOVERNANCE_PROMPT = `## Tool Usage Governance (ClawXGovernor)

Follow these rules when using tools:
- Read-only tools (find, grep, read, glob) are safe and can be used freely.
- Write tools (edit, write, apply_patch) should be used carefully with correct paths.
- Execution tools (exec, code_execution) require user approval for safety.
- Network tools (web_search, fetch) are generally safe but avoid leaking sensitive data.
- Subagent tools (sessions_spawn, sessions_send) require approval.
- NEVER execute obviously destructive commands (rm -rf /, mkfs, dd).
- Avoid calling the same tool more than 3 times consecutively with identical parameters.
- When tool results are very long, reference the summary rather than repeating the full output.`;

export function registerToolGovernor(
  api: OpenClawPluginApi,
  pluginConfig: Record<string, unknown>,
): void {
  const stateDir =
    (pluginConfig.governorStateDir as string) ??
    path.join(os.homedir(), ".openclaw", "cc-tool-governor");
  const summarizeThreshold = (pluginConfig.summarizeThreshold as number) ?? 4000;
  const loopWindowSize =
    (pluginConfig.loopWindowSize as number) ?? DEFAULT_RISK_RULES.loopDetection.windowSize;
  const loopMaxRepeats =
    (pluginConfig.loopMaxRepeats as number) ?? DEFAULT_RISK_RULES.loopDetection.maxRepeats;

  const rules = {
    ...DEFAULT_RISK_RULES,
    loopDetection: { windowSize: loopWindowSize, maxRepeats: loopMaxRepeats },
  };

  const recentCalls: { toolName: string; paramsHash: string; ts: number }[] = [];

  function getParamsHash(params: unknown): string {
    try {
      return JSON.stringify(params ?? {}).slice(0, 200);
    } catch {
      return "";
    }
  }

  function detectLoop(toolName: string, params: unknown): boolean {
    const hash = getParamsHash(params);
    const window = recentCalls.slice(-rules.loopDetection.windowSize);
    let consecutive = 0;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i].toolName === toolName && window[i].paramsHash === hash) consecutive++;
      else break;
    }
    return consecutive >= rules.loopDetection.maxRepeats;
  }

  function appendAudit(record: Record<string, unknown>): void {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const line = JSON.stringify({ ...record, timestamp: new Date().toISOString() }) + "\n";
      fs.appendFileSync(path.join(stateDir, "audit.jsonl"), line);
    } catch {
      /* non-critical */
    }
  }

  function writeSummary(toolCallId: string, summary: string): void {
    try {
      const summaryDir = path.join(stateDir, "summaries");
      fs.mkdirSync(summaryDir, { recursive: true });
      fs.writeFileSync(path.join(summaryDir, `${toolCallId}.md`), summary);
    } catch {
      /* non-critical */
    }
  }

  api.on(
    "before_tool_call",
    async (event) => {
      const { toolName, params } = event;
      const { level, action } = classifyTool(toolName, rules);

      const blockReason = matchesBlockPattern(toolName, params, rules);
      if (blockReason) {
        appendAudit({
          toolName,
          riskLevel: level,
          action: "block",
          reason: blockReason,
          params: getParamsHash(params),
        });
        return { block: true, blockReason };
      }

      if (detectLoop(toolName, params)) {
        const reason = `Loop detected: "${toolName}" called ${rules.loopDetection.maxRepeats}+ times consecutively with identical parameters`;
        appendAudit({
          toolName,
          riskLevel: level,
          action: "block",
          reason,
          params: getParamsHash(params),
        });
        return { block: true, blockReason: reason };
      }

      recentCalls.push({ toolName, paramsHash: getParamsHash(params), ts: Date.now() });
      if (recentCalls.length > rules.loopDetection.windowSize * 2) {
        recentCalls.splice(0, recentCalls.length - rules.loopDetection.windowSize);
      }

      appendAudit({ toolName, riskLevel: level, action, params: getParamsHash(params) });

      if (action === "requireApproval") {
        return {
          requireApproval: {
            title: `Tool "${toolName}" requires approval`,
            description: `Risk level: ${level}. This tool is classified as "${level}" and requires user approval before execution.`,
            severity: level === "exec" ? ("warning" as const) : ("info" as const),
          },
        };
      }
      return {};
    },
    { priority: 100 },
  );

  api.on("after_tool_call", async (event) => {
    const { toolName, result, durationMs } = event;
    const toolCallId = (event as Record<string, unknown>).toolCallId as string | undefined;
    const resultStr = typeof result === "string" ? result : JSON.stringify(result ?? "");
    const resultSize = resultStr.length;

    appendAudit({
      toolName,
      phase: "after",
      durationMs,
      resultSize,
      summarized: resultSize > summarizeThreshold,
    });

    if (resultSize > summarizeThreshold && toolCallId) {
      const truncated = resultStr.slice(0, 1000);
      const summary = `## Tool Result Summary: ${toolName}\n\nOriginal length: ${resultSize} chars | Duration: ${durationMs}ms\n\n${truncated}\n\n... (truncated, ${resultSize - 1000} chars omitted)`;
      writeSummary(toolCallId, summary);
    }
  });

  api.on("before_prompt_build", async () => ({ appendSystemContext: TOOL_GOVERNANCE_PROMPT }), {
    priority: 50,
  });
}
