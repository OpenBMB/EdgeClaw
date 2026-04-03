import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, timeout: 30_000 });
  return stdout.trim();
}

async function getGitRoot(cwd?: string): Promise<string> {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

export async function listWorktrees(cwd?: string): Promise<WorktreeInfo[]> {
  const raw = await git(["worktree", "list", "--porcelain"], cwd);
  if (!raw) return [];

  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push(current as WorktreeInfo);
      current = { path: line.slice(9), branch: "", head: "", bare: false };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    }
  }

  if (current.path) entries.push(current as WorktreeInfo);
  return entries;
}

export async function createWorktree(
  branch: string,
  base?: string,
  targetDir?: string,
  cwd?: string,
): Promise<{ path: string; branch: string; summary: string }> {
  const root = await getGitRoot(cwd);
  const worktreePath = targetDir ?? path.join(root, ".openclaw", "worktrees", branch);

  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  // Check if the branch already exists
  let branchExists = false;
  try {
    await git(["rev-parse", "--verify", `refs/heads/${branch}`], root);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await git(["worktree", "add", worktreePath, branch], root);
  } else {
    const baseRef = base ?? "HEAD";
    await git(["worktree", "add", "-b", branch, worktreePath, baseRef], root);
  }

  return {
    path: worktreePath,
    branch,
    summary: `Created worktree at ${worktreePath} on branch '${branch}'${base ? ` (based on ${base})` : ""}`,
  };
}

export async function removeWorktree(
  worktreePath: string,
  force: boolean,
  cwd?: string,
): Promise<string> {
  const root = await getGitRoot(cwd);
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreePath);

  await git(args, root);
  return `Removed worktree at ${worktreePath}`;
}

export async function getWorktreeChanges(worktreePath: string): Promise<string> {
  try {
    const stat = await git(["diff", "--stat"], worktreePath);
    if (!stat) return "No uncommitted changes.";
    return stat;
  } catch {
    return "Unable to get diff (not a valid worktree or git directory).";
  }
}
