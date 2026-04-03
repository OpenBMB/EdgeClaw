import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";

export const buildMemoryPromptSection: MemoryPromptSectionBuilder = ({ availableTools, citationsMode }) => {
  const hasMemoryOverview = availableTools.has("memory_overview");
  const hasMemoryList = availableTools.has("memory_list");
  const hasMemorySearch = availableTools.has("memory_search");
  const hasMemoryGet = availableTools.has("memory_get");
  const hasMemoryFlush = availableTools.has("memory_flush");

  if (!hasMemoryOverview && !hasMemoryList && !hasMemorySearch && !hasMemoryGet && !hasMemoryFlush) return [];

  const lines = [
    "## ClawXMemory",
    hasMemoryOverview
      ? "Use memory_overview for memory status, freshness, indexing backlog, and runtime health questions."
      : undefined,
    hasMemoryList
      ? "Use memory_list to browse remembered project, timeline, session, or recent memory index entries."
      : undefined,
    hasMemorySearch && hasMemoryGet
      ? "For prior chats, project progress, timelines, preferences, or historical recommendations: run memory_search first, then use memory_get only for the exact ids you need to verify."
      : hasMemorySearch
      ? "For prior chats, project progress, timelines, preferences, or historical recommendations: run memory_search before answering."
      : hasMemoryGet
      ? "Use memory_get only when the user already gave you specific memory ids to inspect."
      : undefined,
    hasMemoryFlush
      ? "If the user wants memory refreshed now or asks why recent turns are not visible yet, run memory_flush."
      : undefined,
    "Treat injected ClawXMemory recall context as the authoritative dynamic memory source for the current turn.",
    "Do not inspect USER.md, MEMORY.md, or memory/*.md unless the user explicitly asks to read or debug those files.",
  ].filter((line): line is string => Boolean(line));

  if (citationsMode === "off") {
    lines.push("Citations are disabled: do not mention file paths or line numbers unless the user explicitly asks.");
  } else {
    lines.push("When verification matters, cite the exact ClawXMemory records you used.");
  }

  lines.push("");
  return lines;
};
