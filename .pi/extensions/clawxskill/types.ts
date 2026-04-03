export interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
  tokens: string[];
}

export interface SearchResult {
  skill: SkillMeta;
  score: number;
  source: "bm25" | "embedding" | "model-judge";
}

export interface SearchEngine {
  name: string;
  available: boolean;
  search(query: string): Promise<SearchResult[]>;
}
