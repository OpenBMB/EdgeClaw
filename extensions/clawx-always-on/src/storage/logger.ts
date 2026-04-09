import { DatabaseSync } from "node:sqlite";
import type { AlwaysOnConfig } from "../core/config.js";
import type { LogLevel, TaskLogEntry } from "../core/types.js";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type PluginLoggerSink = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export class TaskLogger {
  private readonly db: DatabaseSync;
  private minLevel!: number;
  private retentionMs!: number;
  private readonly pluginLogger?: PluginLoggerSink;

  constructor(db: DatabaseSync, config: AlwaysOnConfig, pluginLogger?: PluginLoggerSink) {
    this.db = db;
    this.pluginLogger = pluginLogger;
    this.ensureTable();
    this.updateConfig(config);
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS always_on_logs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId    TEXT NOT NULL,
        level     TEXT NOT NULL,
        message   TEXT NOT NULL,
        metadata  TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_task ON always_on_logs(taskId);
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON always_on_logs(timestamp);
    `);
  }

  log(taskId: string, level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[level] < this.minLevel) return;

    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO always_on_logs (taskId, level, message, metadata, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(taskId, level, message, metadata ? JSON.stringify(metadata) : null, now);

    const prefixed = `[always-on:${taskId}] ${message}`;
    if (level === "debug") this.pluginLogger?.debug?.(prefixed);
    else if (level === "info") this.pluginLogger?.info(prefixed);
    else if (level === "warn") this.pluginLogger?.warn(prefixed);
    else this.pluginLogger?.error(prefixed);
  }

  debug(taskId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(taskId, "debug", message, metadata);
  }

  info(taskId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(taskId, "info", message, metadata);
  }

  warn(taskId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(taskId, "warn", message, metadata);
  }

  error(taskId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(taskId, "error", message, metadata);
  }

  updateConfig(config: AlwaysOnConfig): void {
    this.minLevel = LOG_LEVEL_ORDER[config.logLevel];
    this.retentionMs = config.logRetentionDays * 24 * 60 * 60 * 1000;
  }

  getLogs(taskId: string, limit = 50): TaskLogEntry[] {
    return this.db
      .prepare("SELECT * FROM always_on_logs WHERE taskId = ? ORDER BY id DESC LIMIT ?")
      .all(taskId, limit) as TaskLogEntry[];
  }

  cleanup(): number {
    const cutoff = Date.now() - this.retentionMs;
    const result = this.db.prepare("DELETE FROM always_on_logs WHERE timestamp < ?").run(cutoff);
    return (result as { changes: number }).changes;
  }
}
