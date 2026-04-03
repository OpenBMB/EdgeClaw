export function truncate(text: string, maxLength: number): string {
  if (!text) return "";
  if (maxLength <= 0 || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function scoreMatch(query: string, text: string): number {
  const q = normalizeText(query).toLowerCase();
  const t = normalizeText(text).toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.92;
  if (t.includes(q)) return 0.82;

  const qWords = q.split(" ").filter(Boolean);
  if (qWords.length === 0) return 0;
  let hits = 0;
  for (const word of qWords) {
    if (t.includes(word)) hits += 1;
  }
  const wordScore = hits / qWords.length * 0.7;

  const qCompact = q.replace(/\s+/g, "");
  const tCompact = t.replace(/\s+/g, "");
  if (qCompact.length < 2 || tCompact.length < 2) return wordScore;

  let gramHits = 0;
  let grams = 0;
  for (let i = 0; i < qCompact.length - 1; i += 1) {
    const gram = qCompact.slice(i, i + 2);
    grams += 1;
    if (tCompact.includes(gram)) gramHits += 1;
  }
  const gramScore = grams > 0 ? (gramHits / grams) * 0.75 : 0;
  return Math.max(wordScore, gramScore);
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
