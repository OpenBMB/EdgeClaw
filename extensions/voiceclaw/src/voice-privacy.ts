/**
 * VoiceClaw Voice Privacy Router
 *
 * Bridges voice processing with GuardClaw's privacy pipeline.
 * Determines whether audio should be processed locally or in the cloud
 * based on context, session history, and configured rules.
 *
 * Privacy flow:
 *   Audio → VAD → KWS → [privacy decision] → ASR (local or cloud) → text
 *   text → GuardClaw detection → S1/S2/S3 → route accordingly
 *
 * Key principle: audio data is MORE sensitive than text because:
 *   1. Voice contains biometric data (voiceprint)
 *   2. Audio may contain ambient information (location sounds, other people)
 *   3. Cloud ASR means the full audio stream leaves the device
 *
 * Therefore: when in doubt, process locally.
 */

import type { SensitivityLevel, VoicePrivacyConfig, AsrResult } from "./types.js";

export type VoicePrivacyDecision = {
  asrProvider: "local" | "cloud";
  ttsProvider: "local" | "cloud" | "edge-tts";
  level: SensitivityLevel;
  reason: string;
};

/**
 * Context-aware session privacy tracker.
 * Tracks the privacy state across a voice conversation session.
 */
export class VoicePrivacyManager {
  private sessionLevels = new Map<string, SensitivityLevel>();
  private config: Required<VoicePrivacyConfig>;

  constructor(config: VoicePrivacyConfig = {}) {
    this.config = {
      transcriptDetection: config.transcriptDetection ?? true,
      localAsrForS2: config.localAsrForS2 ?? true,
      localAsrForS3: config.localAsrForS3 ?? true,
      localTtsForS3: config.localTtsForS3 ?? true,
    };
  }

  /**
   * Decide how to process audio BEFORE ASR runs.
   * This is the pre-ASR decision based on session history and context.
   *
   * If the session has previously been marked S2/S3, all subsequent
   * audio in that session uses local ASR (conservative approach).
   */
  preAsrDecision(sessionId: string): VoicePrivacyDecision {
    const sessionLevel = this.sessionLevels.get(sessionId) ?? "S1";

    if (sessionLevel === "S3") {
      return {
        asrProvider: "local",
        ttsProvider: "local",
        level: "S3",
        reason: "Session marked S3 — all voice processing stays local",
      };
    }

    if (sessionLevel === "S2" && this.config.localAsrForS2) {
      return {
        asrProvider: "local",
        ttsProvider: "edge-tts",
        level: "S2",
        reason: "Session marked S2 — ASR forced local, TTS via edge-tts",
      };
    }

    return {
      asrProvider: "cloud",
      ttsProvider: "cloud",
      level: "S1",
      reason: "No prior sensitive context — cloud processing allowed",
    };
  }

  /**
   * Post-ASR decision: after transcription, check the text for sensitivity.
   * If GuardClaw detection is enabled, the transcript will be fed through
   * the privacy pipeline. This method updates the session level.
   *
   * @param sessionId - Voice session ID
   * @param asrResult - The ASR transcription result
   * @param guardClawLevel - Level returned by GuardClaw text detection (if available)
   */
  postAsrUpdate(
    sessionId: string,
    _asrResult: AsrResult,
    guardClawLevel?: SensitivityLevel,
  ): void {
    if (!guardClawLevel) return;

    const currentLevel = this.sessionLevels.get(sessionId) ?? "S1";
    const newLevel = maxLevel(currentLevel, guardClawLevel);

    if (newLevel !== currentLevel) {
      this.sessionLevels.set(sessionId, newLevel);
    }
  }

  /**
   * Decide TTS provider based on current session privacy state.
   */
  ttsDecision(sessionId: string): "local" | "cloud" | "edge-tts" {
    const level = this.sessionLevels.get(sessionId) ?? "S1";

    if (level === "S3" && this.config.localTtsForS3) {
      return "local";
    }

    if (level === "S2") {
      return "edge-tts";
    }

    return "cloud";
  }

  getSessionLevel(sessionId: string): SensitivityLevel {
    return this.sessionLevels.get(sessionId) ?? "S1";
  }

  markSession(sessionId: string, level: SensitivityLevel): void {
    const current = this.sessionLevels.get(sessionId) ?? "S1";
    this.sessionLevels.set(sessionId, maxLevel(current, level));
  }

  clearSession(sessionId: string): void {
    this.sessionLevels.delete(sessionId);
  }
}

function levelToNum(level: SensitivityLevel): number {
  switch (level) {
    case "S1": return 1;
    case "S2": return 2;
    case "S3": return 3;
  }
}

function maxLevel(a: SensitivityLevel, b: SensitivityLevel): SensitivityLevel {
  const levels: SensitivityLevel[] = ["S1", "S2", "S3"];
  return levels[Math.max(levelToNum(a), levelToNum(b)) - 1];
}
