/**
 * GuardClaw Memory Isolation
 * 
 * Manages dual memory directories for privacy isolation.
 * - Full memory: includes all context (for local models and audit)
 * - Clean memory: excludes guard agent context (for cloud models)
 */

import * as fs from "node:fs";
import * as path from "node:path";

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
    options?: { append?: boolean; daily?: boolean }
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
      console.error(
        `[GuardClaw] Failed to write memory (cloud=${isCloudModel}):`,
        err
      );
    }
  }

  /**
   * Read from memory file
   */
  async readMemory(
    isCloudModel: boolean,
    options?: { daily?: boolean; date?: Date }
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
      console.error(
        `[GuardClaw] Failed to read memory (cloud=${isCloudModel}):`,
        err
      );
      return "";
    }
  }

  /**
   * Sync memory from full to clean (removing guard agent content)
   */
  async syncMemoryToClean(): Promise<void> {
    try {
      // Read full memory
      const fullMemory = await this.readMemory(false);

      if (!fullMemory) {
        return;
      }

      // Filter out guard agent related content
      const cleanMemory = this.filterGuardContent(fullMemory);

      // Write to clean memory
      await this.writeMemory(cleanMemory, true);

      console.log("[GuardClaw] Memory synced from full to clean");
    } catch (err) {
      console.error("[GuardClaw] Failed to sync memory:", err);
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
          f.endsWith(".md")
        ).length;
      }

      if (fs.existsSync(cleanDir)) {
        stats.cleanDaily = (await fs.promises.readdir(cleanDir)).filter((f) =>
          f.endsWith(".md")
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
