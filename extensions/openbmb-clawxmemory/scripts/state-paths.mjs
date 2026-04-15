#!/usr/bin/env node

import os from "node:os";
import path from "node:path";

const EDGECLAW_STATE_DIRNAME = ".edgeclaw";
const EDGECLAW_CONFIG_FILENAME = "openclaw.json";
const CLAWXMEMORY_DATA_DIRNAME = "clawxmemory";
const DEFAULT_WORKSPACE_DIRNAME = "workspace-main";

export const DEFAULT_OPENCLAW_CONFIG_PATH_HINT = "~/.edgeclaw/openclaw.json";

export function resolveStateDir() {
  if (process.env.OPENCLAW_STATE_DIR?.trim()) {
    return path.resolve(process.env.OPENCLAW_STATE_DIR.trim());
  }
  return path.join(os.homedir(), EDGECLAW_STATE_DIRNAME);
}

export function resolveConfigPath() {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_CONFIG_PATH.trim());
  }
  return path.join(resolveStateDir(), EDGECLAW_CONFIG_FILENAME);
}

export function resolveClawxmemoryDataDir() {
  return path.join(resolveStateDir(), CLAWXMEMORY_DATA_DIRNAME);
}

export function resolveClawxmemoryDbPath() {
  return path.join(resolveClawxmemoryDataDir(), "memory.sqlite");
}

export function resolveWorkspaceDir() {
  return path.join(resolveStateDir(), DEFAULT_WORKSPACE_DIRNAME);
}
