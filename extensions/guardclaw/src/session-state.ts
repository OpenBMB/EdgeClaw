/**
 * GuardClaw Session State Management
 * 
 * Tracks privacy state for each session.
 */

import type { Checkpoint, SensitivityLevel, SessionPrivacyState } from "./types.js";

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
export function getSessionSensitivity(sessionKey: string): { highestLevel: SensitivityLevel } | null {
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
  reason?: string
): void {
  const state = sessionStates.get(sessionKey);
  
  if (state) {
    state.detectionHistory.push({
      timestamp: Date.now(),
      level,
      checkpoint,
      reason,
    });

    // Keep only the last 50 detections to avoid memory bloat
    if (state.detectionHistory.length > 50) {
      state.detectionHistory = state.detectionHistory.slice(-50);
    }
  }
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

/**
 * Helper to compare and return higher level
 */
function getHigherLevel(a: SensitivityLevel, b: SensitivityLevel): SensitivityLevel {
  const order = { S1: 1, S2: 2, S3: 3 };
  return order[a] >= order[b] ? a : b;
}
