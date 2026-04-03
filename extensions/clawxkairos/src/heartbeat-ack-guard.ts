import type { OpenClawPluginApi } from "../api.js";
import type { KairosState } from "./config.js";

const HEARTBEAT_OK_PATTERN = /\bHEARTBEAT_OK\b/;

/**
 * Watches llm_output for HEARTBEAT_OK responses.
 * When detected, sets state.lastReplyWasAck so the tick scheduler
 * can insert a default sleep delay instead of an immediate next tick.
 */
export function registerHeartbeatAckGuard(api: OpenClawPluginApi, state: KairosState): void {
  api.on("llm_output", (event) => {
    if (!state.active) return;

    const texts: string[] = (event as { assistantTexts?: string[] }).assistantTexts ?? [];
    state.lastReplyWasAck = texts.some((t) => HEARTBEAT_OK_PATTERN.test(t));

    if (state.lastReplyWasAck) {
      api.logger.info?.("clawxkairos: model replied HEARTBEAT_OK, will apply fallback sleep");
    }
  });
}
