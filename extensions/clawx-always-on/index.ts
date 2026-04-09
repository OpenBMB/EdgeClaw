import { join } from "node:path";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { registerCommands } from "./src/commands/commands.js";
import { AlwaysOnConfigController } from "./src/core/config-controller.js";
import { resolveConfig } from "./src/core/config.js";
import { PLUGIN_ID, PROGRESS_TOOL_NAME, COMPLETE_TOOL_NAME } from "./src/core/constants.js";
import { resolveAlwaysOnToolSupport } from "./src/core/tool-compat.js";
import { AlwaysOnDreamScheduler } from "./src/dream/scheduler.js";
import { AlwaysOnDreamService } from "./src/dream/service.js";
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

    const initialConfig = resolveConfig(api.pluginConfig);
    const configController = new AlwaysOnConfigController(api, initialConfig);
    const config = configController.getConfig();

    const stateDir = api.runtime.state.resolveStateDir();
    const dataDir = config.dataDir ?? join(stateDir, PLUGIN_ID);
    const dbPath = join(dataDir, "tasks.sqlite");

    const db = openDatabase(dbPath);
    const store = new TaskStore(db);
    const logger = new TaskLogger(db, config, api.logger);
    const toolSupport = resolveAlwaysOnToolSupport(api.config);
    const getConfig = () => configController.getConfig();
    const planService = new AlwaysOnPlanService(api, store, logger, getConfig, toolSupport);
    const webPlanService = new AlwaysOnWebPlanService(api, store, logger, getConfig);
    const dreamService = new AlwaysOnDreamService(api, store, logger, getConfig);

    const executor = new SubagentExecutor(api.runtime.subagent, store, logger, toolSupport);
    const worker = new AlwaysOnWorker(
      store,
      logger,
      executor,
      api.logger,
      undefined,
      config.maxConcurrentTasks,
    );
    const dreamScheduler = new AlwaysOnDreamScheduler(getConfig, dreamService, api.logger);
    configController.subscribe(({ changedFields, effectiveValues, pendingRestartFields }) => {
      logger.updateConfig(effectiveValues);
      worker.updateMaxConcurrentTasks(effectiveValues.maxConcurrentTasks);
      dreamScheduler.refresh();
      const restartNote =
        pendingRestartFields.length > 0
          ? `; restart required: ${pendingRestartFields.join(", ")}`
          : "";
      api.logger.info(`[${PLUGIN_ID}] config updated (${changedFields.join(", ")})${restartNote}`);
    });

    // Register tools as factories (session-key aware)
    const progressFactory = createProgressToolFactory(store, logger);
    const completeFactory = createCompleteToolFactory(store, logger);

    api.registerTool(progressFactory, { name: PROGRESS_TOOL_NAME });
    api.registerTool(completeFactory, { name: COMPLETE_TOOL_NAME });

    registerCommands(api, store, logger, getConfig, toolSupport, planService, {
      runDream: (ctx) => dreamService.runFromCommand(ctx),
    });
    api.registerHttpRoute({
      path: `/plugins/${PLUGIN_ID}`,
      auth: "plugin",
      match: "prefix",
      handler: createAlwaysOnHttpHandler({
        store,
        logger,
        getConfig,
        configController,
        planService: webPlanService,
        pluginLogger: api.logger,
      }),
    });
    api.registerService({
      id: `${PLUGIN_ID}-worker`,
      start: () => {
        worker.start();
        dreamScheduler.start();
      },
      stop: () => {
        worker.stop();
        dreamScheduler.stop();
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
      `[${PLUGIN_ID}] registered (maxLoops=${config.defaultMaxLoops}, maxCost=$${config.defaultMaxCostUsd}, maxConcurrentTasks=${config.maxConcurrentTasks}, dreamEnabled=${config.dreamEnabled})`,
    );
  },
});
