import { FALLBACK_STATUS_MARKER, FALLBACK_SUMMARY_MARKER } from "../core/constants.js";

export type DerivedTaskOutcome = {
  status: "completed" | "suspended";
  summary: string;
  rawReply: string;
};

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

function extractLastAssistantReply(messages: unknown[]): string | undefined {
  return messages.toReversed().flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }
    const record = message as { role?: unknown; content?: unknown };
    if (record.role !== "assistant") {
      return [];
    }
    const text = extractTextBlock(record.content);
    return text ? [text] : [];
  })[0];
}

function indexOfMarker(text: string, marker: string): number {
  return text.toLowerCase().indexOf(marker.toLowerCase());
}

function buildStatusPattern(): RegExp {
  return new RegExp(`${FALLBACK_STATUS_MARKER}\\s*(completed|suspended)`, "i");
}

function deriveStructuredOutcome(reply: string): DerivedTaskOutcome | undefined {
  const statusPattern = buildStatusPattern();
  const statusMatch = reply.match(statusPattern);
  if (!statusMatch) {
    return undefined;
  }

  const summaryIndex = indexOfMarker(reply, FALLBACK_SUMMARY_MARKER);
  const summary =
    summaryIndex === -1
      ? reply.replace(statusPattern, "").trim()
      : reply.slice(summaryIndex + FALLBACK_SUMMARY_MARKER.length).trim();
  if (!summary) {
    return undefined;
  }

  return {
    status: statusMatch[1]!.toLowerCase() === "suspended" ? "suspended" : "completed",
    summary,
    rawReply: reply,
  };
}

export function deriveTaskOutcomeFromMessages(messages: unknown[]): DerivedTaskOutcome | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }

  const reply = extractLastAssistantReply(messages);
  if (!reply) {
    return undefined;
  }

  return deriveStructuredOutcome(reply) ?? { status: "completed", summary: reply, rawReply: reply };
}
