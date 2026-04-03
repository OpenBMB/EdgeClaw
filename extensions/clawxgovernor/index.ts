import type { ContextEngineFactory } from "openclaw/plugin-sdk";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createContextEngineFactory } from "./src/assembler.js";
import { registerSessionMemory } from "./src/session-memory.js";
import { registerToolGovernor } from "./src/tool-governor.js";

export default definePluginEntry({
  id: "clawxgovernor",
  name: "ClawXGovernor",
  description:
    "工具治理 — 上下文工作集管理、工具风险分级与审计、会话级增量记忆，" +
    "为 OpenClaw 补齐 Claude Code 的治理闭环。",
  kind: "context-engine",

  register(api) {
    const pluginConfig = api.pluginConfig as Record<string, unknown>;
    const logger = api.logger;

    // --- Module 1: Context Engine ---
    const engineFactory = createContextEngineFactory({
      recentTailTurns: (pluginConfig.recentTailTurns as number) ?? 6,
      compactThresholdRatio: (pluginConfig.compactThresholdRatio as number) ?? 0.75,
      stateDir: pluginConfig.contextStateDir as string | undefined,
      logger,
    });
    api.registerContextEngine("clawxgovernor", engineFactory as ContextEngineFactory);
    logger.info("[ClawXGovernor] Context engine registered");

    // --- Module 2: Tool Governor ---
    registerToolGovernor(api, pluginConfig);
    logger.info("[ClawXGovernor] Tool governor registered");

    // --- Module 3: Session Memory ---
    registerSessionMemory(api, pluginConfig);
    logger.info("[ClawXGovernor] Session memory registered");
  },
});
