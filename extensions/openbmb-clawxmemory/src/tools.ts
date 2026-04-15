import { Type } from "@sinclair/typebox";
import { type AnyAgentTool, jsonResult } from "openclaw/plugin-sdk/agent-runtime";
import {
  type DashboardOverview,
  type DreamRunResult,
  type HeartbeatStats,
  type MemoryManifestEntry,
  MemoryRepository,
  ReasoningRetriever,
} from "./core/index.js";

const noParameters = Type.Object({});

const memorySearchParameters = Type.Object({
  query: Type.String({ description: "Question or topic to search in memory." }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Maximum files to read after manifest selection." })),
});

const memoryListParameters = Type.Object({
  kind: Type.Optional(Type.Union([
    Type.Literal("all"),
    Type.Literal("user"),
    Type.Literal("feedback"),
    Type.Literal("project"),
  ], { description: "Memory kind to browse." })),
  query: Type.Optional(Type.String({ description: "Optional search string for browsing memory." })),
  projectId: Type.Optional(Type.String({ description: "Optional project id to filter project memories." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum items to return." })),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "Skip this many results before returning items." })),
});

const memoryGetParameters = Type.Object({
  ids: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: "One or more relative file ids returned by memory_search or memory_list.",
  }),
});

interface PluginToolCallbacks {
  getOverview?: () => DashboardOverview;
  flushAll?: () => Promise<HeartbeatStats>;
  runDream?: () => Promise<DreamRunResult>;
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

function buildListItem(item: MemoryManifestEntry): Record<string, unknown> {
  return {
    id: item.relativePath,
    type: item.type,
    scope: item.scope,
    projectId: item.projectId ?? null,
    name: item.name,
    description: item.description,
    updatedAt: item.updatedAt,
    file: item.file,
  };
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
      description: "Run need-memory gating, manifest selection, and file recall for long-term memory.",
      parameters: memorySearchParameters,
      async execute(_id, params) {
        const input = (params ?? {}) as Record<string, unknown>;
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) {
          return jsonResult({ ok: false, error: "query is required" });
        }
        const limit = toLimit(input.limit, 5);
        const result = await retriever.retrieve(query, {
          retrievalMode: "explicit",
        });
        const selectedProjectId = result.debug?.resolvedProjectId ?? null;
        const disambiguationRequired = result.intent === "project_memory" && !selectedProjectId;
        return jsonResult({
          ok: true,
          query: result.query,
          route: result.intent,
          context: result.context,
          selectedProjectId,
          disambiguationRequired,
          ...(disambiguationRequired
            ? { warning: "No formal project was selected from memory. Ask the user to clarify which project they mean." }
            : {}),
          refs: {
            files: result.debug?.selectedFileIds ?? [],
          },
          debug: result.debug,
        });
      },
    },
    {
      name: "memory_overview",
      label: "Inspect ClawXMemory Status",
      description: "Return current ClawXMemory counts, freshness, dream health, and runtime diagnostics.",
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
      description: "Browse file-based user, feedback, and project memories.",
      parameters: memoryListParameters,
      async execute(_id, params) {
        const input = (params ?? {}) as Record<string, unknown>;
        const kind = typeof input.kind === "string" ? input.kind.trim() : "all";
        if (!["all", "user", "feedback", "project"].includes(kind)) {
          return jsonResult({ ok: false, error: "kind must be one of all, user, feedback, project" });
        }
        const query = normalizeQuery(input.query);
        const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
        const limit = clampLimit(input.limit, 10);
        const offset = toOffset(input.offset, 0);
        const items = repository.listMemoryEntries({
          ...(kind !== "all" ? { kinds: [kind as "user" | "feedback" | "project"] } : {}),
          ...(query ? { query } : {}),
          ...(projectId ? { projectId } : {}),
          limit,
          offset,
        }).map(buildListItem);

        return jsonResult({
          ok: true,
          kind,
          query,
          projectId,
          limit,
          offset,
          count: items.length,
          items,
        });
      },
    },
    {
      name: "memory_get",
      label: "Read ClawXMemory Files",
      description: "Load exact memory files by ids returned from memory_search or memory_list.",
      parameters: memoryGetParameters,
      async execute(_id, params) {
        const input = (params ?? {}) as Record<string, unknown>;
        const ids = normalizeIds(input.ids);
        if (ids.length === 0) {
          return jsonResult({ ok: false, error: "ids must contain at least one non-empty id" });
        }
        const records = repository.getMemoryRecordsByIds(ids);
        const foundIds = new Set(records.map((record) => record.relativePath));
        return jsonResult({
          ok: true,
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
      description: "Run a manual ClawXMemory extraction flush so pending memory becomes searchable sooner.",
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
    {
      name: "memory_dream",
      label: "Dream ClawXMemory",
      description: "Run a manual Dream pass to distill indexed memories into cleaner formal project memory.",
      parameters: noParameters,
      async execute() {
        if (!callbacks.runDream) {
          return jsonResult({ ok: false, error: "memory_dream is unavailable in this runtime" });
        }
        const beforeOverview = callbacks.getOverview?.() ?? repository.getOverview();
        const result = await callbacks.runDream();
        const afterOverview = callbacks.getOverview?.() ?? repository.getOverview();
        return jsonResult({
          ok: true,
          beforeOverview,
          afterOverview,
          result,
        });
      },
    },
  ];
}
