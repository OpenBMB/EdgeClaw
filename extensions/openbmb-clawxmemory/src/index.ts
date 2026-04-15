import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerMemoryHooks } from "./hooks.js";
import { buildMemoryPromptSection } from "./prompt-section.js";
import { MemoryPluginRuntime } from "./runtime.js";
import { pluginConfigJsonSchema, pluginConfigUiHints } from "./config.js";

const plugin = definePluginEntry({
  id: "openbmb-clawxmemory",
  name: "ClawXMemory",
  description: "File-based long-term memory plugin for OpenClaw.",
  kind: "memory",
  configSchema: {
    jsonSchema: pluginConfigJsonSchema,
    uiHints: pluginConfigUiHints,
  },

  register(api): void {
    if (api.registrationMode !== "full") {
      return;
    }

    const runtime = new MemoryPluginRuntime({
      apiConfig: api.config,
      pluginRuntime: api.runtime,
      pluginConfig: api.pluginConfig,
      logger: api.logger,
    });

    api.registerMemoryPromptSection(buildMemoryPromptSection);
    api.registerMemoryRuntime(runtime.getMemoryRuntimeAdapter());

    const tools = runtime.getTools();
    api.registerTool(() => tools, { names: tools.map((tool) => tool.name) });
    registerMemoryHooks(api, runtime);

    api.registerService({
      id: "openbmb-clawxmemory-runtime",
      start: () => runtime.start(),
      stop: () => runtime.stop(),
    });
  },
});

export default plugin;
