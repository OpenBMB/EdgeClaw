/**
 * VoiceClaw Audio Session Manager
 *
 * Manages per-connection audio sessions with state machine:
 *   idle → listening → processing → thinking → speaking → idle
 *                                                ↑ interrupted ↓
 *
 * Each session tracks:
 *   - Audio buffer for current utterance
 *   - Privacy level from GuardClaw integration
 *   - VAD/KWS state
 *   - Turn counter for barge-in coordination
 */

import type { AudioSession, VoiceState, SensitivityLevel } from "./types.js";
import { VadEngine } from "./vad-engine.js";
import { KwsEngine } from "./kws-engine.js";
import { AsrEngine } from "./asr-engine.js";
import { TtsEngine } from "./tts-engine.js";
import { VoicePrivacyManager } from "./voice-privacy.js";
import type { VoiceClawConfig } from "./types.js";

export class AudioSessionManager {
  private sessions = new Map<string, AudioSession>();
  private vadEngine: VadEngine;
  private kwsEngine: KwsEngine;
  private asrEngine: AsrEngine;
  private ttsEngine: TtsEngine;
  private privacyManager: VoicePrivacyManager;
  private turnCounter = 0;

  constructor(config: VoiceClawConfig = {}) {
    this.vadEngine = new VadEngine(config.vad);
    this.kwsEngine = new KwsEngine(config.kws);
    this.asrEngine = new AsrEngine(config.asr);
    this.ttsEngine = new TtsEngine(config.tts);
    this.privacyManager = new VoicePrivacyManager(config.privacy);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.vadEngine.initialize(),
      this.kwsEngine.initialize(),
      this.asrEngine.initialize(),
      this.ttsEngine.initialize(),
    ]);
  }

  createSession(id: string, openclawSessionKey?: string): AudioSession {
    const session: AudioSession = {
      id,
      state: "idle",
      openclawSessionKey,
      privacyLevel: "S1",
      audioBuffer: [],
      speechDurationMs: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): AudioSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Process incoming audio chunk from WebSocket.
   * Returns events to send back to the client.
   */
  async processAudio(
    sessionId: string,
    samples: Float32Array,
  ): Promise<Array<{ type: string; data: unknown }>> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    session.lastActivityAt = Date.now();
    const events: Array<{ type: string; data: unknown }> = [];

    // KWS (always-on if enabled)
    const kwsEvents = this.kwsEngine.process(samples);
    for (const kws of kwsEvents) {
      events.push({ type: "kws", data: kws });
      if (session.state === "idle") {
        this.transitionState(session, "listening");
        events.push({
          type: "state",
          data: { state: session.state, privacyLevel: session.privacyLevel },
        });
      }
    }

    // VAD
    const vadEvents = this.vadEngine.process(samples);
    for (const vad of vadEvents) {
      events.push({ type: "vad", data: vad });

      if (vad.type === "speech_start") {
        if (session.state === "idle" || session.state === "speaking") {
          // Barge-in: user starts speaking while TTS is playing
          if (session.state === "speaking") {
            this.transitionState(session, "interrupted");
            events.push({
              type: "state",
              data: { state: "interrupted", privacyLevel: session.privacyLevel },
            });
          }
          this.transitionState(session, "listening");
          session.audioBuffer = [];
          session.speechDurationMs = 0;
          events.push({
            type: "state",
            data: { state: session.state, privacyLevel: session.privacyLevel },
          });
        }
      }

      if (vad.type === "speech_end" && session.state === "listening") {
        this.transitionState(session, "processing");
        events.push({
          type: "state",
          data: { state: session.state, privacyLevel: session.privacyLevel },
        });

        const asrResult = await this.runAsr(session);
        events.push({ type: "asr", data: asrResult });

        this.transitionState(session, "idle");
        events.push({
          type: "state",
          data: { state: session.state, privacyLevel: session.privacyLevel },
        });
      }
    }

    // Buffer audio when listening
    if (session.state === "listening") {
      session.audioBuffer.push(new Float32Array(samples));
      session.speechDurationMs += (samples.length / 16000) * 1000;
    }

    return events;
  }

  private async runAsr(session: AudioSession) {
    if (session.audioBuffer.length === 0) {
      return { text: "", latencyMs: 0, provider: "local", privacyForced: false };
    }

    const totalSamples = session.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Float32Array(totalSamples);
    let offset = 0;
    for (const buf of session.audioBuffer) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    const privacyDecision = this.privacyManager.preAsrDecision(session.id);
    session.privacyLevel = privacyDecision.level;

    const result = await this.asrEngine.recognize(combined, privacyDecision.level);
    session.audioBuffer = [];
    session.speechDurationMs = 0;

    return result;
  }

  /**
   * Synthesize TTS response and return audio chunks.
   */
  async synthesize(sessionId: string, text: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    this.turnCounter++;
    this.transitionState(session, "speaking");

    const chunks = await this.ttsEngine.synthesize(text, session.privacyLevel);

    if (session.state === "speaking") {
      this.transitionState(session, "idle");
    }

    return { turnId: this.turnCounter, chunks };
  }

  private transitionState(session: AudioSession, newState: VoiceState): void {
    session.state = newState;
  }

  markSessionPrivacy(sessionId: string, level: SensitivityLevel): void {
    this.privacyManager.markSession(sessionId, level);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.privacyLevel = this.privacyManager.getSessionLevel(sessionId);
    }
  }

  removeSession(id: string): void {
    this.sessions.delete(id);
    this.privacyManager.clearSession(id);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  destroy(): void {
    this.vadEngine.destroy();
    this.kwsEngine.destroy();
    this.asrEngine.destroy();
    this.ttsEngine.destroy();
    this.sessions.clear();
  }
}
