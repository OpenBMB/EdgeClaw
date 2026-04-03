export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface StructuredQuestion {
  question: string;
  options: QuestionOption[];
  allowMultiple: boolean;
  timeoutMs: number;
}

export function formatAsTextFallback(q: StructuredQuestion): string {
  const lines = [q.question, ""];

  q.options.forEach((opt, i) => {
    const desc = opt.description ? ` — ${opt.description}` : "";
    lines.push(`${i + 1}. ${opt.label}${desc}`);
  });

  if (q.allowMultiple) {
    lines.push(
      "",
      "(You can select multiple options. Reply with numbers separated by commas, e.g. '1,3')",
    );
  } else {
    lines.push("", "(Reply with the number of your choice)");
  }

  return lines.join("\n");
}

export function parseTextResponse(
  response: string,
  options: QuestionOption[],
  allowMultiple: boolean,
): string[] {
  const cleaned = response.trim();

  // Try matching by option id first
  const byId = options.filter((o) => cleaned.toLowerCase().includes(o.id.toLowerCase()));
  if (byId.length > 0) {
    return allowMultiple ? byId.map((o) => o.id) : [byId[0].id];
  }

  // Try matching by number
  const numbers = cleaned
    .split(/[,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  const selected = numbers
    .filter((n) => n >= 1 && n <= options.length)
    .map((n) => options[n - 1].id);

  if (selected.length > 0) {
    return allowMultiple ? [...new Set(selected)] : [selected[0]];
  }

  // Try fuzzy matching by label
  const byLabel = options.filter((o) => cleaned.toLowerCase().includes(o.label.toLowerCase()));
  if (byLabel.length > 0) {
    return allowMultiple ? byLabel.map((o) => o.id) : [byLabel[0].id];
  }

  return [];
}
