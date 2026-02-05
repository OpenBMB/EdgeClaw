import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { guardClawConfigSchema } from "./src/config-schema.js";
import { registerHooks } from "./src/hooks.js";

const plugin = {
  id: "guardclaw",
  name: "GuardClaw",
  description: "Privacy-aware plugin with sensitivity detection and guard agent support",
  version: "2026.2.4",
  configSchema: guardClawConfigSchema,
  register(api: OpenClawPluginApi) {
    api.logger.info("[GuardClaw] Registering hooks...");
    registerHooks(api);
    api.logger.info("[GuardClaw] Plugin initialized");
  },
};

export default plugin;
