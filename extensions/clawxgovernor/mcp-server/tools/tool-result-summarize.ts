export function toolResultSummarize(
  text: string,
  maxLength?: number,
): { summary: string; originalLength: number; compressionRatio: number } {
  const target = maxLength ?? 500;
  const originalLength = text.length;
  if (originalLength <= target) return { summary: text, originalLength, compressionRatio: 1.0 };

  const headBudget = Math.floor(target * 0.4);
  const tailBudget = Math.floor(target * 0.2);
  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  const lines = text.split("\n").length;
  const meta = `\n\n--- [Summarized: ${originalLength} chars, ${lines} lines → ${target} char target] ---\n\n`;
  const summary = head + meta + tail;

  return {
    summary,
    originalLength,
    compressionRatio: Math.round((summary.length / originalLength) * 1000) / 1000,
  };
}
