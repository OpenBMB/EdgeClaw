/**
 * VoiceClaw Config Schema & Defaults
 */

import { Type, type Static } from "@sinclair/typebox";

export const voiceClawConfigSchema = Type.Object({
  voice: Type.Optional(Type.Object({
    enabled: Type.Optional(Type.Boolean()),
    port: Type.Optional(Type.Number()),
    vad: Type.Optional(Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      threshold: Type.Optional(Type.Number()),
      silenceDurationMs: Type.Optional(Type.Number()),
      modelPath: Type.Optional(Type.String()),
    })),
    kws: Type.Optional(Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      keywords: Type.Optional(Type.Array(Type.String())),
      threshold: Type.Optional(Type.Number()),
      modelPath: Type.Optional(Type.String()),
    })),
    asr: Type.Optional(Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      provider: Type.Optional(Type.Union([
        Type.Literal("sherpa-sensevoice"),
        Type.Literal("sherpa-whisper"),
        Type.Literal("sherpa-paraformer"),
        Type.Literal("cloud-whisper"),
      ])),
      modelPath: Type.Optional(Type.String()),
      language: Type.Optional(Type.String()),
      cloudFallback: Type.Optional(Type.Boolean()),
    })),
    tts: Type.Optional(Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      provider: Type.Optional(Type.Union([
        Type.Literal("sherpa-vits"),
        Type.Literal("sherpa-matcha"),
        Type.Literal("edge-tts"),
        Type.Literal("cloud"),
      ])),
      modelPath: Type.Optional(Type.String()),
      voice: Type.Optional(Type.String()),
      sampleRate: Type.Optional(Type.Number()),
    })),
    privacy: Type.Optional(Type.Object({
      transcriptDetection: Type.Optional(Type.Boolean()),
      localAsrForS2: Type.Optional(Type.Boolean()),
      localAsrForS3: Type.Optional(Type.Boolean()),
      localTtsForS3: Type.Optional(Type.Boolean()),
    })),
  })),
});

export type VoiceClawConfigSchema = Static<typeof voiceClawConfigSchema>;

export const defaultVoiceConfig = {
  enabled: true,
  port: 8501,
  vad: {
    enabled: true,
    threshold: 0.5,
    silenceDurationMs: 500,
  },
  kws: {
    enabled: false,
    keywords: ["hey claw"],
    threshold: 0.5,
  },
  asr: {
    enabled: true,
    provider: "sherpa-sensevoice" as const,
    language: "auto",
    cloudFallback: true,
  },
  tts: {
    enabled: true,
    provider: "edge-tts" as const,
    sampleRate: 16000,
  },
  privacy: {
    transcriptDetection: true,
    localAsrForS2: true,
    localAsrForS3: true,
    localTtsForS3: true,
  },
};
