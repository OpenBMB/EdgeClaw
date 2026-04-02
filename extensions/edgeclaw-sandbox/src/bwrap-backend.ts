import { spawn } from "node:child_process";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type {
  CreateSandboxBackendParams,
  SandboxBackendCommandParams,
  SandboxBackendCommandResult,
  SandboxBackendHandle,
  SandboxBackendManager,
} from "openclaw/plugin-sdk/sandbox";
import { mapToSandboxRuntimeConfig, type EdgeClawSandboxPluginConfig } from "./config.js";

let initialized = false;

async function ensureInitialized(config: SandboxRuntimeConfig): Promise<void> {
  if (initialized) {
    SandboxManager.updateConfig(config);
    return;
  }
  await SandboxManager.initialize(config);
  initialized = true;
}

function runWrappedCommand(
  wrappedCommand: string,
  params: {
    env: Record<string, string>;
    stdin?: Buffer | string;
    allowFailure?: boolean;
    signal?: AbortSignal;
  },
): Promise<SandboxBackendCommandResult> {
  return new Promise<SandboxBackendCommandResult>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", wrappedCommand], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...params.env },
      signal: params.signal,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      const exitCode = code ?? 0;
      if (exitCode !== 0 && !params.allowFailure) {
        reject(
          Object.assign(
            new Error(`Sandbox command failed (exit ${exitCode}): ${stderr.toString("utf8")}`),
            { code: exitCode, stdout, stderr },
          ),
        );
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });

    if (params.stdin !== undefined) {
      child.stdin.end(params.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export function createBwrapSandboxBackendFactory(
  getPluginConfig: () => EdgeClawSandboxPluginConfig,
) {
  const factory = async (params: CreateSandboxBackendParams): Promise<SandboxBackendHandle> => {
    const pluginConfig = getPluginConfig();
    const runtimeConfig = mapToSandboxRuntimeConfig(
      pluginConfig,
      params.workspaceDir,
      params.agentWorkspaceDir,
    );
    await ensureInitialized(runtimeConfig);

    return {
      id: "bwrap",
      runtimeId: `bwrap-${params.scopeKey}`,
      runtimeLabel: `OS Sandbox (${params.scopeKey})`,
      workdir: params.workspaceDir,
      env: params.cfg.docker.env,

      async buildExecSpec({ command, workdir, env, usePty }) {
        const wrapped = await SandboxManager.wrapWithSandbox(command);
        return {
          argv: ["/bin/sh", "-c", wrapped],
          env: { ...process.env, ...env },
          stdinMode: usePty ? ("pipe-open" as const) : ("pipe-closed" as const),
        };
      },

      async runShellCommand(command: SandboxBackendCommandParams) {
        const wrapped = await SandboxManager.wrapWithSandbox(command.script);
        return runWrappedCommand(wrapped, {
          env: {},
          stdin: command.stdin,
          allowFailure: command.allowFailure,
          signal: command.signal,
        });
      },
    };
  };

  return factory;
}

export const bwrapSandboxBackendManager: SandboxBackendManager = {
  async describeRuntime() {
    return {
      running: SandboxManager.isSupportedPlatform(),
      configLabelMatch: true,
    };
  },
  async removeRuntime() {
    // bwrap has no persistent runtime to remove
  },
};

/**
 * Reset internal initialization state.
 * Exposed for testing only.
 */
export function resetBwrapState(): void {
  initialized = false;
}
