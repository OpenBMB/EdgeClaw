/**
 * GuardClaw Local Model Detector
 *
 * Local model-based sensitivity detection via OpenAI-compatible chat completions API.
 * Works with any backend that exposes /v1/chat/completions (Ollama, vLLM, LiteLLM, etc.).
 */

import type {
  DetectionContext,
  DetectionResult,
  PrivacyConfig,
  SensitivityLevel,
} from "./types.js";
import { loadPrompt, loadPromptWithVars } from "./prompt-loader.js";
import { levelToNumeric } from "./types.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Unified OpenAI-compatible chat completions call.
 * Sends POST to ${endpoint}/v1/chat/completions — works with Ollama, vLLM, LiteLLM, etc.
 */
async function callChatCompletion(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
    frequencyPenalty?: number;
  },
): Promise<string> {
  const url = `${endpoint}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  };
  let result = data.choices?.[0]?.message?.content ?? "";

  result = stripThinkingTags(result);
  return result;
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
    const response = await callLocalModel(system, user, config);
    const parsed = parseModelResponse(response);

    let { level } = parsed;

    // If the LLM says S1 but we have file content with obvious PII, bump to S2.
    // This handles cases where the message itself is innocent but the file has PII.
    if (level === "S1" && context.fileContentSnippet) {
      const piiLevel = quickPiiScan(context.fileContentSnippet);
      if (piiLevel !== "S1") {
        console.log(`[GuardClaw] LLM said S1 but file PII scan found ${piiLevel} — bumping`);
        level = piiLevel;
        parsed.reason = `${parsed.reason ?? ""}; file content contains PII (auto-bumped to ${piiLevel})`;
      }
    }

    return {
      level,
      levelNumeric: levelToNumeric(level),
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

/**
 * Quick regex-based PII scan for file content.
 * Not used for primary detection — only as a safety net when the LLM says S1
 * but the file content clearly contains PII that should be at least S2.
 */
function quickPiiScan(content: string): SensitivityLevel {
  const s3Patterns = [
    /\bpassword\s*[:=]/i,
    /\b密码\s*[:：]/,
    /\bAPI[_\s]?key\s*[:=]/i,
    /\bsecret\s*[:=]/i,
    /\btoken\s*[:=]/i,
    /\bprivate[_\s]?key/i,
    /\bid_rsa\b/i,
  ];
  for (const p of s3Patterns) {
    if (p.test(content)) return "S3";
  }

  let piiHits = 0;
  const s2Patterns = [
    /\(\d{3}\)\s?\d{3}-\d{4}/, // US phone (415) 867-5321
    /\b1[3-9]\d{9}\b/, // CN mobile 13867554321
    /\b\d{3}-\d{2}-\d{4}\b/, // US SSN 518-73-6294
    /\b\d{6}(?:19|20)\d{8}\b/, // CN ID 330106196208158821
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i, // email
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/, // card number
    /\b(?:gate|door|access)\s*code\s*[:：]?\s*\S+/i, // gate code
    /门禁码\s*[:：]?\s*\S+/, // CN gate code
    /\b(?:tracking|单号)\s*[:：]?\s*\S+/i, // tracking number
    /\b(?:license\s*plate|车牌号?)\s*[:：]?\s*\S+/i, // license plate
    /\b[沪京粤苏浙鲁豫川闽湘鄂]\w[·]?\w{4,5}\b/, // CN license plate
    /\b\d{1,5}\s+\w+\s+(?:St|Street|Ave|Avenue|Blvd|Dr|Drive|Rd|Road|Ln|Lane)\b/i, // US address
    /(?:路|街|弄|号|巷|村)\d+/, // CN address
  ];
  for (const p of s2Patterns) {
    if (p.test(content)) piiHits++;
  }

  // Need at least 2 PII pattern matches to classify as S2
  return piiHits >= 2 ? "S2" : "S1";
}

/** Default detection system prompt (fallback if prompts/detection-system.md is missing) */
const DEFAULT_DETECTION_SYSTEM_PROMPT = `[SYSTEM] You are a strict privacy classifier. Output ONLY a single JSON object — nothing else.

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
 * Call local model via OpenAI-compatible chat completions API.
 * Provider-agnostic: works with any backend exposing /v1/chat/completions.
 */
async function callLocalModel(
  systemPrompt: string,
  userContent: string,
  config: PrivacyConfig,
): Promise<string> {
  const model = config.localModel?.model ?? "openbmb/minicpm4.1";
  const endpoint = config.localModel?.endpoint ?? "http://localhost:11434";

  // Qwen3: prefix user content with /no_think to suppress chain-of-thought output
  const modelLower = model.toLowerCase();
  const finalUser = modelLower.includes("qwen") ? `/no_think\n${userContent}` : userContent;

  return await callChatCompletion(
    endpoint,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: finalUser },
    ],
    { temperature: 0.1, maxTokens: 800 },
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
): Promise<{ desensitized: string; wasModelUsed: boolean }> {
  if (!config.localModel?.enabled) {
    return { desensitized: content, wasModelUsed: false };
  }

  try {
    const endpoint = config.localModel?.endpoint ?? "http://localhost:11434";
    const model = config.localModel?.model ?? "openbmb/minicpm4.1";

    // Step 1: Ask the model to identify PII as JSON
    const piiItems = await extractPiiWithModel(endpoint, model, content);

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
const DEFAULT_PII_EXTRACTION_PROMPT = `You are a PII extraction engine. Extract ALL PII (personally identifiable information) from the given text as a JSON array.

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
): Promise<Array<{ type: string; value: string }>> {
  const textSnippet = content.slice(0, 3000);

  // Allow user customization via prompts/pii-extraction.md
  const systemPrompt = loadPromptWithVars("pii-extraction", DEFAULT_PII_EXTRACTION_PROMPT, {
    CONTENT: textSnippet,
  });

  // If the loaded prompt has {{CONTENT}} substituted in, use a short user trigger;
  // otherwise send the content as the user message.
  const promptHasContent = systemPrompt.includes(textSnippet) && textSnippet.length > 10;
  const userMessage = promptHasContent
    ? "Extract all PII from the text above. Output ONLY the JSON array."
    : textSnippet;

  const raw = await callChatCompletion(
    endpoint,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    { temperature: 0.0, maxTokens: 2500, stop: ["Input:", "Task:"] },
  );

  return parsePiiJson(raw);
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
 * Call local model directly for an S3 analysis task, bypassing the full agent pipeline.
 * Uses OpenAI-compatible chat completions API with frequency_penalty to reduce repetition.
 */
export async function callLocalModelDirect(
  systemPrompt: string,
  userMessage: string,
  config: { endpoint?: string; model?: string },
): Promise<string> {
  const endpoint = config.endpoint ?? "http://localhost:11434";
  const model = config.model ?? "openbmb/minicpm4.1";

  let result = await callChatCompletion(
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
    },
  );

  // Truncate at any remaining [message_id: artifacts
  for (const marker of ["[message_id:", "[Message_id:"]) {
    const idx = result.indexOf(marker);
    if (idx > 0) {
      result = result.slice(0, idx).trim();
    }
  }

  return result;
}
