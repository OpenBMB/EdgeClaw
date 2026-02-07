/**
 * GuardClaw Local Model Detector
 * 
 * Local model-based sensitivity detection using Ollama or other local providers.
 */

import type { DetectionContext, DetectionResult, PrivacyConfig, SensitivityLevel } from "./types.js";
import { levelToNumeric } from "./types.js";

/**
 * Detect sensitivity level using a local model
 */
export async function detectByLocalModel(
  context: DetectionContext,
  config: PrivacyConfig
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
    const prompt = buildDetectionPrompt(context);
    const response = await callLocalModel(prompt, config);
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
    /\(\d{3}\)\s?\d{3}-\d{4}/,                    // US phone (415) 867-5321
    /\b1[3-9]\d{9}\b/,                              // CN mobile 13867554321
    /\b\d{3}-\d{2}-\d{4}\b/,                        // US SSN 518-73-6294
    /\b\d{6}(?:19|20)\d{8}\b/,                      // CN ID 330106196208158821
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i, // email
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/,           // card number
    /\b(?:gate|door|access)\s*code\s*[:：]?\s*\S+/i, // gate code
    /门禁码\s*[:：]?\s*\S+/,                         // CN gate code
    /\b(?:tracking|单号)\s*[:：]?\s*\S+/i,           // tracking number
    /\b(?:license\s*plate|车牌号?)\s*[:：]?\s*\S+/i, // license plate
    /\b[沪京粤苏浙鲁豫川闽湘鄂]\w[·]?\w{4,5}\b/,    // CN license plate
    /\b\d{1,5}\s+\w+\s+(?:St|Street|Ave|Avenue|Blvd|Dr|Drive|Rd|Road|Ln|Lane)\b/i, // US address
    /(?:路|街|弄|号|巷|村)\d+/,                      // CN address
  ];
  for (const p of s2Patterns) {
    if (p.test(content)) piiHits++;
  }

  // Need at least 2 PII pattern matches to classify as S2
  return piiHits >= 2 ? "S2" : "S1";
}

/**
 * Build detection prompt for the local model.
 *
 * The prompt is bilingual (English + Chinese) so the judge works well with
 * both English developer-oriented content and Chinese daily-life scenarios
 * described in CASES.md.
 *
 * Tuned for MiniCPM4.1-8B but works with other 8B-class models (Qwen3, Llama).
 */
function buildDetectionPrompt(context: DetectionContext): string {
  // Compact prompt with explicit examples — tuned for MiniCPM4.1 and similar 8B models
  const parts: string[] = [
    `[SYSTEM] You are a strict privacy classifier. Output ONLY a single JSON object — nothing else.

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
  - Addresses, gate/door codes, pickup codes, delivery tracking numbers
  - Phone numbers, email addresses, real names used as contact PII
  - License plates, SSN/ID mixed with personal context, chat logs with PII
  - File content containing the above PII → S2
  "1847 Elm St, gate code 4523#" → S2
  "张伟 手机13912345678" → S2

S1 = SAFE: No sensitive data or intent.
  "write a poem about spring" → S1
  "how to read Excel with pandas" → S1

Rules:
- Passwords/credentials → ALWAYS S3 (never S2)
- Medical data → ALWAYS S3 (never S2)
- Gate/access/pickup codes → S2 (not S3)
- If file content is provided and contains PII → at least S2
- When unsure → pick higher level

Output format: {"level":"S1|S2|S3","reason":"brief"}`,
    "",
    "[CONTENT]",
  ];

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
    const resultStr = typeof context.toolResult === "string"
      ? context.toolResult
      : JSON.stringify(context.toolResult);
    parts.push(`Tool Result: ${resultStr.slice(0, 800)}`);
  }

  if (context.recentContext && context.recentContext.length > 0) {
    parts.push(`Recent Context: ${context.recentContext.slice(-3).join(" | ")}`);
  }

  parts.push("[/CONTENT]");

  return parts.join("\n");
}

/**
 * Call local model (Ollama or other providers)
 */
async function callLocalModel(prompt: string, config: PrivacyConfig): Promise<string> {
  const provider = config.localModel?.provider ?? "ollama";
  const model = config.localModel?.model ?? "llama3.2:3b";
  const endpoint = config.localModel?.endpoint ?? "http://localhost:11434";

  if (provider === "ollama") {
    return await callOllama(endpoint, model, prompt);
  }

  throw new Error(`Unsupported local model provider: ${provider}`);
}

/**
 * Call Ollama API
 */
async function callOllama(endpoint: string, model: string, prompt: string): Promise<string> {
  const url = `${endpoint}/api/generate`;

  const modelLower = model.toLowerCase();

  // Model-specific prompt adjustments:
  // - Qwen3: prefix with /no_think to suppress chain-of-thought output
  // - MiniCPM / others: use prompt as-is
  const finalPrompt = modelLower.includes("qwen")
    ? `/no_think\n${prompt}`
    : prompt;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: finalPrompt,
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for consistent classification
        num_predict: 800, // Allow space for thinking models
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { response?: string };
  let result = data.response ?? "";

  // Strip thinking output from models that use <think>...</think> (MiniCPM, Qwen3, etc.)
  // Case 1: Full <think>...</think> blocks
  result = result.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Case 2: Only </think> appears (partial thinking) — take text after the LAST </think>
  const lastThinkClose = result.lastIndexOf("</think>");
  if (lastThinkClose !== -1) {
    result = result.slice(lastThinkClose + "</think>".length).trim();
  }

  return result;
}

/**
 * Desensitize content using local model.
 * For S2 content: ask the local model to redact sensitive parts, then return
 * the cleaned text that is safe to send to cloud models.
 *
 * Falls back to rule-based redaction if the local model is unavailable.
 */
/**
 * Two-step desensitization using a local model:
 *   Step 1: Model identifies PII items as a JSON array (completion-style prompt)
 *   Step 2: Programmatic string replacement using the model's output
 *
 * This approach is much more reliable than asking the model to rewrite text,
 * because small models like MiniCPM4.1 hallucinate when asked to edit text
 * but are good at structured extraction with completion-style prompts.
 */
export async function desensitizeWithLocalModel(
  content: string,
  config: PrivacyConfig
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

/**
 * Call Ollama with a completion-style prompt to extract PII as JSON.
 *
 * Uses the generate API with a prefix that shows the model examples and
 * starts the JSON array for it to complete. This is far more reliable
 * than asking the model to rewrite text.
 */
async function extractPiiWithModel(
  endpoint: string,
  model: string,
  content: string,
): Promise<Array<{ type: string; value: string }>> {
  const textSnippet = content.slice(0, 3000);
  const prompt = `Task: Extract ALL PII (personally identifiable information) from text as a JSON array.

Types: NAME (every person), PHONE, ADDRESS (all variants including shortened), ACCESS_CODE (gate/door/门禁码), DELIVERY (tracking numbers, pickup codes/取件码), ID (SSN/身份证), CARD (bank/medical/insurance), LICENSE_PLATE (plate numbers/车牌), EMAIL, PASSWORD, PAYMENT (Venmo/PayPal/支付宝), BIRTHDAY, TIME (appointment/delivery times), NOTE (private instructions)

Important: Extract EVERY person's name and EVERY address variant.

Example:
Input: Alex lives at 123 Main St. Li Na phone 13912345678, gate code 1234#, card YB330-123, plate 京A12345, tracking SF123, Venmo @alex99
Output: [{"type":"NAME","value":"Alex"},{"type":"NAME","value":"Li Na"},{"type":"ADDRESS","value":"123 Main St"},{"type":"PHONE","value":"13912345678"},{"type":"ACCESS_CODE","value":"1234#"},{"type":"CARD","value":"YB330-123"},{"type":"LICENSE_PLATE","value":"京A12345"},{"type":"DELIVERY","value":"SF123"},{"type":"PAYMENT","value":"@alex99"}]

Input: ${textSnippet}
Output: [`;

  const url = `${endpoint}/api/generate`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.0,
        num_predict: 2500,
        stop: ["Input:", "Task:", "\n\n"],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = (await response.json()) as { response?: string };
  let raw = data.response ?? "";

  // Strip thinking tags
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const lastThink = raw.lastIndexOf("</think>");
  if (lastThink !== -1) {
    raw = raw.slice(lastThink + "</think>".length).trim();
  }

  // Normalize whitespace (model may use newlines between items)
  raw = raw.replace(/\s+/g, " ");

  // Complete the JSON array (prompt already started with "[")
  let jsonStr = "[" + raw;

  // Find the last ] to cut off any trailing garbage (explanations, etc.)
  const lastBracket = jsonStr.lastIndexOf("]");
  if (lastBracket >= 0) {
    jsonStr = jsonStr.slice(0, lastBracket + 1);
  } else {
    // No closing ] — model was cut off. Close after the last complete object.
    const lastCloseBrace = jsonStr.lastIndexOf("}");
    if (lastCloseBrace >= 0) {
      jsonStr = jsonStr.slice(0, lastCloseBrace + 1) + "]";
    } else {
      return [];
    }
  }

  // Fix trailing commas before ]
  jsonStr = jsonStr.replace(/,\s*\]/g, "]");

  console.log(`[GuardClaw] PII extraction raw JSON (${jsonStr.length} chars): ${jsonStr.slice(0, 300)}...`);

  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    const items = arr.filter(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).type === "string" &&
        typeof (item as Record<string, unknown>).value === "string"
    ) as Array<{ type: string; value: string }>;
    console.log(`[GuardClaw] PII extraction found ${items.length} items: ${items.map(i => `${i.type}=${i.value}`).join(", ")}`);
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
 * Call Ollama chat API with proper system/user message separation.
 * Less prone to prompt-echoing than the generate API.
 */
async function callOllamaChat(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: { stop?: string[] },
): Promise<string> {
  const url = `${endpoint}/api/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 1500,
        ...(options?.stop ? { stop: options.stop } : {}),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  let result = data.message?.content ?? "";
  // Strip thinking output
  result = result.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const lastThink = result.lastIndexOf("</think>");
  if (lastThink !== -1) {
    result = result.slice(lastThink + "</think>".length).trim();
  }
  return result;
}

/**
 * Call Ollama directly for an S3 analysis task, bypassing the full agent pipeline.
 * Uses /api/generate with repeat_penalty to prevent degenerate repetitive output.
 */
export async function callLocalModelDirect(
  systemPrompt: string,
  userMessage: string,
  config: { endpoint?: string; model?: string },
): Promise<string> {
  const endpoint = config.endpoint ?? "http://localhost:11434";
  const model = config.model ?? "openbmb/minicpm4.1";
  const url = `${endpoint}/api/generate`;

  // Combine system + user into a single prompt for /api/generate
  const prompt = `${systemPrompt}\n\n${userMessage}\n\nAnalysis:`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 1500,
        repeat_penalty: 1.3,
        stop: ["[message_id:", "[Message_id:", "[system:", "Instructions:", "Data:"],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama generate API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { response?: string };
  let result = data.response ?? "";

  // Strip thinking output
  result = result.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const lastThink = result.lastIndexOf("</think>");
  if (lastThink !== -1) {
    result = result.slice(lastThink + "</think>".length).trim();
  }

  // Truncate at any remaining [message_id: artifacts
  for (const marker of ["[message_id:", "[Message_id:"]) {
    const idx = result.indexOf(marker);
    if (idx > 0) {
      result = result.slice(0, idx).trim();
    }
  }

  return result;
}
