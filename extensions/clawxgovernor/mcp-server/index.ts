#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  contextInspect,
  contextBudgetCheck,
  contextForceCompact,
} from "./tools/context-inspect.js";
import { sessionNoteAppend } from "./tools/session-note-append.js";
import { sessionNoteRead } from "./tools/session-note-read.js";
import { sessionNoteSearch } from "./tools/session-note-search.js";
import { toolAuditQuery } from "./tools/tool-audit-query.js";
import { toolResultSummarize } from "./tools/tool-result-summarize.js";
import { toolRiskClassify } from "./tools/tool-risk-classify.js";

const server = new McpServer({
  name: "clawxgovernor",
  version: "0.2.0",
});

// ── Context Engine Tools ──

server.tool(
  "context_inspect",
  "Inspect the current context engine working set: total tokens, segment count, last compact time.",
  { sessionId: z.string().optional().describe("Optional session ID to inspect") },
  async (params) => ({
    content: [
      { type: "text", text: JSON.stringify(await contextInspect(params.sessionId), null, 2) },
    ],
  }),
);

server.tool(
  "context_budget_check",
  "Check token budget usage: current ratio, distance to compact trigger, estimated remaining turns.",
  { sessionId: z.string().optional().describe("Session ID to check budget for") },
  async (params) => ({
    content: [
      { type: "text", text: JSON.stringify(await contextBudgetCheck(params.sessionId), null, 2) },
    ],
  }),
);

server.tool(
  "context_force_compact",
  "Manually trigger context compaction when context is too large or stale.",
  {
    sessionId: z.string().describe("Session ID to compact"),
    reason: z.string().optional().describe("Reason for manual compaction"),
  },
  async (params) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await contextForceCompact(params.sessionId, params.reason), null, 2),
      },
    ],
  }),
);

// ── Tool Governor Tools ──

server.tool(
  "tool_risk_classify",
  "Classify a tool by risk level and recommended action (allow/requireApproval/block).",
  {
    toolName: z.string().describe("Name of the tool to classify"),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional tool parameters for deeper analysis"),
  },
  async ({ toolName, params }) => ({
    content: [{ type: "text", text: JSON.stringify(toolRiskClassify(toolName, params), null, 2) }],
  }),
);

server.tool(
  "tool_audit_query",
  "Query the tool call audit log. Filter by tool name, risk level, time range, or action.",
  {
    toolName: z.string().optional().describe("Filter by tool name"),
    riskLevel: z.string().optional().describe("Filter by risk level"),
    action: z.string().optional().describe("Filter by action"),
    since: z.string().optional().describe("ISO timestamp to filter entries after"),
    limit: z.number().optional().describe("Max entries to return (default 20)"),
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(toolAuditQuery(params), null, 2) }],
  }),
);

server.tool(
  "tool_result_summarize",
  "Summarize long text into a concise version for condensing verbose tool outputs.",
  {
    text: z.string().describe("The long text to summarize"),
    maxLength: z.number().optional().describe("Target max length in characters (default 500)"),
  },
  async ({ text, maxLength }) => ({
    content: [
      { type: "text", text: JSON.stringify(toolResultSummarize(text, maxLength), null, 2) },
    ],
  }),
);

// ── Session Memory Tools ──

server.tool(
  "session_note_append",
  "Append a delta note to session memory for the agent to remember across turns.",
  {
    sessionId: z.string().describe("Session ID to append note to"),
    note: z.string().describe("The note content to append"),
    turnIndex: z.number().optional().describe("Optional turn index override"),
  },
  async ({ sessionId, note, turnIndex }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(sessionNoteAppend(sessionId, note, turnIndex), null, 2),
      },
    ],
  }),
);

server.tool(
  "session_note_read",
  "Read session notes for a given session. Returns the most recent N entries.",
  {
    sessionId: z.string().describe("Session ID to read notes from"),
    lastN: z.number().optional().describe("Number of recent entries to return (default: all)"),
  },
  async ({ sessionId, lastN }) => ({
    content: [{ type: "text", text: sessionNoteRead(sessionId, lastN) }],
  }),
);

server.tool(
  "session_note_search",
  "Search session notes by keyword, optionally scoped to a specific session.",
  {
    query: z.string().describe("Search query string"),
    sessionId: z.string().optional().describe("Optional session ID to scope search"),
  },
  async ({ query, sessionId }) => ({
    content: [{ type: "text", text: JSON.stringify(sessionNoteSearch(query, sessionId), null, 2) }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
