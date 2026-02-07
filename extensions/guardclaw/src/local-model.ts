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
    `[SYSTEM] You are a strict privacy classifier. Output ONLY one JSON object.

Classify by BOTH actual data AND intent. If the user INTENDS to process sensitive data (e.g. asks to read a payslip file), classify based on what the data WILL contain.

Levels (choose exactly one):

S3 = PRIVATE (must process locally, never send to cloud):
  - Financial records: 工资单/payslip, 报销单/expense, 税表/tax, 收入/income, bank account
  - Medical/Health: 体检报告, 病历, diagnoses, prescriptions, health metrics
  - Credentials: passwords, API keys, verification codes/验证码
  - Requests to READ/ANALYZE files containing above data
  Example: "帮我看一下工资单" → S3 (intent to process financial records)
  Example: "分析一下体检报告" → S3 (intent to process medical data)
  Example: "基本工资 15000, 个税 1200" → S3 (actual financial data)
  Example: "密码 Abc123" → S3 (actual credential)

S2 = SENSITIVE (redact then send to cloud):
  - Home addresses with details: 街道/弄/号楼/单元/室
  - Door codes/门禁码, pickup codes/取件码, delivery tracking
  - Phone numbers, emails, real names as contact PII
  - Chat logs with names + contact info
  Example: "地址浦东新区张杨路500弄, 门禁码1234" → S2
  Example: "张伟 手机13912345678 邮箱xx@xx.com" → S2

S1 = SAFE: No sensitive data or intent to process sensitive data.
  Example: "写一首春天的诗" → S1
  Example: "今天天气怎么样" → S1

Key rules:
- 门禁码/取件码 are S2 (physical access codes), NOT S3
- Health/medical data is ALWAYS S3, never S2
- When genuinely unsure → pick higher

Format: {"level":"S1|S2|S3","reason":"brief","confidence":0.0-1.0}`,
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

Types: NAME (ALL人名,每个人都要提取), PHONE, ADDRESS (all variants), ACCESS_CODE, DELIVERY (tracking/快递单号), ID, CARD (bank/medical/insurance卡号), LICENSE_PLATE (车牌号), EMAIL, PASSWORD, PAYMENT (支付宝/微信), BIRTHDAY

Important: Extract EVERY person's name and EVERY address variant (even shortened forms).

Example:
Input: 张伟住在北京市朝阳区建国路88号。李娜电话13912345678，门禁码1234#，医保卡号YB330-123，车牌号京A12345，顺丰SF123
Output: [{"type":"NAME","value":"张伟"},{"type":"NAME","value":"李娜"},{"type":"ADDRESS","value":"北京市朝阳区建国路88号"},{"type":"PHONE","value":"13912345678"},{"type":"ACCESS_CODE","value":"1234#"},{"type":"CARD","value":"YB330-123"},{"type":"LICENSE_PLATE","value":"京A12345"},{"type":"DELIVERY","value":"SF123"}]

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
        num_predict: 1200,
        stop: ["\n\n", "Input:", "Task:"],
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

  // Complete the JSON array
  const jsonStr = "[" + raw;
  // Find the last ] to cut off any trailing garbage
  const lastBracket = jsonStr.lastIndexOf("]");
  if (lastBracket < 0) return [];
  const cleaned = jsonStr.slice(0, lastBracket + 1);

  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).type === "string" &&
        typeof (item as Record<string, unknown>).value === "string"
    ) as Array<{ type: string; value: string }>;
  } catch {
    console.error("[GuardClaw] Failed to parse PII extraction JSON:", cleaned.slice(0, 200));
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
 * Uses a minimal system prompt and stops at the first [message_id: tag to prevent
 * degenerate repetitive output from small models.
 */
export async function callLocalModelDirect(
  systemPrompt: string,
  userMessage: string,
  config: { endpoint?: string; model?: string },
): Promise<string> {
  const endpoint = config.endpoint ?? "http://localhost:11434";
  const model = config.model ?? "openbmb/minicpm4.1";

  let result = await callOllamaChat(endpoint, model, systemPrompt, userMessage, {
    stop: ["[message_id:", "[Message_id:", "[system:", "--- FILE CONTENT"],
  });

  // Truncate at any remaining [message_id: artifacts
  for (const marker of ["[message_id:", "[Message_id:"]) {
    const idx = result.indexOf(marker);
    if (idx > 0) {
      result = result.slice(0, idx).trim();
    }
  }

  return result;
}
