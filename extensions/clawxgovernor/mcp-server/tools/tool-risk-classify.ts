type RiskLevel = "read" | "workspace_write" | "exec" | "network" | "subagent_control" | "unknown";
type RiskAction = "allow" | "requireApproval" | "block";

const RISK_MAP: Record<string, { level: RiskLevel; action: RiskAction }> = {};

const LEVEL_DEFINITIONS: { level: RiskLevel; keywords: string[]; action: RiskAction }[] = [
  {
    level: "read",
    keywords: ["find", "grep", "read", "glob", "search", "list", "cat", "head", "tail", "ls"],
    action: "allow",
  },
  {
    level: "workspace_write",
    keywords: ["edit", "write", "apply_patch", "create", "mkdir", "touch", "mv", "cp"],
    action: "allow",
  },
  {
    level: "exec",
    keywords: ["exec", "code_execution", "shell", "bash", "run", "execute"],
    action: "requireApproval",
  },
  {
    level: "network",
    keywords: ["web_search", "fetch", "tavily", "firecrawl", "curl", "http", "api"],
    action: "allow",
  },
  {
    level: "subagent_control",
    keywords: ["sessions_spawn", "sessions_send", "subagent", "agent_spawn"],
    action: "requireApproval",
  },
];

const BLOCK_PATTERNS = [
  "rm -rf /",
  ":(){ :|:& };:",
  "mkfs.",
  "dd if=/dev/zero",
  "chmod -R 777 /",
  "> /dev/sda",
  "format c:",
];

export function toolRiskClassify(
  toolName: string,
  params?: Record<string, unknown>,
): {
  level: RiskLevel;
  action: RiskAction;
  reason: string;
  blocked?: boolean;
  blockReason?: string;
} {
  if (!params && RISK_MAP[toolName]) {
    return { ...RISK_MAP[toolName], reason: "Classified by keyword match (cached)" };
  }
  if (params) {
    const paramsStr = JSON.stringify(params);
    for (const pattern of BLOCK_PATTERNS) {
      if (paramsStr.includes(pattern)) {
        return {
          level: "exec",
          action: "block",
          reason: `Parameters contain dangerous pattern: "${pattern}"`,
          blocked: true,
          blockReason: `Dangerous pattern detected: "${pattern}"`,
        };
      }
    }
  }
  const nameLower = toolName.toLowerCase();
  for (const def of LEVEL_DEFINITIONS) {
    if (def.keywords.some((kw) => nameLower.includes(kw))) {
      const result = {
        level: def.level,
        action: def.action,
        reason: `Matched keyword in "${def.level}" category`,
      };
      if (!params) RISK_MAP[toolName] = { level: def.level, action: def.action };
      return result;
    }
  }
  return {
    level: "unknown",
    action: "requireApproval",
    reason: "Unknown tool — conservative default",
  };
}
