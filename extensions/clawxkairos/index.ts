import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { registerAsyncSubagent } from "./src/async-subagent.js";
import { registerBackgroundCommands } from "./src/background-commands.js";
import { resolveConfig, createInitialState } from "./src/config.js";
import { registerHeartbeatAckGuard } from "./src/heartbeat-ack-guard.js";
import { registerPromptHook } from "./src/prompt-hook.js";
import { createSleepTool } from "./src/sleep-tool.js";
import { registerTickScheduler } from "./src/tick-scheduler.js";

export default definePluginEntry({
  id: "clawxkairos",
  name: "ClawXKairos",
  description: "Self-driving agent loop with tick scheduling, Sleep tool, and background execution",

  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);
    const state = createInitialState();

    // ── Feature A: Sleep tool ──────────────────────────────────────
    api.registerTool(createSleepTool(cfg, state), { name: "Sleep" });

    // ── Feature B: Tick scheduler (agent_end → requestHeartbeatNow) ─
    registerTickScheduler(api, cfg, state);

    // ── Feature C: Kairos system prompt (before_prompt_build) ──────
    registerPromptHook(api, state);

    // ── Feature D: Auto-background long commands (before_tool_call) ─
    registerBackgroundCommands(api, cfg, state);

    // ── Feature E: Async sub-agents (before_tool_call) ─────────────
    registerAsyncSubagent(api, cfg, state);

    // ── Feature F: HEARTBEAT_OK fallback (llm_output → default sleep) ─
    registerHeartbeatAckGuard(api, state);

    // ── Runtime switch: /kairos on|off ──────────────────────────────
    api.registerCommand({
      name: "kairos",
      description: "Toggle Kairos autonomous mode on/off",
      acceptsArgs: true,
      handler(ctx) {
        const args = ctx.args?.trim().toLowerCase();

        if (args === "on") {
          state.active = true;
          state.turnCount = 0;
          return {
            text:
              "Kairos mode **ON**. The agent will self-loop on the next tick.\n" +
              `Config: maxTurns=${cfg.maxTurnsPerSession}, sleep=${cfg.minSleepMs}–${cfg.maxSleepMs}ms, ` +
              `tickDelay=${cfg.tickDelayMs}ms, autoBg=${cfg.autoBackgroundAfterMs}ms`,
          };
        }

        if (args === "off") {
          state.active = false;
          if (state.sleepTimer) {
            clearTimeout(state.sleepTimer);
            state.sleepTimer = null;
          }
          if (state.sleepResolve) {
            state.sleepResolve();
            state.sleepResolve = null;
          }
          return { text: "Kairos mode **OFF**. Native heartbeat resumes." };
        }

        if (args === "status") {
          return {
            text:
              `Kairos mode: **${state.active ? "ON" : "OFF"}**\n` +
              `Turn count: ${state.turnCount} / ${cfg.maxTurnsPerSession}\n` +
              `Sleeping: ${state.sleepTimer ? "yes" : "no"}`,
          };
        }

        return {
          text:
            `Kairos mode: **${state.active ? "ON" : "OFF"}**\n\n` +
            "Usage:\n" +
            "- `/kairos on` — activate kairos loop\n" +
            "- `/kairos off` — pause and return to native heartbeat\n" +
            "- `/kairos status` — show current state",
        };
      },
    });

    // ── Cold start: gateway_start kick (if configured) ──────────────
    if (cfg.startMode === "on-gateway-start") {
      api.on("gateway_start", () => {
        if (!state.active) return;
        setTimeout(() => {
          api.runtime.system.runHeartbeatOnce({
            reason: "hook:kairos-cold-start",
            heartbeat: { target: "last" },
          });
        }, 3_000);
      });
    }

    api.logger.info?.(
      `clawxkairos: registered (startMode=${cfg.startMode}, maxTurns=${cfg.maxTurnsPerSession})`,
    );
  },
});
