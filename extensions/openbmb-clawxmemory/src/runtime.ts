import {
  type CaseToolEvent,
  type CaseTraceRecord,
  type DashboardOverview,
  DreamRewriteRunner,
  HeartbeatIndexer,
  LlmMemoryExtractor,
  MemoryRepository,
  ReasoningRetriever,
  loadSkillsRuntime,
  type DreamRunResult,
  type HeartbeatStats,
  type IndexingSettings,
  type MemoryMessage,
  type MemoryExportBundle,
  type MemoryImportResult,
  type MemoryUiSnapshot,
  type RetrievalResult,
  type RetrievalTrace,
  type StartupRepairStatus,
  hashText,
  nowIso,
} from "./core/index.js";
import type { InternalHookEvent } from "openclaw/plugin-sdk/hook-runtime";
import type {
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
  PluginHookBeforeMessageWriteEvent,
  PluginHookBeforeMessageWriteResult,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookBeforeResetEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookAfterToolCallEvent,
  PluginLogger,
  PluginRuntime,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugin-runtime";
import { buildPluginConfig, type PluginRuntimeConfig } from "./config.js";
import { inspectTranscriptMessage, isCommandOnlyUserText, isSessionBoundaryMarkerMessage, isSessionStartupMarkerText, normalizeMessages, normalizeTranscriptMessage } from "./message-utils.js";
import { buildPluginTools } from "./tools.js";
import { LocalUiServer } from "./ui-server.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MEMORY_REPAIR_VERSION = "2026-04-03-strict-user-io-cleanup-v16";
const INDEXING_SETTINGS_MIGRATION_VERSION = "2026-04-02-auto-dream-settings-v3";
const PLUGIN_ID = "openbmb-clawxmemory";
const NATIVE_MEMORY_PLUGIN_ID = "memory-core";
const LAST_DREAM_AT_STATE_KEY = "lastDreamAt";
const LAST_DREAM_STATUS_STATE_KEY = "lastDreamStatus";
const LAST_DREAM_SUMMARY_STATE_KEY = "lastDreamSummary";
const LAST_DREAM_L1_ENDED_AT_STATE_KEY = "lastDreamL1EndedAt";
const CHAT_FACING_MEMORY_TOOLS = ["memory_overview", "memory_list", "memory_flush"] as const;
const MANAGED_BOUNDARY_RESTART_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 8_000;
const RECENT_INBOUND_TTL_MS = 30_000;
const COMMAND_REPLY_TTL_MS = 10_000;
const NON_MEMORY_TURN_TTL_MS = 15_000;
const STARTUP_REPAIR_SNAPSHOT_LIMIT = 200;
const RECENT_CASE_LIMIT = 30;
const STARTUP_FALLBACK_GREETING = "I'm ready. What would you like to do?";
const STARTUP_BOUNDARY_RUNNING_MESSAGE = "Applying managed OpenClaw memory config and requesting a gateway restart.";

interface MemoryBoundaryDiagnostics {
  slotOwner: string;
  dynamicMemoryRuntime: string;
  workspaceBootstrapPresent: boolean;
  memoryRuntimeHealthy: boolean;
  runtimeIssues: string[];
  managedConfigIssues: string[];
}

export interface ManagedMemoryBoundaryApplyResult {
  changed: boolean;
  changedPaths: string[];
  config: Record<string, unknown>;
}

interface LoggerLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

function safeLog(logger: PluginLogger | undefined): LoggerLike {
  if (!logger) return console;

  const wrap = (method: ((message: string, meta?: Record<string, unknown>) => void) | undefined) => (
    ...args: unknown[]
  ): void => {
    if (!method) return;
    const [message, meta] = args;
    const rendered = typeof message === "string" ? message : String(message);
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      method(rendered, meta as Record<string, unknown>);
      return;
    }
    method(rendered);
  };

  return {
    debug: wrap(logger.debug),
    info: wrap(logger.info),
    warn: wrap(logger.warn),
    error: wrap(logger.error),
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeStringList(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function setManagedValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  path: string,
  changedPaths: string[],
): void {
  if (target[key] === value) return;
  target[key] = value;
  changedPaths.push(path);
}

export function applyManagedMemoryBoundaryConfig(
  source: Record<string, unknown> | undefined,
): ManagedMemoryBoundaryApplyResult {
  const config = cloneJson(source ?? {});
  const changedPaths: string[] = [];

  const plugins = ensureObject(config, "plugins");
  const slots = ensureObject(plugins, "slots");
  const entries = ensureObject(plugins, "entries");
  const pluginEntry = ensureObject(entries, PLUGIN_ID);
  const pluginHooks = ensureObject(pluginEntry, "hooks");
  const memoryCore = ensureObject(entries, NATIVE_MEMORY_PLUGIN_ID);
  const internalHooks = ensureObject(ensureObject(ensureObject(config, "hooks"), "internal"), "entries");
  const sessionMemory = ensureObject(internalHooks, "session-memory");
  const agents = ensureObject(config, "agents");
  const defaults = ensureObject(agents, "defaults");
  const memorySearch = ensureObject(defaults, "memorySearch");
  const compaction = ensureObject(defaults, "compaction");
  const memoryFlush = ensureObject(compaction, "memoryFlush");
  const tools = ensureObject(config, "tools");

  setManagedValue(slots, "memory", PLUGIN_ID, "plugins.slots.memory", changedPaths);
  setManagedValue(pluginEntry, "enabled", true, `plugins.entries.${PLUGIN_ID}.enabled`, changedPaths);
  setManagedValue(
    pluginHooks,
    "allowPromptInjection",
    true,
    `plugins.entries.${PLUGIN_ID}.hooks.allowPromptInjection`,
    changedPaths,
  );
  setManagedValue(
    memoryCore,
    "enabled",
    false,
    `plugins.entries.${NATIVE_MEMORY_PLUGIN_ID}.enabled`,
    changedPaths,
  );
  setManagedValue(
    sessionMemory,
    "enabled",
    false,
    "hooks.internal.entries.session-memory.enabled",
    changedPaths,
  );
  setManagedValue(
    memorySearch,
    "enabled",
    false,
    "agents.defaults.memorySearch.enabled",
    changedPaths,
  );
  setManagedValue(
    memoryFlush,
    "enabled",
    false,
    "agents.defaults.compaction.memoryFlush.enabled",
    changedPaths,
  );

  const currentAlsoAllow = Array.isArray(tools.alsoAllow) ? normalizeStringList(tools.alsoAllow) : [];
  const nextAlsoAllow = normalizeStringList([...currentAlsoAllow, ...CHAT_FACING_MEMORY_TOOLS]);
  if (!arraysEqual(currentAlsoAllow, nextAlsoAllow)) {
    tools.alsoAllow = nextAlsoAllow;
    changedPaths.push("tools.alsoAllow");
  }

  return {
    changed: changedPaths.length > 0,
    changedPaths,
    config,
  };
}

function getConfigValue(root: Record<string, unknown> | undefined, path: string[]): unknown {
  let current: unknown = root;
  for (const part of path) {
    const object = asObject(current);
    if (!object) return undefined;
    current = object[part];
  }
  return current;
}

function getConfigString(root: Record<string, unknown> | undefined, path: string[]): string {
  const value = getConfigValue(root, path);
  return typeof value === "string" ? value.trim() : "";
}

function getConfigBoolean(root: Record<string, unknown> | undefined, path: string[]): boolean | undefined {
  const value = getConfigValue(root, path);
  return typeof value === "boolean" ? value : undefined;
}

function resolveSessionKey(ctx: Record<string, unknown>): string {
  if (typeof ctx.sessionKey === "string" && ctx.sessionKey.trim()) return ctx.sessionKey;
  if (typeof ctx.sessionId === "string" && ctx.sessionId.trim()) return ctx.sessionId;
  return `session-${Date.now()}`;
}

function shouldSkipCapture(event: Record<string, unknown>, ctx: Record<string, unknown>): boolean {
  if (event.success === false) return true;
  const provider = typeof ctx.messageProvider === "string" ? ctx.messageProvider : "";
  const trigger = typeof ctx.trigger === "string" ? ctx.trigger : "";
  const sessionKey = resolveSessionKey(ctx);
  return ["exec-event", "cron-event"].includes(provider)
    || ["heartbeat", "cron", "memory"].includes(trigger)
    || sessionKey.startsWith("temp:");
}

function isControlCommandText(text: string): boolean {
  return isCommandOnlyUserText(text);
}

function previewText(text: string, maxChars = 280): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}...`;
}

function previewJson(value: unknown, maxChars = 280): string {
  try {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    return previewText(rendered || "", maxChars);
  } catch {
    return previewText(String(value), maxChars);
  }
}

function canonicalizeUserQuery(text: string): string {
  const info = inspectTranscriptMessage({
    role: "user",
    content: text,
  });
  const normalized = info.role === "user" ? info.content.trim() : "";
  return normalized || text.trim();
}

function buildCaseId(sessionKey: string, query: string): string {
  return `case_${hashText(`${sessionKey}:${query}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`)}`;
}

function buildToolEventId(sessionKey: string, toolName: string, occurredAt: string): string {
  return `tool_${hashText(`${sessionKey}:${toolName}:${occurredAt}:${Math.random().toString(36).slice(2, 10)}`)}`;
}

function buildRecallSkippedTrace(query: string, reason: string): RetrievalTrace {
  const startedAt = nowIso();
  const traceId = `trace_${hashText(`${reason}:${query}:${startedAt}`)}`;
  return {
    traceId,
    query,
    mode: "auto",
    startedAt,
    finishedAt: startedAt,
    steps: [
      {
        stepId: `${traceId}:step:1`,
        kind: "recall_start",
        title: "Recall Started",
        status: "info",
        inputSummary: previewText(query, 220),
        outputSummary: "Runtime inspected this turn before attempting retrieval.",
        details: [
          {
            key: "recall-query",
            label: "Recall Query",
            kind: "kv",
            entries: [
              { label: "query", value: query },
            ],
          },
        ],
      },
      {
        stepId: `${traceId}:step:2`,
        kind: "recall_skipped",
        title: "Recall Skipped",
        status: "skipped",
        inputSummary: `reason=${reason}`,
        outputSummary: `Automatic recall did not run because ${reason}.`,
        refs: { reason },
        details: [
          {
            key: "skip-reason",
            label: "Skip Reason",
            kind: "kv",
            entries: [
              { label: "reason", value: reason },
            ],
          },
        ],
      },
    ],
  };
}

function deriveCasePathSummary(
  trace: RetrievalTrace | null | undefined,
  enoughAt: RetrievalResult["enoughAt"] | undefined,
): string {
  if (enoughAt === "profile") return "profile";
  if (!trace?.steps?.length) return enoughAt ?? "none";
  const stepKinds = new Set(trace.steps.map((step) => step.kind));
  if (stepKinds.has("hop4_decision") || stepKinds.has("l0_candidates")) return "l2->l1->l0";
  if (stepKinds.has("hop3_decision") || stepKinds.has("l1_candidates")) return "l2->l1";
  if (stepKinds.has("hop2_decision") || stepKinds.has("l2_candidates")) return "l2";
  if (stepKinds.has("recall_skipped")) return "none";
  return enoughAt ?? "none";
}

function extractAssistantReply(messages: MemoryMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

function sanitizeStoredMessages(messages: MemoryMessage[]): MemoryMessage[] {
  const cleaned: MemoryMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.content.trim()) continue;
    const next = messages[index + 1];
    if (
      message.role === "assistant"
      && next?.role === "assistant"
      && !message.content.includes("\n")
      && !/[你您?？]/.test(message.content)
    ) {
      continue;
    }
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.role === message.role && previous.content === message.content) continue;
    cleaned.push(message);
  }
  return cleaned;
}

function sanitizeL0Record(
  record: { sessionKey: string; messages: unknown[] },
  config: { includeAssistant: boolean; maxMessageChars: number },
): MemoryMessage[] {
  if (record.sessionKey.startsWith("temp:")) return [];
  return sanitizeStoredMessages(normalizeMessages(record.messages, {
    captureStrategy: "last_turn",
    includeAssistant: config.includeAssistant,
    maxMessageChars: config.maxMessageChars,
  })).filter((message, index, all) => {
    if (message.role === "assistant") {
      return all.slice(0, index).some((item) => item.role === "user");
    }
    return true;
  });
}

function buildRecentMessagesForRecall(
  rawMessages: unknown[],
  currentPrompt: string,
  config: { includeAssistant: boolean; maxMessageChars: number },
): MemoryMessage[] {
  const normalizedPrompt = canonicalizeUserQuery(currentPrompt);
  const normalized = sanitizeStoredMessages(normalizeMessages(rawMessages, {
    captureStrategy: "full_session",
    includeAssistant: config.includeAssistant,
    maxMessageChars: config.maxMessageChars,
  }));

  if (normalizedPrompt) {
    while (normalized.length > 0) {
      const last = normalized[normalized.length - 1];
      if (last?.role !== "user") break;
      if (canonicalizeUserQuery(last.content) !== normalizedPrompt) break;
      normalized.pop();
    }
  }

  return normalized.slice(-4);
}

function shouldLogStats(stats: HeartbeatStats): boolean {
  return stats.l0Captured > 0
    || stats.l1Created > 0
    || stats.l2TimeUpdated > 0
    || stats.l2ProjectUpdated > 0
    || stats.profileUpdated > 0
    || stats.failed > 0;
}

function logIndexStats(logger: LoggerLike, reason: string, stats: HeartbeatStats): void {
  if (!shouldLogStats(stats)) return;
  logger.info?.(
    `[clawxmemory] indexed reason=${reason} l0=${stats.l0Captured}, l1=${stats.l1Created}, l2_time=${stats.l2TimeUpdated}, l2_project=${stats.l2ProjectUpdated}, profile=${stats.profileUpdated}, failed=${stats.failed}`,
  );
}

function emptyStats(): HeartbeatStats {
  return {
    l0Captured: 0,
    l1Created: 0,
    l2TimeUpdated: 0,
    l2ProjectUpdated: 0,
    profileUpdated: 0,
    failed: 0,
  };
}

function mergeStats(left: HeartbeatStats, right: HeartbeatStats): HeartbeatStats {
  return {
    l0Captured: left.l0Captured + right.l0Captured,
    l1Created: left.l1Created + right.l1Created,
    l2TimeUpdated: left.l2TimeUpdated + right.l2TimeUpdated,
    l2ProjectUpdated: left.l2ProjectUpdated + right.l2ProjectUpdated,
    profileUpdated: left.profileUpdated + right.profileUpdated,
    failed: left.failed + right.failed,
  };
}

function sliceUiSnapshot(snapshot: MemoryUiSnapshot, limit: number): MemoryUiSnapshot {
  return {
    overview: { ...snapshot.overview },
    settings: { ...snapshot.settings },
    recentTimeIndexes: snapshot.recentTimeIndexes.slice(0, limit),
    recentProjectIndexes: snapshot.recentProjectIndexes.slice(0, limit),
    recentL1Windows: snapshot.recentL1Windows.slice(0, limit),
    recentSessions: snapshot.recentSessions.slice(0, limit),
    globalProfile: { ...snapshot.globalProfile },
  };
}

function replaceAssistantMessageText(rawMessage: unknown, text: string): unknown {
  const replacementContent = [{ type: "text", text }];
  if (!rawMessage || typeof rawMessage !== "object") {
    return { role: "assistant", content: replacementContent };
  }

  const root = { ...(rawMessage as Record<string, unknown>) };
  const nested = asObject(root.message);
  if (nested) {
    root.message = {
      ...nested,
      role: "assistant",
      content: replacementContent,
    };
    return root;
  }

  return {
    ...root,
    role: "assistant",
    content: replacementContent,
  };
}

function buildMemoryRecallSystemContext(evidenceBlock: string): string {
  return [
    "## ClawXMemory Recall",
    "Use the following retrieved ClawXMemory evidence for this turn.",
    evidenceBlock.trim(),
  ].filter(Boolean).join("\n\n");
}

export interface MemoryPluginRuntimeOptions {
  apiConfig: Record<string, unknown> | undefined;
  pluginRuntime: PluginRuntime | undefined;
  pluginConfig: Record<string, unknown> | undefined;
  logger: PluginLogger | undefined;
}

export class MemoryPluginRuntime {
  readonly logger: LoggerLike;
  readonly config: PluginRuntimeConfig;
  readonly repository: MemoryRepository;
  readonly indexer: HeartbeatIndexer;
  readonly retriever: ReasoningRetriever;
  readonly dreamRewriter: DreamRewriteRunner;

  private readonly pluginRuntime: PluginRuntime | undefined;
  private currentApiConfig: Record<string, unknown> | undefined;
  private readonly pendingBySession = new Map<string, MemoryMessage[]>();
  private readonly idleIndexTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debouncedSessions = new Set<string>();
  private readonly queuedSessionKeys = new Set<string>();
  private readonly effectiveSessionKeyByRawSession = new Map<string, string>();
  private readonly conversationGenerationByRawSession = new Map<string, number>();
  private readonly recentInboundBySession = new Map<string, number>();
  private readonly startupGraceByRawSession = new Set<string>();
  private readonly nonMemoryTurnByRawSession = new Map<string, number>();
  private readonly pendingCommandReplyByRawSession = new Map<string, number>();
  private readonly caseById = new Map<string, CaseTraceRecord>();
  private readonly recentCaseIds: string[] = [];
  private readonly activeCaseIdByRawSession = new Map<string, string>();

  private autoIndexTimer: ReturnType<typeof setInterval> | undefined;
  private autoDreamTimer: ReturnType<typeof setInterval> | undefined;
  private uiServer: LocalUiServer | undefined;
  private queuePromise: Promise<HeartbeatStats> | undefined;
  private activeSessionKey: string | undefined;
  private queuedFullRun = false;
  private queuedReason = "";
  private indexingInProgress = false;
  private started = false;
  private stopped = false;
  private startupRepairStatus: StartupRepairStatus = "idle";
  private startupRepairMessage = "";
  private startupRepairSnapshot: MemoryUiSnapshot | undefined;
  private dreamRunPromise: Promise<DreamRunResult> | undefined;
  private dreamRunLocked = false;

  constructor(options: MemoryPluginRuntimeOptions) {
    this.logger = safeLog(options.logger);
    this.pluginRuntime = options.pluginRuntime;
    this.currentApiConfig = options.apiConfig;
    this.config = buildPluginConfig(options.pluginConfig);

    const skills = this.config.skillsDir
      ? loadSkillsRuntime({ skillsDir: this.config.skillsDir, logger: this.logger })
      : loadSkillsRuntime({ logger: this.logger });
    this.repository = new MemoryRepository(this.config.dbPath);
    const persistedSettings = this.repository.getIndexingSettings(this.config.defaultIndexingSettings);
    const migratedSettings = this.maybeUpgradeIndexingSettings(persistedSettings);
    const extractor = new LlmMemoryExtractor(
      options.apiConfig ?? {},
      options.pluginRuntime as Record<string, unknown> | undefined,
      this.logger,
    );
    this.indexer = new HeartbeatIndexer(
      this.repository,
      extractor,
      {
        batchSize: this.config.heartbeatBatchSize,
        source: "openclaw",
        settings: migratedSettings,
        logger: this.logger,
      },
    );
    this.retriever = new ReasoningRetriever(
      this.repository,
      skills,
      extractor,
      {
        getSettings: () => this.indexer.getSettings(),
        isBackgroundBusy: () => this.indexingInProgress,
      },
    );
    this.dreamRewriter = new DreamRewriteRunner(this.repository, extractor, {
      logger: this.logger,
      getDreamProjectRebuildTimeoutMs: () => this.indexer.getSettings().dreamProjectRebuildTimeoutMs,
    });

    if (this.config.uiEnabled) {
      this.uiServer = new LocalUiServer(
        this.repository,
        this.retriever,
        {
          host: this.config.uiHost,
          port: this.config.uiPort,
          prefix: this.config.uiPathPrefix,
        },
        {
          getSettings: () => this.indexer.getSettings(),
          saveSettings: (partial) => this.applyIndexingSettings(partial),
          runIndexNow: () => this.flushAllNow("manual"),
          runDreamNow: () => this.runDreamNow("manual"),
          exportMemoryBundle: () => this.repository.exportMemoryBundle(),
          importMemoryBundle: (bundle) => this.replaceMemoryBundle(bundle),
          getRuntimeOverview: () => this.getRuntimeOverview(),
          getStartupRepairSnapshot: (limit) => this.getStartupRepairSnapshot(limit),
          listCaseTraces: (limit) => this.listRecentCaseTraces(limit),
          getCaseTrace: (caseId) => this.getCaseTrace(caseId),
        },
        this.logger,
      );
    }
  }

  private maybeUpgradeIndexingSettings(settings: IndexingSettings): IndexingSettings {
    const migrationState = this.repository.getPipelineState("indexingSettingsMigration");
    if (migrationState === INDEXING_SETTINGS_MIGRATION_VERSION) return settings;
    const normalized = this.repository.saveIndexingSettings(settings, this.config.defaultIndexingSettings);
    this.repository.setPipelineState("indexingSettingsMigration", INDEXING_SETTINGS_MIGRATION_VERSION);
    return normalized;
  }

  private setStartupRepairState(
    status: StartupRepairStatus,
    options?: { message?: string; snapshot?: MemoryUiSnapshot },
  ): void {
    this.startupRepairStatus = status;
    if (status === "idle") {
      this.startupRepairMessage = "";
      this.startupRepairSnapshot = undefined;
      return;
    }
    this.startupRepairMessage = options?.message?.trim() ?? "";
    this.startupRepairSnapshot = options?.snapshot;
  }

  private getStartupRepairSnapshot(limit: number): MemoryUiSnapshot | undefined {
    if (this.startupRepairStatus === "idle" || !this.startupRepairSnapshot) return undefined;
    return sliceUiSnapshot(this.startupRepairSnapshot, limit);
  }

  private listRecentCaseTraces(limit: number): CaseTraceRecord[] {
    return this.repository.listRecentCaseTraces(limit);
  }

  private getCaseTrace(caseId: string): CaseTraceRecord | undefined {
    return this.repository.getCaseTrace(caseId);
  }

  private trimCaseBuffer(): void {
    while (this.recentCaseIds.length > RECENT_CASE_LIMIT) {
      const removedId = this.recentCaseIds.pop();
      if (!removedId) break;
      this.caseById.delete(removedId);
      for (const [sessionKey, activeCaseId] of this.activeCaseIdByRawSession.entries()) {
        if (activeCaseId === removedId) {
          this.activeCaseIdByRawSession.delete(sessionKey);
        }
      }
    }
  }

  private upsertCase(record: CaseTraceRecord): void {
    this.caseById.set(record.caseId, record);
    const existingIndex = this.recentCaseIds.indexOf(record.caseId);
    if (existingIndex >= 0) this.recentCaseIds.splice(existingIndex, 1);
    this.recentCaseIds.unshift(record.caseId);
    this.trimCaseBuffer();
    this.repository.saveCaseTrace(record, RECENT_CASE_LIMIT);
  }

  private ensureCase(rawSessionKey: string, query: string): CaseTraceRecord {
    const trimmedSession = rawSessionKey.trim();
    const normalizedQuery = canonicalizeUserQuery(query);
    const activeCaseId = this.activeCaseIdByRawSession.get(trimmedSession);
    if (activeCaseId) {
      const activeRecord = this.caseById.get(activeCaseId);
      if (activeRecord && activeRecord.status === "running") return activeRecord;
    }

    const startedAt = nowIso();
    const record: CaseTraceRecord = {
      caseId: buildCaseId(trimmedSession, normalizedQuery || startedAt),
      sessionKey: trimmedSession,
      query: normalizedQuery,
      startedAt,
      status: "running",
      toolEvents: [],
      assistantReply: "",
    };
    this.activeCaseIdByRawSession.set(trimmedSession, record.caseId);
    this.upsertCase(record);
    return record;
  }

  private getActiveCase(rawSessionKey: string): CaseTraceRecord | undefined {
    const trimmedSession = rawSessionKey.trim();
    if (!trimmedSession) return undefined;
    const caseId = this.activeCaseIdByRawSession.get(trimmedSession);
    if (!caseId) return undefined;
    return this.caseById.get(caseId);
  }

  private interruptActiveCase(rawSessionKey: string, reason = "interrupted_by_new_turn"): void {
    const trimmedSession = rawSessionKey.trim();
    if (!trimmedSession) return;
    const caseId = this.activeCaseIdByRawSession.get(trimmedSession);
    if (!caseId) return;
    const record = this.caseById.get(caseId);
    if (!record || record.status !== "running") {
      this.activeCaseIdByRawSession.delete(trimmedSession);
      return;
    }
    record.status = "interrupted";
    record.finishedAt = nowIso();
    if (record.retrieval?.trace && !record.retrieval.trace.steps.some((step) => step.kind === "recall_skipped")) {
      record.retrieval.trace.steps.push({
        stepId: `${record.retrieval.trace.traceId}:step:${record.retrieval.trace.steps.length + 1}`,
        kind: "recall_skipped",
        title: "Recall Interrupted",
        status: "warning",
        inputSummary: `reason=${reason}`,
        outputSummary: "A newer user turn interrupted this case before completion.",
      });
      record.retrieval.trace.finishedAt = nowIso();
    }
    this.upsertCase(record);
    this.activeCaseIdByRawSession.delete(trimmedSession);
  }

  private updateCaseRetrieval(
    rawSessionKey: string,
    query: string,
    result: Pick<RetrievalResult, "intent" | "enoughAt" | "context" | "trace" | "evidenceNote">,
  ): void {
    const record = this.ensureCase(rawSessionKey, query);
    const trace = result.trace ? cloneJson(result.trace) : null;
    record.retrieval = {
      intent: result.intent,
      enoughAt: result.enoughAt,
      injected: Boolean(result.context.trim()),
      contextPreview: previewText(result.context, 1200),
      evidenceNotePreview: previewText(result.evidenceNote, 1200),
      pathSummary: deriveCasePathSummary(trace, result.enoughAt),
      trace,
    };
    this.upsertCase(record);
  }

  private updateCaseRecallSkipped(rawSessionKey: string, query: string, reason: string): void {
    const record = this.ensureCase(rawSessionKey, query);
    record.retrieval = {
      intent: "general",
      enoughAt: "none",
      injected: false,
      contextPreview: "",
      evidenceNotePreview: "",
      pathSummary: "none",
      trace: buildRecallSkippedTrace(query, reason),
    };
    this.upsertCase(record);
  }

  private appendCaseToolEvent(rawSessionKey: string, query: string, event: CaseToolEvent): void {
    const record = this.getActiveCase(rawSessionKey) ?? (query.trim() ? this.ensureCase(rawSessionKey, query) : undefined);
    if (!record) return;
    record.toolEvents.push(event);
    this.upsertCase(record);
  }

  private finalizeCase(rawSessionKey: string, query: string, status: CaseTraceRecord["status"], assistantReply = ""): void {
    const trimmedSession = rawSessionKey.trim();
    if (!trimmedSession) return;
    const record = this.getActiveCase(trimmedSession) ?? (query.trim() ? this.ensureCase(trimmedSession, query) : undefined);
    if (!record) return;
    if (assistantReply.trim()) {
      record.assistantReply = previewText(assistantReply, 4000);
    }
    record.status = status;
    record.finishedAt = nowIso();
    if (record.retrieval?.trace) {
      record.retrieval.trace.finishedAt = record.finishedAt;
    }
    this.upsertCase(record);
    this.activeCaseIdByRawSession.delete(trimmedSession);
  }

  private clearEphemeralMemoryState(): void {
    for (const sessionKey of Array.from(this.idleIndexTimers.keys())) {
      this.clearIdleTimer(sessionKey);
    }
    this.pendingBySession.clear();
    this.debouncedSessions.clear();
    this.queuedSessionKeys.clear();
    this.queuedFullRun = false;
    this.queuedReason = "";
    this.activeSessionKey = undefined;
    this.effectiveSessionKeyByRawSession.clear();
    this.conversationGenerationByRawSession.clear();
    this.recentInboundBySession.clear();
    this.startupGraceByRawSession.clear();
    this.nonMemoryTurnByRawSession.clear();
    this.pendingCommandReplyByRawSession.clear();
    this.caseById.clear();
    this.recentCaseIds.splice(0);
    this.activeCaseIdByRawSession.clear();
    this.retriever.resetTransientState();
  }

  async replaceMemoryBundle(bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    this.setStartupRepairState("idle");
    this.clearEphemeralMemoryState();
    if (this.queuePromise) {
      try {
        await this.queuePromise;
      } catch (error) {
        this.logger.warn?.(`[clawxmemory] pending index queue failed before import: ${String(error)}`);
      }
    }
    this.clearEphemeralMemoryState();
    return this.repository.importMemoryBundle(bundle);
  }

  getTools() {
    return buildPluginTools(this.repository, this.retriever, {
      getOverview: () => ({
        ...this.repository.getOverview(),
        ...this.getRuntimeOverview(),
      }),
      flushAll: () => this.flushAllNow("manual"),
    });
  }

  getMemoryRuntimeAdapter() {
    return {
      getMemorySearchManager: async (): Promise<{
        manager: null;
        error: string;
      }> => {
        this.ensureStarted();
        return {
          manager: null,
          error: "ClawXMemory manages dynamic session memory and does not expose OpenClaw file-memory search managers.",
        };
      },
      resolveMemoryBackendConfig: (): { backend: "builtin" } => {
        this.ensureStarted();
        return { backend: "builtin" };
      },
      closeAllMemorySearchManagers: async (): Promise<void> => {},
    };
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.rescheduleBackgroundTasks();
    this.uiServer?.start();
    void this.runStartupInitialization().catch((error) => {
      if (this.stopped) return;
      this.logger.warn?.(`[clawxmemory] startup initialization failed: ${String(error)}`);
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    this.clearBackgroundTimers();
    for (const sessionKey of Array.from(this.idleIndexTimers.keys())) {
      this.clearIdleTimer(sessionKey);
    }
    this.pendingBySession.clear();
    this.effectiveSessionKeyByRawSession.clear();
    this.conversationGenerationByRawSession.clear();
    this.recentInboundBySession.clear();
    this.startupGraceByRawSession.clear();
    this.nonMemoryTurnByRawSession.clear();
    this.pendingCommandReplyByRawSession.clear();
    this.uiServer?.stop();
    this.repository.close();
  }

  private ensureStarted(): void {
    if (this.started || this.stopped) return;
    this.start();
  }

  private appendPendingMessage(sessionKey: string, message: MemoryMessage): void {
    const pending = this.pendingBySession.get(sessionKey) ?? [];
    const previous = pending[pending.length - 1];
    if (!previous || previous.role !== message.role || previous.content !== message.content) {
      pending.push(message);
      this.pendingBySession.set(sessionKey, pending);
    }
  }

  private markRecentInbound(sessionKey: string): void {
    this.recentInboundBySession.set(sessionKey, Date.now());
  }

  private hasRecentInbound(sessionKey: string): boolean {
    const receivedAt = this.recentInboundBySession.get(sessionKey);
    if (!receivedAt) return false;
    if (Date.now() - receivedAt > RECENT_INBOUND_TTL_MS) {
      this.recentInboundBySession.delete(sessionKey);
      return false;
    }
    return true;
  }

  private markStartupGrace(rawSessionKey: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed || trimmed.startsWith("temp:")) return;
    this.startupGraceByRawSession.add(trimmed);
  }

  private hasStartupGrace(rawSessionKey: string): boolean {
    const trimmed = rawSessionKey.trim();
    return Boolean(trimmed) && this.startupGraceByRawSession.has(trimmed);
  }

  private clearStartupGrace(rawSessionKey: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed) return;
    this.startupGraceByRawSession.delete(trimmed);
  }

  private markNonMemoryTurn(rawSessionKey: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed || trimmed.startsWith("temp:")) return;
    this.nonMemoryTurnByRawSession.set(trimmed, Date.now());
  }

  private hasNonMemoryTurn(rawSessionKey: string): boolean {
    const trimmed = rawSessionKey.trim();
    if (!trimmed) return false;
    const markedAt = this.nonMemoryTurnByRawSession.get(trimmed);
    if (!markedAt) return false;
    if (Date.now() - markedAt > NON_MEMORY_TURN_TTL_MS) {
      this.nonMemoryTurnByRawSession.delete(trimmed);
      return false;
    }
    return true;
  }

  private clearNonMemoryTurn(rawSessionKey: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed) return;
    this.nonMemoryTurnByRawSession.delete(trimmed);
  }

  private markPendingCommandReply(rawSessionKey: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed || trimmed.startsWith("temp:")) return;
    this.pendingCommandReplyByRawSession.set(trimmed, Date.now());
  }

  private hasPendingCommandReply(rawSessionKey: string): boolean {
    const trimmed = rawSessionKey.trim();
    if (!trimmed) return false;
    const markedAt = this.pendingCommandReplyByRawSession.get(trimmed);
    if (!markedAt) return false;
    if (Date.now() - markedAt > COMMAND_REPLY_TTL_MS) {
      this.pendingCommandReplyByRawSession.delete(trimmed);
      return false;
    }
    return true;
  }

  private clearPendingCommandReply(rawSessionKey: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed) return;
    this.pendingCommandReplyByRawSession.delete(trimmed);
  }

  private getEffectiveSessionKey(rawSessionKey: string): string {
    const trimmed = rawSessionKey.trim();
    if (!trimmed) return trimmed;
    const cached = this.effectiveSessionKeyByRawSession.get(trimmed);
    if (cached) return cached;
    this.effectiveSessionKeyByRawSession.set(trimmed, trimmed);
    this.conversationGenerationByRawSession.set(trimmed, 0);
    return trimmed;
  }

  private rotateConversationWindow(rawSessionKey: string, reason: string): void {
    const trimmed = rawSessionKey.trim();
    if (!trimmed || trimmed.startsWith("temp:")) return;
    const previousSessionKey = this.getEffectiveSessionKey(trimmed);
    const pending = this.pendingBySession.get(previousSessionKey) ?? [];
    const pendingMessages = sanitizeStoredMessages(pending);
    if (pendingMessages.length > 0 && pendingMessages.some((message) => message.role === "user")) {
      const captured = this.indexer.captureL0Session({
        sessionKey: previousSessionKey,
        timestamp: nowIso(),
        messages: pendingMessages,
      });
      if (captured) {
        this.logger.info?.(`[clawxmemory] captured pending l0 before ${reason} session=${previousSessionKey}`);
      }
    }
    const nextGeneration = (this.conversationGenerationByRawSession.get(trimmed) ?? 0) + 1;
    const nextSessionKey = `${trimmed}#window:${nextGeneration}`;
    this.conversationGenerationByRawSession.set(trimmed, nextGeneration);
    this.effectiveSessionKeyByRawSession.set(trimmed, nextSessionKey);

    this.pendingBySession.delete(previousSessionKey);
    this.recentInboundBySession.delete(previousSessionKey);
    if (this.activeSessionKey === previousSessionKey) {
      this.activeSessionKey = undefined;
    }

    void this.flushSessionNow(previousSessionKey, reason).catch((error) => {
      this.logger.warn?.(`[clawxmemory] ${reason} failed session=${previousSessionKey}: ${String(error)}`);
    });
    this.logger.info?.(
      `[clawxmemory] opened new conversation window raw_session=${trimmed} previous=${previousSessionKey} next=${nextSessionKey} reason=${reason}`,
    );
  }

  handleInternalMessageReceived = (event: InternalHookEvent): void => {
    if (event.type !== "message" || event.action !== "received") return;
    this.ensureStarted();
    const rawSessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
    if (!rawSessionKey || rawSessionKey.startsWith("temp:")) return;

    const context = event.context && typeof event.context === "object"
      ? event.context as Record<string, unknown>
      : undefined;
    const rawContent = typeof context?.content === "string" ? context.content.trim() : "";
    if (!rawContent || isControlCommandText(rawContent) || isSessionStartupMarkerText(rawContent)) return;

    const sessionKey = this.getEffectiveSessionKey(rawSessionKey);
    const rawMessageId = typeof context?.messageId === "string" ? context.messageId.trim() : "";
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: rawContent,
        ...(rawMessageId ? { id: rawMessageId } : {}),
      },
      {
        includeAssistant: this.config.includeAssistant,
        maxMessageChars: this.config.maxMessageChars,
      },
    );
    if (!normalized || normalized.role !== "user") return;

    this.appendPendingMessage(sessionKey, normalized);
    this.markRecentInbound(sessionKey);
  };

  handleInternalCommandEvent = (event: InternalHookEvent): void => {
    if (event.type !== "command") return;
    this.ensureStarted();
    const rawSessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
    if (!rawSessionKey || rawSessionKey.startsWith("temp:")) return;

    const action = typeof event.action === "string" ? event.action.trim().toLowerCase() : "";
    if (!action) return;

    if (action === "new" || action === "reset") {
      this.markStartupGrace(rawSessionKey);
      this.markNonMemoryTurn(rawSessionKey);
      this.clearPendingCommandReply(rawSessionKey);
      return;
    }

    this.markPendingCommandReply(rawSessionKey);
  };

  handleBeforePromptBuild = async (
    event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforePromptBuildResult | void> => {
    this.ensureStarted();
    const prompt = typeof event.prompt === "string" ? event.prompt : "";
    const normalizedPrompt = canonicalizeUserQuery(prompt);
    const rawSessionKey = typeof ctx.sessionKey === "string" && ctx.sessionKey.trim()
      ? ctx.sessionKey.trim()
      : resolveSessionKey(ctx as Record<string, unknown>);
    if (!normalizedPrompt || isSessionStartupMarkerText(normalizedPrompt) || isControlCommandText(normalizedPrompt)) {
      return;
    }
    if (!this.config.recallEnabled) {
      if (normalizedPrompt) this.updateCaseRecallSkipped(rawSessionKey, normalizedPrompt, "recall_disabled");
      return;
    }
    if (normalizedPrompt.length < 2) {
      if (normalizedPrompt) this.updateCaseRecallSkipped(rawSessionKey, normalizedPrompt, "prompt_too_short");
      return;
    }
    try {
      const startedAt = Date.now();
      const settings = this.indexer.getSettings();
      const recallTopK = Math.max(1, Math.min(50, settings.recallTopK || 10));
      const recentMessages = Array.isArray(event.messages)
        ? buildRecentMessagesForRecall(event.messages, normalizedPrompt, {
            includeAssistant: this.config.includeAssistant,
            maxMessageChars: this.config.maxMessageChars,
          })
        : [];
      const retrieved = await this.retriever.retrieve(normalizedPrompt, {
        retrievalMode: "auto",
        l2Limit: recallTopK,
        l1Limit: recallTopK,
        l0Limit: recallTopK,
        includeFacts: true,
        recentMessages,
      });
      const elapsedMs = Date.now() - startedAt;
      const injected = Boolean(retrieved.context?.trim());
      this.updateCaseRetrieval(rawSessionKey, normalizedPrompt, retrieved);
      this.logger.info?.(
        `[clawxmemory] recall mode=${retrieved.debug?.mode ?? "none"} reasoning_mode=${settings.reasoningMode} recall_top_k=${recallTopK} enough_at=${retrieved.enoughAt} injected=${injected} elapsed_ms=${retrieved.debug?.elapsedMs ?? elapsedMs} cache_hit=${retrieved.debug?.cacheHit ? "1" : "0"}`,
      );
      if (!retrieved.context.trim()) return;
      // Dynamic recall must stay in system prompt space; prependContext leaks into user-visible prompt displays.
      return { prependSystemContext: buildMemoryRecallSystemContext(retrieved.context) };
    } catch (error) {
      if (normalizedPrompt) this.updateCaseRecallSkipped(rawSessionKey, normalizedPrompt, "error");
      this.logger.warn?.(`[clawxmemory] recall failed: ${String(error)}`);
      return;
    }
  };

  handleBeforeMessageWrite = (
    event: PluginHookBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ): PluginHookBeforeMessageWriteResult | void => {
    this.ensureStarted();
    const rawSessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey.trim() : "";
    if (!rawSessionKey || rawSessionKey.startsWith("temp:")) return;
    const messageInfo = inspectTranscriptMessage(event.message);

    if (messageInfo.role === "user" && isSessionBoundaryMarkerMessage(event.message)) {
      this.markStartupGrace(rawSessionKey);
      this.markNonMemoryTurn(rawSessionKey);
      this.rotateConversationWindow(rawSessionKey, "session_boundary_marker");
      this.logger.info?.(`[clawxmemory] blocked startup marker session=${rawSessionKey}`);
      return { block: true };
    }

    if (messageInfo.role === "user" && isCommandOnlyUserText(messageInfo.content)) {
      this.markNonMemoryTurn(rawSessionKey);
      this.markPendingCommandReply(rawSessionKey);
      return;
    }

    if (messageInfo.role === "user" && messageInfo.content.trim()) {
      const normalizedQuery = canonicalizeUserQuery(messageInfo.content);
      const activeCase = this.getActiveCase(rawSessionKey);
      if (!activeCase || canonicalizeUserQuery(activeCase.query) !== normalizedQuery) {
        if (activeCase?.status === "running") {
          this.interruptActiveCase(rawSessionKey);
        }
        this.ensureCase(rawSessionKey, normalizedQuery);
      }
    }

    if (messageInfo.role === "assistant" && !messageInfo.content && !messageInfo.hasToolCalls) {
      if (this.hasStartupGrace(rawSessionKey)) {
        this.clearStartupGrace(rawSessionKey);
        this.logger.warn?.(`[clawxmemory] replaced empty startup assistant session=${rawSessionKey}`);
        return {
          message: replaceAssistantMessageText(
            event.message,
            STARTUP_FALLBACK_GREETING,
          ) as typeof event.message,
        };
      }
      this.logger.warn?.(`[clawxmemory] blocked empty assistant message session=${rawSessionKey}`);
      return { block: true };
    }

    if (messageInfo.role === "assistant" && this.hasPendingCommandReply(rawSessionKey)) {
      this.clearPendingCommandReply(rawSessionKey);
      this.logger.info?.(`[clawxmemory] skipped command reply from memory session=${rawSessionKey}`);
      return;
    }

    if (messageInfo.role === "assistant" && messageInfo.content && this.hasStartupGrace(rawSessionKey)) {
      this.clearStartupGrace(rawSessionKey);
    }

    if (
      messageInfo.role === "user"
      && !this.hasStartupGrace(rawSessionKey)
      && !this.hasPendingCommandReply(rawSessionKey)
    ) {
      this.clearNonMemoryTurn(rawSessionKey);
    }

    const sessionKey = this.getEffectiveSessionKey(rawSessionKey);
    const normalized = normalizeTranscriptMessage(event.message, {
      includeAssistant: this.config.includeAssistant,
      maxMessageChars: this.config.maxMessageChars,
    });
    if (!normalized) return;
    if (normalized.role === "user" && this.hasRecentInbound(sessionKey)) {
      const pending = this.pendingBySession.get(sessionKey) ?? [];
      if (pending[pending.length - 1]?.role === "user") {
        return;
      }
    }
    this.appendPendingMessage(sessionKey, normalized);
  };

  handleBeforeToolCall = (
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext,
  ): void => {
    this.ensureStarted();
    const rawSessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey.trim() : "";
    if (!rawSessionKey || rawSessionKey.startsWith("temp:")) return;
    const query = this.getActiveCase(rawSessionKey)?.query ?? "";
    if (!query) return;
    const occurredAt = nowIso();
    this.appendCaseToolEvent(rawSessionKey, query, {
      eventId: buildToolEventId(rawSessionKey, event.toolName, occurredAt),
      phase: "start",
      toolName: event.toolName,
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      occurredAt,
      status: "running",
      summary: `${event.toolName} started.`,
      paramsPreview: previewJson(event.params, 360),
    });
  };

  handleAfterToolCall = (
    event: PluginHookAfterToolCallEvent,
    ctx: PluginHookToolContext,
  ): void => {
    this.ensureStarted();
    const rawSessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey.trim() : "";
    if (!rawSessionKey || rawSessionKey.startsWith("temp:")) return;
    const query = this.getActiveCase(rawSessionKey)?.query ?? "";
    if (!query) return;
    const occurredAt = nowIso();
    const failed = typeof event.error === "string" && event.error.trim().length > 0;
    const resultPreview = failed
      ? previewText(event.error ?? "", 360)
      : previewJson(event.result, 360);
    this.appendCaseToolEvent(rawSessionKey, query, {
      eventId: buildToolEventId(rawSessionKey, event.toolName, occurredAt),
      phase: "result",
      toolName: event.toolName,
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      occurredAt,
      status: failed ? "error" : "success",
      summary: failed
        ? `${event.toolName} failed.`
        : `${event.toolName} completed.`,
      paramsPreview: previewJson(event.params, 240),
      resultPreview,
      ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
    });
  };

  handleAgentEnd = async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): Promise<void> => {
    this.ensureStarted();
    if (!this.config.addEnabled) return;
    if (shouldSkipCapture(event as unknown as Record<string, unknown>, ctx as Record<string, unknown>)) return;

    const rawSessionKey = typeof ctx.sessionKey === "string" && ctx.sessionKey.trim()
      ? ctx.sessionKey.trim()
      : resolveSessionKey(ctx as Record<string, unknown>);
    const sessionKey = this.getEffectiveSessionKey(rawSessionKey);
    try {
      if (this.hasNonMemoryTurn(rawSessionKey)) {
        this.pendingBySession.delete(sessionKey);
        this.recentInboundBySession.delete(sessionKey);
        return;
      }

      if (this.activeSessionKey && this.activeSessionKey !== sessionKey) {
        void this.flushSessionNow(this.activeSessionKey, "session_boundary").catch((error) => {
          this.logger.warn?.(`[clawxmemory] session_boundary failed: ${String(error)}`);
        });
      }
      this.activeSessionKey = sessionKey;

      const pending = this.pendingBySession.get(sessionKey) ?? [];
      this.pendingBySession.delete(sessionKey);
      this.recentInboundBySession.delete(sessionKey);
      let messages = sanitizeStoredMessages(pending);
      const rawMessages = Array.isArray(event.messages)
        ? sanitizeL0Record({ sessionKey, messages: event.messages }, this.config)
        : [];
      if (messages.length === 0) {
        messages = rawMessages;
      } else if (!messages.some((message) => message.role === "assistant")) {
        const assistantReply = extractAssistantReply(rawMessages);
        if (assistantReply) {
          messages = [...messages, { role: "assistant", content: assistantReply }];
        }
      }
      if (messages.length === 0) {
        if (this.activeCaseIdByRawSession.has(rawSessionKey)) {
          this.finalizeCase(rawSessionKey, "", "completed");
        }
        return;
      }
      if (!messages.some((message) => message.role === "user")) {
        if (this.activeCaseIdByRawSession.has(rawSessionKey)) {
          this.finalizeCase(rawSessionKey, "", "completed", extractAssistantReply(messages));
        }
        return;
      }
      const activeCase = this.getActiveCase(rawSessionKey);
      const userQuery = messages.find((message) => message.role === "user")?.content ?? "";
      if (activeCase && !activeCase.retrieval) {
        this.updateCaseRecallSkipped(rawSessionKey, userQuery || activeCase.query, "empty_context");
      }
      this.finalizeCase(rawSessionKey, userQuery, "completed", extractAssistantReply(messages));

      const captured = this.indexer.captureL0Session({
        sessionKey,
        timestamp: nowIso(),
        messages,
      });
      if (captured) {
        this.logger.info?.(
          `[clawxmemory] captured l0 session=${sessionKey} indexed=pending trigger=idle|timer|session_boundary|manual`,
        );
        this.scheduleIdleIndex(sessionKey);
      }
    } finally {
      this.clearNonMemoryTurn(rawSessionKey);
      this.clearPendingCommandReply(rawSessionKey);
    }
  };

  handleBeforeReset = async (event: PluginHookBeforeResetEvent, ctx: PluginHookAgentContext): Promise<void> => {
    this.ensureStarted();
    if (!this.config.addEnabled) return;
    const fallbackRawSession = typeof ctx.sessionKey === "string" && ctx.sessionKey.trim()
      ? this.getEffectiveSessionKey(ctx.sessionKey)
      : this.activeSessionKey;
    const sessionKey = fallbackRawSession?.trim() ?? "";
    if (!sessionKey || sessionKey.startsWith("temp:")) return;

    try {
      this.interruptActiveCase(ctx.sessionKey ?? sessionKey, "before_reset");
      const pending = this.pendingBySession.get(sessionKey) ?? [];
      this.pendingBySession.delete(sessionKey);
      this.recentInboundBySession.delete(sessionKey);
      let messages = sanitizeStoredMessages(pending);
      if (messages.length === 0 && Array.isArray(event.messages)) {
        messages = sanitizeL0Record({ sessionKey, messages: event.messages }, this.config);
      }
      if (messages.length > 0 && messages.some((message) => message.role === "user")) {
        const captured = this.indexer.captureL0Session({
          sessionKey,
          timestamp: nowIso(),
          messages,
        });
        if (captured) {
          this.logger.info?.(`[clawxmemory] captured pending l0 before reset session=${sessionKey}`);
        }
      }
      await this.flushSessionNow(sessionKey, "before_reset");
      if (this.activeSessionKey === sessionKey) {
        this.activeSessionKey = undefined;
      }
    } catch (error) {
      this.logger.warn?.(`[clawxmemory] before_reset flush failed session=${sessionKey}: ${String(error)}`);
    }
  };

  private getRuntimeOverview(): Pick<
    DashboardOverview,
    | "queuedSessions"
    | "lastRecallMs"
    | "recallTimeouts"
    | "lastRecallMode"
    | "currentReasoningMode"
    | "lastRecallPath"
    | "lastRecallBudgetLimited"
    | "lastShadowDeepQueued"
    | "lastRecallInjected"
    | "lastRecallEnoughAt"
    | "lastRecallCacheHit"
    | "slotOwner"
    | "dynamicMemoryRuntime"
    | "workspaceBootstrapPresent"
    | "memoryRuntimeHealthy"
    | "runtimeIssues"
    | "startupRepairStatus"
    | "startupRepairMessage"
  > {
    const queuedSessions = this.queuedFullRun
      ? Math.max(1, this.debouncedSessions.size + this.queuedSessionKeys.size)
      : new Set([...this.debouncedSessions, ...this.queuedSessionKeys]).size;
    const stats = this.retriever.getRuntimeStats();
    const diagnostics = this.collectMemoryBoundaryDiagnostics();
    return {
      queuedSessions,
      lastRecallMs: stats.lastRecallMs,
      recallTimeouts: stats.recallTimeouts,
      lastRecallMode: stats.lastRecallMode,
      currentReasoningMode: this.indexer.getSettings().reasoningMode,
      lastRecallPath: stats.lastRecallPath,
      lastRecallBudgetLimited: stats.lastRecallBudgetLimited,
      lastShadowDeepQueued: stats.lastShadowDeepQueued,
      lastRecallInjected: stats.lastRecallInjected,
      lastRecallEnoughAt: stats.lastRecallEnoughAt,
      lastRecallCacheHit: stats.lastRecallCacheHit,
      slotOwner: diagnostics.slotOwner,
      dynamicMemoryRuntime: diagnostics.dynamicMemoryRuntime,
      workspaceBootstrapPresent: diagnostics.workspaceBootstrapPresent,
      memoryRuntimeHealthy: diagnostics.memoryRuntimeHealthy,
      runtimeIssues: diagnostics.runtimeIssues,
      startupRepairStatus: this.startupRepairStatus,
      ...(this.startupRepairMessage ? { startupRepairMessage: this.startupRepairMessage } : {}),
    };
  }

  private clearIdleTimer(sessionKey: string): void {
    const timer = this.idleIndexTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      this.idleIndexTimers.delete(sessionKey);
    }
    this.debouncedSessions.delete(sessionKey);
  }

  private async drainIndexQueue(): Promise<HeartbeatStats> {
    let aggregate = emptyStats();
    try {
      while (this.queuedFullRun || this.queuedSessionKeys.size > 0) {
        const reason = this.queuedReason || "heartbeat";
        const runAll = this.queuedFullRun;
        const sessionKeys = runAll ? undefined : Array.from(this.queuedSessionKeys);
        this.queuedFullRun = false;
        this.queuedSessionKeys.clear();
        this.queuedReason = "";

        this.indexingInProgress = true;
        const stats = runAll
          ? await this.indexer.runHeartbeat({ reason })
          : await this.indexer.runHeartbeat({ reason, sessionKeys: sessionKeys ?? [] });
        aggregate = mergeStats(aggregate, stats);
        logIndexStats(this.logger, reason, stats);
        if (runAll && this.startupRepairStatus === "failed" && !reason.includes("repair")) {
          this.setStartupRepairState("idle");
        }
      }
    } finally {
      this.indexingInProgress = false;
      this.queuePromise = undefined;
    }
    return aggregate;
  }

  private requestIndexRun(
    reason: string,
    sessionKeys?: string[],
    options?: { allowWhileDream?: boolean },
  ): Promise<HeartbeatStats> {
    if (sessionKeys && sessionKeys.length > 0) {
      sessionKeys.filter(Boolean).forEach((sessionKey) => this.queuedSessionKeys.add(sessionKey));
    } else {
      this.queuedFullRun = true;
    }
    this.queuedReason = this.queuedReason ? `${this.queuedReason}+${reason}` : reason;
    if (!this.queuePromise && (!this.dreamRunLocked || options?.allowWhileDream)) {
      this.queuePromise = this.drainIndexQueue();
    }
    if (!this.queuePromise) {
      return (async () => {
        await this.dreamRunPromise;
        return this.queuePromise ? await this.queuePromise : emptyStats();
      })();
    }
    return this.queuePromise;
  }

  private clearBackgroundTimers(): void {
    if (this.autoIndexTimer) {
      clearInterval(this.autoIndexTimer);
      this.autoIndexTimer = undefined;
    }
    if (this.autoDreamTimer) {
      clearInterval(this.autoDreamTimer);
      this.autoDreamTimer = undefined;
    }
  }

  private rescheduleBackgroundTasks(): void {
    this.clearBackgroundTimers();
    const settings = this.indexer.getSettings();
    if (settings.autoIndexIntervalMinutes > 0) {
      this.autoIndexTimer = setInterval(() => {
        for (const sessionKey of Array.from(this.debouncedSessions)) {
          this.clearIdleTimer(sessionKey);
        }
        void this.requestIndexRun("scheduled").catch((error) => {
          this.logger.warn?.(`[clawxmemory] scheduled index failed: ${String(error)}`);
        });
      }, settings.autoIndexIntervalMinutes * 60_000);
    }
    if (settings.autoDreamIntervalMinutes > 0) {
      this.autoDreamTimer = setInterval(() => {
        void this.runDreamNow("scheduled").catch((error) => {
          this.logger.warn?.(`[clawxmemory] scheduled dream failed: ${String(error)}`);
        });
      }, settings.autoDreamIntervalMinutes * 60_000);
    }
  }

  private applyIndexingSettings(partial: Partial<IndexingSettings>): IndexingSettings {
    const merged = this.repository.saveIndexingSettings(
      {
        ...this.indexer.getSettings(),
        ...partial,
      },
      this.config.defaultIndexingSettings,
    );
    this.indexer.setSettings(merged);
    this.rescheduleBackgroundTasks();
    return merged;
  }

  private getLatestL1EndedAt(): string | undefined {
    const windows = this.repository.listAllL1();
    if (windows.length === 0) return undefined;
    return windows[windows.length - 1]?.endedAt || undefined;
  }

  private getNewL1CountSinceLastSuccessfulDream(): { count: number; latestEndedAt?: string } {
    const cutoff = this.repository.getPipelineState(LAST_DREAM_L1_ENDED_AT_STATE_KEY)?.trim() || "";
    const windows = this.repository.listAllL1();
    let latestEndedAt: string | undefined;
    let count = 0;
    for (const window of windows) {
      if (!latestEndedAt || window.endedAt > latestEndedAt) {
        latestEndedAt = window.endedAt;
      }
      if (!cutoff || window.endedAt > cutoff) {
        count += 1;
      }
    }
    return {
      count,
      ...(latestEndedAt ? { latestEndedAt } : {}),
    };
  }

  private recordDreamLifecycle(
    status: "running" | "success" | "skipped" | "failed",
    summary: string,
    options?: { completedAt?: string; latestL1EndedAt?: string },
  ): void {
    this.repository.setPipelineState(LAST_DREAM_STATUS_STATE_KEY, status);
    this.repository.setPipelineState(LAST_DREAM_SUMMARY_STATE_KEY, summary.trim());
    if (options?.completedAt) {
      this.repository.setPipelineState(LAST_DREAM_AT_STATE_KEY, options.completedAt);
    }
    if (options?.latestL1EndedAt) {
      this.repository.setPipelineState(LAST_DREAM_L1_ENDED_AT_STATE_KEY, options.latestL1EndedAt);
    }
  }

  private buildSkippedDreamResult(
    trigger: "manual" | "scheduled",
    prepFlush: HeartbeatStats,
    summary: string,
    skipReason: string,
  ): DreamRunResult {
    return {
      prepFlush,
      reviewedL1: 0,
      rewrittenProjects: 0,
      deletedProjects: 0,
      profileUpdated: false,
      duplicateTopicCount: 0,
      conflictTopicCount: 0,
      prunedProjectL1Refs: 0,
      prunedProfileL1Refs: 0,
      summary,
      trigger,
      status: "skipped",
      skipReason,
    };
  }

  private scheduleIdleIndex(sessionKey: string): void {
    this.clearIdleTimer(sessionKey);
    this.debouncedSessions.add(sessionKey);
    const delayMs = this.config.indexIdleDebounceMs;
    const timer = setTimeout(() => {
      this.idleIndexTimers.delete(sessionKey);
      this.debouncedSessions.delete(sessionKey);
      void this.requestIndexRun("message_capture", [sessionKey]).catch((error) => {
        this.logger.warn?.(`[clawxmemory] async message_capture failed: ${String(error)}`);
      });
    }, delayMs);
    this.idleIndexTimers.set(sessionKey, timer);
  }

  private flushSessionNow(sessionKey: string, reason: string): Promise<HeartbeatStats> {
    this.clearIdleTimer(sessionKey);
    return this.requestIndexRun(reason, [sessionKey]);
  }

  private flushAllNow(reason: string, options?: { allowWhileDream?: boolean }): Promise<HeartbeatStats> {
    for (const sessionKey of Array.from(this.debouncedSessions)) {
      this.clearIdleTimer(sessionKey);
    }
    return this.requestIndexRun(reason, undefined, options);
  }

  private async runDreamNow(trigger: "manual" | "scheduled"): Promise<DreamRunResult> {
    if (this.dreamRunLocked || this.dreamRunPromise) {
      if (trigger === "scheduled") {
        return this.buildSkippedDreamResult(
          trigger,
          emptyStats(),
          "Skipped automatic Dream because another Dream reconstruction is already running.",
          "already_running",
        );
      }
      throw new Error("Dream reconstruction is already running");
    }

    this.dreamRunLocked = true;
    const promise = (async () => {
      this.recordDreamLifecycle(
        "running",
        trigger === "scheduled" ? "Automatic Dream is running." : "Manual Dream is running.",
      );
      if (this.queuePromise) {
        await this.queuePromise;
      }
      const prepFlush = await this.flushAllNow("dream_prep", { allowWhileDream: true });
      if (trigger === "scheduled") {
        const settings = this.indexer.getSettings();
        const { count: newL1Count } = this.getNewL1CountSinceLastSuccessfulDream();
        if (newL1Count < settings.autoDreamMinNewL1) {
          const summary = `Skipped automatic Dream: ${newL1Count} new L1 windows since the last successful Dream, below threshold ${settings.autoDreamMinNewL1}.`;
          this.recordDreamLifecycle("skipped", summary, { completedAt: nowIso() });
          return this.buildSkippedDreamResult(trigger, prepFlush, summary, "new_l1_below_threshold");
        }
      }
      const outcome = await this.dreamRewriter.run();
      const latestL1EndedAt = this.getLatestL1EndedAt();
      this.recordDreamLifecycle("success", outcome.summary, {
        completedAt: nowIso(),
        ...(latestL1EndedAt ? { latestL1EndedAt } : {}),
      });
      this.logger.info?.(
        `[clawxmemory] dream run(${trigger}) reviewed_l1=${outcome.reviewedL1} rewritten_projects=${outcome.rewrittenProjects} deleted_projects=${outcome.deletedProjects} profile_updated=${outcome.profileUpdated}`,
      );
      const result: DreamRunResult = {
        prepFlush,
        ...outcome,
        trigger,
        status: "success" as const,
      };
      return result;
    })().catch((error) => {
      this.recordDreamLifecycle("failed", `Dream ${trigger} failed: ${String(error)}`, {
        completedAt: nowIso(),
      });
      throw error;
    }).finally(() => {
      this.dreamRunPromise = undefined;
      this.dreamRunLocked = false;
      if ((this.queuedFullRun || this.queuedSessionKeys.size > 0) && !this.queuePromise) {
        this.queuePromise = this.drainIndexQueue();
      }
    });

    this.dreamRunPromise = promise;
    return promise;
  }

  private startBackgroundRepair(): void {
    if (this.stopped) return;
    let repairedVersion: string | undefined;
    let cachedSnapshot: MemoryUiSnapshot;
    try {
      repairedVersion = this.repository.getPipelineState("repairVersion");
      cachedSnapshot = this.repository.getUiSnapshot(STARTUP_REPAIR_SNAPSHOT_LIMIT);
    } catch (error) {
      if (!this.stopped) {
        this.logger.warn?.(`[clawxmemory] startup repair initialization failed: ${String(error)}`);
      }
      return;
    }
    if (repairedVersion === MEMORY_REPAIR_VERSION) return;
    void (async () => {
      try {
        if (this.stopped) return;
        const repair = this.repository.repairL0Sessions((record) => sanitizeL0Record(record, this.config));
        if (repair.updated === 0 && repair.removed === 0) {
          this.repository.setPipelineState("repairVersion", MEMORY_REPAIR_VERSION);
          this.logger.info?.("[clawxmemory] startup repair skipped: no l0 changes needed");
          return;
        }
        this.setStartupRepairState("running", {
          message: "startup repair rebuild in progress",
          snapshot: cachedSnapshot,
        });
        const stats = await this.flushAllNow("repair");
        this.logger.info?.(
          `[clawxmemory] repaired l0 updated=${repair.updated} removed=${repair.removed}; rebuilt l1=${stats.l1Created}, l2_time=${stats.l2TimeUpdated}, l2_project=${stats.l2ProjectUpdated}, profile=${stats.profileUpdated}, failed=${stats.failed}`,
        );
        this.repository.setPipelineState("repairVersion", MEMORY_REPAIR_VERSION);
        this.setStartupRepairState("idle");
      } catch (error) {
        this.setStartupRepairState("failed", {
          message: error instanceof Error ? error.message : String(error),
          snapshot: cachedSnapshot,
        });
        this.logger.warn?.(`[clawxmemory] startup repair failed: ${String(error)}`);
      }
    })();
  }

  private resolveWorkspaceDir(): string {
    const configured = getConfigString(this.currentApiConfig, ["agents", "defaults", "workspace"]);
    return resolve(configured || join(homedir(), ".openclaw", "workspace"));
  }

  private async runStartupInitialization(): Promise<void> {
    const boundaryState = await this.reconcileManagedMemoryBoundary();
    if (this.stopped) return;
    this.logMemoryBoundaryDiagnostics();
    if (boundaryState !== "ready" || this.stopped) return;
    this.startBackgroundRepair();
  }

  private async reconcileManagedMemoryBoundary(): Promise<"ready" | "restarting" | "failed"> {
    if (!this.pluginRuntime) return "ready";

    try {
      const loaded = await Promise.resolve(this.pluginRuntime.config.loadConfig());
      this.currentApiConfig = asObject(loaded) ?? {};
    } catch (error) {
      this.logger.warn?.(`[clawxmemory] failed to load OpenClaw config for managed memory boundary: ${String(error)}`);
    }

    const diagnostics = this.collectMemoryBoundaryDiagnostics();
    if (diagnostics.managedConfigIssues.length === 0) return "ready";

    const repair = applyManagedMemoryBoundaryConfig(this.currentApiConfig);

    try {
      if (repair.changed) {
        await this.pluginRuntime.config.writeConfigFile(repair.config);
        this.logger.info?.(
          `[clawxmemory] managed memory config updated: ${repair.changedPaths.join(", ")}`,
        );
      } else {
        this.logger.info?.("[clawxmemory] managed memory config already matches desired state; restarting gateway.");
      }
      this.currentApiConfig = repair.config;
      this.setStartupRepairState("running", { message: STARTUP_BOUNDARY_RUNNING_MESSAGE });

      const restart = await this.pluginRuntime.system.runCommandWithTimeout(
        ["openclaw", "gateway", "restart"],
        { timeoutMs: MANAGED_BOUNDARY_RESTART_TIMEOUT_MS },
      );

      if (restart.termination === "timeout" || restart.termination === "no-output-timeout") {
        this.logger.warn?.("[clawxmemory] `openclaw gateway restart` timed out after managed memory config update; waiting for restart.");
        return "restarting";
      }
      if (restart.code !== 0) {
        const stderr = typeof restart.stderr === "string" ? restart.stderr.trim() : "";
        const stdout = typeof restart.stdout === "string" ? restart.stdout.trim() : "";
        throw new Error(stderr || stdout || `openclaw gateway restart exited with ${restart.code}`);
      }

      this.logger.info?.("[clawxmemory] managed memory config applied; gateway restart requested.");
      return "restarting";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStartupRepairState("failed", { message });
      this.logger.warn?.(`[clawxmemory] managed memory boundary repair failed: ${message}`);
      return "failed";
    }
  }

  private collectMemoryBoundaryDiagnostics(): MemoryBoundaryDiagnostics {
    const runtimeIssues: string[] = [];
    const managedConfigIssues: string[] = [];
    const pushManagedIssue = (message: string): void => {
      runtimeIssues.push(message);
      managedConfigIssues.push(message);
    };

    const slotOwner = getConfigString(this.currentApiConfig, ["plugins", "slots", "memory"]);
    if (slotOwner !== PLUGIN_ID) {
      pushManagedIssue(`plugins.slots.memory=${slotOwner || "(empty)"}`);
    }
    if (getConfigBoolean(this.currentApiConfig, ["plugins", "entries", NATIVE_MEMORY_PLUGIN_ID, "enabled"]) !== false) {
      pushManagedIssue(`plugins.entries.${NATIVE_MEMORY_PLUGIN_ID}.enabled should be false`);
    }
    if (getConfigBoolean(this.currentApiConfig, ["hooks", "internal", "entries", "session-memory", "enabled"]) !== false) {
      pushManagedIssue("hooks.internal.entries.session-memory.enabled should be false");
    }
    if (getConfigBoolean(this.currentApiConfig, ["agents", "defaults", "memorySearch", "enabled"]) !== false) {
      pushManagedIssue("agents.defaults.memorySearch.enabled should be false");
    }
    if (getConfigBoolean(this.currentApiConfig, ["agents", "defaults", "compaction", "memoryFlush", "enabled"]) !== false) {
      pushManagedIssue("agents.defaults.compaction.memoryFlush.enabled should be false");
    }
    if (getConfigBoolean(this.currentApiConfig, ["plugins", "entries", PLUGIN_ID, "hooks", "allowPromptInjection"]) === false) {
      pushManagedIssue(`plugins.entries.${PLUGIN_ID}.hooks.allowPromptInjection should not be false`);
    }
    if (!this.config.recallEnabled) {
      runtimeIssues.push("plugin config recallEnabled=false");
    }

    const workspaceDir = this.resolveWorkspaceDir();
    const workspaceBootstrapPresent = [
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
      "IDENTITY.md",
      "USER.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
      "MEMORY.md",
    ].some((name) => existsSync(join(workspaceDir, name)));

    return {
      slotOwner,
      dynamicMemoryRuntime: slotOwner === PLUGIN_ID ? "ClawXMemory" : slotOwner || "unbound",
      workspaceBootstrapPresent,
      memoryRuntimeHealthy: runtimeIssues.length === 0,
      runtimeIssues,
      managedConfigIssues,
    };
  }

  private logMemoryBoundaryDiagnostics(): void {
    const diagnostics = this.collectMemoryBoundaryDiagnostics();
    if (this.startupRepairStatus === "running") {
      const message = this.startupRepairMessage || STARTUP_BOUNDARY_RUNNING_MESSAGE;
      this.logger.info?.(`[clawxmemory] startup fix in progress: ${message}`);
      return;
    }
    if (this.startupRepairStatus === "failed") {
      const message = this.startupRepairMessage || "startup fix failed";
      this.logger.warn?.(`[clawxmemory] startup fix failed: ${message}`);
      return;
    }
    if (diagnostics.memoryRuntimeHealthy) {
      this.logger.info?.("[clawxmemory] dynamic memory runtime ready: active memory slot is ClawXMemory.");
      return;
    }
    this.logger.warn?.(
      `[clawxmemory] dynamic memory runtime issues detected: ${diagnostics.runtimeIssues.join(" | ")}`,
    );
  }
}
