import type {
  GlobalProfileRecord,
  IndexingSettings,
  L0SearchResult,
  L0SessionRecord,
  L1SearchResult,
  L1WindowRecord,
  L2SearchResult,
  MemoryMessage,
  RetrievalPromptDebug,
  RetrievalTraceDetail,
  RetrievalTrace,
  RetrievalTraceStep,
  RetrievalResult,
  RecallMode,
} from "../types.js";
import {
  LlmMemoryExtractor,
  type L2CatalogEntry,
  type LookupQuerySpec,
} from "../skills/llm-extraction.js";
import { MemoryRepository } from "../storage/sqlite.js";
import { hashText, nowIso } from "../utils/id.js";
import { truncate } from "../utils/text.js";
import type { SkillsRuntime } from "../skills/types.js";

const RECALL_CACHE_TTL_MS = 30_000;
const DEFAULT_RECALL_TOP_K = 10;

export interface RetrievalOptions {
  l2Limit?: number;
  l1Limit?: number;
  l0Limit?: number;
  includeFacts?: boolean;
  retrievalMode?: "auto" | "explicit";
  recentMessages?: MemoryMessage[];
}

export interface RetrievalRuntimeOptions {
  getSettings?: () => IndexingSettings;
  isBackgroundBusy?: () => boolean;
}

export interface RetrievalRuntimeStats {
  lastRecallMs: number;
  recallTimeouts: number;
  lastRecallMode: RecallMode;
  lastRecallPath: "auto" | "explicit" | "shadow";
  lastRecallBudgetLimited: boolean;
  lastShadowDeepQueued: boolean;
  lastRecallInjected: boolean;
  lastRecallEnoughAt: RetrievalResult["enoughAt"];
  lastRecallCacheHit: boolean;
}

interface RecallCacheEntry {
  expiresAt: number;
  result: RetrievalResult;
}

interface RetrieveExecutionOptions {
  retrievalMode: "auto" | "explicit";
  updateRuntimeStats: boolean;
  savePrimaryCache: boolean;
}

interface LocalFallbackCandidates {
  profile: GlobalProfileRecord | null;
  l2: L2SearchResult[];
  truncated: boolean;
}

interface PackedL2Catalog {
  entries: L2CatalogEntry[];
  byId: Map<string, L2SearchResult>;
  truncated: boolean;
}

interface RecallLimits {
  l2: number;
  l1: number;
  l0: number;
}

function renderProfile(profile: GlobalProfileRecord | null): string {
  if (!profile?.profileText.trim()) return "";
  return ["## Global Profile", profile.profileText.trim()].join("\n");
}

function renderEvidenceNote(note: string): string {
  if (!note.trim()) return "";
  return ["## Evidence Note", note.trim()].join("\n");
}

function renderL2(results: L2SearchResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = ["## L2 Indexes"];
  for (const hit of results) {
    if (hit.level === "l2_time") {
      lines.push(`- [time:${hit.item.dateKey}] ${truncate(hit.item.summary, 180)}`);
      continue;
    }
    lines.push(`- [project:${hit.item.projectName}] status=${hit.item.currentStatus} | ${truncate(hit.item.latestProgress || hit.item.summary, 140)}`);
  }
  return lines.join("\n");
}

function renderL1(results: L1SearchResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = ["## L1 Windows"];
  for (const hit of results) {
    lines.push(`- [${hit.item.timePeriod}] ${truncate(hit.item.summary, 180)}`);
  }
  return lines.join("\n");
}

function renderL0(results: L0SearchResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = ["## L0 Raw Sessions"];
  for (const hit of results) {
    lines.push(`- [${hit.item.timestamp}]`);
    for (const message of hit.item.messages.slice(-4)) {
      lines.push(`  ${message.role}: ${truncate(message.content, 260)}`);
    }
  }
  return lines.join("\n");
}

function renderContextTemplate(
  template: string,
  input: {
    intent: RetrievalResult["intent"];
    enoughAt: RetrievalResult["enoughAt"];
    profileBlock: string;
    evidenceNoteBlock: string;
    l2Block: string;
    l1Block: string;
    l0Block: string;
  },
): string {
  let content = template;
  content = content.replaceAll("{{intent}}", input.intent);
  content = content.replaceAll("{{enoughAt}}", input.enoughAt);
  content = content.replaceAll("{{profileBlock}}", input.profileBlock);
  content = content.replaceAll("{{evidenceNoteBlock}}", input.evidenceNoteBlock);
  content = content.replaceAll("{{l2Block}}", input.l2Block);
  content = content.replaceAll("{{l1Block}}", input.l1Block);
  content = content.replaceAll("{{l0Block}}", input.l0Block);
  return content.trim();
}

function toRankScore(index: number): number {
  return Math.max(0.1, 1 - index * 0.12);
}

function normalizeQueryKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message));
}

function withDebug(result: RetrievalResult, debug: RetrievalResult["debug"]): RetrievalResult {
  return debug ? { ...result, debug } : result;
}

function buildTraceId(prefix: string, seed: string): string {
  return `${prefix}_${hashText(`${seed}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`)}`;
}

function previewText(value: string, max = 220): string {
  return truncate(value.trim(), max);
}

function asDisplayText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function textDetail(key: string, label: string, text: string): RetrievalTraceDetail {
  return { key, label, kind: "text", text };
}

function noteDetail(key: string, label: string, text: string): RetrievalTraceDetail {
  return { key, label, kind: "note", text };
}

function listDetail(key: string, label: string, items: string[]): RetrievalTraceDetail {
  return { key, label, kind: "list", items };
}

function kvDetail(
  key: string,
  label: string,
  entries: Array<{ label: string; value: unknown }>,
): RetrievalTraceDetail {
  return {
    key,
    label,
    kind: "kv",
    entries: entries
      .map((entry) => ({ label: entry.label, value: asDisplayText(entry.value) }))
      .filter((entry) => entry.value),
  };
}

function jsonDetail(key: string, label: string, json: unknown): RetrievalTraceDetail {
  return { key, label, kind: "json", json };
}

function describeL2Result(hit: L2SearchResult): string {
  return hit.level === "l2_time"
    ? `${hit.item.l2IndexId} · ${hit.item.dateKey} · ${previewText(hit.item.summary, 180)}`
    : `${hit.item.l2IndexId} · ${hit.item.projectName} · status=${hit.item.currentStatus} · ${previewText(hit.item.latestProgress || hit.item.summary, 180)}`;
}

function describeL1Result(item: L1WindowRecord): string {
  const projects = item.projectDetails.map((project) => project.name).filter(Boolean).slice(0, 4).join(", ");
  return `${item.l1IndexId} · ${item.timePeriod} · ${previewText(item.summary, 140)}${projects ? ` · projects=${projects}` : ""}`;
}

function describeL0Result(item: L0SessionRecord): string {
  const preview = item.messages.slice(-2).map((message) => `${message.role}: ${previewText(message.content, 120)}`).join(" | ");
  return `${item.l0IndexId} · ${item.timestamp}${preview ? ` · ${preview}` : ""}`;
}

function buildLookupQueryItems(lookupQueries: LookupQuerySpec[]): string[] {
  return lookupQueries.map((entry) => {
    const route = entry.targetTypes.join("+") || "time+project";
    const range = entry.timeRange ? ` [${entry.timeRange.startDate}..${entry.timeRange.endDate}]` : "";
    return `${route} · ${entry.lookupQuery || "(same as query)"}${range}`;
  });
}

function summarizeLookupQueries(lookupQueries: LookupQuerySpec[]): string {
  if (lookupQueries.length === 0) return "No structured lookup queries.";
  return lookupQueries
    .map((entry) => {
      const route = entry.targetTypes.join("+") || "time+project";
      const range = entry.timeRange ? ` [${entry.timeRange.startDate}..${entry.timeRange.endDate}]` : "";
      return `${route}: ${entry.lookupQuery || "(same as query)"}${range}`;
    })
    .join(" | ");
}

function summarizeL2Results(results: L2SearchResult[]): string {
  if (results.length === 0) return "No L2 candidates.";
  return results
    .map((hit) => hit.level === "l2_time"
      ? `${hit.item.dateKey}`
      : `${hit.item.projectName} (${hit.item.currentStatus})`)
    .join(" | ");
}

function summarizeL1Windows(results: L1WindowRecord[]): string {
  if (results.length === 0) return "No L1 candidates.";
  return results.map((item) => `${item.l1IndexId} · ${item.timePeriod}`).join(" | ");
}

function summarizeL0Sessions(results: L0SessionRecord[]): string {
  if (results.length === 0) return "No L0 candidates.";
  return results.map((item) => `${item.l0IndexId} · ${item.timestamp}`).join(" | ");
}

function createRetrievalTrace(query: string, mode: "auto" | "explicit"): RetrievalTrace {
  const startedAt = nowIso();
  return {
    traceId: buildTraceId("trace", `${mode}:${query}`),
    query,
    mode,
    startedAt,
    finishedAt: startedAt,
    steps: [],
  };
}

function appendTraceStep(
  trace: RetrievalTrace,
  step: Omit<RetrievalTraceStep, "stepId">,
): void {
  trace.steps.push({
    ...step,
    stepId: `${trace.traceId}:step:${trace.steps.length + 1}`,
  });
}

function finishTrace(trace: RetrievalTrace): RetrievalTrace {
  return {
    ...trace,
    finishedAt: nowIso(),
    steps: trace.steps.map((step) => ({
      ...step,
      ...(step.refs ? { refs: { ...step.refs } } : {}),
      ...(step.metrics ? { metrics: { ...step.metrics } } : {}),
      ...(step.details ? { details: structuredClone(step.details) } : {}),
      ...(step.promptDebug ? { promptDebug: structuredClone(step.promptDebug) } : {}),
    })),
  };
}

function attachTrace(result: RetrievalResult, trace: RetrievalTrace): RetrievalResult {
  return {
    ...result,
    trace: finishTrace(trace),
  };
}

function summarizeCorrections(corrections: string[] | undefined): string {
  if (!corrections || corrections.length === 0) return "No corrections.";
  return corrections.join(" | ");
}

function appendContextRenderedStep(trace: RetrievalTrace, result: RetrievalResult): void {
  const injected = Boolean(result.context.trim());
  appendTraceStep(trace, {
    kind: "context_rendered",
    title: "Context Rendered",
    status: injected ? "success" : "skipped",
    inputSummary: `intent=${result.intent} · enoughAt=${result.enoughAt}`,
    outputSummary: injected
      ? `Injected ${result.context.length} chars. ${previewText(result.context, 260)}`
      : "No context injected.",
    refs: {
      intent: result.intent,
      enoughAt: result.enoughAt,
      injected,
    },
    metrics: {
      contextChars: result.context.length,
      l2Count: result.l2Results.length,
      l1Count: result.l1Results.length,
      l0Count: result.l0Results.length,
    },
    details: [
      kvDetail("final-state", "Final State", [
        { label: "intent", value: result.intent },
        { label: "enoughAt", value: result.enoughAt },
        { label: "injected", value: injected ? "true" : "false" },
      ]),
      ...(result.evidenceNote.trim() ? [noteDetail("final-note", "Final Evidence Note", result.evidenceNote)] : []),
      ...(injected ? [textDetail("context-preview", "Injected Context Preview", result.context)] : []),
      kvDetail("level-counts", "Rendered Evidence Counts", [
        { label: "L2", value: result.l2Results.length },
        { label: "L1", value: result.l1Results.length },
        { label: "L0", value: result.l0Results.length },
      ]),
    ],
  });
}

function appendRecallSkippedStep(
  trace: RetrievalTrace,
  reason: string,
  outputSummary: string,
  refs?: Record<string, unknown>,
): void {
  appendTraceStep(trace, {
    kind: "recall_skipped",
    title: "Recall Skipped",
    status: "skipped",
    inputSummary: `reason=${reason}`,
    outputSummary,
    ...(refs ? { refs } : {}),
    details: [
      kvDetail("skip-reason", "Skip Reason", [
        { label: "reason", value: reason },
      ]),
      ...(refs ? [jsonDetail("skip-refs", "Skip Metadata", refs)] : []),
    ],
  });
}

function appendFallbackStep(
  trace: RetrievalTrace,
  corrections: string[],
  result: RetrievalResult,
): void {
  appendTraceStep(trace, {
    kind: "fallback_applied",
    title: "Fallback Applied",
    status: "warning",
    inputSummary: summarizeCorrections(corrections),
    outputSummary: previewText(result.evidenceNote || result.context || "No fallback evidence.", 260),
    refs: {
      enoughAt: result.enoughAt,
      corrections,
    },
    metrics: {
      l2Count: result.l2Results.length,
      l1Count: result.l1Results.length,
      l0Count: result.l0Results.length,
    },
    details: [
      listDetail("fallback-corrections", "Fallback Reasons", corrections),
      ...(result.evidenceNote.trim() ? [noteDetail("fallback-note", "Fallback Evidence Note", result.evidenceNote)] : []),
      kvDetail("fallback-levels", "Fallback Result", [
        { label: "enoughAt", value: result.enoughAt },
        { label: "L2", value: result.l2Results.length },
        { label: "L1", value: result.l1Results.length },
        { label: "L0", value: result.l0Results.length },
      ]),
    ],
  });
}

function uniqueById<T>(items: T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(item);
  }
  return next;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function buildLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10) || "unknown";
  return formatLocalDateKey(date);
}

function parseDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function enumerateRecentDateKeys(
  startDate: string,
  endDate: string,
  maxDays: number,
): { dateKeys: string[]; truncated: boolean } {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || maxDays <= 0) return { dateKeys: [], truncated: false };

  const cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const floor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const dateKeys: string[] = [];
  let truncated = false;

  while (cursor.getTime() >= floor.getTime()) {
    dateKeys.push(formatLocalDateKey(cursor));
    if (dateKeys.length >= maxDays) {
      truncated = cursor.getTime() > floor.getTime();
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return { dateKeys, truncated };
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function coerceEnoughAt(
  enoughAt: RetrievalResult["enoughAt"],
  input: { l2: number; l1: number; l0: number },
): RetrievalResult["enoughAt"] {
  if (enoughAt === "profile" && input.l2 === 0 && input.l1 === 0 && input.l0 === 0) return "profile";
  if (enoughAt === "l0" && input.l0 > 0) return "l0";
  if (enoughAt === "l1" && input.l1 > 0) return "l1";
  if (enoughAt === "l2" && input.l2 > 0) return "l2";
  if (input.l0 > 0) return "l0";
  if (input.l1 > 0) return "l1";
  if (input.l2 > 0) return "l2";
  return "none";
}

export class ReasoningRetriever {
  private readonly cache = new Map<string, RecallCacheEntry>();
  private runtimeStats: RetrievalRuntimeStats = {
    lastRecallMs: 0,
    recallTimeouts: 0,
    lastRecallMode: "none",
    lastRecallPath: "explicit",
    lastRecallBudgetLimited: false,
    lastShadowDeepQueued: false,
    lastRecallInjected: false,
    lastRecallEnoughAt: "none",
    lastRecallCacheHit: false,
  };

  constructor(
    private readonly repository: MemoryRepository,
    private readonly skills: SkillsRuntime,
    private readonly extractor: LlmMemoryExtractor,
    private readonly runtime: RetrievalRuntimeOptions = {},
  ) {}

  getRuntimeStats(): RetrievalRuntimeStats {
    return { ...this.runtimeStats };
  }

  resetTransientState(): void {
    this.cache.clear();
    this.runtimeStats = {
      lastRecallMs: 0,
      recallTimeouts: 0,
      lastRecallMode: "none",
      lastRecallPath: "explicit",
      lastRecallBudgetLimited: false,
      lastShadowDeepQueued: false,
      lastRecallInjected: false,
      lastRecallEnoughAt: "none",
      lastRecallCacheHit: false,
    };
  }

  private currentSettings(): IndexingSettings {
    return this.runtime.getSettings?.() ?? {
      reasoningMode: "answer_first",
      recallTopK: DEFAULT_RECALL_TOP_K,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinNewL1: 10,
      dreamProjectRebuildTimeoutMs: 180_000,
    };
  }

  private buildCacheKey(query: string, settings: IndexingSettings, retrievalMode: "auto" | "explicit"): string {
    return JSON.stringify({
      query: normalizeQueryKey(query),
      snapshot: this.repository.getSnapshotVersion(),
      retrievalMode,
      settings: {
        reasoningMode: settings.reasoningMode,
        recallTopK: settings.recallTopK,
      },
    });
  }

  private getCachedResult(cacheKey: string): RetrievalResult | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    return cached.result;
  }

  private saveCachedResult(cacheKey: string, result: RetrievalResult): void {
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + RECALL_CACHE_TTL_MS,
      result,
    });
    if (this.cache.size > 80) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }

  private getBaseProfile(includeFacts: boolean | undefined): GlobalProfileRecord | null {
    if (includeFacts === false) return null;
    const profile = this.repository.getGlobalProfileRecord();
    return profile.profileText.trim() ? profile : null;
  }

  private buildContext(
    intent: RetrievalResult["intent"],
    enoughAt: RetrievalResult["enoughAt"],
    profile: GlobalProfileRecord | null,
    evidenceNote: string,
    l2Results: L2SearchResult[],
    l1Results: L1SearchResult[],
    l0Results: L0SearchResult[],
  ): string {
    const hasEvidence = Boolean(profile?.profileText.trim())
      || Boolean(evidenceNote.trim())
      || l2Results.length > 0
      || l1Results.length > 0
      || l0Results.length > 0;
    if (!hasEvidence) return "";
    return renderContextTemplate(this.skills.contextTemplate, {
      intent,
      enoughAt,
      profileBlock: renderProfile(profile),
      evidenceNoteBlock: renderEvidenceNote(evidenceNote),
      l2Block: renderL2(l2Results),
      l1Block: renderL1(l1Results),
      l0Block: renderL0(l0Results),
    });
  }

  private updateRuntimeStats(result: RetrievalResult, timedOut = false): void {
    const mode = result.debug?.mode ?? "none";
    const elapsedMs = result.debug?.elapsedMs ?? 0;
    this.runtimeStats.lastRecallMs = elapsedMs;
    this.runtimeStats.lastRecallMode = mode;
    this.runtimeStats.lastRecallPath = result.debug?.path ?? "explicit";
    this.runtimeStats.lastRecallBudgetLimited = Boolean(result.debug?.budgetLimited);
    this.runtimeStats.lastShadowDeepQueued = Boolean(result.debug?.shadowDeepQueued);
    this.runtimeStats.lastRecallInjected = Boolean(result.context?.trim());
    this.runtimeStats.lastRecallEnoughAt = result.enoughAt;
    this.runtimeStats.lastRecallCacheHit = Boolean(result.debug?.cacheHit);
    if (timedOut) this.runtimeStats.recallTimeouts += 1;
  }

  private buildL2CatalogHit(item: L2SearchResult["item"]): L2SearchResult {
    if ("dateKey" in item) return { level: "l2_time", score: 1, item };
    return { level: "l2_project", score: 1, item };
  }

  private buildL2CatalogEntry(hit: L2SearchResult): L2CatalogEntry {
    if (hit.level === "l2_time") {
      return {
        id: hit.item.l2IndexId,
        type: "time",
        label: hit.item.dateKey,
        lookupKeys: [hit.item.dateKey],
        compressedContent: truncate(hit.item.summary, 180),
      };
    }
    return {
      id: hit.item.l2IndexId,
      type: "project",
      label: hit.item.projectName,
      lookupKeys: [hit.item.projectKey, hit.item.projectName].filter(Boolean),
      compressedContent: truncate(
        [hit.item.summary, `status=${hit.item.currentStatus}`, hit.item.latestProgress].filter(Boolean).join(" | "),
        220,
      ),
    };
  }

  private getRequestedLookupTypes(lookupQueries: LookupQuerySpec[]): Set<LookupQuerySpec["targetTypes"][number]> {
    const requestedTypes = new Set<LookupQuerySpec["targetTypes"][number]>();
    for (const spec of lookupQueries) {
      for (const type of spec.targetTypes) requestedTypes.add(type);
    }
    return requestedTypes;
  }

  private buildLookupSpecs(query: string, lookupQueries: LookupQuerySpec[]): LookupQuerySpec[] {
    const specs = lookupQueries.length > 0
      ? lookupQueries
      : [{
          targetTypes: ["time", "project"] as const,
          lookupQuery: query,
          timeRange: null,
        }];

    const normalized: LookupQuerySpec[] = [];
    const seen = new Set<string>();
    for (const spec of specs) {
      const lookupQuery = spec.lookupQuery.trim() || query.trim();
      const targetTypes: LookupQuerySpec["targetTypes"] = spec.targetTypes.length > 0
        ? [...spec.targetTypes]
        : ["time", "project"];
      const timeRange = spec.timeRange ?? null;
      const key = JSON.stringify({ lookupQuery: normalizeQueryKey(lookupQuery), targetTypes, timeRange });
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ targetTypes, lookupQuery, timeRange });
    }
    return normalized;
  }

  private buildTimeCandidates(query: string, specs: LookupQuerySpec[], limit: number): { hits: L2SearchResult[]; truncated: boolean } {
    if (limit <= 0) return { hits: [], truncated: false };
    const hits: L2SearchResult[] = [];
    const seen = new Set<string>();
    let truncated = false;

    for (const spec of specs.filter((item) => item.targetTypes.includes("time"))) {
      if (!spec.timeRange) continue;
      const expanded = enumerateRecentDateKeys(spec.timeRange.startDate, spec.timeRange.endDate, limit);
      truncated = truncated || expanded.truncated;
      for (const dateKey of expanded.dateKeys) {
        const item = this.repository.getL2TimeByDate(dateKey);
        if (!item || seen.has(item.l2IndexId)) continue;
        seen.add(item.l2IndexId);
        hits.push({ level: "l2_time", score: toRankScore(hits.length), item });
        if (hits.length >= limit) {
          return { hits, truncated: true };
        }
      }
    }

    if (hits.length === 0) {
      for (const spec of specs.filter((item) => item.targetTypes.includes("time"))) {
        const queryHits = this.repository.searchL2TimeIndexes(spec.lookupQuery || query, Math.max(limit, 4));
        for (const hit of queryHits) {
          if (seen.has(hit.item.l2IndexId)) continue;
          seen.add(hit.item.l2IndexId);
          hits.push({ ...hit, score: hit.score });
        }
      }
    }

    const ordered = hits
      .filter((hit): hit is Extract<L2SearchResult, { level: "l2_time" }> => hit.level === "l2_time")
      .sort((left, right) => compareIsoDesc(left.item.dateKey, right.item.dateKey))
      .slice(0, limit);
    if (hits.length > ordered.length) truncated = true;
    return { hits: ordered, truncated };
  }

  private buildProjectCandidates(query: string, specs: LookupQuerySpec[], limit: number): { hits: L2SearchResult[]; truncated: boolean } {
    if (limit <= 0) return { hits: [], truncated: false };
    const merged = new Map<string, L2SearchResult>();

    for (const spec of specs.filter((item) => item.targetTypes.includes("project"))) {
      const queryHits = this.repository.searchL2ProjectIndexes(spec.lookupQuery || query, Math.max(limit, 4));
      for (const hit of queryHits) {
        const previous = merged.get(hit.item.l2IndexId);
        if (!previous || hit.score > previous.score) {
          merged.set(hit.item.l2IndexId, hit);
        }
      }
    }

    const ordered = Array.from(merged.values())
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return compareIsoDesc(
          left.level === "l2_project" ? left.item.updatedAt : "",
          right.level === "l2_project" ? right.item.updatedAt : "",
        );
      })
      .slice(0, limit);

    return {
      hits: ordered,
      truncated: merged.size > ordered.length,
    };
  }

  private buildL2Catalog(query: string, lookupQueries: LookupQuerySpec[], limit: number): PackedL2Catalog {
    const specs = this.buildLookupSpecs(query, lookupQueries);
    const requestedTypes = this.getRequestedLookupTypes(specs);
    const includeTime = requestedTypes.size === 0 || requestedTypes.has("time");
    const includeProject = requestedTypes.size === 0 || requestedTypes.has("project");
    const timeLimit = includeTime && includeProject ? Math.ceil(limit / 2) : includeTime ? limit : 0;
    const projectLimit = includeTime && includeProject ? Math.floor(limit / 2) : includeProject ? limit : 0;
    const timeCandidates = includeTime ? this.buildTimeCandidates(query, specs, timeLimit) : { hits: [], truncated: false };
    const projectCandidates = includeProject ? this.buildProjectCandidates(query, specs, projectLimit) : { hits: [], truncated: false };
    const orderedHits = [
      ...timeCandidates.hits,
      ...projectCandidates.hits,
    ].slice(0, Math.max(1, limit));
    const byId = new Map<string, L2SearchResult>(orderedHits.map((hit) => [hit.item.l2IndexId, hit]));

    return {
      entries: orderedHits.map((hit) => this.buildL2CatalogEntry(hit)),
      byId,
      truncated: timeCandidates.truncated || projectCandidates.truncated || orderedHits.length < (timeCandidates.hits.length + projectCandidates.hits.length),
    };
  }

  private buildL1CandidatesFromL2(l2Results: L2SearchResult[], limit: number): L1WindowRecord[] {
    const l1Ids = uniqueById(
      l2Results.flatMap((result) => result.item.l1Source.map((id) => ({ id }))),
      (item) => item.id,
    ).map((item) => item.id);
    if (l1Ids.length === 0) return [];
    return this.repository.getL1ByIds(l1Ids)
      .sort((left, right) => {
        const endedCompare = compareIsoDesc(left.endedAt, right.endedAt);
        return endedCompare !== 0 ? endedCompare : compareIsoDesc(left.createdAt, right.createdAt);
      })
      .slice(0, limit);
  }

  private buildL0CandidatesFromL1(l1Windows: L1WindowRecord[], limit: number): L0SessionRecord[] {
    const l0Ids = uniqueById(
      l1Windows.flatMap((item) => item.l0Source.map((id) => ({ id }))),
      (item) => item.id,
    ).map((item) => item.id);
    if (l0Ids.length === 0) return [];
    return this.repository.getL0ByIds(l0Ids)
      .sort((left, right) => compareIsoDesc(left.timestamp, right.timestamp))
      .slice(0, limit);
  }

  private buildFallbackEvidenceNote(l2Results: L2SearchResult[], seed = ""): string {
    const note = l2Results
      .map((hit) => hit.level === "l2_time"
        ? `${hit.item.dateKey}: ${hit.item.summary}`
        : `${hit.item.projectName}: ${hit.item.latestProgress || hit.item.summary}`)
      .join("\n");
    return truncate(note || seed.trim(), 800);
  }

  private buildLocalFallbackCandidates(
    query: string,
    l2Limit: number,
    profile: GlobalProfileRecord | null,
    lookupQueries: LookupQuerySpec[] = [],
  ): LocalFallbackCandidates {
    const catalog = this.buildL2Catalog(query, lookupQueries, Math.max(1, l2Limit));
    return {
      profile,
      l2: catalog.entries
        .map((entry, index) => {
          const hit = catalog.byId.get(entry.id);
          return hit ? { ...hit, score: toRankScore(index) } : undefined;
        })
        .filter((hit): hit is L2SearchResult => Boolean(hit)),
      truncated: catalog.truncated,
    };
  }

  private buildLocalFallback(
    resultQuery: string,
    fallbackQuery: string,
    candidates: LocalFallbackCandidates,
    execution: RetrieveExecutionOptions,
    elapsedMs: number,
    cacheHit: boolean,
    corrections: string[] = ["fallback"],
  ): RetrievalResult {
    const profile = candidates.profile;
    const l2Results = candidates.l2.slice(0, Math.max(1, Math.min(4, candidates.l2.length || 1)));
    const evidenceNote = this.buildFallbackEvidenceNote(l2Results, fallbackQuery);
    const intent = l2Results[0]?.level === "l2_project"
      ? "project"
      : l2Results[0]?.level === "l2_time"
        ? "time"
        : profile
          ? "fact"
          : "general";
    const enoughAt = l2Results.length > 0
      ? coerceEnoughAt("l2", { l2: l2Results.length, l1: 0, l0: 0 })
      : profile
        ? "profile"
        : "none";
    return withDebug({
      query: resultQuery,
      intent,
      enoughAt,
      profile,
      evidenceNote,
      l2Results,
      l1Results: [],
      l0Results: [],
      context: this.buildContext(intent, enoughAt, profile, evidenceNote, l2Results, [], []),
    }, {
      mode: l2Results.length > 0 || profile ? "local_fallback" : "none",
      elapsedMs,
      cacheHit,
      path: execution.retrievalMode,
      catalogTruncated: candidates.truncated,
      corrections,
    });
  }

  private resolveRecallLimits(settings: IndexingSettings, options: RetrievalOptions): RecallLimits {
    const baseLimit = Math.max(1, Math.min(50, settings.recallTopK || DEFAULT_RECALL_TOP_K));
    return {
      l2: Math.max(1, Math.min(50, options.l2Limit ?? baseLimit)),
      l1: Math.max(1, Math.min(50, options.l1Limit ?? baseLimit)),
      l0: Math.max(1, Math.min(50, options.l0Limit ?? baseLimit)),
    };
  }

  private resolveBaseIntent(profile: GlobalProfileRecord | null): RetrievalResult["intent"] {
    return profile ? "fact" : "general";
  }

  private resolveBaseEnoughAt(profile: GlobalProfileRecord | null): RetrievalResult["enoughAt"] {
    return profile ? "profile" : "none";
  }

  private finalizeResult(
    result: RetrievalResult,
    execution: RetrieveExecutionOptions,
    cacheKey: string,
    timedOut = false,
  ): RetrievalResult {
    if (execution.savePrimaryCache) this.saveCachedResult(cacheKey, result);
    if (execution.updateRuntimeStats) this.updateRuntimeStats(result, timedOut);
    return result;
  }

  private shouldStayShallow(settings: IndexingSettings, retrievalMode: "auto" | "explicit"): boolean {
    return retrievalMode === "auto" && settings.reasoningMode === "answer_first";
  }

  private buildL1Results(candidates: L1WindowRecord[]): L1SearchResult[] {
    return candidates.map((item, index) => ({ item, score: toRankScore(index) }));
  }

  private buildL0Results(candidates: L0SessionRecord[]): L0SearchResult[] {
    return candidates.map((item, index) => ({ item, score: toRankScore(index) }));
  }

  private async runRetrieve(
    query: string,
    options: RetrievalOptions,
    execution: RetrieveExecutionOptions,
  ): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const settings = this.currentSettings();
    const limits = this.resolveRecallLimits(settings, options);
    const trace = createRetrievalTrace(query, execution.retrievalMode);
    let hop1PromptDebug: RetrievalPromptDebug | undefined;
    let hop2PromptDebug: RetrievalPromptDebug | undefined;
    let hop3PromptDebug: RetrievalPromptDebug | undefined;
    let hop4PromptDebug: RetrievalPromptDebug | undefined;
    appendTraceStep(trace, {
      kind: "recall_start",
      title: "Recall Started",
      status: "info",
      inputSummary: previewText(query, 220),
      outputSummary: `mode=${execution.retrievalMode} · reasoning=${settings.reasoningMode} · limits=${limits.l2}/${limits.l1}/${limits.l0}`,
      refs: {
        retrievalMode: execution.retrievalMode,
        reasoningMode: settings.reasoningMode,
      },
      metrics: {
        l2Limit: limits.l2,
        l1Limit: limits.l1,
        l0Limit: limits.l0,
      },
      details: [
        kvDetail("recall-config", "Recall Configuration", [
          { label: "query", value: query },
          { label: "retrievalMode", value: execution.retrievalMode },
          { label: "reasoningMode", value: settings.reasoningMode },
          { label: "l2Limit", value: limits.l2 },
          { label: "l1Limit", value: limits.l1 },
          { label: "l0Limit", value: limits.l0 },
        ]),
      ],
    });
    const cacheKey = this.buildCacheKey(query, settings, execution.retrievalMode);
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      const result = withDebug(cached, {
        ...(cached.debug ?? {}),
        mode: cached.debug?.mode ?? "llm",
        elapsedMs: Date.now() - startedAt,
        cacheHit: true,
        path: execution.retrievalMode,
      });
      appendTraceStep(trace, {
        kind: "cache_hit",
        title: "Cache Hit",
        status: "success",
        inputSummary: "Used cached retrieval result for this query snapshot.",
        outputSummary: `intent=${result.intent} · enoughAt=${result.enoughAt} · mode=${result.debug?.mode ?? "llm"}`,
        refs: {
          enoughAt: result.enoughAt,
          intent: result.intent,
        },
        metrics: {
          cacheHit: 1,
          elapsedMs: Date.now() - startedAt,
        },
        details: [
          kvDetail("cache-summary", "Cached Result", [
            { label: "intent", value: result.intent },
            { label: "enoughAt", value: result.enoughAt },
            { label: "mode", value: result.debug?.mode ?? "llm" },
          ]),
          ...(result.evidenceNote.trim() ? [noteDetail("cache-note", "Cached Evidence Note", result.evidenceNote)] : []),
        ],
      });
      appendContextRenderedStep(trace, result);
      return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
    }

    const baseProfile = this.getBaseProfile(options.includeFacts);
    const recentMessages = Array.isArray(options.recentMessages) ? options.recentMessages.slice(0, 4) : [];

    if (execution.retrievalMode === "auto" && this.runtime.isBackgroundBusy?.()) {
      const fallbackCandidates = this.buildLocalFallbackCandidates(query, limits.l2, baseProfile);
      const fallback = this.buildLocalFallback(query, query, fallbackCandidates, execution, Date.now() - startedAt, false, ["background_busy", "fallback"]);
      appendFallbackStep(trace, ["background_busy", "fallback"], fallback);
      appendContextRenderedStep(trace, fallback);
      return this.finalizeResult(attachTrace(fallback, trace), execution, cacheKey, false);
    }

    let workingQuery = query;
    let workingLookupQueries: LookupQuerySpec[] = [];
    try {
      const hop1 = await this.extractor.decideMemoryLookup({
        query,
        profile: baseProfile,
        recentMessages,
        debugTrace: (debug) => {
          hop1PromptDebug = debug;
        },
      });
      const hop1QueryScope = hop1.queryScope === "continuation" ? "continuation" : "standalone";
      workingQuery = typeof hop1.effectiveQuery === "string" && hop1.effectiveQuery.trim()
        ? hop1.effectiveQuery.trim()
        : query;
      workingLookupQueries = hop1.lookupQueries;
      const routedFallbackCandidates = this.buildLocalFallbackCandidates(workingQuery, limits.l2, baseProfile, hop1.lookupQueries);
      appendTraceStep(trace, {
        kind: "hop1_decision",
        title: "Hop 1 Decision",
        status: "success",
        inputSummary: baseProfile?.profileText.trim()
          ? `profile_available=1 · recent_messages=${recentMessages.length} · ${previewText(query, 160)}`
          : `recent_messages=${recentMessages.length} · ${previewText(query, 160)}`,
        outputSummary: [
          `queryScope=${hop1QueryScope}`,
          `memoryRelevant=${hop1.memoryRelevant ? "yes" : "no"}`,
          `baseOnly=${hop1.baseOnly ? "yes" : "no"}`,
          summarizeLookupQueries(hop1.lookupQueries),
        ].join(" · "),
        refs: {
          queryScope: hop1QueryScope,
          effectiveQuery: workingQuery,
          recentMessagesCount: recentMessages.length,
          memoryRelevant: hop1.memoryRelevant,
          baseOnly: hop1.baseOnly,
          lookupQueries: hop1.lookupQueries,
        },
        details: [
          kvDetail("hop1-decision", "Hop 1 Decision", [
            { label: "queryScope", value: hop1QueryScope },
            { label: "effectiveQuery", value: workingQuery },
            { label: "recentMessagesCount", value: recentMessages.length },
            { label: "memoryRelevant", value: hop1.memoryRelevant ? "true" : "false" },
            { label: "baseOnly", value: hop1.baseOnly ? "true" : "false" },
          ]),
          ...(hop1.lookupQueries.length > 0 ? [listDetail("hop1-queries", "Lookup Queries", buildLookupQueryItems(hop1.lookupQueries))] : []),
          jsonDetail("hop1-json", "Hop 1 Structured Result", {
            queryScope: hop1QueryScope,
            effectiveQuery: workingQuery,
            memoryRelevant: hop1.memoryRelevant,
            baseOnly: hop1.baseOnly,
            lookupQueries: hop1.lookupQueries,
          }),
        ],
        ...(hop1PromptDebug ? { promptDebug: hop1PromptDebug } : {}),
      });

      if (!hop1.memoryRelevant) {
        const result = withDebug({
          query,
          intent: "general",
          enoughAt: "none",
          profile: null,
          evidenceNote: "",
          l2Results: [],
          l1Results: [],
          l0Results: [],
          context: "",
        }, {
          mode: "none",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1.lookupQueries.map((entry) => ({
            targetTypes: entry.targetTypes,
            lookupQuery: entry.lookupQuery,
          })),
        });
        appendRecallSkippedStep(
          trace,
          "memory_not_relevant",
          "Hop 1 judged that memory recall is unnecessary for this query.",
          {
            hop1QueryScope,
            hop1EffectiveQuery: workingQuery,
            hop1BaseOnly: hop1.baseOnly,
          },
        );
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      if (hop1.baseOnly) {
        const intent = this.resolveBaseIntent(baseProfile);
        const enoughAt = this.resolveBaseEnoughAt(baseProfile);
        const result = withDebug({
          query,
          intent,
          enoughAt,
          profile: baseProfile,
          evidenceNote: "",
          l2Results: [],
          l1Results: [],
          l0Results: [],
          context: this.buildContext(intent, enoughAt, baseProfile, "", [], [], []),
        }, {
          mode: "llm",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1.lookupQueries.map((entry) => ({
            targetTypes: entry.targetTypes,
            lookupQuery: entry.lookupQuery,
          })),
        });
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      const catalog = this.buildL2Catalog(workingQuery, hop1.lookupQueries, limits.l2);
      const l2Results = catalog.entries
        .map((entry, index) => {
          const hit = catalog.byId.get(entry.id);
          return hit ? { ...hit, score: toRankScore(index) } : undefined;
        })
        .filter((hit): hit is L2SearchResult => Boolean(hit));
      appendTraceStep(trace, {
        kind: "l2_candidates",
        title: "L2 Candidates",
        status: l2Results.length > 0 ? "success" : "warning",
        inputSummary: summarizeLookupQueries(hop1.lookupQueries),
        outputSummary: summarizeL2Results(l2Results),
        refs: {
          l2Ids: l2Results.map((item) => item.item.l2IndexId),
          catalogTruncated: catalog.truncated,
        },
        metrics: {
          count: l2Results.length,
          truncated: catalog.truncated ? 1 : 0,
        },
        details: [
          kvDetail("l2-summary", "L2 Candidate Summary", [
            { label: "count", value: l2Results.length },
            { label: "catalogTruncated", value: catalog.truncated ? "true" : "false" },
          ]),
          ...(l2Results.length > 0 ? [listDetail("l2-items", "L2 Candidates", l2Results.map(describeL2Result))] : []),
        ],
      });

      if (l2Results.length === 0) {
        const fallback = this.buildLocalFallback(query, workingQuery, routedFallbackCandidates, execution, Date.now() - startedAt, false, ["catalog_empty", "fallback"]);
        appendFallbackStep(trace, ["catalog_empty", "fallback"], fallback);
        appendContextRenderedStep(trace, fallback);
        return this.finalizeResult(attachTrace(fallback, trace), execution, cacheKey, false);
      }

      const hop2 = await this.extractor.selectL2FromCatalog({
        query: workingQuery,
        profile: baseProfile,
        lookupQueries: hop1.lookupQueries,
        l2Entries: catalog.entries,
        catalogTruncated: catalog.truncated,
        debugTrace: (debug) => {
          hop2PromptDebug = debug;
        },
      });
      const hop2Note = hop2.evidenceNote.trim() || this.buildFallbackEvidenceNote(l2Results, workingQuery);
      const shallowMode = this.shouldStayShallow(settings, execution.retrievalMode);
      const hop1DebugQueries = hop1.lookupQueries.map((entry) => ({
        targetTypes: entry.targetTypes,
        lookupQuery: entry.lookupQuery,
      }));
      const hop2SelectedL2Ids = l2Results.map((item) => item.item.l2IndexId);
      appendTraceStep(trace, {
        kind: "hop2_decision",
        title: "Hop 2 Decision",
        status: hop2.enoughAt === "none" ? "warning" : "success",
        inputSummary: summarizeL2Results(l2Results),
        outputSummary: `intent=${hop2.intent} · enoughAt=${hop2.enoughAt} · ${previewText(hop2Note, 220)}`,
        refs: {
          enoughAt: hop2.enoughAt,
          intent: hop2.intent,
          selectedL2Ids: hop2SelectedL2Ids,
        },
        details: [
          kvDetail("hop2-result", "Hop 2 Result", [
            { label: "intent", value: hop2.intent },
            { label: "enoughAt", value: hop2.enoughAt },
          ]),
          noteDetail("hop2-note-before", "Evidence Note Before Hop 2", "(empty)"),
          noteDetail("hop2-note-after", "Evidence Note After Hop 2", hop2Note),
          listDetail("hop2-selected-l2", "Selected L2 IDs", hop2SelectedL2Ids),
        ],
        ...(hop2PromptDebug ? { promptDebug: hop2PromptDebug } : {}),
      });

      if (shallowMode) {
        const enoughAt = coerceEnoughAt("l2", { l2: l2Results.length, l1: 0, l0: 0 });
        const corrections = hop2.enoughAt === "l2" ? [] : ["hop2_unverified_shallow_stop"];
        const result = withDebug({
          query,
          intent: hop2.intent,
          enoughAt,
          profile: null,
          evidenceNote: hop2Note,
          l2Results,
          l1Results: [],
          l0Results: [],
          context: this.buildContext(hop2.intent, enoughAt, null, hop2Note, l2Results, [], []),
        }, {
          mode: "llm",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1DebugQueries,
          hop2EnoughAt: hop2.enoughAt,
          hop2SelectedL2Ids,
          catalogTruncated: catalog.truncated,
          ...(corrections.length > 0 ? { corrections } : {}),
        });
        if (corrections.length > 0) {
          appendFallbackStep(trace, corrections, result);
        }
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      if (hop2.enoughAt === "l2") {
        const enoughAt = coerceEnoughAt("l2", { l2: l2Results.length, l1: 0, l0: 0 });
        const result = withDebug({
          query,
          intent: hop2.intent,
          enoughAt,
          profile: null,
          evidenceNote: hop2Note,
          l2Results,
          l1Results: [],
          l0Results: [],
          context: this.buildContext(hop2.intent, enoughAt, null, hop2Note, l2Results, [], []),
        }, {
          mode: "llm",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1DebugQueries,
          hop2EnoughAt: hop2.enoughAt,
          hop2SelectedL2Ids,
          catalogTruncated: catalog.truncated,
        });
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      const l1Candidates = this.buildL1CandidatesFromL2(l2Results, limits.l1);
      appendTraceStep(trace, {
        kind: "l1_candidates",
        title: "L1 Candidates",
        status: l1Candidates.length > 0 ? "success" : "warning",
        inputSummary: hop2SelectedL2Ids.join(" | ") || "No selected L2 ids.",
        outputSummary: summarizeL1Windows(l1Candidates),
        refs: {
          l1Ids: l1Candidates.map((item) => item.l1IndexId),
        },
        metrics: {
          count: l1Candidates.length,
        },
        details: [
          kvDetail("l1-summary", "L1 Candidate Summary", [
            { label: "count", value: l1Candidates.length },
          ]),
          ...(l1Candidates.length > 0 ? [listDetail("l1-items", "L1 Candidates", l1Candidates.map(describeL1Result))] : []),
        ],
      });
      if (l1Candidates.length === 0) {
        const enoughAt = coerceEnoughAt("l2", { l2: l2Results.length, l1: 0, l0: 0 });
        const result = withDebug({
          query,
          intent: hop2.intent,
          enoughAt,
          profile: null,
          evidenceNote: hop2Note,
          l2Results,
          l1Results: [],
          l0Results: [],
          context: this.buildContext(hop2.intent, enoughAt, null, hop2Note, l2Results, [], []),
        }, {
          mode: "llm",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1DebugQueries,
          hop2EnoughAt: hop2.enoughAt,
          hop2SelectedL2Ids,
          catalogTruncated: catalog.truncated,
          corrections: ["missing_l1_candidates"],
        });
        appendFallbackStep(trace, ["missing_l1_candidates"], result);
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      const hop3 = await this.extractor.selectL1FromEvidence({
        query: workingQuery,
        evidenceNote: hop2Note,
        selectedL2Entries: catalog.entries,
        l1Windows: l1Candidates,
        debugTrace: (debug) => {
          hop3PromptDebug = debug;
        },
      });
      const l1Results = this.buildL1Results(l1Candidates);
      const hop3Note = hop3.evidenceNote.trim() || hop2Note;
      appendTraceStep(trace, {
        kind: "hop3_decision",
        title: "Hop 3 Decision",
        status: hop3.enoughAt === "none" ? "warning" : "success",
        inputSummary: previewText(hop2Note, 220),
        outputSummary: `enoughAt=${hop3.enoughAt} · ${previewText(hop3Note, 220)}`,
        refs: {
          enoughAt: hop3.enoughAt,
          selectedL1Ids: l1Results.map((item) => item.item.l1IndexId),
        },
        details: [
          kvDetail("hop3-result", "Hop 3 Result", [
            { label: "enoughAt", value: hop3.enoughAt },
          ]),
          noteDetail("hop3-note-before", "Evidence Note Before Hop 3", hop2Note),
          noteDetail("hop3-note-after", "Evidence Note After Hop 3", hop3Note),
          listDetail("hop3-selected-l1", "Selected L1 IDs", l1Results.map((item) => item.item.l1IndexId)),
        ],
        ...(hop3PromptDebug ? { promptDebug: hop3PromptDebug } : {}),
      });

      if (hop3.enoughAt === "l1") {
        const enoughAt = coerceEnoughAt("l1", { l2: l2Results.length, l1: l1Results.length, l0: 0 });
        const result = withDebug({
          query,
          intent: hop2.intent,
          enoughAt,
          profile: null,
          evidenceNote: hop3Note,
          l2Results,
          l1Results,
          l0Results: [],
          context: this.buildContext(hop2.intent, enoughAt, null, hop3Note, l2Results, l1Results, []),
        }, {
          mode: "llm",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1DebugQueries,
          hop2EnoughAt: hop2.enoughAt,
          hop2SelectedL2Ids,
          hop3EnoughAt: hop3.enoughAt,
          hop3SelectedL1Ids: l1Results.map((item) => item.item.l1IndexId),
          catalogTruncated: catalog.truncated,
        });
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      const l0Candidates = this.buildL0CandidatesFromL1(l1Candidates, limits.l0);
      appendTraceStep(trace, {
        kind: "l0_candidates",
        title: "L0 Candidates",
        status: l0Candidates.length > 0 ? "success" : "warning",
        inputSummary: l1Results.map((item) => item.item.l1IndexId).join(" | ") || "No selected L1 ids.",
        outputSummary: summarizeL0Sessions(l0Candidates),
        refs: {
          l0Ids: l0Candidates.map((item) => item.l0IndexId),
        },
        metrics: {
          count: l0Candidates.length,
        },
        details: [
          kvDetail("l0-summary", "L0 Candidate Summary", [
            { label: "count", value: l0Candidates.length },
          ]),
          ...(l0Candidates.length > 0 ? [listDetail("l0-items", "L0 Candidates", l0Candidates.map(describeL0Result))] : []),
        ],
      });
      if (l0Candidates.length === 0) {
        const enoughAt = coerceEnoughAt("l1", { l2: l2Results.length, l1: l1Results.length, l0: 0 });
        const result = withDebug({
          query,
          intent: hop2.intent,
          enoughAt,
          profile: null,
          evidenceNote: hop3Note,
          l2Results,
          l1Results,
          l0Results: [],
          context: this.buildContext(hop2.intent, enoughAt, null, hop3Note, l2Results, l1Results, []),
        }, {
          mode: "llm",
          elapsedMs: Date.now() - startedAt,
          cacheHit: false,
          path: execution.retrievalMode,
          hop1QueryScope,
          hop1EffectiveQuery: workingQuery,
          hop1BaseOnly: hop1.baseOnly,
          hop1LookupQueries: hop1DebugQueries,
          hop2EnoughAt: hop2.enoughAt,
          hop2SelectedL2Ids,
          hop3EnoughAt: hop3.enoughAt,
          hop3SelectedL1Ids: l1Results.map((item) => item.item.l1IndexId),
          catalogTruncated: catalog.truncated,
          corrections: ["missing_l0_candidates"],
        });
        appendFallbackStep(trace, ["missing_l0_candidates"], result);
        appendContextRenderedStep(trace, result);
        return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
      }

      const hop4 = await this.extractor.selectL0FromEvidence({
        query: workingQuery,
        evidenceNote: hop3Note,
        selectedL2Entries: catalog.entries,
        selectedL1Windows: l1Candidates,
        l0Sessions: l0Candidates,
        debugTrace: (debug) => {
          hop4PromptDebug = debug;
        },
      });
      const l0Results = this.buildL0Results(l0Candidates);
      const finalNote = hop4.evidenceNote.trim() || hop3Note;
      const useL0Results = hop4.enoughAt === "l0";
      const finalEnoughAt = useL0Results
        ? coerceEnoughAt("l0", { l2: l2Results.length, l1: l1Results.length, l0: l0Results.length })
        : coerceEnoughAt("l1", { l2: l2Results.length, l1: l1Results.length, l0: 0 });
      appendTraceStep(trace, {
        kind: "hop4_decision",
        title: "Hop 4 Decision",
        status: hop4.enoughAt === "none" ? "warning" : "success",
        inputSummary: previewText(hop3Note, 220),
        outputSummary: `enoughAt=${hop4.enoughAt} · ${previewText(finalNote, 220)}`,
        refs: {
          enoughAt: hop4.enoughAt,
          selectedL0Ids: useL0Results ? l0Results.map((item) => item.item.l0IndexId) : [],
        },
        details: [
          kvDetail("hop4-result", "Hop 4 Result", [
            { label: "enoughAt", value: hop4.enoughAt },
          ]),
          noteDetail("hop4-note-before", "Evidence Note Before Hop 4", hop3Note),
          noteDetail("hop4-note-after", "Evidence Note After Hop 4", finalNote),
          ...(useL0Results ? [listDetail("hop4-selected-l0", "Selected L0 IDs", l0Results.map((item) => item.item.l0IndexId))] : []),
        ],
        ...(hop4PromptDebug ? { promptDebug: hop4PromptDebug } : {}),
      });
      const result = withDebug({
        query,
        intent: hop2.intent,
        enoughAt: finalEnoughAt,
        profile: null,
        evidenceNote: finalNote,
        l2Results,
        l1Results,
        l0Results: useL0Results ? l0Results : [],
        context: this.buildContext(hop2.intent, finalEnoughAt, null, finalNote, l2Results, l1Results, useL0Results ? l0Results : []),
      }, {
        mode: "llm",
        elapsedMs: Date.now() - startedAt,
        cacheHit: false,
        path: execution.retrievalMode,
        hop1QueryScope,
        hop1EffectiveQuery: workingQuery,
        hop1BaseOnly: hop1.baseOnly,
        hop1LookupQueries: hop1DebugQueries,
        hop2EnoughAt: hop2.enoughAt,
        hop2SelectedL2Ids,
        hop3EnoughAt: hop3.enoughAt,
        hop3SelectedL1Ids: l1Results.map((item) => item.item.l1IndexId),
        hop4SelectedL0Ids: useL0Results ? l0Results.map((item) => item.item.l0IndexId) : [],
        catalogTruncated: catalog.truncated,
      });
      appendContextRenderedStep(trace, result);
      return this.finalizeResult(attachTrace(result, trace), execution, cacheKey, false);
    } catch (error) {
      const timedOut = isTimeoutError(error);
      const fallbackCandidates = this.buildLocalFallbackCandidates(workingQuery, limits.l2, baseProfile, workingLookupQueries);
      const fallback = this.buildLocalFallback(query, workingQuery, fallbackCandidates, execution, Date.now() - startedAt, false, ["error", "fallback"]);
      appendFallbackStep(trace, ["error", "fallback"], fallback);
      appendContextRenderedStep(trace, fallback);
      return this.finalizeResult(attachTrace(fallback, trace), execution, cacheKey, timedOut);
    }
  }

  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const retrievalMode = options.retrievalMode ?? "explicit";
    return this.runRetrieve(query, { ...options, retrievalMode }, {
      retrievalMode,
      updateRuntimeStats: true,
      savePrimaryCache: true,
    });
  }
}
