/**
 * VoiceClaw ASR Engine — Speech-to-Text via sherpa-onnx-node
 *
 * Supports multiple backends:
 *   - sherpa-sensevoice: SenseVoice (recommended for Chinese + multilingual)
 *   - sherpa-whisper: Whisper (good general-purpose)
 *   - sherpa-paraformer: Paraformer (fast, Chinese-focused)
 *   - cloud-whisper: OpenAI Whisper API (S1 only, requires API key)
 *
 * Privacy integration: forces local ASR for S2/S3 sensitivity levels.
 */

import type { AsrConfig, AsrResult, SensitivityLevel } from "./types.js";

let sherpaOnnx: typeof import("sherpa-onnx-node") | null = null;

async function loadSherpa() {
  if (!sherpaOnnx) {
    sherpaOnnx = await import("sherpa-onnx-node");
  }
  return sherpaOnnx;
}

export class AsrEngine {
  private recognizer: unknown = null;
  private config: Required<AsrConfig>;
  private readonly SAMPLE_RATE = 16000;

  constructor(config: AsrConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      provider: config.provider ?? "sherpa-sensevoice",
      modelPath: config.modelPath ?? "",
      language: config.language ?? "auto",
      cloudFallback: config.cloudFallback ?? true,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.config.provider === "cloud-whisper") return; // no local init needed

    if (!this.config.modelPath) {
      throw new Error(
        `[VoiceClaw ASR] modelPath is required for ${this.config.provider}. ` +
        "Download models from https://github.com/k2-fsa/sherpa-onnx/releases",
      );
    }

    const sherpa = await loadSherpa();
    const modelConfig = this.buildModelConfig();

    this.recognizer = new (sherpa as any).OfflineRecognizer(modelConfig);
  }

  private buildModelConfig(): Record<string, unknown> {
    const base = {
      featConfig: { sampleRate: this.SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        numThreads: 2,
        provider: "cpu",
        debug: false,
      },
    };

    switch (this.config.provider) {
      case "sherpa-sensevoice":
        return {
          ...base,
          modelConfig: {
            ...base.modelConfig,
            senseVoice: {
              model: `${this.config.modelPath}/model.int8.onnx`,
              useInverseTextNormalization: true,
              language: this.config.language === "auto" ? "" : this.config.language,
            },
            tokens: `${this.config.modelPath}/tokens.txt`,
          },
        };

      case "sherpa-whisper":
        return {
          ...base,
          modelConfig: {
            ...base.modelConfig,
            whisper: {
              encoder: `${this.config.modelPath}/encoder.int8.onnx`,
              decoder: `${this.config.modelPath}/decoder.int8.onnx`,
              language: this.config.language === "auto" ? "" : this.config.language,
            },
            tokens: `${this.config.modelPath}/tokens.txt`,
          },
        };

      case "sherpa-paraformer":
        return {
          ...base,
          modelConfig: {
            ...base.modelConfig,
            paraformer: {
              model: `${this.config.modelPath}/model.int8.onnx`,
            },
            tokens: `${this.config.modelPath}/tokens.txt`,
          },
        };

      default:
        throw new Error(`[VoiceClaw ASR] Unknown provider: ${this.config.provider}`);
    }
  }

  /**
   * Recognize speech from a complete audio buffer.
   *
   * @param samples - Float32Array of PCM audio (16kHz mono)
   * @param privacyLevel - Current privacy level; S2/S3 forces local ASR
   */
  async recognize(
    samples: Float32Array,
    privacyLevel: SensitivityLevel = "S1",
  ): Promise<AsrResult> {
    if (!this.config.enabled) {
      return { text: "", latencyMs: 0, provider: "local", privacyForced: false };
    }

    const start = Date.now();
    const forceLocal = privacyLevel !== "S1";

    if (!forceLocal && this.config.provider === "cloud-whisper") {
      return this.recognizeCloud(samples, start);
    }

    if (!forceLocal && this.config.cloudFallback && !this.recognizer) {
      return this.recognizeCloud(samples, start);
    }

    return this.recognizeLocal(samples, start, forceLocal);
  }

  private async recognizeLocal(
    samples: Float32Array,
    startTime: number,
    privacyForced: boolean,
  ): Promise<AsrResult> {
    if (!this.recognizer) {
      return {
        text: "",
        latencyMs: Date.now() - startTime,
        provider: "local",
        privacyForced,
      };
    }

    const stream = (this.recognizer as any).createStream();
    stream.acceptWaveform({ sampleRate: this.SAMPLE_RATE, samples });
    (this.recognizer as any).decode(stream);

    const text = (this.recognizer as any).getResult(stream).text?.trim() ?? "";

    return {
      text,
      latencyMs: Date.now() - startTime,
      provider: "local",
      privacyForced,
    };
  }

  private async recognizeCloud(
    _samples: Float32Array,
    startTime: number,
  ): Promise<AsrResult> {
    // Cloud ASR would call OpenAI Whisper API here.
    // For now, return a placeholder — the actual implementation would use
    // the OpenClaw runtime's stt.transcribeAudioFile() method.
    return {
      text: "[cloud ASR not yet implemented — configure local model]",
      latencyMs: Date.now() - startTime,
      provider: "cloud",
      privacyForced: false,
    };
  }

  destroy(): void {
    this.recognizer = null;
  }
}
