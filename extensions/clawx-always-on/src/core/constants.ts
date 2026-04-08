export const PLUGIN_ID = "clawx-always-on";

export const ALWAYS_ON_SESSION_PREFIX = "always-on:";

export const ALWAYS_ON_LANE = "always-on";

export const PROGRESS_TOOL_NAME = "always_on_progress";
export const COMPLETE_TOOL_NAME = "always_on_complete";
export const FALLBACK_STATUS_MARKER = "ALWAYS_ON_STATUS:";
export const FALLBACK_SUMMARY_MARKER = "ALWAYS_ON_SUMMARY:";

export function taskSessionKey(taskId: string): string {
  return `${ALWAYS_ON_SESSION_PREFIX}${taskId}`;
}

export function taskIdempotencyKey(taskId: string, runOrdinal: number): string {
  return `${taskSessionKey(taskId)}:run:${runOrdinal}`;
}

export function canonicalAlwaysOnSessionKey(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  if (sessionKey.startsWith(ALWAYS_ON_SESSION_PREFIX)) return sessionKey;

  const namespacedPrefix = `:${ALWAYS_ON_SESSION_PREFIX}`;
  const namespacedIndex = sessionKey.indexOf(namespacedPrefix);
  if (namespacedIndex === -1) return undefined;

  return sessionKey.slice(namespacedIndex + 1);
}

export function isAlwaysOnSession(sessionKey?: string): boolean {
  return canonicalAlwaysOnSessionKey(sessionKey) !== undefined;
}

export function taskIdFromSessionKey(sessionKey: string): string | undefined {
  const canonicalSessionKey = canonicalAlwaysOnSessionKey(sessionKey);
  if (!canonicalSessionKey) return undefined;

  return canonicalSessionKey.slice(ALWAYS_ON_SESSION_PREFIX.length);
}
