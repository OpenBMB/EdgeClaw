/**
 * VoiceClaw Types
 *
 * Core type definitions for the VoiceClaw edge voice processing plugin.
 */

// Re-use GuardClaw's sensitivity levels for consistency
export type SensitivityLevel = "S1" | "S2" | "S3";

export type VoiceState =
  | "idle"
  | "listening"    // KWS detected wake word, VAD active
  | "processing"   // ASR running
  | "thinking"     // LLM generating
  | "speaking"     // TTS playing
  | "interrupted"; // Barge-in detected

export type AudioFormat = {
  sampleRate: number;   // e.g. 16000
  channels: number;     // 1 = mono
  bitDepth: number;     // 16
  encoding: "pcm" | "opus" | "mulaw";
};

export type VadEvent = {
  type: "speech_start" | "speech_end";
  timestamp: number;
  probability?: number;
};

export type KwsEvent = {
  type: "keyword_detected";
  keyword: string;
  confidence: number;
  timestamp: number;
};

export type AsrResult = {
  text: string;
  language?: string;
  latencyMs: number;
  provider: "local" | "cloud";
  /** Whether privacy routing forced local ASR */
  privacyForced: boolean;
};

export type TtsRequest = {
  text: string;
  voice?: string;
  sampleRate?: number;
};

export type TtsChunk = {
  audio: Buffer;        // PCM audio data
  sampleRate: number;
  isLast: boolean;
};

// ── Config Types ────────────────────────────────────────────────────────

export type VadConfig = {
  enabled?: boolean;
  threshold?: number;
  silenceDurationMs?: number;
  modelPath?: string;
};

export type KwsConfig = {
  enabled?: boolean;
  keywords?: string[];
  threshold?: number;
  modelPath?: string;
};

export type AsrConfig = {
  enabled?: boolean;
  provider?: "sherpa-sensevoice" | "sherpa-whisper" | "sherpa-paraformer" | "cloud-whisper";
  modelPath?: string;
  language?: string;
  cloudFallback?: boolean;
};

export type TtsConfig = {
  enabled?: boolean;
  provider?: "sherpa-vits" | "sherpa-matcha" | "edge-tts" | "cloud";
  modelPath?: string;
  voice?: string;
  sampleRate?: number;
};

export type VoicePrivacyConfig = {
  transcriptDetection?: boolean;
  localAsrForS2?: boolean;
  localAsrForS3?: boolean;
  localTtsForS3?: boolean;
};

export type VoiceClawConfig = {
  enabled?: boolean;
  port?: number;
  vad?: VadConfig;
  kws?: KwsConfig;
  asr?: AsrConfig;
  tts?: TtsConfig;
  privacy?: VoicePrivacyConfig;
};

// ── Audio Session ───────────────────────────────────────────────────────

export type AudioSession = {
  id: string;
  state: VoiceState;
  /** Linked OpenClaw session key for privacy integration */
  openclawSessionKey?: string;
  /** Current sensitivity level from GuardClaw (if available) */
  privacyLevel: SensitivityLevel;
  /** Audio buffer for current utterance */
  audioBuffer: Float32Array[];
  /** Accumulated speech duration in ms */
  speechDurationMs: number;
  createdAt: number;
  lastActivityAt: number;
};

// ── WebSocket Protocol ──────────────────────────────────────────────────

export type WsClientMessage =
  | { type: "audio"; data: ArrayBuffer }      // PCM 16kHz 16bit mono
  | { type: "config"; config: Partial<VoiceClawConfig> }
  | { type: "stop" }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "vad"; event: VadEvent }
  | { type: "kws"; event: KwsEvent }
  | { type: "asr"; result: AsrResult }
  | { type: "tts_start"; turnId: number }
  | { type: "tts_audio"; data: ArrayBuffer; turnId: number }
  | { type: "tts_end"; turnId: number }
  | { type: "state"; state: VoiceState; privacyLevel: SensitivityLevel }
  | { type: "error"; message: string }
  | { type: "pong" };
