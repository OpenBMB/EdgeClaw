/**
 * GuardClaw Memory Isolation
 *
 * Manages dual memory directories for privacy isolation.
 * - Full memory: includes all context (for local models and audit)
 * - Clean memory: excludes guard agent context (for cloud models)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PrivacyConfig } from "./types.js";
import { desensitizeWithLocalModel } from "./local-model.js";
import { redactSensitiveInfo } from "./utils.js";

export class MemoryIsolationManager {
  private workspaceDir: string;

  constructor(workspaceDir: string = "~/.openclaw/workspace") {
    // Expand ~ to home directory
    this.workspaceDir = workspaceDir.startsWith("~")
      ? path.join(process.env.HOME || process.env.USERPROFILE || "~", workspaceDir.slice(2))
      : workspaceDir;
  }

  /**
   * Get memory directory path based on model type and content type
   */
  getMemoryDir(isCloudModel: boolean): string {
    const memoryType = isCloudModel ? "memory" : "memory-full";
    return path.join(this.workspaceDir, memoryType);
  }

  /**
   * Get MEMORY.md path based on model type
   */
  getMemoryFilePath(isCloudModel: boolean): string {
    if (isCloudModel) {
      // Cloud models use the standard MEMORY.md
      return path.join(this.workspaceDir, "MEMORY.md");
    } else {
      // Local models can access the full memory
      return path.join(this.workspaceDir, "MEMORY-FULL.md");
    }
  }

  /**
   * Get daily memory file path
   */
  getDailyMemoryPath(isCloudModel: boolean, date?: Date): string {
    const memoryDir = this.getMemoryDir(isCloudModel);
    const today = date ?? new Date();
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD
    return path.join(memoryDir, `${dateStr}.md`);
  }

  /**
   * Write to memory file
   */
  async writeMemory(
    content: string,
    isCloudModel: boolean,
    options?: { append?: boolean; daily?: boolean },
  ): Promise<void> {
    try {
      const filePath = options?.daily
        ? this.getDailyMemoryPath(isCloudModel)
        : this.getMemoryFilePath(isCloudModel);

      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });

      // Write or append
      if (options?.append) {
        await fs.promises.appendFile(filePath, content, "utf-8");
      } else {
        await fs.promises.writeFile(filePath, content, "utf-8");
      }
    } catch (err) {
      console.error(`[GuardClaw] Failed to write memory (cloud=${isCloudModel}):`, err);
    }
  }

  /**
   * Read from memory file
   */
  async readMemory(
    isCloudModel: boolean,
    options?: { daily?: boolean; date?: Date },
  ): Promise<string> {
    try {
      const filePath = options?.daily
        ? this.getDailyMemoryPath(isCloudModel, options.date)
        : this.getMemoryFilePath(isCloudModel);

      if (!fs.existsSync(filePath)) {
        return "";
      }

      return await fs.promises.readFile(filePath, "utf-8");
    } catch (err) {
      console.error(`[GuardClaw] Failed to read memory (cloud=${isCloudModel}):`, err);
      return "";
    }
  }

  /**
   * Merge clean memory content into full memory so FULL is always the superset.
   * Cloud models write to MEMORY.md; this step captures those additions into
   * MEMORY-FULL.md before we sanitize back. Lines already present in FULL
   * (by trimmed content) are skipped to avoid duplicates.
   */
  async mergeCleanIntoFull(options?: { daily?: boolean; date?: Date }): Promise<number> {
    try {
      const cleanContent = await this.readMemory(true, options);
      const fullContent = await this.readMemory(false, options);

      if (!cleanContent.trim()) {
        return 0;
      }

      // Build a set of trimmed lines already in FULL for dedup
      const fullLines = new Set(
        fullContent
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      );

      // Find lines in CLEAN that don't exist in FULL
      // Skip [REDACTED:...] tags — those are artifacts of previous sync, not real content
      const newLines: string[] = [];
      for (const line of cleanContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !fullLines.has(trimmed) && !trimmed.includes("[REDACTED:")) {
          newLines.push(line);
        }
      }

      if (newLines.length === 0) {
        return 0;
      }

      // Append new lines to FULL under a merged section
      const appendBlock = `\n\n## Cloud Session Additions\n${newLines.join("\n")}\n`;
      await this.writeMemory(fullContent + appendBlock, false, options);
      console.log(`[GuardClaw] Merged ${newLines.length} line(s) from clean → full`);
      return newLines.length;
    } catch (err) {
      console.error("[GuardClaw] Failed to merge clean into full:", err);
      return 0;
    }
  }

  /**
   * Sync memory from full to clean (removing guard agent content + redacting PII).
   *
   * Flow:
   *   1. Merge MEMORY.md → MEMORY-FULL.md (capture cloud model additions)
   *   2. Filter guard agent sections from MEMORY-FULL.md
   *   3. Redact PII (local model → regex fallback)
   *   4. Write result to MEMORY.md
   *
   * @param privacyConfig - When provided, PII redaction uses the local model
   *   (same `desensitizeWithLocalModel` pipeline as real-time S2 messages).
   *   If the model is unavailable or config is omitted, falls back to
   *   rule-based `redactSensitiveInfo()`.
   */
  async syncMemoryToClean(privacyConfig?: PrivacyConfig): Promise<void> {
    try {
      // Step 0: Merge cloud additions into FULL so nothing is lost
      await this.mergeCleanIntoFull();

      // Read full memory (now includes any cloud additions)
      const fullMemory = await this.readMemory(false);

      if (!fullMemory) {
        return;
      }

      // Phase 1: Filter out guard agent related sections
      const guardStripped = this.filterGuardContent(fullMemory);

      // Phase 2: Redact PII — prefer local model, fall back to regex rules
      const cleanMemory = await this.redactContent(guardStripped, privacyConfig);

      // Write to clean memory
      await this.writeMemory(cleanMemory, true);

      console.log("[GuardClaw] MEMORY-FULL.md synced to MEMORY.md");
    } catch (err) {
      console.error("[GuardClaw] Failed to sync memory:", err);
    }
  }

  /**
   * Sync ALL daily memory files from memory-full/ → memory/
   * Each file goes through: merge clean→full, guard-strip, PII-redact.
   */
  async syncDailyMemoryToClean(privacyConfig?: PrivacyConfig): Promise<number> {
    let synced = 0;
    try {
      const fullDir = this.getMemoryDir(false); // memory-full/
      const cleanDir = this.getMemoryDir(true); // memory/

      if (!fs.existsSync(fullDir)) {
        return 0;
      }

      await fs.promises.mkdir(cleanDir, { recursive: true });

      // Collect all daily .md files from BOTH directories (cloud may have files full doesn't)
      const fullFiles = fs.existsSync(fullDir)
        ? (await fs.promises.readdir(fullDir)).filter((f) => f.endsWith(".md"))
        : [];
      const cleanFiles = fs.existsSync(cleanDir)
        ? (await fs.promises.readdir(cleanDir)).filter((f) => f.endsWith(".md"))
        : [];
      const allFiles = [...new Set([...fullFiles, ...cleanFiles])];

      for (const file of allFiles) {
        try {
          const fullPath = path.join(fullDir, file);
          const cleanPath = path.join(cleanDir, file);

          // Step 0: Merge cloud daily additions into full daily (by filepath, no Date needed)
          await this.mergeDailyFile(fullPath, cleanPath);

          // Re-read full content (now includes merged cloud additions)
          const fullContent = fs.existsSync(fullPath)
            ? await fs.promises.readFile(fullPath, "utf-8")
            : "";

          if (!fullContent.trim()) {
            continue;
          }

          // Phase 1: strip guard content
          const guardStripped = this.filterGuardContent(fullContent);

          // Phase 2: PII redaction
          const cleanContent = await this.redactContent(guardStripped, privacyConfig);

          await fs.promises.writeFile(cleanPath, cleanContent, "utf-8");
          synced++;
        } catch (fileErr) {
          console.error(`[GuardClaw] Failed to sync daily file ${file}:`, fileErr);
        }
      }

      if (synced > 0) {
        console.log(
          `[GuardClaw] Synced ${synced} daily memory file(s) from memory-full/ → memory/`,
        );
      }
    } catch (err) {
      console.error("[GuardClaw] Failed to sync daily memory:", err);
    }
    return synced;
  }

  /**
   * Sync everything: long-term memory + all daily files
   */
  async syncAllMemoryToClean(privacyConfig?: PrivacyConfig): Promise<void> {
    await this.syncMemoryToClean(privacyConfig);
    await this.syncDailyMemoryToClean(privacyConfig);
  }

  /**
   * Shared PII redaction: prefer local model, fall back to regex.
   */
  private async redactContent(text: string, privacyConfig?: PrivacyConfig): Promise<string> {
    if (privacyConfig) {
      const { desensitized, wasModelUsed } = await desensitizeWithLocalModel(text, privacyConfig);

      if (wasModelUsed && desensitized !== text) {
        console.log("[GuardClaw] PII redacted via local model");
        return desensitized;
      }

      // Model unavailable or returned unchanged — fall back to regex
      console.log(
        `[GuardClaw] PII redacted via rules (model ${wasModelUsed ? "returned unchanged" : "unavailable"})`,
      );
      return redactSensitiveInfo(text);
    }

    console.log("[GuardClaw] PII redacted via rules (no config)");
    return redactSensitiveInfo(text);
  }

  /**
   * Merge a single daily clean file's unique lines into the corresponding full file.
   * Operates directly on file paths — no Date conversion needed, avoids timezone issues.
   */
  private async mergeDailyFile(fullPath: string, cleanPath: string): Promise<void> {
    try {
      if (!fs.existsSync(cleanPath)) {
        return;
      }

      const cleanContent = await fs.promises.readFile(cleanPath, "utf-8");
      if (!cleanContent.trim()) {
        return;
      }

      const fullContent = fs.existsSync(fullPath)
        ? await fs.promises.readFile(fullPath, "utf-8")
        : "";

      const fullLines = new Set(
        fullContent
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      );

      const newLines: string[] = [];
      for (const line of cleanContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !fullLines.has(trimmed) && !trimmed.includes("[REDACTED:")) {
          newLines.push(line);
        }
      }

      if (newLines.length === 0) {
        return;
      }

      // Ensure parent dir exists (in case full file doesn't exist yet)
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

      const appendBlock = `\n\n## Cloud Session Additions\n${newLines.join("\n")}\n`;
      await fs.promises.writeFile(fullPath, fullContent + appendBlock, "utf-8");
      console.log(
        `[GuardClaw] Merged ${newLines.length} daily line(s) from clean → full (${path.basename(fullPath)})`,
      );
    } catch (err) {
      console.error(`[GuardClaw] Failed to merge daily file:`, err);
    }
  }

  /**
   * Filter guard agent content from memory text
   */
  private filterGuardContent(content: string): string {
    const lines = content.split("\n");
    const filtered: string[] = [];
    let skipSection = false;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Check for guard agent section markers
      if (
        lowerLine.includes("[guard agent]") ||
        lowerLine.includes("guard:") ||
        lowerLine.includes("private context:")
      ) {
        skipSection = true;
        continue;
      }

      // End of guard section (typically a blank line or new section)
      if (skipSection && (line.trim() === "" || line.startsWith("#"))) {
        skipSection = false;
        if (line.startsWith("#")) {
          filtered.push(line); // Keep the new section header
        }
        continue;
      }

      // Skip lines in guard section
      if (skipSection) {
        continue;
      }

      // Keep line
      filtered.push(line);
    }

    return filtered.join("\n");
  }

  /**
   * Ensure both memory directories exist
   */
  async initializeDirectories(): Promise<void> {
    try {
      const fullDir = this.getMemoryDir(false);
      const cleanDir = this.getMemoryDir(true);

      await fs.promises.mkdir(fullDir, { recursive: true });
      await fs.promises.mkdir(cleanDir, { recursive: true });

      console.log("[GuardClaw] Memory directories initialized");
    } catch (err) {
      console.error("[GuardClaw] Failed to initialize memory directories:", err);
    }
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(): Promise<{
    fullSize: number;
    cleanSize: number;
    fullDaily: number;
    cleanDaily: number;
  }> {
    const stats = {
      fullSize: 0,
      cleanSize: 0,
      fullDaily: 0,
      cleanDaily: 0,
    };

    try {
      // Check MEMORY.md files
      const fullMemPath = this.getMemoryFilePath(false);
      const cleanMemPath = this.getMemoryFilePath(true);

      if (fs.existsSync(fullMemPath)) {
        stats.fullSize = (await fs.promises.stat(fullMemPath)).size;
      }

      if (fs.existsSync(cleanMemPath)) {
        stats.cleanSize = (await fs.promises.stat(cleanMemPath)).size;
      }

      // Count daily memory files
      const fullDir = this.getMemoryDir(false);
      const cleanDir = this.getMemoryDir(true);

      if (fs.existsSync(fullDir)) {
        stats.fullDaily = (await fs.promises.readdir(fullDir)).filter((f) =>
          f.endsWith(".md"),
        ).length;
      }

      if (fs.existsSync(cleanDir)) {
        stats.cleanDaily = (await fs.promises.readdir(cleanDir)).filter((f) =>
          f.endsWith(".md"),
        ).length;
      }
    } catch (err) {
      console.error("[GuardClaw] Failed to get memory stats:", err);
    }

    return stats;
  }
}

// Export a singleton instance
let defaultMemoryManager: MemoryIsolationManager | null = null;

export function getDefaultMemoryManager(workspaceDir?: string): MemoryIsolationManager {
  if (!defaultMemoryManager || workspaceDir) {
    defaultMemoryManager = new MemoryIsolationManager(workspaceDir);
  }
  return defaultMemoryManager;
}
