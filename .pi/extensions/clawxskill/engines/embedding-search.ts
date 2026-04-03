import type { SearchEngine, SearchResult } from "../types.js";

export interface EmbeddingConfig {
  provider?: "google" | "openai" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Embedding vector search engine.
 *
 * Enabled when config.embedding has both provider and apiKey.
 * Currently a stub — search() returns [] but `available` reflects config.
 *
 * TODO: Implement actual embedding logic:
 * - Pre-compute skill embeddings at init
 * - On search: embed query, cosine similarity against cached vectors
 * - Incremental update on chokidar change
 */
export class EmbeddingSearch implements SearchEngine {
  readonly name = "embedding";
  readonly available: boolean;
  private config: EmbeddingConfig;

  constructor(cfg?: EmbeddingConfig) {
    this.config = cfg ?? {};
    this.available = !!(this.config.apiKey && this.config.provider);
  }

  async init(): Promise<void> {
    // TODO: pre-compute skill embedding vectors using this.config
  }

  async search(_query: string): Promise<SearchResult[]> {
    // TODO: embed query → cosine similarity → return ranked results
    return [];
  }
}
