#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LlmMemoryExtractor, MemoryRepository, ReasoningRetriever } from "../dist/core/index.js";
import { resolveClawxmemoryDbPath, resolveConfigPath } from "./state-paths.mjs";

function parseArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function toLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const dbPath = resolve(parseArg("--db", resolveClawxmemoryDbPath()));
const memoryDir = resolve(parseArg("--memory-dir", join(dirname(dbPath), "memory")));
const query = parseArg("--query", "");
const limit = toLimit(parseArg("--limit", "6"), 6);
const openclawConfigPath = resolve(parseArg("--openclaw-config", resolveConfigPath()));

if (!query.trim()) {
  console.error(JSON.stringify({ ok: false, error: "query is required" }, null, 2));
  process.exit(1);
}

const repository = new MemoryRepository(dbPath, { memoryDir });
try {
  const openclawConfig = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
  const silentLogger = {
    info() {},
    warn() {},
  };
  const extractor = new LlmMemoryExtractor(openclawConfig, undefined, silentLogger);
  const retriever = new ReasoningRetriever(repository, extractor, {
    getSettings: () => ({
      reasoningMode: "answer_first",
      recallTopK: limit,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinTmpEntries: 10,
      dreamProjectRebuildTimeoutMs: 180_000,
    }),
  });
  const result = await retriever.retrieve(query, {
    retrievalMode: "explicit",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: "ts-plugin-debug",
        dbPath,
        memoryDir,
        query,
        limit,
        result,
      },
      null,
      2,
    ),
  );
} finally {
  repository.close();
}
