import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";
import { join, resolve } from "node:path";

const EDGECLAW_CONFIG_FILENAME = "openclaw.json";
const CLAWXMEMORY_DATA_DIRNAME = "clawxmemory";
const DEFAULT_WORKSPACE_DIRNAME = "workspace-main";

export const DEFAULT_OPENCLAW_CONFIG_PATH_HINT = "~/.edgeclaw/openclaw.json";

export function resolveClawxmemoryStateDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveStateDir(env);
}

export function resolveDefaultClawxmemoryDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveClawxmemoryStateDir(env), CLAWXMEMORY_DATA_DIRNAME);
}

export function resolveDefaultClawxmemoryDbPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveDefaultClawxmemoryDataDir(env), "memory.sqlite");
}

export function resolveDefaultClawxmemoryMemoryDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveDefaultClawxmemoryDataDir(env), "memory");
}

export function resolveDefaultOpenClawConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.OPENCLAW_CONFIG_PATH?.trim();
  return resolve(
    override || join(resolveClawxmemoryStateDir(env), EDGECLAW_CONFIG_FILENAME),
  );
}

export function resolveDefaultWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveClawxmemoryStateDir(env), DEFAULT_WORKSPACE_DIRNAME);
}

export function containsDefaultWorkspaceMarker(raw: string): boolean {
  const normalized = raw.trim().replace(/\\/g, "/").toLowerCase();
  return normalized.includes(".edgeclaw/workspace-main")
    || normalized.includes(".edgeclaw/workspace")
    || normalized.includes(".openclaw/workspace-main")
    || normalized.includes(".openclaw/workspace");
}
