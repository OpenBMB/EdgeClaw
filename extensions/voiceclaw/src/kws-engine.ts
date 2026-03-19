/**
 * VoiceClaw KWS Engine — Keyword Spotting via sherpa-onnx-node
 *
 * Always-on wake word detection. Listens for configurable keywords
 * (e.g. "hey claw") and emits detection events.
 */

import type { KwsConfig, KwsEvent } from "./types.js";

let sherpaOnnx: typeof import("sherpa-onnx-node") | null = null;

async function loadSherpa() {
  if (!sherpaOnnx) {
    sherpaOnnx = await import("sherpa-onnx-node");
  }
  return sherpaOnnx;
}

export class KwsEngine {
  private spotter: unknown = null;
  private stream: unknown = null;
  private config: Required<KwsConfig>;
  private readonly SAMPLE_RATE = 16000;

  constructor(config: KwsConfig = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      keywords: config.keywords ?? ["hey claw"],
      threshold: config.threshold ?? 0.5,
      modelPath: config.modelPath ?? "",
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    if (!this.config.modelPath) {
      throw new Error(
        "[VoiceClaw KWS] modelPath is required. Download a keyword spotter model from " +
        "https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models",
      );
    }

    const sherpa = await loadSherpa();

    const kwsConfig = {
      featConfig: {
        sampleRate: this.SAMPLE_RATE,
        featureDim: 80,
      },
      modelConfig: {
        transducer: {
          encoder: `${this.config.modelPath}/encoder-epoch-12-avg-2-chunk-16-left-64.onnx`,
          decoder: `${this.config.modelPath}/decoder-epoch-12-avg-2-chunk-16-left-64.onnx`,
          joiner: `${this.config.modelPath}/joiner-epoch-12-avg-2-chunk-16-left-64.onnx`,
        },
        tokens: `${this.config.modelPath}/tokens.txt`,
        numThreads: 2,
        provider: "cpu",
      },
      keywordsFile: "",
      keywords: this.config.keywords.join("/"),
      keywordsThreshold: this.config.threshold,
    };

    this.spotter = new (sherpa as any).KeywordSpotter(kwsConfig);
    this.stream = (this.spotter as any).createStream();
  }

  /**
   * Feed PCM audio chunk and check for keyword detections.
   */
  process(samples: Float32Array): KwsEvent[] {
    if (!this.config.enabled || !this.spotter || !this.stream) return [];

    const events: KwsEvent[] = [];

    (this.stream as any).acceptWaveform({ sampleRate: this.SAMPLE_RATE, samples });

    while ((this.spotter as any).isReady(this.stream)) {
      (this.spotter as any).decode(this.stream);
    }

    const keyword = (this.spotter as any).getResult(this.stream).keyword;
    if (keyword && keyword.trim()) {
      events.push({
        type: "keyword_detected",
        keyword: keyword.trim(),
        confidence: this.config.threshold,
        timestamp: Date.now(),
      });
    }

    return events;
  }

  reset(): void {
    if (this.spotter && this.stream) {
      this.stream = (this.spotter as any).createStream();
    }
  }

  destroy(): void {
    this.stream = null;
    this.spotter = null;
  }
}
