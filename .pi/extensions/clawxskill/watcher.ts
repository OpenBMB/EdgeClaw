import os from "node:os";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

export type SkillChangeEvent = "add" | "change" | "unlink";

export type SkillChangeCallback = (filePath: string, event: SkillChangeEvent) => void;

const WATCH_IGNORED = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
];

export function createSkillWatcher(cwd: string, onChange: SkillChangeCallback): () => void {
  const watchRoots = [
    path.join(cwd, "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
  ];

  const watchTargets = watchRoots.flatMap((root) => [
    `${root.replace(/\\/g, "/")}/SKILL.md`,
    `${root.replace(/\\/g, "/")}/*/SKILL.md`,
  ]);

  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingChanges: Array<{
    path: string;
    event: SkillChangeEvent;
  }> = [];

  const flush = () => {
    const changes = pendingChanges;
    pendingChanges = [];
    debounceTimer = null;

    const seen = new Set<string>();
    for (const c of changes) {
      if (seen.has(c.path)) continue;
      seen.add(c.path);
      onChange(c.path, c.event);
    }
  };

  const schedule = (filePath: string, event: SkillChangeEvent) => {
    pendingChanges.push({ path: filePath, event });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, 300);
  };

  try {
    watcher = chokidar.watch(watchTargets, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: WATCH_IGNORED,
    });

    watcher.on("add", (p) => schedule(p, "add"));
    watcher.on("change", (p) => schedule(p, "change"));
    watcher.on("unlink", (p) => schedule(p, "unlink"));
    watcher.on("error", () => {});
  } catch {
    // chokidar may not be available in all environments
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher?.close().catch(() => {});
  };
}

export function extractSkillName(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const skillMdIndex = parts.findIndex((p) => p.toLowerCase() === "skill.md");
  if (skillMdIndex > 0) {
    return parts[skillMdIndex - 1] || null;
  }
  return null;
}
