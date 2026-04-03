const TOKEN_BUDGET = 25_000;
const PER_SKILL_LIMIT = 5_000;

interface BackupEntry {
  content: string;
  lastUsed: number;
  seq: number;
}

export class SkillBackup {
  private store = new Map<string, BackupEntry>();
  private seqCounter = 0;

  record(skillName: string, content: string) {
    this.store.set(skillName, {
      content,
      lastUsed: Date.now(),
      seq: this.seqCounter++,
    });
  }

  getRestorationPayload(): Array<{ name: string; content: string }> {
    if (this.store.size === 0) return [];

    const sorted = [...this.store.entries()].sort(
      (a, b) => b[1].lastUsed - a[1].lastUsed || b[1].seq - a[1].seq,
    );

    let totalTokens = 0;
    const result: Array<{ name: string; content: string }> = [];

    for (const [name, { content }] of sorted) {
      const estimatedTokens = Math.ceil(content.length / 4);
      const capped = Math.min(estimatedTokens, PER_SKILL_LIMIT);
      if (totalTokens + capped > TOKEN_BUDGET) break;

      result.push({
        name,
        content: content.slice(0, PER_SKILL_LIMIT * 4),
      });
      totalTokens += capped;
    }

    return result;
  }

  has(skillName: string): boolean {
    return this.store.has(skillName);
  }

  get size(): number {
    return this.store.size;
  }
}
