/**
 * GuardClaw Session State Management
 *
 * Tracks privacy state for each session.
 */

import type { Checkpoint, SensitivityLevel, SessionPrivacyState } from "./types.js";
import { recordLoopDetection } from "./loop-detection-level.js";

// In-memory session state storage
const sessionStates = new Map<string, SessionPrivacyState>();

/**
 * Mark a session as private (S2 or S3 detected)
 * Once marked private, the session stays private to protect sensitive history.
 */
export function markSessionAsPrivate(sessionKey: string, level: SensitivityLevel): void {
  const existing = sessionStates.get(sessionKey);

  // Mark as private for S2 or S3 (not S1)
  const shouldBePrivate = level === "S2" || level === "S3";

  if (existing) {
    // Once private, always private (don't downgrade)
    existing.isPrivate = existing.isPrivate || shouldBePrivate;
    existing.highestLevel = getHigherLevel(existing.highestLevel, level);
  } else {
    sessionStates.set(sessionKey, {
      sessionKey,
      isPrivate: shouldBePrivate,
      highestLevel: level,
      detectionHistory: [],
    });
  }
}

/**
 * Check if a session is marked as private
 */
export function isSessionMarkedPrivate(sessionKey: string): boolean {
  return sessionStates.get(sessionKey)?.isPrivate ?? false;
}

/**
 * Get the highest detected sensitivity level for a session
 */
export function getSessionHighestLevel(sessionKey: string): SensitivityLevel {
  return sessionStates.get(sessionKey)?.highestLevel ?? "S1";
}

/**
 * Get session sensitivity info including highest level
 */
export function getSessionSensitivity(
  sessionKey: string,
): { highestLevel: SensitivityLevel } | null {
  const state = sessionStates.get(sessionKey);
  if (!state) return null;
  return { highestLevel: state.highestLevel };
}

/**
 * Record a detection event in session history
 */
export function recordDetection(
  sessionKey: string,
  level: SensitivityLevel,
  checkpoint: Checkpoint,
  reason?: string,
): void {
  let state = sessionStates.get(sessionKey);

  if (!state) {
    state = {
      sessionKey,
      isPrivate: false,
      highestLevel: "S1",
      detectionHistory: [],
    };
    sessionStates.set(sessionKey, state);
  }

  state.detectionHistory.push({
    timestamp: Date.now(),
    level,
    checkpoint,
    reason,
  });

  if (state.detectionHistory.length > 50) {
    state.detectionHistory = state.detectionHistory.slice(-50);
  }

  // Track loop-local highest level for frontend polling API.
  recordLoopDetection(sessionKey, level);
}

/**
 * Get full session privacy state
 */
export function getSessionState(sessionKey: string): SessionPrivacyState | undefined {
  return sessionStates.get(sessionKey);
}

/**
 * Clear session state (e.g., when session ends)
 */
export function clearSessionState(sessionKey: string): void {
  sessionStates.delete(sessionKey);
}

/**
 * Reset session privacy state (allow user to switch back to cloud models)
 * WARNING: This will allow the conversation history to be sent to cloud models
 */
export function resetSessionPrivacy(sessionKey: string): boolean {
  const state = sessionStates.get(sessionKey);
  if (state) {
    state.isPrivate = false;
    state.highestLevel = "S1";
    state.detectionHistory = [];
    // Also clear the guard subsession
    sessionStates.delete(`${sessionKey}:guard`);
    return true;
  }
  return false;
}

/**
 * Get all active session states (for debugging/monitoring)
 */
export function getAllSessionStates(): Map<string, SessionPrivacyState> {
  return new Map(sessionStates);
}

// ── Pending detection stash ─────────────────────────────────────────────
// Used to pass detection results between before_model_resolve and
// before_prompt_build / before_message_write hooks (which fire in sequence
// but are registered separately).

export type PendingDetection = {
  level: SensitivityLevel;
  reason?: string;
  desensitized?: string;
  originalPrompt?: string;
  timestamp: number;
};

const pendingDetections = new Map<string, PendingDetection>();

export function stashDetection(sessionKey: string, detection: PendingDetection): void {
  pendingDetections.set(sessionKey, detection);
}

export function getPendingDetection(sessionKey: string): PendingDetection | undefined {
  return pendingDetections.get(sessionKey);
}

export function consumeDetection(sessionKey: string): PendingDetection | undefined {
  const d = pendingDetections.get(sessionKey);
  pendingDetections.delete(sessionKey);
  return d;
}

/**
 * Track the highest detected level for a session WITHOUT marking it as private.
 *
 * Used when S3 is detected at before_model_resolve: the message is routed to
 * Guard Agent (physically isolated session/workspace), so S3 data never enters
 * the main session's context window. Marking the main session as permanently
 * private would be incorrect — subsequent S1 messages can safely use cloud models
 * because the context window is clean.
 *
 * highestLevel is still updated for statistics/audit; only isPrivate is left unchanged.
 */
export function trackSessionLevel(sessionKey: string, level: SensitivityLevel): void {
  const existing = sessionStates.get(sessionKey);
  if (existing) {
    existing.highestLevel = getHigherLevel(existing.highestLevel, level);
  } else {
    sessionStates.set(sessionKey, {
      sessionKey,
      isPrivate: false,
      highestLevel: level,
      detectionHistory: [],
    });
  }
}

// ── Active local routing tracking ───────────────────────────────────────
// Tracks sessions whose current turn is being served by a local model
// due to S3 detection.  Set at the start of before_model_resolve (S3),
// cleared at the start of the NEXT before_model_resolve call.
// Used by tool_result_persist to skip unnecessary PII redaction when
// data never leaves the local environment.

const activeLocalRouting = new Set<string>();

export function setActiveLocalRouting(sessionKey: string): void {
  activeLocalRouting.add(sessionKey);
}

export function clearActiveLocalRouting(sessionKey: string): void {
  activeLocalRouting.delete(sessionKey);
}

export function isActiveLocalRouting(sessionKey: string): boolean {
  return activeLocalRouting.has(sessionKey);
}

/**
 * Helper to compare and return higher level
 */
function getHigherLevel(a: SensitivityLevel, b: SensitivityLevel): SensitivityLevel {
  const order = { S1: 1, S2: 2, S3: 3 };
  return order[a] >= order[b] ? a : b;
}
