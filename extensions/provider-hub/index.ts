import type { OpenClawPluginDefinition } from "../../src/plugins/types.ts";
import { registerProviderHubMethods } from "./src/methods/index.ts";

const plugin: OpenClawPluginDefinition = {
  id: "provider-hub",
  name: "Provider Hub",
  description:
    "Pre-built LLM provider catalog (global + China + local) with simplified API key management",
  version: "0.1.0",

  register(api) {
    registerProviderHubMethods(api);

    api.logger.info(
      `Provider Hub loaded — catalog ready, gateway methods: hub.providers.{list,probe,discover}`,
    );
  },
};

export default plugin;
