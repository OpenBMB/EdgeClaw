/**
 * GuardClaw Local Model Detector
 *
 * Provider-agnostic edge model integration supporting multiple API protocols:
 *   - "openai-compatible": /v1/chat/completions (Ollama, vLLM, LiteLLM, LocalAI, LMStudio, SGLang, TGI …)
 *   - "ollama-native":     /api/chat (Ollama native API)
 *   - "custom":            User-supplied module with callChat() export
 */

import { loadPrompt, loadPromptWithVars } from "./prompt-loader.js";
import { getGlobalCollector } from "./token-stats.js";
import { recordRouterOperation } from "./usage-intel.js";
import type {
  DetectionContext,
  DetectionResult,
  EdgeProviderType,
  PrivacyConfig,
  SensitivityLevel,
} from "./types.js";
import { levelToNumeric } from "./types.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletionOptions = {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  frequencyPenalty?: number;
  apiKey?: string;
};

export type LlmUsageInfo = {
  input: number;
  output: number;
  total: number;
};

export type ChatCompletionResult = {
  text: string;
  usage?: LlmUsageInfo;
};

/**
 * Custom edge provider module interface.
 * Users implementing type="custom" must export a module matching this shape.
 */
export interface CustomEdgeProvider {
  callChat(
    endpoint: string,
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<string>;
}

let _customProviderCache: Map<string, CustomEdgeProvider> = new Map();

async function loadCustomProvider(modulePath: string): Promise<CustomEdgeProvider> {
  const cached = _customProviderCache.get(modulePath);
  if (cached) return cached;
  const mod = (await import(modulePath)) as CustomEdgeProvider;
  if (typeof mod.callChat !== "function") {
    throw new Error(`Custom edge provider at "${modulePath}" must export a callChat() function`);
  }
  _customProviderCache.set(modulePath, mod);
  return mod;
}

/**
 * Dispatch a chat completion call based on the configured edge provider type.
 * This is the single entry point for all edge model calls.
 *
 * Returns a ChatCompletionResult with the response text and optional usage info
 * parsed from the API response (for token accounting).
 */
export async function callChatCompletion(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatCompletionOptions & { providerType?: EdgeProviderType; customModule?: string },
): Promise<ChatCompletionResult> {
  const providerType = options?.providerType ?? "openai-compatible";
  console.log(`[GuardClaw] [DEBUG] calling LLM: ${endpoint} ${model} (${providerType})`);

  let result: ChatCompletionResult;
  switch (providerType) {
    case "ollama-native":
      result = await callOllamaNative(endpoint, model, messages, options);
      break;
    case "custom": {
      if (!options?.customModule) {
        throw new Error("Custom edge provider requires a 'module' path in localModel config");
      }
      const provider = await loadCustomProvider(options.customModule);
      const text = await provider.callChat(endpoint, model, messages, options);
      result = { text };
      break;
    }
    case "openai-compatible":
    default:
      result = await callOpenAICompatible(endpoint, model, messages, options);
      break;
  }
  console.log(`[GuardClaw] [DEBUG] LLM response (${model}): ${result.text.slice(0, 200)}`);
  return result;
}

/**
 * OpenAI-compatible chat completions call.
 * POST ${endpoint}/v1/chat/completions — works with Ollama, vLLM, LiteLLM, LocalAI, LMStudio, SGLang, TGI, etc.
 */
async function callOpenAICompatible(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const url = `${endpoint}/v1/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 800,
      stream: false,
      ...(options?.stop ? { stop: options.stop } : {}),
      ...(options?.frequencyPenalty != null ? { frequency_penalty: options.frequencyPenalty } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat completions API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  let text = data.choices?.[0]?.message?.content ?? "";
  text = stripThinkingTags(text);

  const usage: LlmUsageInfo | undefined = data.usage
    ? {
        input: data.usage.prompt_tokens ?? 0,
        output: data.usage.completion_tokens ?? 0,
        total:
          data.usage.total_tokens ??
          (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
      }
    : undefined;

  return { text, usage };
}

/**
 * Ollama native API call.
 * POST ${endpoint}/api/chat — Ollama's own protocol (non-streaming).
 */
async function callOllamaNative(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const url = `${endpoint}/api/chat`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.1,
        num_predict: options?.maxTokens ?? 800,
        ...(options?.stop ? { stop: options.stop } : {}),
        ...(options?.frequencyPenalty != null
          ? { repeat_penalty: 1.0 + (options.frequencyPenalty ?? 0) }
          : {}),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama native API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  let text = data.message?.content ?? "";
  text = stripThinkingTags(text);

  const promptTokens = data.prompt_eval_count ?? 0;
  const outputTokens = data.eval_count ?? 0;
  const usage: LlmUsageInfo | undefined =
    promptTokens || outputTokens
      ? { input: promptTokens, output: outputTokens, total: promptTokens + outputTokens }
      : undefined;

  return { text, usage };
}

/** Strip <think>...</think> blocks emitted by reasoning models (MiniCPM, Qwen3, etc.) */
function stripThinkingTags(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const lastThinkClose = result.lastIndexOf("</think>");
  if (lastThinkClose !== -1) {
    result = result.slice(lastThinkClose + "</think>".length).trim();
  }
  return result;
}

/**
 * Detect sensitivity level using a local model
 */
export async function detectByLocalModel(
  context: DetectionContext,
  config: PrivacyConfig,
): Promise<DetectionResult> {
  // Check if local model is enabled
  if (!config.localModel?.enabled) {
    return {
      level: "S1",
      levelNumeric: 1,
      reason: "Local model detection disabled",
      detectorType: "localModelDetector",
      confidence: 0,
    };
  }

  try {
    const { system, user } = buildDetectionMessages(context);
    const result = await callLocalModel(system, user, config);
    const parsed = parseModelResponse(result.text);

    if (result.usage) {
      const collector = getGlobalCollector();
      collector?.record({
        sessionKey: context.sessionKey ?? "",
        provider: "edge",
        model: config.localModel?.model ?? "unknown",
        source: "router",
        usage: result.usage,
      });
      recordRouterOperation(
        context.sessionKey,
        "detection",
        result.usage,
        config.localModel?.model ?? "unknown",
        config.localModel?.provider,
      );
    }

    return {
      level: parsed.level,
      levelNumeric: levelToNumeric(parsed.level),
      reason: parsed.reason,
      detectorType: "localModelDetector",
      confidence: parsed.confidence ?? 0.8,
    };
  } catch (err) {
    // If local model fails, return S1 (safe) but log the error
    console.error("[GuardClaw] Local model detection failed:", err);
    return {
      level: "S1",
      levelNumeric: 1,
      reason: `Local model error: ${String(err)}`,
      detectorType: "localModelDetector",
      confidence: 0,
    };
  }
}

/** Default detection system prompt (fallback if prompts/detection-system.md is missing) */
export const DEFAULT_DETECTION_SYSTEM_PROMPT = `[SYSTEM] You are a strict privacy classifier. Output ONLY a single JSON object — nothing else.

Classify by BOTH actual data AND intent. If the user asks to read/analyze a file, classify based on what the file WILL contain.

S3 = PRIVATE (local only, never cloud):
  - Financial: payslip, salary, tax, bank account, SSN, 工资单, 报销单, 税表
  - Medical: health records, diagnoses, prescriptions, lab results, 病历, 体检报告
  - Credentials: passwords, API keys, secrets, tokens, private keys
  - ANY request to read/analyze a file about the above topics → S3
  "evaluate these passwords" → S3
  "check my payslip" → S3
  "summarize the medical record" → S3

S2 = SENSITIVE (redact PII, then send to cloud):
  - Addresses (ANY physical address, 地址, 住址, street, road, apartment, 路, 街, 小区, 弄, 号)
  - Gate/door codes, pickup codes, delivery tracking numbers
  - Phone numbers, email addresses, real names used as contact PII
  - License plates, SSN/ID mixed with personal context, chat logs with PII
  - File content containing the above PII → S2
  - ANY mention of "address"/"地址" with actual location data → S2
  "1847 Elm St, gate code 4523#" → S2
  "我的地址是北京市朝阳区xxx" → S2
  "张伟 手机13912345678" → S2
  "my address is 123 Main St" → S2

S1 = SAFE: No sensitive data or intent.
  "write a poem about spring" → S1
  "how to read Excel with pandas" → S1

Rules:
- Passwords/credentials → ALWAYS S3 (never S2)
- Medical data → ALWAYS S3 (never S2)
- Gate/access/pickup codes → S2 (not S3)
- If file content is provided and contains PII → at least S2
- When unsure → pick higher level

Output format: {"level":"S1|S2|S3","reason":"brief"}`;

/**
 * Build separate system/user messages for the detection prompt.
 *
 * System instruction is loaded from prompts/detection-system.md (editable by users).
 * The dynamic [CONTENT] block becomes the user message.
 */
function buildDetectionMessages(context: DetectionContext): { system: string; user: string } {
  const system = loadPrompt("detection-system", DEFAULT_DETECTION_SYSTEM_PROMPT);

  const parts: string[] = ["[CONTENT]"];

  if (context.message) {
    parts.push(`Message: ${context.message.slice(0, 1500)}`);
  }

  if (context.toolName) {
    parts.push(`Tool: ${context.toolName}`);
  }

  if (context.toolParams) {
    const paramsStr = JSON.stringify(context.toolParams, null, 2);
    parts.push(`Tool Parameters: ${paramsStr.slice(0, 800)}`);
  }

  if (context.toolResult) {
    const resultStr =
      typeof context.toolResult === "string"
        ? context.toolResult
        : JSON.stringify(context.toolResult);
    parts.push(`Tool Result: ${resultStr.slice(0, 800)}`);
  }

  if (context.recentContext && context.recentContext.length > 0) {
    parts.push(`Recent Context: ${context.recentContext.slice(-3).join(" | ")}`);
  }

  parts.push("[/CONTENT]");

  return { system, user: parts.join("\n") };
}

/**
 * Call local/edge model via the configured provider protocol.
 * Dispatches to the correct API based on localModel.type.
 * Returns both the text response and optional usage info for router overhead tracking.
 */
async function callLocalModel(
  systemPrompt: string,
  userContent: string,
  config: PrivacyConfig,
): Promise<ChatCompletionResult> {
  const model = config.localModel?.model ?? "openbmb/minicpm4.1";
  const endpoint = config.localModel?.endpoint ?? "http://localhost:11434";
  const providerType = config.localModel?.type ?? "openai-compatible";

  const modelLower = model.toLowerCase();
  const finalUser = modelLower.includes("qwen") ? `/no_think\n${userContent}` : userContent;

  return await callChatCompletion(
    endpoint,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: finalUser },
    ],
    {
      temperature: 0.1,
      maxTokens: 32768,
      apiKey: config.localModel?.apiKey,
      providerType,
      customModule: config.localModel?.module,
    },
  );
}

/**
 * Two-step desensitization using a local model:
 *   Step 1: Model identifies PII items as a JSON array
 *   Step 2: Programmatic string replacement using the model's output
 *
 * Falls back to rule-based redaction if the local model is unavailable.
 */
export async function desensitizeWithLocalModel(
  content: string,
  config: PrivacyConfig,
  sessionKey?: string,
): Promise<{ desensitized: string; wasModelUsed: boolean }> {
  if (!config.localModel?.enabled) {
    return { desensitized: content, wasModelUsed: false };
  }

  try {
    const endpoint = config.localModel?.endpoint ?? "http://localhost:11434";
    const model = config.localModel?.model ?? "openbmb/minicpm4.1";
    const providerType = config.localModel?.type ?? "openai-compatible";
    const customModule = config.localModel?.module;

    const piiItems = await extractPiiWithModel(endpoint, model, content, {
      apiKey: config.localModel?.apiKey,
      providerType,
      customModule,
      sessionKey,
      provider: config.localModel?.provider,
    });

    if (piiItems.length === 0) {
      return { desensitized: content, wasModelUsed: true };
    }

    // Step 2: Programmatic replacement
    let redacted = content;
    // Sort by value length descending to avoid partial replacements
    const sorted = [...piiItems].sort((a, b) => b.value.length - a.value.length);
    for (const item of sorted) {
      if (!item.value || item.value.length < 2) continue;
      const tag = mapPiiTypeToTag(item.type);
      // Replace all occurrences of this value
      redacted = replaceAll(redacted, item.value, tag);
    }

    return { desensitized: redacted, wasModelUsed: true };
  } catch (err) {
    console.error("[GuardClaw] Local model desensitization failed:", err);
    return { desensitized: content, wasModelUsed: false };
  }
}

/** Map model PII types to [REDACTED:...] tags */
function mapPiiTypeToTag(type: string): string {
  const t = type.toUpperCase().replace(/\s+/g, "_");
  const mapping: Record<string, string> = {
    ADDRESS: "[REDACTED:ADDRESS]",
    ACCESS_CODE: "[REDACTED:ACCESS_CODE]",
    DELIVERY: "[REDACTED:DELIVERY]",
    COURIER_NUMBER: "[REDACTED:DELIVERY]",
    COURIER_NO: "[REDACTED:DELIVERY]",
    COURIER_CODE: "[REDACTED:DELIVERY]",
    TRACKING_NUMBER: "[REDACTED:DELIVERY]",
    NAME: "[REDACTED:NAME]",
    SENDER_NAME: "[REDACTED:NAME]",
    RECIPIENT_NAME: "[REDACTED:NAME]",
    PHONE: "[REDACTED:PHONE]",
    SENDER_PHONE: "[REDACTED:PHONE]",
    FACILITY_PHONE: "[REDACTED:PHONE]",
    LANDLINE: "[REDACTED:PHONE]",
    MOBILE: "[REDACTED:PHONE]",
    EMAIL: "[REDACTED:EMAIL]",
    ID: "[REDACTED:ID]",
    ID_CARD: "[REDACTED:ID]",
    ID_NUMBER: "[REDACTED:ID]",
    CARD: "[REDACTED:CARD]",
    BANK_CARD: "[REDACTED:CARD]",
    CARD_NUMBER: "[REDACTED:CARD]",
    SECRET: "[REDACTED:SECRET]",
    PASSWORD: "[REDACTED:SECRET]",
    API_KEY: "[REDACTED:SECRET]",
    TOKEN: "[REDACTED:SECRET]",
    IP: "[REDACTED:IP]",
    LICENSE_PLATE: "[REDACTED:LICENSE]",
    PLATE: "[REDACTED:LICENSE]",
    TIME: "[REDACTED:TIME]",
    DATE: "[REDACTED:DATE]",
    SALARY: "[REDACTED:SALARY]",
    AMOUNT: "[REDACTED:AMOUNT]",
  };
  return mapping[t] ?? `[REDACTED:${t}]`;
}

/** Simple replaceAll polyfill for older Node */
function replaceAll(str: string, search: string, replacement: string): string {
  // Escape regex special chars in search string
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return str.replace(new RegExp(escaped, "g"), replacement);
}

/** Default PII extraction system prompt (fallback if prompts/pii-extraction.md is missing) */
export const DEFAULT_PII_EXTRACTION_PROMPT = `You are a PII extraction engine. Extract ALL PII (personally identifiable information) from the given text as a JSON array.

Types: NAME (every person), PHONE, ADDRESS (all variants including shortened), ACCESS_CODE (gate/door/门禁码), DELIVERY (tracking numbers, pickup codes/取件码), ID (SSN/身份证), CARD (bank/medical/insurance), LICENSE_PLATE (plate numbers/车牌), EMAIL, PASSWORD, PAYMENT (Venmo/PayPal/支付宝), BIRTHDAY, TIME (appointment/delivery times), NOTE (private instructions)

Important: Extract EVERY person's name and EVERY address variant.

Example:
Input: Alex lives at 123 Main St. Li Na phone 13912345678, gate code 1234#, card YB330-123, plate 京A12345, tracking SF123, Venmo @alex99
Output: [{"type":"NAME","value":"Alex"},{"type":"NAME","value":"Li Na"},{"type":"ADDRESS","value":"123 Main St"},{"type":"PHONE","value":"13912345678"},{"type":"ACCESS_CODE","value":"1234#"},{"type":"CARD","value":"YB330-123"},{"type":"LICENSE_PLATE","value":"京A12345"},{"type":"DELIVERY","value":"SF123"},{"type":"PAYMENT","value":"@alex99"}]

Output ONLY the JSON array — no explanation, no markdown fences.`;

/**
 * Extract PII from content using local model via chat completions.
 *
 * Two-step approach: model identifies PII items as JSON, then we do
 * programmatic string replacement. More reliable than asking models to rewrite.
 */
async function extractPiiWithModel(
  endpoint: string,
  model: string,
  content: string,
  opts?: {
    apiKey?: string;
    providerType?: EdgeProviderType;
    customModule?: string;
    sessionKey?: string;
    provider?: string;
  },
): Promise<Array<{ type: string; value: string }>> {
  const textSnippet = content.slice(0, 3000);

  const systemPrompt = loadPromptWithVars("pii-extraction", DEFAULT_PII_EXTRACTION_PROMPT, {
    CONTENT: textSnippet,
  });

  const promptHasContent = systemPrompt.includes(textSnippet) && textSnippet.length > 10;
  const userMessage = promptHasContent
    ? "Extract all PII from the text above. Output ONLY the JSON array."
    : textSnippet;

  const result = await callChatCompletion(
    endpoint,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      temperature: 0.0,
      maxTokens: 32768,
      stop: ["Input:", "Task:"],
      apiKey: opts?.apiKey,
      providerType: opts?.providerType,
      customModule: opts?.customModule,
    },
  );

  if (result.usage) {
    const collector = getGlobalCollector();
    collector?.record({
      sessionKey: opts?.sessionKey ?? "",
      provider: "edge",
      model,
      source: "router",
      usage: result.usage,
    });
    recordRouterOperation(opts?.sessionKey, "desensitization", result.usage, model, opts?.provider);
  }

  return parsePiiJson(result.text);
}

/** Parse the model's PII extraction output into structured items */
function parsePiiJson(raw: string): Array<{ type: string; value: string }> {
  // Normalize whitespace (model may use newlines between items)
  let cleaned = raw.replace(/\s+/g, " ").trim();

  // Strip markdown code fences if present
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Find the JSON array in the output
  const arrayStart = cleaned.indexOf("[");
  if (arrayStart < 0) return [];
  let jsonStr = cleaned.slice(arrayStart);

  // Find the last ] to cut off any trailing garbage
  const lastBracket = jsonStr.lastIndexOf("]");
  if (lastBracket >= 0) {
    jsonStr = jsonStr.slice(0, lastBracket + 1);
  } else {
    const lastCloseBrace = jsonStr.lastIndexOf("}");
    if (lastCloseBrace >= 0) {
      jsonStr = jsonStr.slice(0, lastCloseBrace + 1) + "]";
    } else {
      return [];
    }
  }

  // Fix trailing commas before ]
  jsonStr = jsonStr.replace(/,\s*\]/g, "]");

  // Normalize Python-style single-quoted JSON to double-quoted JSON.
  // Some local models output {'key': 'value'} instead of {"key": "value"}.
  jsonStr = jsonStr
    .replace(/(?<=[\[,{]\s*)'([^']+?)'(?=\s*:)/g, '"$1"')
    .replace(/(?<=:\s*)'([^']*?)'(?=\s*[,}\]])/g, '"$1"');

  console.log(
    `[GuardClaw] PII extraction raw JSON (${jsonStr.length} chars): ${jsonStr.slice(0, 300)}...`,
  );

  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    const items = arr.filter(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).type === "string" &&
        typeof (item as Record<string, unknown>).value === "string",
    ) as Array<{ type: string; value: string }>;
    console.log(
      `[GuardClaw] PII extraction found ${items.length} items: ${items.map((i) => `${i.type}=${i.value}`).join(", ")}`,
    );
    return items;
  } catch {
    console.error("[GuardClaw] Failed to parse PII extraction JSON:", jsonStr.slice(0, 300));
    return [];
  }
}

/**
 * Parse model response to extract sensitivity level
 */
function parseModelResponse(response: string): {
  level: SensitivityLevel;
  reason?: string;
  confidence?: number;
} {
  try {
    // Try to find JSON in the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        level?: string;
        reason?: string;
        confidence?: number;
      };

      // Validate level
      const level = parsed.level?.toUpperCase();
      if (level === "S1" || level === "S2" || level === "S3") {
        return {
          level: level as SensitivityLevel,
          reason: parsed.reason,
          confidence: parsed.confidence,
        };
      }
    }

    // Fallback: look for level mentions in text
    const upperResponse = response.toUpperCase();
    if (upperResponse.includes("S3") || upperResponse.includes("PRIVATE")) {
      return {
        level: "S3",
        reason: "Detected from text analysis",
        confidence: 0.6,
      };
    }
    if (upperResponse.includes("S2") || upperResponse.includes("SENSITIVE")) {
      return {
        level: "S2",
        reason: "Detected from text analysis",
        confidence: 0.6,
      };
    }

    // Default to S1 if unable to parse
    return {
      level: "S1",
      reason: "Unable to parse model response",
      confidence: 0.3,
    };
  } catch (err) {
    console.error("[GuardClaw] Error parsing model response:", err);
    return {
      level: "S1",
      reason: "Parse error",
      confidence: 0,
    };
  }
}

/**
 * Raw edge model call for internal GuardClaw use only (detection, PII extraction,
 * desensitization, token-saver). S3 content routing uses providerOverride instead.
 *
 * Not part of the public plugin API — OpenClaw Plugin SDK has no native model
 * completion API yet. If upstream adds PluginRuntime.models.chatComplete(),
 * this helper should migrate to that.
 */
export async function _callEdgeModelRaw(
  systemPrompt: string,
  userMessage: string,
  config: {
    endpoint?: string;
    model?: string;
    apiKey?: string;
    providerType?: EdgeProviderType;
    customModule?: string;
  },
): Promise<string> {
  const endpoint = config.endpoint ?? "http://localhost:11434";
  const model = config.model ?? "openbmb/minicpm4.1";

  const completion = await callChatCompletion(
    endpoint,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      temperature: 0.3,
      maxTokens: 1500,
      frequencyPenalty: 0.5,
      stop: ["[message_id:", "[Message_id:", "[system:", "Instructions:", "Data:"],
      apiKey: config.apiKey,
      providerType: config.providerType,
      customModule: config.customModule,
    },
  );

  let result = completion.text;
  for (const marker of ["[message_id:", "[Message_id:"]) {
    const idx = result.indexOf(marker);
    if (idx > 0) {
      result = result.slice(0, idx).trim();
    }
  }

  return result;
}
