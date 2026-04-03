import type { SearchEngine, SearchResult, SkillMeta } from "../types.js";

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, " ");
  const tokens: string[] = [];

  for (const part of raw.split(/\s+/)) {
    if (!part) continue;

    // Split CJK runs into bigrams for better matching
    const cjkRuns = part.match(/[\u4e00-\u9fff]+/g);
    const asciiRuns = part.match(/[a-z0-9_]+/g);

    if (cjkRuns) {
      for (const run of cjkRuns) {
        if (run.length <= 2) {
          tokens.push(run);
        } else {
          for (let i = 0; i < run.length - 1; i++) {
            tokens.push(run.slice(i, i + 2));
          }
        }
      }
    }

    if (asciiRuns) {
      for (const run of asciiRuns) {
        if (run.length > 1) tokens.push(run);
      }
    }
  }

  return tokens;
}

export class InvertedIndex implements SearchEngine {
  readonly name = "bm25";
  readonly available = true;

  private index = new Map<string, SkillMeta[]>();
  private allSkills: SkillMeta[] = [];
  private avgDocLen = 0;

  build(skills: SkillMeta[]) {
    this.allSkills = skills;
    this.index.clear();
    let totalTokens = 0;

    for (const skill of skills) {
      totalTokens += skill.tokens.length;
      const uniqueTokens = new Set(skill.tokens);
      for (const token of uniqueTokens) {
        const list = this.index.get(token);
        if (list) {
          list.push(skill);
        } else {
          this.index.set(token, [skill]);
        }
      }
    }

    this.avgDocLen = skills.length > 0 ? totalTokens / skills.length : 0;
  }

  addSkill(skill: SkillMeta) {
    this.allSkills.push(skill);
    const uniqueTokens = new Set(skill.tokens);
    for (const token of uniqueTokens) {
      const list = this.index.get(token);
      if (list) {
        list.push(skill);
      } else {
        this.index.set(token, [skill]);
      }
    }
    this.recalcAvgDocLen();
  }

  removeSkill(name: string) {
    this.allSkills = this.allSkills.filter((s) => s.name !== name);
    for (const [token, skills] of this.index) {
      const filtered = skills.filter((s) => s.name !== name);
      if (filtered.length === 0) {
        this.index.delete(token);
      } else {
        this.index.set(token, filtered);
      }
    }
    this.recalcAvgDocLen();
  }

  private recalcAvgDocLen() {
    const total = this.allSkills.reduce((s, sk) => s + sk.tokens.length, 0);
    this.avgDocLen = this.allSkills.length > 0 ? total / this.allSkills.length : 0;
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.searchSync(query);
  }

  searchSync(query: string): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = this.allSkills.length;
    if (N === 0) return [];

    const k1 = 1.2;
    const b = 0.75;
    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const matchingSkills = this.index.get(token);
      if (!matchingSkills) continue;

      const df = matchingSkills.length;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const skill of matchingSkills) {
        const tf = skill.tokens.filter((t) => t === token).length;
        const dl = skill.tokens.length;
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / this.avgDocLen));
        scores.set(skill.name, (scores.get(skill.name) || 0) + idf * tfNorm);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, score]) => ({
        skill: this.allSkills.find((s) => s.name === name)!,
        score,
        source: "bm25" as const,
      }))
      .filter((r) => r.skill);
  }

  getSkillCount(): number {
    return this.allSkills.length;
  }

  getSkill(name: string): SkillMeta | undefined {
    return this.allSkills.find((s) => s.name === name);
  }
}
