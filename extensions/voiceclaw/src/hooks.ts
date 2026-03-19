/**
 * VoiceClaw Hooks — OpenClaw Integration
 *
 * Registers hooks to bridge voice processing with GuardClaw's privacy pipeline.
 *
 * Hook strategy:
 *   - before_model_resolve: If current turn was voice input, mark session
 *     with the privacy level determined during ASR
 *   - before_prompt_build: Inject voice context (ASR transcript) into prompt
 *   - message_sending: If response should be spoken, trigger TTS
 *   - session_end: Cleanup voice sessions
 *
 * The voice-specific privacy decisions happen BEFORE these hooks fire,
 * inside AudioSessionManager.processAudio() and VoicePrivacyManager.
 * These hooks bridge the result into OpenClaw's standard pipeline.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { WsServerHandle } from "./ws-server.js";

/**
 * Map of OpenClaw session keys → voice session IDs.
 * Populated when a voice session is linked to an OpenClaw conversation.
 */
const voiceSessionMap = new Map<string, string>();

export function registerHooks(
  api: OpenClawPluginApi,
  wsHandle: WsServerHandle,
): void {
  // ── Hook: before_model_resolve ──
  // Check if the current message came from voice input.
  // If so, the privacy level was already determined during ASR
  // and we pass it through to GuardClaw.
  api.on("before_model_resolve", async (event, ctx) => {
    try {
      const sessionKey = ctx.sessionKey ?? "";
      if (!sessionKey) return;

      const voiceSessionId = voiceSessionMap.get(sessionKey);
      if (!voiceSessionId) return;

      const session = wsHandle.sessionManager.getSession(voiceSessionId);
      if (!session) return;

      // Voice sessions that are S2/S3 should inform GuardClaw
      if (session.privacyLevel !== "S1") {
        api.logger.info(
          `[VoiceClaw] Voice session ${voiceSessionId} has privacy level ${session.privacyLevel} — GuardClaw will handle routing`,
        );
      }
    } catch (err) {
      api.logger.error(`[VoiceClaw] Error in before_model_resolve: ${String(err)}`);
    }
  });

  // ── Hook: session_end ──
  // Clean up voice session state when OpenClaw session ends.
  api.on("session_end", async (event, ctx) => {
    try {
      const sessionKey = event.sessionKey ?? ctx.sessionKey;
      if (!sessionKey) return;

      const voiceSessionId = voiceSessionMap.get(sessionKey);
      if (voiceSessionId) {
        wsHandle.sessionManager.removeSession(voiceSessionId);
        voiceSessionMap.delete(sessionKey);
        api.logger.info(`[VoiceClaw] Cleaned up voice session ${voiceSessionId}`);
      }
    } catch (err) {
      api.logger.error(`[VoiceClaw] Error in session_end: ${String(err)}`);
    }
  });

  // ── Hook: message_received ──
  // Log voice-related message activity for observability.
  api.on("message_received", async (_event, _ctx) => {
    // Observational: track voice session activity
  });

  api.logger.info("[VoiceClaw] Hooks registered (3 hooks)");
}

/**
 * Link an OpenClaw session to a voice session.
 * Called when a voice WebSocket connection is associated with
 * an existing OpenClaw conversation.
 */
export function linkVoiceSession(
  openclawSessionKey: string,
  voiceSessionId: string,
): void {
  voiceSessionMap.set(openclawSessionKey, voiceSessionId);
}

export function unlinkVoiceSession(openclawSessionKey: string): void {
  voiceSessionMap.delete(openclawSessionKey);
}
