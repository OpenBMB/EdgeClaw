#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveClawxmemoryDbPath } from "../../../scripts/state-paths.mjs";

function parseArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const dbPath = resolve(parseArg("--db", resolveClawxmemoryDbPath()));
const limit = parsePositiveInt(parseArg("--limit", "5"), 5);

if (!existsSync(dbPath)) {
  console.error(JSON.stringify({
    ok: false,
    error: "Database file not found",
    dbPath,
  }, null, 2));
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const tableExists = (tableName) => {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return row?.present === 1;
};

const queryRows = (tableName, sql) => {
  if (!tableExists(tableName)) return [];
  return db.prepare(sql).all(limit);
};

const l0Rows = queryRows(
  "l0_sessions",
  "SELECT l0_index_id, session_key, timestamp, messages_json FROM l0_sessions ORDER BY timestamp DESC LIMIT ?",
);

const l1Rows = queryRows(
  "l1_windows",
  "SELECT l1_index_id, time_period, summary, project_tags_json FROM l1_windows ORDER BY created_at DESC LIMIT ?",
);

const l2ProjectRows = queryRows(
  "l2_project_indexes",
  "SELECT l2_index_id, project_name, current_status, latest_progress FROM l2_project_indexes ORDER BY updated_at DESC LIMIT ?",
);

const l2TimeRows = queryRows(
  "l2_time_indexes",
  "SELECT l2_index_id, date_key, summary FROM l2_time_indexes ORDER BY updated_at DESC LIMIT ?",
);

const output = {
  ok: true,
  dbPath,
  limit,
  recent: {
    l0_sessions: l0Rows.map((row) => {
      const messages = safeJsonParse(row.messages_json ?? "[]", []);
      const lastUser = [...messages].reverse().find((msg) => msg?.role === "user");
      return {
        l0_index_id: row.l0_index_id,
        session_key: row.session_key,
        timestamp: row.timestamp,
        last_user_message: lastUser?.content ?? null,
      };
    }),
    l1_windows: l1Rows.map((row) => ({
      l1_index_id: row.l1_index_id,
      time_period: row.time_period,
      summary: row.summary,
      project_tags: safeJsonParse(row.project_tags_json ?? "[]", []),
    })),
    l2_project_indexes: l2ProjectRows,
    l2_time_indexes: l2TimeRows,
  },
};

console.log(JSON.stringify(output, null, 2));
db.close();
