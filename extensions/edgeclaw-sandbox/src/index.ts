import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSandboxBackend } from "openclaw/plugin-sdk/sandbox";
import { bwrapSandboxBackendManager, createBwrapSandboxBackendFactory } from "./bwrap-backend.js";
import type { EdgeClawSandboxPluginConfig } from "./config.js";
import { createBwrapFsBridge } from "./fs-bridge.js";

let storedPluginConfig: EdgeClawSandboxPluginConfig = {};

const plugin = definePluginEntry({
  id: "edgeclaw-sandbox",
  name: "EdgeClaw OS Sandbox",
  description: "OS-level sandbox backend (bwrap/sandbox-exec) for EdgeClaw agents.",

  register(api) {
    storedPluginConfig = (api.pluginConfig as EdgeClawSandboxPluginConfig) ?? {};

    const factory = createBwrapSandboxBackendFactory(() => storedPluginConfig);

    registerSandboxBackend("bwrap", {
      factory: async (params) => {
        const handle = await factory(params);

        const originalHandle = handle;
        return {
          ...originalHandle,
          createFsBridge: ({ sandbox }) =>
            createBwrapFsBridge({
              workspaceDir: sandbox.workspaceDir,
              containerWorkdir: sandbox.containerWorkdir,
            }),
        };
      },
      manager: bwrapSandboxBackendManager,
    });
  },
});

export default plugin;
