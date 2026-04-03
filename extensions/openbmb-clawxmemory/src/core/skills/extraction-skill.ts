import type { FactCandidate, MemoryMessage } from "../types.js";
import { normalizeText, truncate } from "../utils/text.js";
import type { SkillsRuntime } from "./types.js";

function extractFromPattern(text: string, pattern: RegExp): string[] {
  const results: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = normalizeText(match[1] ?? "");
    if (value) results.push(value);
  }
  return results;
}

export function extractProjectTags(messages: MemoryMessage[], skills: SkillsRuntime): string[] {
  const tags = new Set<string>();
  const userText = messages
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.content)
    .join("\n");

  for (const pattern of skills.extractionRules.projectPatterns) {
    for (const value of extractFromPattern(userText, pattern)) {
      const cleaned = value.replace(/[^\w.-]/g, "");
      if (
        cleaned.length >= skills.extractionRules.projectTagMinLength &&
        cleaned.length <= skills.extractionRules.projectTagMaxLength
      ) {
        tags.add(cleaned);
      }
    }
  }
  return Array.from(tags).slice(0, skills.extractionRules.maxProjectTags);
}

export function extractFactCandidates(messages: MemoryMessage[], skills: SkillsRuntime): FactCandidate[] {
  const facts = new Map<string, FactCandidate>();
  const userText = messages
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.content)
    .join("\n");

  for (const rule of skills.extractionRules.factRules) {
    for (const value of extractFromPattern(userText, rule.regex)) {
      const text = truncate(value, rule.maxLength);
      const key = `${rule.keyPrefix}:${text.toLowerCase()}`;
      facts.set(key, {
        factKey: key,
        factValue: text,
        confidence: rule.confidence,
      });
    }
  }

  for (const projectName of extractProjectTags(messages, skills)) {
    facts.set(`project:${projectName.toLowerCase()}`, {
      factKey: `project:${projectName.toLowerCase()}`,
      factValue: projectName,
      confidence: 0.78,
    });
  }

  return Array.from(facts.values()).slice(0, skills.extractionRules.maxFacts);
}

export function buildSessionSummary(messages: MemoryMessage[], skills: SkillsRuntime): string {
  const userMessages = messages.filter((msg) => msg.role === "user").map((msg) => normalizeText(msg.content));
  const assistantMessages = messages
    .filter((msg) => msg.role === "assistant")
    .map((msg) => normalizeText(msg.content));

  const userHead = userMessages[0] ?? "";
  const userTail = userMessages[userMessages.length - 1] ?? "";
  const assistantTail = assistantMessages[assistantMessages.length - 1] ?? "";

  const limits = skills.extractionRules.summaryLimits;
  const parts = [
    userHead ? `用户提到：${truncate(userHead, limits.head)}` : "",
    userTail && userTail !== userHead ? `后续重点：${truncate(userTail, limits.tail)}` : "",
    assistantTail ? `助手响应：${truncate(assistantTail, limits.assistant)}` : "",
  ].filter(Boolean);

  if (parts.length === 0) return "该窗口没有可用文本，跳过结构化摘要。";
  return parts.join("；");
}

export function buildSituationTimeInfo(timestamp: string, summary: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return `未知时间场景：${truncate(summary, 120)}`;
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.toISOString().slice(0, 10)} ${hour}:${minute} 用户正在推进：${truncate(summary, 120)}`;
}
