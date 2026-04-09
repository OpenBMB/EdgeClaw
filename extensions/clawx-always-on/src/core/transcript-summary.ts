function extractTextBlock(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const record = block as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" ? [record.text.trim()] : [];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeMessageRecord(
  message: unknown,
): { role?: string; content?: unknown } | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const direct = message as { role?: unknown; content?: unknown };
  if (typeof direct.role === "string") {
    return {
      role: direct.role,
      content: direct.content,
    };
  }

  const transcriptEntry = message as { message?: unknown };
  if (!transcriptEntry.message || typeof transcriptEntry.message !== "object") {
    return undefined;
  }
  const nested = transcriptEntry.message as { role?: unknown; content?: unknown };
  if (typeof nested.role !== "string") {
    return undefined;
  }
  return {
    role: nested.role,
    content: nested.content,
  };
}

function truncateText(value: string, maxChars = 320): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

export function summarizeTranscriptMessages(messages: unknown[], limit = 10): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }

  const lines = messages
    .map((message) => normalizeMessageRecord(message))
    .filter((record): record is { role: string; content?: unknown } => Boolean(record?.role))
    .flatMap((record) => {
      const role = record.role === "toolResult" ? "tool" : record.role;
      if (role !== "user" && role !== "assistant" && role !== "tool") {
        return [];
      }
      const text = extractTextBlock(record.content);
      if (!text) {
        return [];
      }
      return [`- ${role}: ${truncateText(text)}`];
    })
    .slice(-limit);

  return lines.length > 0 ? lines.join("\n") : undefined;
}
