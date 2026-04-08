import {
  COMPLETE_TOOL_NAME,
  FALLBACK_STATUS_MARKER,
  FALLBACK_SUMMARY_MARKER,
  PLUGIN_ID,
  PROGRESS_TOOL_NAME,
} from "./constants.js";

type ToolConfigLike = {
  tools?: {
    profile?: unknown;
    alsoAllow?: unknown;
  };
};

export type AlwaysOnToolSupport = {
  explicitToolsAvailable: boolean;
  profile?: string;
};

const REENABLE_ALLOWLIST = new Set([
  COMPLETE_TOOL_NAME,
  PLUGIN_ID,
  PROGRESS_TOOL_NAME,
  "group:plugins",
]);

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function resolveAlwaysOnToolSupport(config?: ToolConfigLike): AlwaysOnToolSupport {
  const profile = normalizeString(config?.tools?.profile);
  const alsoAllow = new Set(normalizeStringList(config?.tools?.alsoAllow));
  const explicitToolsAvailable =
    !profile ||
    profile === "full" ||
    Array.from(REENABLE_ALLOWLIST).some((entry) => alsoAllow.has(entry));

  return {
    explicitToolsAvailable,
    profile,
  };
}

export function buildAlwaysOnCommandNote(toolSupport: AlwaysOnToolSupport): string | undefined {
  if (toolSupport.explicitToolsAvailable) {
    return undefined;
  }

  const profileLabel = toolSupport.profile
    ? `tool profile \`${toolSupport.profile}\``
    : "current tool policy";
  return (
    `Note: this environment uses ${profileLabel}, so explicit always-on tools are unavailable. ` +
    `The task will use reply-based completion fallback instead. ` +
    `To restore tool-based checkpoints, add \`tools.alsoAllow: ["${PLUGIN_ID}"]\`.`
  );
}

export function buildAlwaysOnExecutionInstructions(toolSupport: AlwaysOnToolSupport): string[] {
  if (toolSupport.explicitToolsAvailable) {
    return [
      `Use \`${PROGRESS_TOOL_NAME}\` to save progress at regular intervals.`,
      `When complete, call \`${COMPLETE_TOOL_NAME}\` with a result summary.`,
    ];
  }

  return [
    "Explicit always-on tools are unavailable in this environment.",
    "Do not mention missing tools to the user.",
    "End your final reply with a machine-readable footer that the plugin can capture:",
    `${FALLBACK_STATUS_MARKER} completed`,
    `${FALLBACK_SUMMARY_MARKER} <final result summary>`,
    `If the task still needs follow-up work, use \`${FALLBACK_STATUS_MARKER} suspended\` instead and put completed work plus next steps after \`${FALLBACK_SUMMARY_MARKER}\`.`,
  ];
}
