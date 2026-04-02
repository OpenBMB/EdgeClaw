import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

export type EdgeClawSandboxNetworkConfig = {
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  allowLocalBinding?: boolean;
};

export type EdgeClawSandboxFilesystemConfig = {
  allowWrite?: string[];
  denyWrite?: string[];
  allowRead?: string[];
  denyRead?: string[];
};

export type EdgeClawSandboxPluginConfig = {
  network?: EdgeClawSandboxNetworkConfig;
  filesystem?: EdgeClawSandboxFilesystemConfig;
};

/**
 * Convert EdgeClaw plugin config + backend params into the
 * SandboxRuntimeConfig shape that @anthropic-ai/sandbox-runtime expects.
 *
 * The workspace directory is always added to allowWrite so sandboxed
 * commands can operate on the agent's working tree.
 */
export function mapToSandboxRuntimeConfig(
  pluginConfig: EdgeClawSandboxPluginConfig,
  workspaceDir: string,
  agentWorkspaceDir?: string,
): SandboxRuntimeConfig {
  const extraWritePaths = pluginConfig.filesystem?.allowWrite ?? [];
  const allowWrite = [workspaceDir, ...extraWritePaths];
  if (agentWorkspaceDir && agentWorkspaceDir !== workspaceDir) {
    allowWrite.push(agentWorkspaceDir);
  }

  return {
    network: {
      allowedDomains: pluginConfig.network?.allowedDomains ?? [],
      deniedDomains: pluginConfig.network?.deniedDomains ?? [],
      allowUnixSockets: pluginConfig.network?.allowUnixSockets,
      allowAllUnixSockets: pluginConfig.network?.allowAllUnixSockets,
      allowLocalBinding: pluginConfig.network?.allowLocalBinding,
    },
    filesystem: {
      allowWrite,
      denyWrite: pluginConfig.filesystem?.denyWrite ?? [],
      allowRead: pluginConfig.filesystem?.allowRead ?? [],
      denyRead: pluginConfig.filesystem?.denyRead ?? [],
    },
  };
}
