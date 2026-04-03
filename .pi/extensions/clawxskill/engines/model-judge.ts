import type { SearchEngine, SearchResult } from "../types.js";

export interface ModelJudgeConfig {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Small model judge search engine.
 *
 * Enabled when config.modelJudge has both provider and apiKey.
 * Currently a stub — search() returns [] but `available` reflects config.
 *
 * TODO: Implement actual judge logic:
 * - Call chat completion with a judge prompt listing all skill names + descriptions
 * - Parse model output for top-N matching skill names
 * - 3s timeout via Promise.race
 *
 * Recommended models (cheapest first):
 *   gemini-2.0-flash-lite, gpt-4.1-nano, groq/llama-3.1-8b-instant
 */
export class ModelJudge implements SearchEngine {
  readonly name = "model-judge";
  readonly available: boolean;
  private config: ModelJudgeConfig;

  constructor(cfg?: ModelJudgeConfig) {
    this.config = cfg ?? {};
    this.available = !!(this.config.apiKey && this.config.provider);
  }

  async init(): Promise<void> {
    // TODO: validate config, warm up connection
  }

  async search(_query: string): Promise<SearchResult[]> {
    // TODO: call small model with judge prompt → parse skill names → return results
    return [];
  }
}
