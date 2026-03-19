/**
 * VoiceClaw VAD Engine — Voice Activity Detection via sherpa-onnx-node
 *
 * Uses Silero VAD ONNX model for real-time speech/silence detection.
 * Designed for streaming: feed 32ms PCM chunks, get speech_start/speech_end events.
 */

import type { VadConfig, VadEvent } from "./types.js";

let sherpaOnnx: typeof import("sherpa-onnx-node") | null = null;

async function loadSherpa() {
  if (!sherpaOnnx) {
    sherpaOnnx = await import("sherpa-onnx-node");
  }
  return sherpaOnnx;
}

export class VadEngine {
  private vad: unknown = null;
  private config: Required<VadConfig>;
  private isSpeaking = false;
  private silenceFrames = 0;
  private readonly SAMPLE_RATE = 16000;
  private readonly FRAME_MS = 32;
  private readonly FRAME_SAMPLES: number;
  private silenceFramesThreshold: number;

  constructor(config: VadConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      threshold: config.threshold ?? 0.5,
      silenceDurationMs: config.silenceDurationMs ?? 500,
      modelPath: config.modelPath ?? "",
    };
    this.FRAME_SAMPLES = (this.SAMPLE_RATE * this.FRAME_MS) / 1000; // 512 samples
    this.silenceFramesThreshold = Math.ceil(
      this.config.silenceDurationMs / this.FRAME_MS,
    );
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    const sherpa = await loadSherpa();

    const vadConfig = {
      sileroVad: {
        model: this.config.modelPath || undefined,
        threshold: this.config.threshold,
        minSilenceDuration: this.config.silenceDurationMs / 1000,
        minSpeechDuration: 0.1,
        windowSize: this.FRAME_SAMPLES,
      },
      sampleRate: this.SAMPLE_RATE,
      debug: false,
    };

    this.vad = new (sherpa as any).Vad(vadConfig);
  }

  /**
   * Feed a PCM audio chunk (Float32Array, 16kHz mono) and get VAD events.
   * Each chunk should be ~32ms (512 samples at 16kHz).
   */
  process(samples: Float32Array): VadEvent[] {
    if (!this.config.enabled || !this.vad) return [];

    const events: VadEvent[] = [];
    const now = Date.now();

    (this.vad as any).acceptWaveform(samples);

    while ((this.vad as any).isDetected()) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.silenceFrames = 0;
        events.push({
          type: "speech_start",
          timestamp: now,
        });
      }
      (this.vad as any).pop();
    }

    if (this.isSpeaking) {
      const prob = this.getSpeechProbability(samples);
      if (prob < this.config.threshold) {
        this.silenceFrames++;
        if (this.silenceFrames >= this.silenceFramesThreshold) {
          this.isSpeaking = false;
          this.silenceFrames = 0;
          events.push({
            type: "speech_end",
            timestamp: now,
          });
        }
      } else {
        this.silenceFrames = 0;
      }
    }

    return events;
  }

  private getSpeechProbability(samples: Float32Array): number {
    let rms = 0;
    for (let i = 0; i < samples.length; i++) {
      rms += samples[i] * samples[i];
    }
    rms = Math.sqrt(rms / samples.length);
    return Math.min(rms * 10, 1.0);
  }

  get speaking(): boolean {
    return this.isSpeaking;
  }

  reset(): void {
    this.isSpeaking = false;
    this.silenceFrames = 0;
    if (this.vad) {
      try {
        (this.vad as any).reset?.();
      } catch { /* best-effort */ }
    }
  }

  destroy(): void {
    this.vad = null;
  }
}
