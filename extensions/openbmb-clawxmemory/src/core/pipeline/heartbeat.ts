import type {
  IndexTraceRecord,
  IndexTraceStep,
  IndexTraceStoredResult,
  IndexingSettings,
  L0SessionRecord,
  MemoryCandidate,
  MemoryFileRecord,
  MemoryMessage,
  MemoryRecordType,
  RetrievalPromptDebug,
  TraceI18nText,
} from "../types.js";
import { LlmMemoryExtractor, type FileMemoryExtractionDebug } from "../skills/llm-extraction.js";
import { MemoryRepository } from "../storage/sqlite.js";
import { TMP_PROJECT_ID } from "../file-memory.js";
import { traceI18n } from "../trace-i18n.js";
import { buildL0IndexId, hashText, nowIso } from "../utils/id.js";
import { decodeEscapedUnicodeText, decodeEscapedUnicodeValue } from "../utils/text.js";
import { hasExplicitRememberIntent } from "../../message-utils.js";

const LAST_INDEXED_AT_STATE_KEY = "lastIndexedAt" as const;

export interface HeartbeatOptions {
  batchSize?: number;
  source?: string;
  settings: IndexingSettings;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
  };
}

export interface HeartbeatRunOptions {
  batchSize?: number;
  sessionKeys?: string[];
  reason?: string;
}

export interface HeartbeatStats {
  capturedSessions: number;
  writtenFiles: number;
  writtenProjectFiles: number;
  writtenFeedbackFiles: number;
  userProfilesUpdated: number;
  failedSessions: number;
}

function sameMessage(left: MemoryMessage | undefined, right: MemoryMessage | undefined): boolean {
  if (!left || !right) return false;
  return left.role === right.role && left.content === right.content;
}

function hasNewContent(previous: MemoryMessage[], incoming: MemoryMessage[]): boolean {
  if (incoming.length === 0) return false;
  if (previous.length === 0) return true;
  if (incoming.length > previous.length) return true;
  for (let index = 0; index < incoming.length; index += 1) {
    if (!sameMessage(previous[index], incoming[index])) return true;
  }
  return false;
}

function emptyStats(): HeartbeatStats {
  return {
    capturedSessions: 0,
    writtenFiles: 0,
    writtenProjectFiles: 0,
    writtenFeedbackFiles: 0,
    userProfilesUpdated: 0,
    failedSessions: 0,
  };
}

function flattenBatchMessages(sessions: L0SessionRecord[]): MemoryMessage[] {
  let previousMessages: MemoryMessage[] = [];
  for (const session of sessions) {
    previousMessages = mergeSessionMessages(previousMessages, session.messages).mergedMessages;
  }
  return previousMessages;
}

function commonPrefixLength(previous: MemoryMessage[], incoming: MemoryMessage[]): number {
  const limit = Math.min(previous.length, incoming.length);
  let index = 0;
  while (index < limit && sameMessage(previous[index], incoming[index])) {
    index += 1;
  }
  return index;
}

function mergeSessionMessages(
  previousMessages: MemoryMessage[],
  incomingMessages: MemoryMessage[],
): {
  mergedMessages: MemoryMessage[];
  newMessages: MemoryMessage[];
} {
  if (previousMessages.length === 0) {
    return {
      mergedMessages: incomingMessages,
      newMessages: incomingMessages,
    };
  }
  const prefixLength = commonPrefixLength(previousMessages, incomingMessages);
  if (prefixLength > 0) {
    return {
      mergedMessages: incomingMessages,
      newMessages: incomingMessages.slice(prefixLength),
    };
  }
  return {
    mergedMessages: [...previousMessages, ...incomingMessages],
    newMessages: incomingMessages,
  };
}

function deriveFocusTurns(
  previousMessages: MemoryMessage[],
  sessions: L0SessionRecord[],
): Map<string, MemoryMessage[]> {
  const focusTurns = new Map<string, MemoryMessage[]>();
  let cursorMessages = previousMessages;
  for (const session of sessions) {
    const merged = mergeSessionMessages(cursorMessages, session.messages);
    focusTurns.set(
      session.l0IndexId,
      merged.newMessages.filter((message) => message.role === "user"),
    );
    cursorMessages = merged.mergedMessages;
  }
  return focusTurns;
}

function buildIndexTraceId(sessionKey: string, startedAt: string, l0Ids: string[]): string {
  return `index_trace_${hashText(`${sessionKey}:${startedAt}:${l0Ids.join(",")}`)}`;
}

function normalizeTrigger(reason: string | undefined): IndexTraceRecord["trigger"] {
  const normalized = (reason ?? "").trim().toLowerCase();
  if (normalized.includes("explicit_remember")) return "explicit_remember";
  if (normalized.includes("scheduled")) return "scheduled";
  return "manual_sync";
}

function previewText(text: string, maxChars = 220): string {
  const normalized = decodeEscapedUnicodeText(text, true).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function describeCandidate(candidate: MemoryCandidate): string {
  return `${candidate.type}:${candidate.name} — ${previewText(candidate.description, 120)}`;
}

function inferStorageKind(record: MemoryFileRecord): IndexTraceStoredResult["storageKind"] {
  if (record.type === "user") return "global_user";
  if (record.projectId === TMP_PROJECT_ID) {
    return record.type === "feedback" ? "tmp_feedback" : "tmp_project";
  }
  return record.type === "feedback" ? "formal_feedback" : "formal_project";
}

function inferGroupingLabel(
  repository: MemoryRepository,
  candidate: MemoryCandidate,
): { projectId?: string; storageKind: IndexTraceStoredResult["storageKind"]; label: string } {
  if (candidate.type === "user") {
    return { storageKind: "global_user", label: "global user profile" };
  }
  const store = repository.getFileMemoryStore();
  const formalProjectId = candidate.projectId?.trim() && store.getProjectMeta(candidate.projectId)
    ? candidate.projectId.trim()
    : "";
  if (formalProjectId) {
    return {
      projectId: formalProjectId,
      storageKind: candidate.type === "feedback" ? "formal_feedback" : "formal_project",
      label: `formal:${formalProjectId}`,
    };
  }
  return {
    projectId: TMP_PROJECT_ID,
    storageKind: candidate.type === "feedback" ? "tmp_feedback" : "tmp_project",
    label: candidate.type === "feedback" ? "tmp feedback (no unique project anchor)" : "tmp project",
  };
}

function textDetail(
  key: string,
  label: string,
  text: string,
  labelI18n?: TraceI18nText,
): NonNullable<IndexTraceStep["details"]>[number] {
  return {
    key,
    label,
    ...(labelI18n ? { labelI18n } : {}),
    kind: "text",
    text: decodeEscapedUnicodeText(text, true),
  };
}

function noteDetail(
  key: string,
  label: string,
  text: string,
  labelI18n?: TraceI18nText,
): NonNullable<IndexTraceStep["details"]>[number] {
  return {
    key,
    label,
    ...(labelI18n ? { labelI18n } : {}),
    kind: "note",
    text: decodeEscapedUnicodeText(text, true),
  };
}

function listDetail(
  key: string,
  label: string,
  items: string[],
  labelI18n?: TraceI18nText,
): NonNullable<IndexTraceStep["details"]>[number] {
  return {
    key,
    label,
    ...(labelI18n ? { labelI18n } : {}),
    kind: "list",
    items: items.map((item) => decodeEscapedUnicodeText(item, true)),
  };
}

function kvDetail(
  key: string,
  label: string,
  entries: Array<{ label: string; value: unknown }>,
  labelI18n?: TraceI18nText,
): NonNullable<IndexTraceStep["details"]>[number] {
  return {
    key,
    label,
    ...(labelI18n ? { labelI18n } : {}),
    kind: "kv",
    entries: entries.map((entry) => ({
      label: entry.label,
      value: decodeEscapedUnicodeText(String(entry.value ?? ""), true),
    })),
  };
}

function jsonDetail(
  key: string,
  label: string,
  json: unknown,
  labelI18n?: TraceI18nText,
): NonNullable<IndexTraceStep["details"]>[number] {
  return {
    key,
    label,
    ...(labelI18n ? { labelI18n } : {}),
    kind: "json",
    json: decodeEscapedUnicodeValue(json, true),
  };
}

function createStep(
  trace: IndexTraceRecord,
  kind: IndexTraceStep["kind"],
  title: string,
  status: IndexTraceStep["status"],
  inputSummary: string,
  outputSummary: string,
  options: {
    refs?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    details?: IndexTraceStep["details"];
    promptDebug?: RetrievalPromptDebug;
    titleI18n?: TraceI18nText;
    inputSummaryI18n?: TraceI18nText;
    outputSummaryI18n?: TraceI18nText;
  } = {},
): void {
  trace.steps.push({
    stepId: `${trace.indexTraceId}:step:${trace.steps.length + 1}`,
    kind,
    title,
    status,
    inputSummary,
    outputSummary,
    ...(options.refs ? { refs: options.refs } : {}),
    ...(options.metrics ? { metrics: options.metrics } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.promptDebug ? { promptDebug: options.promptDebug } : {}),
    ...(options.titleI18n ? { titleI18n: options.titleI18n } : {}),
    ...(options.inputSummaryI18n ? { inputSummaryI18n: options.inputSummaryI18n } : {}),
    ...(options.outputSummaryI18n ? { outputSummaryI18n: options.outputSummaryI18n } : {}),
  });
}

function createBatchTrace(
  sessionKey: string,
  sessions: L0SessionRecord[],
  trigger: IndexTraceRecord["trigger"],
  focusUserTurnCount: number,
): IndexTraceRecord {
  const startedAt = nowIso();
  const timestamps = sessions.map((session) => session.timestamp).filter(Boolean).sort();
  return {
    indexTraceId: buildIndexTraceId(sessionKey, startedAt, sessions.map((session) => session.l0IndexId)),
    sessionKey,
    trigger,
    startedAt,
    status: "running",
    batchSummary: {
      l0Ids: sessions.map((session) => session.l0IndexId),
      segmentCount: sessions.length,
      focusUserTurnCount,
      fromTimestamp: timestamps[0] ?? "",
      toTimestamp: timestamps[timestamps.length - 1] ?? "",
    },
    steps: [],
    storedResults: [],
  };
}

export class HeartbeatIndexer {
  private readonly batchSize: number;
  private readonly source: string;
  private readonly logger: HeartbeatOptions["logger"];
  private settings: IndexingSettings;

  constructor(
    private readonly repository: MemoryRepository,
    private readonly extractor: LlmMemoryExtractor,
    options: HeartbeatOptions,
  ) {
    this.batchSize = options.batchSize ?? 30;
    this.source = options.source ?? "openclaw";
    this.settings = options.settings;
    this.logger = options.logger;
  }

  getSettings(): IndexingSettings {
    return { ...this.settings };
  }

  setSettings(settings: IndexingSettings): void {
    this.settings = { ...settings };
  }

  captureL0Session(input: {
    sessionKey: string;
    timestamp?: string;
    messages: MemoryMessage[];
    source?: string;
  }): L0SessionRecord | undefined {
    const timestamp = input.timestamp ?? nowIso();
    const recent = this.repository.listRecentL0(1)[0];
    if (recent?.sessionKey === input.sessionKey && !hasNewContent(recent.messages, input.messages)) {
      this.logger?.info?.(`[clawxmemory] skip duplicate l0 capture for session=${input.sessionKey}`);
      return undefined;
    }
    const payload = JSON.stringify(input.messages);
    const l0IndexId = buildL0IndexId(input.sessionKey, timestamp, payload);
    const record: L0SessionRecord = {
      l0IndexId,
      sessionKey: input.sessionKey,
      timestamp,
      messages: input.messages,
      source: input.source ?? this.source,
      indexed: false,
      createdAt: nowIso(),
    };
    this.repository.insertL0Session(record);
    return record;
  }

  async runHeartbeat(options: HeartbeatRunOptions = {}): Promise<HeartbeatStats> {
    const stats = emptyStats();
    const sessionKeys = this.repository.listPendingSessionKeys(
      Math.max(1, options.batchSize ?? this.batchSize),
      options.sessionKeys,
    );
    if (sessionKeys.length === 0) return stats;

    const store = this.repository.getFileMemoryStore();
    for (const sessionKey of sessionKeys) {
      const sessions = this.repository.listUnindexedL0BySession(sessionKey);
      if (sessions.length === 0) continue;

      const previousIndexedSession = this.repository.getLatestL0Before(
        sessionKey,
        sessions[0]?.timestamp ?? "",
        sessions[0]?.createdAt ?? "",
      );
      const previousMessages = previousIndexedSession?.messages ?? [];
      const focusTurnsBySession = deriveFocusTurns(previousMessages, sessions);
      const batchContextMessages = flattenBatchMessages(sessions);
      const focusUserTurnCount = Array.from(focusTurnsBySession.values()).reduce((count, turns) => count + turns.length, 0);
      const trace = createBatchTrace(sessionKey, sessions, normalizeTrigger(options.reason), focusUserTurnCount);
      createStep(
        trace,
        "index_start",
        "Index Started",
        "info",
        `trigger=${trace.trigger}`,
        `Preparing batch indexing for ${sessionKey}.`,
        {
          titleI18n: traceI18n("trace.step.index_start", "Index Started"),
          outputSummaryI18n: traceI18n("trace.text.index_start.output.preparing_batch", "Preparing batch indexing for {0}.", sessionKey),
        },
      );
      createStep(
        trace,
        "batch_loaded",
        "Batch Loaded",
        "info",
        `${trace.batchSummary.segmentCount} segments from ${trace.batchSummary.fromTimestamp || "n/a"} to ${trace.batchSummary.toTimestamp || "n/a"}`,
        `${batchContextMessages.length} messages loaded into batch context.`,
        {
          titleI18n: traceI18n("trace.step.batch_loaded", "Batch Loaded"),
          inputSummaryI18n: traceI18n(
            "trace.text.batch_loaded.input",
            "{0} segments from {1} to {2}",
            trace.batchSummary.segmentCount,
            trace.batchSummary.fromTimestamp || "n/a",
            trace.batchSummary.toTimestamp || "n/a",
          ),
          outputSummaryI18n: traceI18n(
            "trace.text.batch_loaded.output",
            "{0} messages loaded into batch context.",
            batchContextMessages.length,
          ),
          metrics: {
            segmentCount: trace.batchSummary.segmentCount,
            focusUserTurnCount: trace.batchSummary.focusUserTurnCount,
          },
          details: [
            kvDetail("batch-summary", "Batch Summary", [
              { label: "sessionKey", value: sessionKey },
              { label: "from", value: trace.batchSummary.fromTimestamp || "" },
              { label: "to", value: trace.batchSummary.toTimestamp || "" },
              { label: "l0Ids", value: trace.batchSummary.l0Ids.join(", ") || "none" },
            ], traceI18n("trace.detail.batch_summary", "Batch Summary")),
            jsonDetail(
              "batch-context",
              "Batch Context",
              batchContextMessages.map((message, index) => ({
                index,
                role: message.role,
                content: message.content,
              })),
              traceI18n("trace.detail.batch_context", "Batch Context"),
            ),
          ],
        },
      );
      createStep(
        trace,
        "focus_turns_selected",
        "Focus Turns Selected",
        trace.batchSummary.focusUserTurnCount > 0 ? "success" : "warning",
        `${trace.batchSummary.focusUserTurnCount} user turns in this batch.`,
        trace.batchSummary.focusUserTurnCount > 0
          ? "User turns will be classified one by one."
          : "No user turns found; this batch will be marked indexed without storing memory.",
        {
          titleI18n: traceI18n("trace.step.focus_turns_selected", "Focus Turns Selected"),
          inputSummaryI18n: traceI18n(
            "trace.text.focus_turns_selected.input",
            "{0} user turns in this batch.",
            trace.batchSummary.focusUserTurnCount,
          ),
          outputSummaryI18n: trace.batchSummary.focusUserTurnCount > 0
            ? traceI18n("trace.text.focus_turns_selected.output.classifying", "User turns will be classified one by one.")
            : traceI18n(
                "trace.text.focus_turns_selected.output.no_user_turns",
                "No user turns found; this batch will be marked indexed without storing memory.",
              ),
          details: [
            kvDetail("focus-turn-selection-summary", "Focus Selection Summary", [
              { label: "userTurns", value: String(trace.batchSummary.focusUserTurnCount) },
              { label: "assistantMessagesInContext", value: String(batchContextMessages.filter((message) => message.role === "assistant").length) },
              { label: "assistantUsedAsContextOnly", value: "yes" },
            ], traceI18n("trace.detail.focus_selection_summary", "Focus Selection Summary")),
            ...sessions
              .flatMap((session) => focusTurnsBySession.get(session.l0IndexId) ?? [])
              .map((message, index) => textDetail(
                `focus-turn-${index + 1}`,
                `Focus Turn ${index + 1}`,
                message.content,
                traceI18n("trace.detail.focus_turn", "Focus Turn {0}", index + 1),
              )),
          ],
        },
      );
      this.repository.saveIndexTrace(trace);

      const processedIds: string[] = [];
      const userCandidates: MemoryCandidate[] = [];
      let userRewriteDebug: RetrievalPromptDebug | undefined;
      let sessionHadError = false;

      for (const session of sessions) {
        try {
          const focusUserTurns = focusTurnsBySession.get(session.l0IndexId) ?? [];
          if (focusUserTurns.length === 0) {
            processedIds.push(session.l0IndexId);
            stats.capturedSessions += 1;
            continue;
          }

          for (const focusTurn of focusUserTurns) {
            let extractionPromptDebug: RetrievalPromptDebug | undefined;
            let extractionDebug: FileMemoryExtractionDebug | undefined;
            const candidates = await this.extractor.extractFileMemoryCandidates({
              timestamp: session.timestamp,
              sessionKey: session.sessionKey,
              messages: [focusTurn],
              batchContextMessages,
              explicitRemember: hasExplicitRememberIntent([focusTurn]),
              debugTrace: (debug) => {
                extractionPromptDebug = debug;
              },
              decisionTrace: (debug) => {
                extractionDebug = debug;
              },
            });
            const finalCandidates = extractionDebug?.finalCandidates ?? candidates;
            const normalizedCandidates = extractionDebug?.normalizedCandidates ?? finalCandidates;
            const discarded = extractionDebug?.discarded ?? [];
            const candidateTypes = Array.from(new Set(finalCandidates.map((candidate) => candidate.type)));
            createStep(
              trace,
              "turn_classified",
              "Turn Classified",
              finalCandidates.length > 0 ? "success" : "warning",
              previewText(focusTurn.content, 220),
              finalCandidates.length > 0
                ? `classified=${candidateTypes.join(", ")}`
                : "classified=discarded",
              {
                titleI18n: traceI18n("trace.step.turn_classified", "Turn Classified"),
                refs: {
                  classification: finalCandidates.length > 0 ? candidateTypes : ["discarded"],
                },
                details: [
                  textDetail(
                    `focus-turn-text-${session.l0IndexId}`,
                    "Focus User Turn",
                    focusTurn.content,
                    traceI18n("trace.detail.focus_user_turn", "Focus User Turn"),
                  ),
                  kvDetail(`classification-result-${session.l0IndexId}`, "Classification Result", [
                    { label: "sessionKey", value: session.sessionKey },
                    { label: "timestamp", value: session.timestamp },
                    { label: "result", value: finalCandidates.length > 0 ? candidateTypes.join(", ") : "discarded" },
                  ], traceI18n("trace.detail.classification_result", "Classification Result")),
                  jsonDetail(
                    `classification-candidates-${session.l0IndexId}`,
                    "Classifier Candidates",
                    finalCandidates,
                    traceI18n("trace.detail.classifier_candidates", "Classifier Candidates"),
                  ),
                  ...(discarded.length > 0
                    ? [jsonDetail(
                        `discarded-reasons-${session.l0IndexId}`,
                        "Discarded Reasons",
                        discarded,
                        traceI18n("trace.detail.discarded_reasons", "Discarded Reasons"),
                      )]
                    : []),
                ],
                ...(extractionPromptDebug ? { promptDebug: extractionPromptDebug } : {}),
              },
            );

            createStep(
              trace,
              "candidate_validated",
              "Candidate Validated",
              normalizedCandidates.length > 0 || discarded.length === 0 ? "success" : "warning",
              `${normalizedCandidates.length} normalized candidates, ${discarded.length} discarded.`,
              finalCandidates.length > 0
                ? `${finalCandidates.length} candidates survived validation.`
                : "No candidates survived validation.",
              {
                titleI18n: traceI18n("trace.step.candidate_validated", "Candidate Validated"),
                inputSummaryI18n: traceI18n(
                  "trace.text.candidate_validated.input",
                  "{0} normalized candidates, {1} discarded.",
                  normalizedCandidates.length,
                  discarded.length,
                ),
                outputSummaryI18n: finalCandidates.length > 0
                  ? traceI18n(
                      "trace.text.candidate_validated.output.survived",
                      "{0} candidates survived validation.",
                      finalCandidates.length,
                    )
                  : traceI18n(
                      "trace.text.candidate_validated.output.none_survived",
                      "No candidates survived validation.",
                    ),
                details: [
                  jsonDetail(
                    `raw-candidates-${session.l0IndexId}`,
                    "Raw Candidates",
                    finalCandidates,
                    traceI18n("trace.detail.raw_candidates", "Raw Candidates"),
                  ),
                  listDetail(
                    `normalized-candidates-${session.l0IndexId}`,
                    "Normalized Candidates",
                    normalizedCandidates.map((candidate) => describeCandidate(candidate)),
                    traceI18n("trace.detail.normalized_candidates", "Normalized Candidates"),
                  ),
                  jsonDetail(
                    `discarded-candidates-${session.l0IndexId}`,
                    "Discarded Candidates",
                    discarded,
                    traceI18n("trace.detail.discarded_candidates", "Discarded Candidates"),
                  ),
                ],
              },
            );

            createStep(
              trace,
              "candidate_grouped",
              "Candidate Grouped",
              finalCandidates.length > 0 ? "success" : "skipped",
              `${finalCandidates.length} validated candidates ready for grouping.`,
              finalCandidates.length > 0
                ? "Resolved storage groups for validated candidates."
                : "No validated candidates to group.",
              {
                titleI18n: traceI18n("trace.step.candidate_grouped", "Candidate Grouped"),
                inputSummaryI18n: traceI18n(
                  "trace.text.candidate_grouped.input",
                  "{0} validated candidates ready for grouping.",
                  finalCandidates.length,
                ),
                outputSummaryI18n: finalCandidates.length > 0
                  ? traceI18n(
                      "trace.text.candidate_grouped.output.grouped",
                      "Resolved storage groups for validated candidates.",
                    )
                  : traceI18n(
                      "trace.text.candidate_grouped.output.none",
                      "No validated candidates to group.",
                    ),
                details: [jsonDetail(
                  `grouped-candidates-${session.l0IndexId}`,
                  "Grouping Result",
                  finalCandidates.map((candidate) => {
                    const grouping = inferGroupingLabel(this.repository, candidate);
                    return {
                      candidateType: candidate.type,
                      candidateName: candidate.name,
                      candidateDescription: candidate.description,
                      grouping: grouping.label,
                      projectId: grouping.projectId ?? null,
                      storageKind: grouping.storageKind,
                    };
                  }),
                  traceI18n("trace.detail.grouping_result", "Grouping Result"),
                )],
              },
            );

            const batchUserCandidates = finalCandidates.filter((candidate) => candidate.type === "user");
            const fileCandidates = finalCandidates.filter((candidate) => candidate.type !== "user");
            const persistedRecords: MemoryFileRecord[] = [];

            for (const candidate of fileCandidates) {
              const record = store.upsertCandidate(candidate);
              persistedRecords.push(record);
              trace.storedResults.push({
                candidateType: candidate.type,
                candidateName: candidate.name,
                scope: candidate.scope,
                ...(record.projectId ? { projectId: record.projectId } : {}),
                relativePath: record.relativePath,
                storageKind: inferStorageKind(record),
              });
              stats.writtenFiles += 1;
              if (candidate.type === "project") stats.writtenProjectFiles += 1;
              if (candidate.type === "feedback") stats.writtenFeedbackFiles += 1;
            }
            createStep(
              trace,
              "candidate_persisted",
              "Candidate Persisted",
              persistedRecords.length > 0 ? "success" : "skipped",
              `${fileCandidates.length} file candidates ready to persist.`,
              persistedRecords.length > 0
                ? `${persistedRecords.length} memory files written.`
                : "No project or feedback files were written for this turn.",
              {
                titleI18n: traceI18n("trace.step.candidate_persisted", "Candidate Persisted"),
                inputSummaryI18n: traceI18n(
                  "trace.text.candidate_persisted.input",
                  "{0} file candidates ready to persist.",
                  fileCandidates.length,
                ),
                outputSummaryI18n: persistedRecords.length > 0
                  ? traceI18n(
                      "trace.text.candidate_persisted.output.written",
                      "{0} memory files written.",
                      persistedRecords.length,
                    )
                  : traceI18n(
                      "trace.text.candidate_persisted.output.none_written",
                      "No project or feedback files were written for this turn.",
                    ),
                details: [jsonDetail(
                  `persisted-files-${session.l0IndexId}`,
                  "Persisted Files",
                  persistedRecords.map((record) => ({
                    type: record.type,
                    name: record.name,
                    projectId: record.projectId ?? null,
                    relativePath: record.relativePath,
                    storageKind: inferStorageKind(record),
                  })),
                  traceI18n("trace.detail.persisted_files", "Persisted Files"),
                )],
              },
            );
            userCandidates.push(...batchUserCandidates);
          }
          processedIds.push(session.l0IndexId);
          stats.capturedSessions += 1;
          this.repository.setPipelineState(LAST_INDEXED_AT_STATE_KEY, session.timestamp);
          this.repository.setPipelineState(`lastIndexedCursor:${session.sessionKey}`, session.timestamp);
        } catch (error) {
          stats.failedSessions += 1;
          sessionHadError = true;
          createStep(
            trace,
            "index_finished",
            "Index Error",
            "error",
            session.l0IndexId,
            error instanceof Error ? error.message : String(error),
            {
              titleI18n: traceI18n("trace.text.index_error.title", "Index Error"),
              details: [noteDetail(
                `index-error-${session.l0IndexId}`,
                "Index Error",
                error instanceof Error ? error.message : String(error),
                traceI18n("trace.detail.index_error", "Index Error"),
              )],
            },
          );
          this.logger?.warn?.(`[clawxmemory] heartbeat file-memory extraction failed for ${session.l0IndexId}: ${String(error)}`);
        }
      }

      if (userCandidates.length > 0) {
        try {
          const existingUserProfile = store.getUserSummary();
          const rewrittenUser = await this.extractor.rewriteUserProfile({
            existingProfile: existingUserProfile,
            candidates: userCandidates,
            debugTrace: (debug) => {
              userRewriteDebug = debug;
            },
          });
          if (rewrittenUser) {
            const record = store.upsertCandidate(rewrittenUser);
            trace.storedResults.push({
              candidateType: "user",
              candidateName: rewrittenUser.name,
              scope: rewrittenUser.scope,
              relativePath: record.relativePath,
              storageKind: inferStorageKind(record),
            });
            stats.userProfilesUpdated += 1;
            createStep(
              trace,
              "user_profile_rewritten",
              "User Profile Rewritten",
              "success",
              `${userCandidates.length} user candidates merged.`,
              `Stored user profile at ${record.relativePath}.`,
              {
                titleI18n: traceI18n("trace.step.user_profile_rewritten", "User Profile Rewritten"),
                inputSummaryI18n: traceI18n(
                  "trace.text.user_profile_rewritten.input",
                  "{0} user candidates merged.",
                  userCandidates.length,
                ),
                outputSummaryI18n: traceI18n(
                  "trace.text.user_profile_rewritten.output.stored",
                  "Stored user profile at {0}.",
                  record.relativePath,
                ),
                details: [jsonDetail(
                  "user-profile-result",
                  "User Profile Result",
                  {
                    before: {
                      profile: existingUserProfile.profile,
                      preferences: existingUserProfile.preferences,
                      constraints: existingUserProfile.constraints,
                      relationships: existingUserProfile.relationships,
                    },
                    after: {
                    profile: rewrittenUser.profile ?? "",
                    preferences: rewrittenUser.preferences ?? [],
                    constraints: rewrittenUser.constraints ?? [],
                    relationships: rewrittenUser.relationships ?? [],
                    },
                    relativePath: record.relativePath,
                  },
                  traceI18n("trace.detail.user_profile_result", "User Profile Result"),
                )],
                ...(userRewriteDebug ? { promptDebug: userRewriteDebug } : {}),
              },
            );
          }
        } catch (error) {
          stats.failedSessions += 1;
          sessionHadError = true;
          createStep(
            trace,
            "user_profile_rewritten",
            "User Profile Rewritten",
            "error",
            `${userCandidates.length} user candidates merged.`,
            error instanceof Error ? error.message : String(error),
            {
              titleI18n: traceI18n("trace.step.user_profile_rewritten", "User Profile Rewritten"),
              inputSummaryI18n: traceI18n(
                "trace.text.user_profile_rewritten.input",
                "{0} user candidates merged.",
                userCandidates.length,
              ),
              details: [noteDetail(
                "user-profile-error",
                "User Rewrite Error",
                error instanceof Error ? error.message : String(error),
                traceI18n("trace.detail.user_rewrite_error", "User Rewrite Error"),
              )],
              ...(userRewriteDebug ? { promptDebug: userRewriteDebug } : {}),
            },
          );
          this.logger?.warn?.(`[clawxmemory] heartbeat user-profile rewrite failed for ${sessionKey}: ${String(error)}`);
        }
      }

      if (processedIds.length > 0) {
        this.repository.markL0Indexed(processedIds);
      }
      trace.finishedAt = nowIso();
      trace.status = sessionHadError ? "error" : "completed";
      createStep(
        trace,
        "index_finished",
        "Index Finished",
        sessionHadError ? "warning" : "success",
        `segments=${trace.batchSummary.segmentCount}`,
        `stored=${trace.storedResults.length}, failed=${sessionHadError ? 1 : 0}`,
        {
          titleI18n: traceI18n("trace.step.index_finished", "Index Finished"),
          metrics: {
            storedResults: trace.storedResults.length,
            failed: sessionHadError ? 1 : 0,
          },
          details: [jsonDetail(
            "stored-results",
            "Stored Results",
            trace.storedResults,
            traceI18n("trace.detail.stored_results", "Stored Results"),
          )],
        },
      );
      this.repository.saveIndexTrace(trace);
    }
    return stats;
  }
}
