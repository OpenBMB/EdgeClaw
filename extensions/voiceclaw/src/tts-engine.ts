/**
 * VoiceClaw TTS Engine — Text-to-Speech via sherpa-onnx-node or edge-tts
 *
 * Supports multiple backends:
 *   - sherpa-vits: VITS models via sherpa-onnx (fully local)
 *   - sherpa-matcha: MatchaTTS via sherpa-onnx (fully local)
 *   - edge-tts: Microsoft Edge TTS (cloud, no API key needed, default)
 *   - cloud: OpenClaw core TTS (ElevenLabs/OpenAI)
 *
 * Privacy: S3 responses use local TTS to prevent voice data leaking to cloud.
 */

import type { TtsConfig, TtsChunk, SensitivityLevel } from "./types.js";

let sherpaOnnx: typeof import("sherpa-onnx-node") | null = null;

async function loadSherpa() {
  if (!sherpaOnnx) {
    sherpaOnnx = await import("sherpa-onnx-node");
  }
  return sherpaOnnx;
}

export class TtsEngine {
  private tts: unknown = null;
  private config: Required<TtsConfig>;
  private readonly DEFAULT_SAMPLE_RATE = 16000;

  constructor(config: TtsConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      provider: config.provider ?? "edge-tts",
      modelPath: config.modelPath ?? "",
      voice: config.voice ?? "",
      sampleRate: config.sampleRate ?? this.DEFAULT_SAMPLE_RATE,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.config.provider === "edge-tts" || this.config.provider === "cloud") return;

    if (!this.config.modelPath) {
      throw new Error(
        `[VoiceClaw TTS] modelPath is required for ${this.config.provider}. ` +
        "Download models from https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
      );
    }

    const sherpa = await loadSherpa();
    const ttsConfig = this.buildTtsConfig();
    this.tts = new (sherpa as any).OfflineTts(ttsConfig);
  }

  private buildTtsConfig(): Record<string, unknown> {
    switch (this.config.provider) {
      case "sherpa-vits":
        return {
          modelConfig: {
            vits: {
              model: `${this.config.modelPath}/model.onnx`,
              tokens: `${this.config.modelPath}/tokens.txt`,
              lexicon: `${this.config.modelPath}/lexicon.txt`,
              dataDir: `${this.config.modelPath}/espeak-ng-data`,
            },
            numThreads: 2,
            provider: "cpu",
            debug: false,
          },
          maxNumSentences: 1,
        };

      case "sherpa-matcha":
        return {
          modelConfig: {
            matcha: {
              acousticModel: `${this.config.modelPath}/model-steps-3.onnx`,
              vocoder: `${this.config.modelPath}/hifigan_v2.onnx`,
              tokens: `${this.config.modelPath}/tokens.txt`,
              lexicon: `${this.config.modelPath}/lexicon.txt`,
              dataDir: `${this.config.modelPath}/espeak-ng-data`,
            },
            numThreads: 2,
            provider: "cpu",
            debug: false,
          },
          maxNumSentences: 1,
        };

      default:
        throw new Error(`[VoiceClaw TTS] No sherpa config for provider: ${this.config.provider}`);
    }
  }

  /**
   * Synthesize speech from text.
   *
   * @param text - Text to synthesize
   * @param privacyLevel - Current privacy level; S3 forces local TTS
   * @returns Array of audio chunks
   */
  async synthesize(
    text: string,
    privacyLevel: SensitivityLevel = "S1",
  ): Promise<TtsChunk[]> {
    if (!this.config.enabled || !text.trim()) return [];

    const forceLocal = privacyLevel === "S3";

    if (!forceLocal && this.config.provider === "edge-tts") {
      return this.synthesizeEdgeTts(text);
    }

    if (!forceLocal && this.config.provider === "cloud") {
      return []; // handled by OpenClaw core TTS
    }

    return this.synthesizeLocal(text);
  }

  private async synthesizeLocal(text: string): Promise<TtsChunk[]> {
    if (!this.tts) return [];

    const result = (this.tts as any).generate({
      text,
      sid: 0,
      speed: 1.0,
    });

    if (!result || !result.samples || result.samples.length === 0) return [];

    const samples = result.samples as Float32Array;
    const sampleRate = result.sampleRate as number;
    const buffer = Buffer.from(samples.buffer);

    return [{
      audio: buffer,
      sampleRate,
      isLast: true,
    }];
  }

  private async synthesizeEdgeTts(text: string): Promise<TtsChunk[]> {
    // edge-tts integration: uses the same node-edge-tts that OpenClaw core uses.
    // For the initial version, we generate the audio and return it as chunks.
    try {
      const { MsEdgeTTS } = await import("node-edge-tts" as any);
      const edgeTts = new MsEdgeTTS();
      const voice = this.config.voice || "zh-CN-XiaoxiaoNeural";
      await edgeTts.setMetadata(voice, "audio-16khz-32kbitrate-mono-mp3");

      const readable = edgeTts.toStream(text);
      const audioChunks: Buffer[] = [];

      return new Promise((resolve) => {
        readable.on("data", (chunk: Buffer) => {
          audioChunks.push(chunk);
        });
        readable.on("end", () => {
          if (audioChunks.length === 0) {
            resolve([]);
            return;
          }
          const combined = Buffer.concat(audioChunks);
          resolve([{
            audio: combined,
            sampleRate: this.config.sampleRate,
            isLast: true,
          }]);
        });
        readable.on("error", () => {
          resolve([]);
        });
      });
    } catch {
      return [];
    }
  }

  destroy(): void {
    this.tts = null;
  }
}
