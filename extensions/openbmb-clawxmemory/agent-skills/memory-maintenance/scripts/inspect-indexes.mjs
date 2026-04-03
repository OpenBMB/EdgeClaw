#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const dbPath = resolve(parseArg("--db", join(homedir(), ".openclaw", "clawxmemory", "memory.sqlite")));

if (!existsSync(dbPath)) {
  console.error(JSON.stringify({
    ok: false,
    error: "Database file not found",
    dbPath,
  }, null, 2));
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const count = (tableName) => {
  const stmt = db.prepare(`SELECT COUNT(1) AS total FROM ${tableName}`);
  const row = stmt.get();
  return Number(row?.total ?? 0);
};

const getState = (key) => {
  const stmt = db.prepare("SELECT state_value FROM pipeline_state WHERE state_key = ?");
  const row = stmt.get(key);
  return row?.state_value ?? null;
};

const summary = {
  ok: true,
  dbPath,
  counts: {
    l0_sessions: count("l0_sessions"),
    l1_windows: count("l1_windows"),
    l2_time_indexes: count("l2_time_indexes"),
    l2_project_indexes: count("l2_project_indexes"),
    global_profile_record: count("global_profile_record"),
    index_links: count("index_links"),
  },
  state: {
    lastIndexedAt: getState("lastIndexedAt"),
  },
};

console.log(JSON.stringify(summary, null, 2));
db.close();
