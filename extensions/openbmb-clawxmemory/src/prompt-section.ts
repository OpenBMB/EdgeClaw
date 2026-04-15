import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";

export const buildMemoryPromptSection: MemoryPromptSectionBuilder = ({ availableTools, citationsMode }) => {
  const hasMemoryOverview = availableTools.has("memory_overview");
  const hasMemoryList = availableTools.has("memory_list");
  const hasMemorySearch = availableTools.has("memory_search");
  const hasMemoryGet = availableTools.has("memory_get");
  const hasMemoryFlush = availableTools.has("memory_flush");
  const hasMemoryDream = availableTools.has("memory_dream");

  if (!hasMemoryOverview && !hasMemoryList && !hasMemorySearch && !hasMemoryGet && !hasMemoryFlush && !hasMemoryDream) return [];

  const lines = [
    "## ClawXMemory",
    hasMemoryOverview
      ? "Use memory_overview for memory status, freshness, indexing backlog, and runtime health questions."
      : undefined,
    hasMemoryList
      ? "Use memory_list to browse file-based user, feedback, and project memory indexes."
      : undefined,
    hasMemorySearch && hasMemoryGet
      ? "For durable preferences, collaboration rules, or project progress across sessions: run memory_search first, then use memory_get only for the exact file ids you need to verify."
      : hasMemorySearch
      ? "For durable preferences, collaboration rules, or project progress across sessions: run memory_search before answering."
      : hasMemoryGet
      ? "Use memory_get only when the user already gave you specific memory file ids to inspect."
      : undefined,
    hasMemoryFlush
      ? "If the user wants recent memory extracted now or asks why a just-finished conversation is not visible yet, run memory_flush."
      : undefined,
    hasMemoryDream
      ? "If the user wants memory cleanup, duplicate merge, or manifest repair, run memory_dream."
      : undefined,
    "Treat injected ClawXMemory recall context and memory file tools as the authoritative long-term memory source for the current turn.",
    "ClawXMemory uses file-based memory manifests and memory files as its durable memory source.",
    "Do not create or maintain long-term memory in workspace files such as memory/*.md, USER.md, or MEMORY.md, and do not write directly into ClawXMemory's managed memory directory. Use ClawXMemory's managed memory flow instead.",
    "Never call write, edit, move, rename, or delete tools on workspace memory files or ClawXMemory-managed memory paths. Those paths are reserved for ClawXMemory runtime ownership.",
  ].filter((line): line is string => Boolean(line));

  if (citationsMode === "off") {
    lines.push("Citations are disabled: do not mention file paths or line numbers unless the user explicitly asks.");
  } else {
    lines.push("When verification matters, cite the exact ClawXMemory records you used.");
  }

  lines.push("");
  return lines;
};
