import { join } from "node:path";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { registerCommands } from "./src/commands/commands.js";
import { resolveConfig } from "./src/core/config.js";
import { PLUGIN_ID, PROGRESS_TOOL_NAME, COMPLETE_TOOL_NAME } from "./src/core/constants.js";
import { resolveAlwaysOnToolSupport } from "./src/core/tool-compat.js";
import { SubagentExecutor } from "./src/executor/executor.js";
import { registerLifecycleHooks } from "./src/hooks/lifecycle-hook.js";
import { registerPlanHook } from "./src/hooks/plan-hook.js";
import { registerPromptHook } from "./src/hooks/prompt-hook.js";
import { createAlwaysOnHttpHandler } from "./src/http.js";
import { AlwaysOnPlanService } from "./src/plan/service.js";
import { AlwaysOnWebPlanService } from "./src/plan/web-service.js";
import { TaskLogger } from "./src/storage/logger.js";
import { openDatabase, TaskStore } from "./src/storage/store.js";
import { createCompleteToolFactory } from "./src/tools/complete-tool.js";
import { createProgressToolFactory } from "./src/tools/progress-tool.js";
import { AlwaysOnWorker } from "./src/worker/worker.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "ClawXAlwaysOn",
  description:
    "Persistent background tasks via isolated sub-agent sessions with per-task budget constraints.",

  register(api: OpenClawPluginApi) {
    if (api.registrationMode !== "full") return;

    const config = resolveConfig(api.pluginConfig);

    const stateDir = api.runtime.state.resolveStateDir();
    const dataDir = config.dataDir ?? join(stateDir, PLUGIN_ID);
    const dbPath = join(dataDir, "tasks.sqlite");

    const db = openDatabase(dbPath);
    const store = new TaskStore(db);
    const logger = new TaskLogger(db, config, api.logger);
    const toolSupport = resolveAlwaysOnToolSupport(api.config);
    const planService = new AlwaysOnPlanService(api, store, logger, config, toolSupport);
    const webPlanService = new AlwaysOnWebPlanService(api, store, logger, config);

    const executor = new SubagentExecutor(api.runtime.subagent, store, logger, toolSupport);
    const worker = new AlwaysOnWorker(
      store,
      logger,
      executor,
      api.logger,
      undefined,
      config.maxConcurrentTasks,
    );

    // Register tools as factories (session-key aware)
    const progressFactory = createProgressToolFactory(store, logger);
    const completeFactory = createCompleteToolFactory(store, logger);

    api.registerTool(progressFactory, { name: PROGRESS_TOOL_NAME });
    api.registerTool(completeFactory, { name: COMPLETE_TOOL_NAME });

    registerCommands(api, store, logger, config, toolSupport, planService);
    api.registerHttpRoute({
      path: `/plugins/${PLUGIN_ID}`,
      auth: "plugin",
      match: "prefix",
      handler: createAlwaysOnHttpHandler({
        store,
        logger,
        config,
        planService: webPlanService,
        pluginLogger: api.logger,
      }),
    });
    api.registerService({
      id: `${PLUGIN_ID}-worker`,
      start: () => {
        worker.start();
      },
      stop: () => {
        worker.stop();
      },
    });
    registerPromptHook(api, store, toolSupport);
    registerPlanHook(api, planService);
    registerLifecycleHooks(api, store, logger);

    // Periodic log cleanup
    const cleanupIntervalMs = 24 * 60 * 60 * 1000;
    const cleanupTimer = setInterval(() => {
      try {
        const deleted = logger.cleanup();
        if (deleted > 0) {
          api.logger.info(`[${PLUGIN_ID}] Cleaned up ${deleted} old log entries`);
        }
      } catch {
        // Cleanup failures are non-critical
      }
    }, cleanupIntervalMs);
    if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

    api.logger.info(
      `[${PLUGIN_ID}] registered (maxLoops=${config.defaultMaxLoops}, maxCost=$${config.defaultMaxCostUsd}, maxConcurrentTasks=${config.maxConcurrentTasks})`,
    );
  },
});
