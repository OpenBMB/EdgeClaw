import * as http from "node:http";
import { getLiveConfig } from "./live-config.js";
import { desensitizeWithLocalModel } from "./local-model.js";
import { lookupDesensitizedToolResult, stashDesensitizedToolResult } from "./session-state.js";
import { redactSensitiveInfo } from "./utils.js";

// ── Marker protocol ──

export const CLAWXROUTER_S2_OPEN = "<clawxrouter-s2>";
export const CLAWXROUTER_S2_CLOSE = "</clawxrouter-s2>";

// ── Original provider target ──

export type OriginalProviderTarget = {
  baseUrl: string;
  apiKey: string;
  provider: string;
  api?: string;
  streaming?: boolean;
};

// ── Model-keyed target map ──
// Deterministic routing: model ID → upstream provider target.
// Built at init time (mirrorAllProviderModels) and updated JIT
// (ensureModelMirrored).  No per-request header injection needed.

const modelProviderTargets = new Map<string, OriginalProviderTarget>();

export function registerModelTarget(modelId: string, target: OriginalProviderTarget): void {
  modelProviderTargets.set(modelId, target);
}

export function getModelTarget(modelId: string): OriginalProviderTarget | undefined {
  return modelProviderTargets.get(modelId);
}

let defaultProviderTarget: OriginalProviderTarget | null = null;

export function setDefaultProviderTarget(target: OriginalProviderTarget): void {
  defaultProviderTarget = target;
}

// ── Proxy handle ──

export type ProxyHandle = {
  baseUrl: string;
  port: number;
  close: () => Promise<void>;
};

// ── Request body reader ──

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ── Tool schema cleaning ──
// Multiple provider APIs reject JSON Schema keywords they don't support.
// Strip these universally so the proxy works regardless of the downstream target.

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "patternProperties",
  "additionalProperties",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "examples",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

function stripUnsupportedSchemaKeywords(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripUnsupportedSchemaKeywords);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;
    if (value && typeof value === "object") {
      cleaned[key] = stripUnsupportedSchemaKeywords(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Clean tool parameter schemas in an OpenAI-format request body.
 * Handles `tools[].function.parameters`.
 */
export function cleanToolSchemas(tools: unknown[] | undefined): boolean {
  if (!Array.isArray(tools) || tools.length === 0) return false;
  let cleaned = false;
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i] as Record<string, unknown> | undefined;
    if (!tool) continue;
    const fn = tool.function as Record<string, unknown> | undefined;
    const params = fn?.parameters;
    if (params && typeof params === "object") {
      const result = stripUnsupportedSchemaKeywords(params);
      if (result !== params) {
        fn!.parameters = result;
        cleaned = true;
      }
    }
  }
  return cleaned;
}

/**
 * Clean tool schemas in Google's native format.
 * Handles `tools[].functionDeclarations[].parameters`.
 */
export function cleanGoogleToolSchemas(tools: unknown[] | undefined): boolean {
  if (!Array.isArray(tools) || tools.length === 0) return false;
  let cleaned = false;
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const decls =
      (tool as Record<string, unknown>).functionDeclarations ??
      (tool as Record<string, unknown>).function_declarations;
    if (!Array.isArray(decls)) continue;
    for (const decl of decls) {
      if (!decl || typeof decl !== "object") continue;
      const params = (decl as Record<string, unknown>).parameters;
      if (params && typeof params === "object") {
        (decl as Record<string, unknown>).parameters = stripUnsupportedSchemaKeywords(params);
        cleaned = true;
      }
    }
  }
  return cleaned;
}

// ── PII marker stripping ──

/**
 * Strip PII markers from OpenAI/Anthropic format messages.
 * Format: `messages[].content` (string)
 */
export function stripPiiMarkers(messages: Array<{ role: string; content: unknown }>): boolean {
  let stripped = false;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      const openIdx = msg.content.indexOf(CLAWXROUTER_S2_OPEN);
      const closeIdx = msg.content.indexOf(CLAWXROUTER_S2_CLOSE);
      if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) continue;
      msg.content = msg.content.slice(openIdx + CLAWXROUTER_S2_OPEN.length, closeIdx).trim();
      stripped = true;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (!part || typeof part.text !== "string") continue;
        const openIdx = part.text.indexOf(CLAWXROUTER_S2_OPEN);
        const closeIdx = part.text.indexOf(CLAWXROUTER_S2_CLOSE);
        if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) continue;
        part.text = part.text.slice(openIdx + CLAWXROUTER_S2_OPEN.length, closeIdx).trim();
        stripped = true;
      }
    }
  }

  return stripped;
}

/**
 * Strip PII markers from Google Gemini native format.
 * Format: `contents[].parts[].text` (string)
 */
export function stripPiiMarkersGoogleContents(contents: unknown[] | undefined): boolean {
  if (!Array.isArray(contents) || contents.length === 0) return false;
  let stripped = false;

  for (const entry of contents) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const parts = e.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (typeof p.text !== "string") continue;

      const openIdx = p.text.indexOf(CLAWXROUTER_S2_OPEN);
      const closeIdx = p.text.indexOf(CLAWXROUTER_S2_CLOSE);
      if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) continue;

      p.text = p.text.slice(openIdx + CLAWXROUTER_S2_OPEN.length, closeIdx).trim();
      stripped = true;
    }
  }

  return stripped;
}

// ── Provider-aware auth headers ──

const ANTHROPIC_PATTERNS = ["anthropic"];
const ANTHROPIC_APIS = ["anthropic-messages"];

const GOOGLE_NATIVE_APIS = ["google-generative-ai", "google-gemini-cli", "google-ai-studio"];
const GOOGLE_URL_MARKERS = ["generativelanguage.googleapis.com", "aiplatform.googleapis.com"];

export function isGoogleTarget(target: OriginalProviderTarget): boolean {
  const api = (target.api ?? "").toLowerCase();
  const provider = target.provider.toLowerCase();
  const url = target.baseUrl.toLowerCase();

  if (api === "openai-completions" || api === "openai-chat") return false;
  if (GOOGLE_NATIVE_APIS.some((p) => api.includes(p))) return true;
  if (provider === "google" || provider.includes("gemini") || provider.includes("vertex"))
    return true;
  if (GOOGLE_URL_MARKERS.some((p) => url.includes(p))) return true;
  return false;
}

export function resolveAuthHeaders(target: OriginalProviderTarget): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!target.apiKey) return headers;

  const p = target.provider.toLowerCase();
  const api = (target.api ?? "").toLowerCase();

  if (ANTHROPIC_PATTERNS.some((pat) => p.includes(pat)) || ANTHROPIC_APIS.includes(api)) {
    headers["x-api-key"] = target.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${target.apiKey}`;
  }

  return headers;
}

// ── Resolve original provider target ──

function resolveTarget(modelId: string | undefined): OriginalProviderTarget | null {
  if (modelId) {
    const t = modelProviderTargets.get(modelId);
    if (t) return t;
  }
  return defaultProviderTarget;
}

// ── SSE conversion for non-streaming upstreams ──

/**
 * Convert a complete (non-streaming) OpenAI response into SSE chunks
 * that the SDK can parse as a streaming response.
 */
function completionToSSE(responseJson: Record<string, unknown>): string {
  const id = (responseJson.id as string) ?? "chatcmpl-proxy";
  const model = (responseJson.model as string) ?? "";
  const created = (responseJson.created as number) ?? Math.floor(Date.now() / 1000);
  const choices = (responseJson.choices as Array<Record<string, unknown>>) ?? [];

  const chunks: string[] = [];

  for (const choice of choices) {
    const msg = choice.message as Record<string, unknown> | undefined;
    const content = (msg?.content as string) ?? "";
    const finishReason = (choice.finish_reason as string) ?? "stop";

    // Content chunk
    if (content) {
      chunks.push(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: choice.index ?? 0,
              delta: { role: "assistant", content },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
    }

    // Finish chunk
    chunks.push(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: choice.index ?? 0, delta: {}, finish_reason: finishReason }],
        ...(responseJson.usage ? { usage: responseJson.usage } : {}),
      })}\n\n`,
    );
  }

  chunks.push("data: [DONE]\n\n");
  return chunks.join("");
}

// ── Upstream URL construction ──

/**
 * Build the upstream URL by combining the target's baseUrl with the
 * incoming request path. The proxy is mounted at /v1, so we strip that
 * prefix and append the remainder to the target baseUrl.
 *
 * For Google providers using native APIs (google-generative-ai, etc.),
 * the OpenAI-compatible endpoint lives under `/openai/` on the same host.
 * We insert that segment so the proxy can forward OpenAI-format requests.
 *
 * Example:
 *   req.url = "/v1/chat/completions"
 *   target.baseUrl = "https://api.openai.com/v1"
 *   → "https://api.openai.com/v1/chat/completions"
 *
 *   target.baseUrl = "https://generativelanguage.googleapis.com/v1beta"
 *   target = Google provider
 *   → "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
 */
export function buildUpstreamUrl(
  targetBaseUrl: string,
  reqUrl: string | undefined,
  target?: OriginalProviderTarget,
): string {
  let baseUrl = targetBaseUrl.replace(/\/+$/, "");
  const forwardPath = (reqUrl ?? "/v1/chat/completions").replace(/^\/v1/, "");

  if (target && isGoogleTarget(target) && !baseUrl.includes("/openai")) {
    baseUrl = `${baseUrl}/openai`;
  }

  return `${baseUrl}${forwardPath}`;
}

// ── Streaming with timeout fallback ──

const STREAM_FIRST_CHUNK_TIMEOUT_MS = 120_000;

/**
 * Attempt to forward a streaming request to the upstream.
 * Returns true if streaming succeeded (response fully piped), false if
 * the upstream didn't send any data within the timeout — caller should
 * fall back to non-streaming.
 */
async function tryStreamUpstream(
  parsed: Record<string, unknown>,
  upstreamUrl: string,
  upstreamHeaders: Record<string, string>,
  res: import("node:http").ServerResponse,
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_FIRST_CHUNK_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(parsed),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return false;
  }

  if (!upstream.body || !upstream.ok) {
    clearTimeout(timeout);
    return false;
  }

  const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();

  // Wait for the first chunk within the timeout
  let firstRead: ReadableStreamReadResult<Uint8Array>;
  try {
    firstRead = await reader.read();
  } catch {
    clearTimeout(timeout);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    return false;
  }
  clearTimeout(timeout);

  if (firstRead.done) {
    return false;
  }

  // Streaming is working — send headers and pipe
  const contentType = upstream.headers.get("content-type") ?? "text/event-stream";
  res.writeHead(upstream.status, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(Buffer.from(firstRead.value));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) {
        res.write(Buffer.from(value));
      }
    }
  } catch {
    log.warn("[ClawXrouter Proxy] Upstream stream closed unexpectedly");
  } finally {
    if (!res.writableEnded) res.end();
  }
  return true;
}

// ── Tool result PII likelihood heuristic ──

const SAFE_TOOL_RESULT_PATTERNS = [
  /^\s*\{\s*"(?:status|error|result)":/, // JSON error / status objects
  /^\s*#\s+\S+\.md\b/, // Markdown file headers (memory files)
  /^```[\w-]*\n/, // Code fences
  /^\s*(?:ENOENT|EACCES|EPERM|EISDIR|ENOTDIR)\b/, // File system errors
];

const MAX_LLM_DESENSITIZE_TASKS = 4;

function looksLikeSafeToolResult(content: string): boolean {
  const head = content.slice(0, 120);
  return SAFE_TOOL_RESULT_PATTERNS.some((re) => re.test(head));
}

// ── Proxy server ──

export async function startPrivacyProxy(
  port: number,
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  },
): Promise<ProxyHandle> {
  const log = logger ?? {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
    error: (m: string) => console.error(m),
  };

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      log.info(`[ClawXrouter Proxy] Incoming ${req.method} ${req.url}`);
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body);

      // Step 1: Strip PII markers (supports both OpenAI and Google formats)
      const hadOpenAiMarkers = stripPiiMarkers(parsed.messages ?? []);
      const hadGoogleMarkers = stripPiiMarkersGoogleContents(parsed.contents);
      if (hadOpenAiMarkers || hadGoogleMarkers) {
        log.info("[ClawXrouter Proxy] Stripped S2 PII markers from request");
      }

      // Step 2: Clean tool schemas (supports both OpenAI and Google formats)
      const hadOpenAiSchemaFix = cleanToolSchemas(parsed.tools);
      const hadGoogleSchemaFix = cleanGoogleToolSchemas(parsed.tools);
      if (hadOpenAiSchemaFix || hadGoogleSchemaFix) {
        log.info("[ClawXrouter Proxy] Cleaned unsupported keywords from tool schemas");
      }

      // Step 2b: Defense-in-depth — PII redaction on all non-system messages.
      //
      // Three layers:
      //   (a) Cached LLM desensitization: tool_result_persist or prior proxy
      //       call stashed a semantically desensitized version
      //   (b) Rule-based regex redaction: catches structured PII patterns
      //       (phone, email, SSN, etc.) as a universal fallback
      //   (c) Async LLM desensitization: for tool results that missed the
      //       cache — needed because pi-coding-agent's read fast-path
      //       bypasses the tool_result_persist hook entirely
      //
      // System messages are excluded to avoid corrupting security instructions.
      const redactionOpts = getLiveConfig().redaction;
      const privacyConfig = getLiveConfig();
      const allMessages = (parsed.messages ?? parsed.contents ?? []) as Array<
        Record<string, unknown>
      >;

      // Collect async LLM desensitization tasks so they run concurrently
      const llmTasks: Array<{ msg: Record<string, unknown>; rawContent: string }> = [];

      for (const msg of allMessages) {
        const role = String(msg.role ?? "").toLowerCase();
        if (role === "system") continue;

        // (a) Try cached LLM-desensitized version
        if (typeof msg.content === "string") {
          const cached = lookupDesensitizedToolResult(msg.content);
          if (cached) {
            msg.content = cached;
            log.info("[ClawXrouter Proxy] Applied cached LLM-desensitized tool result");
            continue;
          }
        } else if (Array.isArray(msg.content)) {
          let cacheHit = false;
          for (const part of msg.content as Array<Record<string, unknown>>) {
            if (part && typeof part.text === "string") {
              const cached = lookupDesensitizedToolResult(part.text);
              if (cached) {
                part.text = cached;
                cacheHit = true;
              }
            }
          }
          if (cacheHit) {
            log.info(
              "[ClawXrouter Proxy] Applied cached LLM-desensitized tool result (array content)",
            );
            continue;
          }
        }
        if (Array.isArray(msg.parts)) {
          let cacheHit = false;
          for (const part of msg.parts as Array<Record<string, unknown>>) {
            if (part && typeof part.text === "string") {
              const cached = lookupDesensitizedToolResult(part.text);
              if (cached) {
                part.text = cached;
                cacheHit = true;
              }
            }
          }
          if (cacheHit) {
            log.info(
              "[ClawXrouter Proxy] Applied cached LLM-desensitized tool result (Google parts)",
            );
            continue;
          }
        }

        // Capture raw content BEFORE regex, for correct cache key in step (c)
        const rawContent = typeof msg.content === "string" ? msg.content : undefined;

        // (b) Regex-based PII redaction fallback
        if (typeof msg.content === "string") {
          const redacted = redactSensitiveInfo(msg.content, redactionOpts);
          if (redacted !== msg.content) {
            msg.content = redacted;
            log.info(
              "[ClawXrouter Proxy] Defense-in-depth: rule-based PII redaction applied to message",
            );
          }
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content as Array<Record<string, unknown>>) {
            if (part && typeof part.text === "string") {
              const redacted = redactSensitiveInfo(part.text, redactionOpts);
              if (redacted !== part.text) {
                part.text = redacted;
                log.info(
                  "[ClawXrouter Proxy] Defense-in-depth: rule-based PII redaction applied to message part",
                );
              }
            }
          }
        }
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts as Array<Record<string, unknown>>) {
            if (part && typeof part.text === "string") {
              const redacted = redactSensitiveInfo(part.text, redactionOpts);
              if (redacted !== part.text) {
                part.text = redacted;
                log.info(
                  "[ClawXrouter Proxy] Defense-in-depth: rule-based PII redaction applied to Google part",
                );
              }
            }
          }
        }

        // (c) Queue LLM desensitization for tool results on cache miss.
        // pi-coding-agent's read fast-path bypasses tool_result_persist,
        // so ALL tool results may arrive here un-desensitized regardless
        // of language. Uses rawContent (pre-regex) for LLM input and cache key.
        //
        // Skip content that is very unlikely to contain user PII:
        //  - too short (<80 chars) to hold meaningful PII context
        //  - JSON error objects (tool failures, ENOENT, etc.)
        //  - regex already substantially modified it (regex handled it)
        if (
          role === "tool" &&
          rawContent &&
          rawContent.length > 80 &&
          privacyConfig.localModel?.enabled &&
          !looksLikeSafeToolResult(rawContent) &&
          rawContent === (msg.content as string)
        ) {
          llmTasks.push({ msg, rawContent });
        }
      }

      // Run LLM desensitization tasks concurrently (capped to avoid rate limits)
      if (llmTasks.length > 0) {
        const capped = llmTasks.slice(0, MAX_LLM_DESENSITIZE_TASKS);
        if (llmTasks.length > MAX_LLM_DESENSITIZE_TASKS) {
          log.warn(
            `[ClawXrouter Proxy] LLM desensitize: ${llmTasks.length} tasks, capped to ${MAX_LLM_DESENSITIZE_TASKS}`,
          );
        }
        const results = await Promise.allSettled(
          capped.map(async ({ msg, rawContent }) => {
            const result = await desensitizeWithLocalModel(rawContent, privacyConfig);
            if (result.wasModelUsed && !result.failed && result.desensitized !== rawContent) {
              stashDesensitizedToolResult(rawContent, result.desensitized);
              msg.content = result.desensitized;
              log.info(
                `[ClawXrouter Proxy] Async LLM PII extraction applied (len=${rawContent.length}→${result.desensitized.length})`,
              );
            }
          }),
        );
        for (const r of results) {
          if (r.status === "rejected") {
            log.warn(`[ClawXrouter Proxy] Async LLM desensitization failed: ${String(r.reason)}`);
          }
        }
      }

      // Step 3: Resolve the upstream provider via model-keyed target map
      const requestModel = parsed.model as string | undefined;
      const target = resolveTarget(requestModel);

      if (!target) {
        log.error("[ClawXrouter Proxy] No original provider target found");
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "ClawXrouter privacy proxy: no original provider target configured",
              type: "proxy_error",
            },
          }),
        );
        return;
      }

      // Step 4: Build upstream URL (transparent path forwarding)
      const upstreamUrl = buildUpstreamUrl(target.baseUrl, req.url, target);

      // Step 5: Forward cleaned request with provider-aware auth
      const upstreamHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...resolveAuthHeaders(target),
      };

      // Cap max_tokens for S2 traffic to avoid upstream rejections on
      // desensitized (shorter) content.  S1 traffic passes through uncapped.
      const hasS2Markers = hadOpenAiMarkers || hadGoogleMarkers;
      if (hasS2Markers) {
        const MAX_COMPLETION_TOKENS = 16384;
        for (const key of ["max_tokens", "max_completion_tokens"] as const) {
          if (parsed[key] != null && (parsed[key] as number) > MAX_COMPLETION_TOKENS) {
            log.info(`[ClawXrouter Proxy] Capped ${key} ${parsed[key]} → ${MAX_COMPLETION_TOKENS}`);
            parsed[key] = MAX_COMPLETION_TOKENS;
          }
        }
      }

      const clientWantsStream = !!parsed.stream;
      log.info(`[ClawXrouter Proxy] → ${upstreamUrl} (stream=${clientWantsStream})`);

      if (clientWantsStream) {
        const streamOk = await tryStreamUpstream(parsed, upstreamUrl, upstreamHeaders, res, log);
        if (streamOk) return;
        log.info(
          "[ClawXrouter Proxy] Streaming unavailable, falling back to non-streaming + SSE conversion",
        );
      }

      // Non-streaming upstream request (or fallback from failed stream).
      const upstreamBody = { ...parsed, stream: false };
      const nonStreamController = new AbortController();
      const nonStreamTimeout = setTimeout(() => nonStreamController.abort(), 120_000);
      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: JSON.stringify(upstreamBody),
          signal: nonStreamController.signal,
        });
      } catch (fetchErr) {
        clearTimeout(nonStreamTimeout);
        const msg =
          fetchErr instanceof Error && fetchErr.name === "AbortError"
            ? "Upstream request timed out (120s)"
            : String(fetchErr);
        log.error(`[ClawXrouter Proxy] Upstream fetch failed: ${msg}`);
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: msg, type: "proxy_timeout" } }));
        return;
      }
      clearTimeout(nonStreamTimeout);

      if (clientWantsStream) {
        const responseJson = (await upstream.json()) as Record<string, unknown>;
        log.info(
          `[ClawXrouter Proxy] Upstream responded: status=${upstream.status} ok=${upstream.ok}`,
        );
        if (upstream.ok) {
          const ssePayload = completionToSSE(responseJson);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.end(ssePayload);
        } else {
          res.writeHead(upstream.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(responseJson));
        }
      } else {
        const contentType = upstream.headers.get("content-type") ?? "application/json";
        res.writeHead(upstream.status, { "Content-Type": contentType });
        const responseBody = await upstream.text();
        res.end(responseBody);
      }
    } catch (err) {
      log.error(`[ClawXrouter Proxy] Request failed: ${String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end(
          JSON.stringify({
            error: {
              message: `ClawXrouter proxy error: ${String(err)}`,
              type: "proxy_error",
            },
          }),
        );
      }
    }
  });

  // Handle server-level errors
  server.on("error", (err) => {
    log.error(`[ClawXrouter Proxy] Server error: ${String(err)}`);
  });

  return new Promise<ProxyHandle>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
            // Force-close lingering connections after a short grace period
            setTimeout(() => r(), 2000);
          }),
      });
    });
    server.on("error", reject);
  });
}
