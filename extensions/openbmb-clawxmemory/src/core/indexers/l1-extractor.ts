import type { L0SessionRecord, L1WindowRecord, MemoryMessage } from "../types.js";
import { buildL1IndexId, nowIso } from "../utils/id.js";
import { LlmMemoryExtractor } from "../skills/llm-extraction.js";

function sameMessage(left: MemoryMessage | undefined, right: MemoryMessage | undefined): boolean {
  if (!left || !right) return false;
  return left.role === right.role && left.content === right.content;
}

function startsWithMessages(list: MemoryMessage[], prefix: MemoryMessage[]): boolean {
  if (prefix.length > list.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (!sameMessage(list[index], prefix[index])) return false;
  }
  return true;
}

function findOverlap(existing: MemoryMessage[], incoming: MemoryMessage[]): number {
  const max = Math.min(existing.length, incoming.length);
  for (let size = max; size > 0; size -= 1) {
    let matched = true;
    for (let index = 0; index < size; index += 1) {
      if (!sameMessage(existing[existing.length - size + index], incoming[index])) {
        matched = false;
        break;
      }
    }
    if (matched) return size;
  }
  return 0;
}

function dedupeAdjacentMessages(messages: MemoryMessage[]): MemoryMessage[] {
  const merged: MemoryMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (sameMessage(previous, message)) continue;
    merged.push(message);
  }
  return merged;
}

function mergeMessageStream(existing: MemoryMessage[], incoming: MemoryMessage[]): MemoryMessage[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return dedupeAdjacentMessages(incoming);
  if (startsWithMessages(incoming, existing)) return dedupeAdjacentMessages(incoming);
  if (startsWithMessages(existing, incoming)) return dedupeAdjacentMessages(existing);
  const overlap = findOverlap(existing, incoming);
  return dedupeAdjacentMessages([...existing, ...incoming.slice(overlap)]);
}

function mergeWindowMessages(records: L0SessionRecord[]): MemoryMessage[] {
  return records.reduce<MemoryMessage[]>((combined, record) => mergeMessageStream(combined, record.messages), []);
}

function buildTimePeriod(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "unknown";
  const yyyyMmDd = (date: Date): string => date.toISOString().slice(0, 10);
  const hhMm = (date: Date): string =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (yyyyMmDd(start) === yyyyMmDd(end)) {
    return `${yyyyMmDd(start)} ${hhMm(start)}-${hhMm(end)}`;
  }
  return `${yyyyMmDd(start)} ${hhMm(start)} -> ${yyyyMmDd(end)} ${hhMm(end)}`;
}

export async function extractL1FromWindow(
  records: L0SessionRecord[],
  extractor: LlmMemoryExtractor,
): Promise<L1WindowRecord> {
  if (records.length === 0) {
    throw new Error("Cannot build L1 window from empty L0 records");
  }
  const ordered = [...records].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const startedAt = ordered[0]!.timestamp;
  const endedAt = ordered[ordered.length - 1]!.timestamp;
  const mergedMessages = mergeWindowMessages(ordered);
  const extracted = await extractor.extract({
    timestamp: endedAt,
    messages: mergedMessages,
  });
  const l0Source = ordered.map((record) => record.l0IndexId);
  const l1IndexId = buildL1IndexId(startedAt, l0Source);
  return {
    l1IndexId,
    sessionKey: ordered[0]!.sessionKey,
    timePeriod: buildTimePeriod(startedAt, endedAt),
    startedAt,
    endedAt,
    summary: extracted.summary,
    facts: extracted.facts,
    situationTimeInfo: extracted.situationTimeInfo,
    projectTags: extracted.projectDetails.map((item) => item.name),
    projectDetails: extracted.projectDetails,
    l0Source,
    createdAt: nowIso(),
  };
}

export async function extractL1FromL0(
  record: L0SessionRecord,
  extractor: LlmMemoryExtractor,
): Promise<L1WindowRecord> {
  return extractL1FromWindow([record], extractor);
}
