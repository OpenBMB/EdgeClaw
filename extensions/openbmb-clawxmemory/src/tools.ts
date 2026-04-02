import { Type } from "@sinclair/typebox";
import { type AnyAgentTool, jsonResult } from "openclaw/plugin-sdk/agent-runtime";
import {
  type DashboardOverview,
  type HeartbeatStats,
  MemoryRepository,
  ReasoningRetriever,
  type L0SessionRecord,
  type L1WindowRecord,
  type L2ProjectIndexRecord,
  type L2SearchResult,
  type L2TimeIndexRecord,
  type RetrievalResult,
} from "./core/index.js";

const noParameters = Type.Object({});

const memorySearchParameters = Type.Object({
  query: Type.String({ description: "Question or topic to search in memory." }),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, description: "Maximum items per memory level." }),
  ),
});

const memoryListParameters = Type.Object({
  level: Type.Optional(
    Type.Union(
      [
        Type.Literal("l2"),
        Type.Literal("l2_project"),
        Type.Literal("l2_time"),
        Type.Literal("l1"),
        Type.Literal("l0"),
      ],
      { description: "Memory level to browse." },
    ),
  ),
  query: Type.Optional(Type.String({ description: "Optional search string for browsing memory." })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 50, description: "Maximum items to return." }),
  ),
  offset: Type.Optional(
    Type.Integer({ minimum: 0, description: "Skip this many results before returning items." }),
  ),
});

const memoryGetParameters = Type.Object({
  level: Type.Union(
    [Type.Literal("l2_project"), Type.Literal("l2_time"), Type.Literal("l1"), Type.Literal("l0")],
    { description: "Memory level to read." },
  ),
  ids: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: "One or more ids returned by memory_search.",
  }),
});

type MemoryGetLevel = "l2_project" | "l2_time" | "l1" | "l0";
type MemoryListLevel = "l2" | "l2_project" | "l2_time" | "l1" | "l0";

interface PluginToolCallbacks {
  getOverview?: () => DashboardOverview;
  flushAll?: () => Promise<HeartbeatStats>;
}

function isMemoryGetLevel(value: string): value is MemoryGetLevel {
  return value === "l2_project" || value === "l2_time" || value === "l1" || value === "l0";
}

function isMemoryListLevel(value: string): value is MemoryListLevel {
  return (
    value === "l2" ||
    value === "l2_project" ||
    value === "l2_time" ||
    value === "l1" ||
    value === "l0"
  );
}

function toLimit(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(1, Math.floor(raw));
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return Math.max(1, parsed);
  }
  return fallback;
}

function clampLimit(raw: unknown, fallback: number): number {
  return Math.min(50, toLimit(raw, fallback));
}

function toOffset(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return fallback;
}

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeQuery(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function truncate(value: string, max = 160): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function buildL2Ref(hit: L2SearchResult): Record<string, unknown> {
  if (hit.level === "l2_project") {
    return {
      level: hit.level,
      id: hit.item.l2IndexId,
      score: hit.score,
      projectKey: hit.item.projectKey,
      projectName: hit.item.projectName,
      updatedAt: hit.item.updatedAt,
    };
  }
  return {
    level: hit.level,
    id: hit.item.l2IndexId,
    score: hit.score,
    dateKey: hit.item.dateKey,
    updatedAt: hit.item.updatedAt,
  };
}

function buildMemoryRefs(result: RetrievalResult): Record<string, unknown> {
  return {
    l2: result.l2Results.map(buildL2Ref),
    l1: result.l1Results.map((hit) => ({
      level: "l1",
      id: hit.item.l1IndexId,
      score: hit.score,
      sessionKey: hit.item.sessionKey,
      endedAt: hit.item.endedAt,
    })),
    l0: result.l0Results.map((hit) => ({
      level: "l0",
      id: hit.item.l0IndexId,
      score: hit.score,
      sessionKey: hit.item.sessionKey,
      timestamp: hit.item.timestamp,
    })),
  };
}

function buildL2ProjectListItem(item: L2ProjectIndexRecord): Record<string, unknown> {
  return {
    level: "l2_project",
    id: item.l2IndexId,
    projectKey: item.projectKey,
    projectName: item.projectName,
    summary: item.summary,
    currentStatus: item.currentStatus,
    updatedAt: item.updatedAt,
  };
}

function buildL2TimeListItem(item: L2TimeIndexRecord): Record<string, unknown> {
  return {
    level: "l2_time",
    id: item.l2IndexId,
    dateKey: item.dateKey,
    summary: item.summary,
    updatedAt: item.updatedAt,
  };
}

function buildL1ListItem(item: L1WindowRecord): Record<string, unknown> {
  return {
    level: "l1",
    id: item.l1IndexId,
    sessionKey: item.sessionKey,
    timePeriod: item.timePeriod,
    summary: item.summary,
    endedAt: item.endedAt,
  };
}

function buildL0Preview(messages: L0SessionRecord["messages"]): string {
  const preferred = messages.find(
    (message) => typeof message.content === "string" && message.content.trim(),
  );
  if (!preferred) return "";
  return truncate(preferred.content.trim(), 160);
}

function buildL0ListItem(item: L0SessionRecord): Record<string, unknown> {
  return {
    level: "l0",
    id: item.l0IndexId,
    sessionKey: item.sessionKey,
    timestamp: item.timestamp,
    indexed: item.indexed,
    messageCount: item.messages.length,
    preview: buildL0Preview(item.messages),
  };
}

function compareByTimestampDesc(
  left: { updatedAt?: string; endedAt?: string; timestamp?: string },
  right: { updatedAt?: string; endedAt?: string; timestamp?: string },
): number {
  const leftValue = left.updatedAt ?? left.endedAt ?? left.timestamp ?? "";
  const rightValue = right.updatedAt ?? right.endedAt ?? right.timestamp ?? "";
  return rightValue.localeCompare(leftValue);
}

function selectRecords(
  repository: MemoryRepository,
  level: MemoryGetLevel,
  ids: string[],
): Array<L2ProjectIndexRecord | L2TimeIndexRecord | L1WindowRecord | L0SessionRecord> {
  switch (level) {
    case "l2_project":
      return repository.getL2ProjectByIds(ids);
    case "l2_time":
      return repository.getL2TimeByIds(ids);
    case "l1":
      return repository.getL1ByIds(ids);
    case "l0":
      return repository.getL0ByIds(ids);
  }
}

export function buildPluginTools(
  repository: MemoryRepository,
  retriever: ReasoningRetriever,
  callbacks: PluginToolCallbacks = {},
): AnyAgentTool[] {
  return [
    {
      name: "memory_search",
      label: "Search ClawXMemory",
      description:
        "Search ClawXMemory and return recall context plus ids for exact follow-up reads.",
      parameters: memorySearchParameters,
      async execute(_id, params) {
        const input = (params ?? {}) as Record<string, unknown>;
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query.trim()) {
          return jsonResult({ ok: false, error: "query is required" });
        }
        const limit = toLimit(input.limit, 6);
        const result = await retriever.retrieve(query, {
          retrievalMode: "explicit",
          l2Limit: limit,
          l1Limit: limit,
          l0Limit: limit,
        });
        return jsonResult({
          ok: true,
          query: result.query,
          intent: result.intent,
          enoughAt: result.enoughAt,
          evidenceNote: result.evidenceNote,
          context: result.context,
          profile: result.profile,
          refs: buildMemoryRefs(result),
          debug: result.debug,
        });
      },
    },
    {
      name: "memory_overview",
      label: "Inspect ClawXMemory Status",
      description:
        "Return current ClawXMemory counts, freshness, runtime health, and recall diagnostics.",
      parameters: noParameters,
      async execute() {
        const overview = callbacks.getOverview?.() ?? repository.getOverview();
        return jsonResult({
          ok: true,
          overview,
        });
      },
    },
    {
      name: "memory_list",
      label: "Browse ClawXMemory",
      description:
        "Browse recent ClawXMemory indexes and sessions, or filter them with a query string.",
      parameters: memoryListParameters,
      async execute(_id, params) {
        const input = (params ?? {}) as Record<string, unknown>;
        const levelInput = typeof input.level === "string" ? input.level.trim() : "l2";
        if (!isMemoryListLevel(levelInput)) {
          return jsonResult({
            ok: false,
            error: "level must be one of l2, l2_project, l2_time, l1, l0",
          });
        }

        const query = normalizeQuery(input.query);
        const limit = clampLimit(input.limit, 10);
        const offset = toOffset(input.offset, 0);
        const pageSize = limit + offset;
        let items: Record<string, unknown>[] = [];

        if (levelInput === "l2") {
          if (query) {
            items = repository
              .searchL2Hits(query, pageSize)
              .map((hit) =>
                hit.level === "l2_project"
                  ? buildL2ProjectListItem(hit.item)
                  : buildL2TimeListItem(hit.item),
              )
              .slice(offset, offset + limit);
          } else {
            const projectItems = repository
              .listRecentL2Projects(pageSize)
              .map(buildL2ProjectListItem);
            const timeItems = repository.listRecentL2Time(pageSize).map(buildL2TimeListItem);
            items = [...projectItems, ...timeItems]
              .sort(compareByTimestampDesc)
              .slice(offset, offset + limit);
          }
        } else if (levelInput === "l2_project") {
          items = query
            ? repository
                .searchL2ProjectIndexes(query, pageSize)
                .filter(
                  (hit): hit is Extract<L2SearchResult, { level: "l2_project" }> =>
                    hit.level === "l2_project",
                )
                .map((hit) => buildL2ProjectListItem(hit.item))
                .slice(offset, offset + limit)
            : repository.listRecentL2Projects(limit, offset).map(buildL2ProjectListItem);
        } else if (levelInput === "l2_time") {
          items = query
            ? repository
                .searchL2TimeIndexes(query, pageSize)
                .filter(
                  (hit): hit is Extract<L2SearchResult, { level: "l2_time" }> =>
                    hit.level === "l2_time",
                )
                .map((hit) => buildL2TimeListItem(hit.item))
                .slice(offset, offset + limit)
            : repository.listRecentL2Time(limit, offset).map(buildL2TimeListItem);
        } else if (levelInput === "l1") {
          items = query
            ? repository
                .searchL1(query, pageSize)
                .map(buildL1ListItem)
                .slice(offset, offset + limit)
            : repository.listRecentL1(limit, offset).map(buildL1ListItem);
        } else {
          items = query
            ? repository
                .searchL0(query, pageSize)
                .map(buildL0ListItem)
                .slice(offset, offset + limit)
            : repository.listRecentL0(limit, offset).map(buildL0ListItem);
        }

        return jsonResult({
          ok: true,
          level: levelInput,
          query,
          limit,
          offset,
          count: items.length,
          items,
        });
      },
    },
    {
      name: "memory_get",
      label: "Read ClawXMemory Records",
      description: "Load exact ClawXMemory records by ids returned from memory_search.",
      parameters: memoryGetParameters,
      async execute(_id, params) {
        const input = (params ?? {}) as Record<string, unknown>;
        const level = typeof input.level === "string" ? input.level.trim() : "";
        const ids = normalizeIds(input.ids);
        if (!isMemoryGetLevel(level)) {
          return jsonResult({
            ok: false,
            error: "level must be one of l2_project, l2_time, l1, l0",
          });
        }
        if (ids.length === 0) {
          return jsonResult({ ok: false, error: "ids must contain at least one non-empty id" });
        }

        const records = selectRecords(repository, level, ids);
        const foundIds = new Set(
          records.map((record) => {
            if ("l2IndexId" in record) return record.l2IndexId;
            if ("l1IndexId" in record) return record.l1IndexId;
            return record.l0IndexId;
          }),
        );

        return jsonResult({
          ok: true,
          level,
          requestedIds: ids,
          foundIds: Array.from(foundIds),
          missingIds: ids.filter((id) => !foundIds.has(id)),
          count: records.length,
          records,
        });
      },
    },
    {
      name: "memory_flush",
      label: "Flush ClawXMemory",
      description:
        "Run a manual ClawXMemory indexing flush so pending memory becomes searchable sooner.",
      parameters: noParameters,
      async execute() {
        if (!callbacks.flushAll) {
          return jsonResult({ ok: false, error: "memory_flush is unavailable in this runtime" });
        }
        const beforeOverview = callbacks.getOverview?.() ?? repository.getOverview();
        const stats = await callbacks.flushAll();
        const afterOverview = callbacks.getOverview?.() ?? repository.getOverview();
        return jsonResult({
          ok: true,
          scope: "all",
          reason: "manual",
          beforeOverview,
          afterOverview,
          stats,
        });
      },
    },
  ];
}
