/**
 * GuardClaw Event Emitter
 * 
 * Global event emitter for GuardClaw privacy events.
 * Used to notify the UI when model switching occurs.
 */

export type GuardClawEvent = {
  active: boolean;
  level: "S2" | "S3" | null;
  model: string | null;
  provider: string | null;
  reason: string | null;
  sessionKey?: string;
  /** Original session key when using subsession isolation */
  originalSessionKey?: string;
  /** Message ID to replace with placeholder in UI */
  messageId?: string;
  /** If true, UI should replace the user's message with a privacy placeholder */
  replaceWithPlaceholder?: boolean;
};

type GuardClawEventListener = (event: GuardClawEvent) => void;

const listeners = new Set<GuardClawEventListener>();

/**
 * Emit a GuardClaw event to all listeners
 */
export function emitGuardClawEvent(event: GuardClawEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Subscribe to GuardClaw events
 * Returns an unsubscribe function
 */
export function onGuardClawEvent(listener: GuardClawEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Clear all listeners (for testing)
 */
export function clearGuardClawListeners(): void {
  listeners.clear();
}

