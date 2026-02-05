/**
 * Plugin Event System
 *
 * Generic event emitter for plugins to broadcast custom events.
 * Events are forwarded to Gateway WebSocket clients.
 */

export type PluginEventPayload = Record<string, unknown>;

export type PluginEvent = {
  pluginId: string;
  eventType: string;
  payload: PluginEventPayload;
  timestamp: number;
};

type PluginEventListener = (event: PluginEvent) => void;

const listeners = new Set<PluginEventListener>();

/**
 * Emit a plugin event to all listeners
 */
export function emitPluginEvent(
  pluginId: string,
  eventType: string,
  payload: PluginEventPayload,
): void {
  const event: PluginEvent = {
    pluginId,
    eventType,
    payload,
    timestamp: Date.now(),
  };

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Subscribe to plugin events
 * Returns an unsubscribe function
 */
export function onPluginEvent(listener: PluginEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Clear all listeners (for testing)
 */
export function clearPluginEventListeners(): void {
  listeners.clear();
}

