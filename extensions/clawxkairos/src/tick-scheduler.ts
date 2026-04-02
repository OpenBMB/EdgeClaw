import type { OpenClawPluginApi } from "../api.js";
import type { KairosConfig, KairosState } from "./config.js";

/**
 * Registers the agent_end hook that drives the kairos loop.
 *
 * Flow: agent finishes a turn → hook fires → after tickDelayMs,
 * runHeartbeatOnce({ target: "last" }) forces the heartbeat runner to
 * actually run the agent even when the global heartbeat target is "none"
 * → before_prompt_build injects tick context → agent runs again → cycle repeats.
 */
export function registerTickScheduler(
  api: OpenClawPluginApi,
  cfg: Required<KairosConfig>,
  state: KairosState,
): void {
  api.on("agent_end", (_event, ctx) => {
    api.logger.info?.(
      `clawxkairos: [tick] agent_end trigger=${ctx.trigger} active=${state.active} turnCount=${state.turnCount} ack=${state.lastReplyWasAck}`,
    );

    if (!state.active) return;

    if (ctx.trigger === "user") {
      state.turnCount = 0;
    }

    const shouldTick =
      ctx.trigger === "heartbeat" || (ctx.trigger === "user" && state.turnCount === 0);

    if (!shouldTick) {
      api.logger.info?.(`clawxkairos: [tick] skipped (shouldTick=false)`);
      return;
    }

    state.turnCount++;

    if (state.turnCount >= cfg.maxTurnsPerSession) {
      api.logger.info?.(
        `clawxkairos: [tick] reached maxTurnsPerSession (${cfg.maxTurnsPerSession}), pausing`,
      );
      return;
    }

    const delay = state.lastReplyWasAck ? cfg.minSleepMs : cfg.tickDelayMs;
    state.lastReplyWasAck = false;

    api.logger.info?.(
      `clawxkairos: [tick] scheduling in ${delay}ms (turnCount=${state.turnCount})`,
    );

    setTimeout(() => {
      if (!state.active) return;

      api.logger.info?.(`clawxkairos: [tick] firing runHeartbeatOnce`);

      const p = api.runtime.system.runHeartbeatOnce({
        reason: "hook:kairos-tick",
        heartbeat: { target: "last" },
      });
      if (p && typeof p.then === "function") {
        p.then((r: any) =>
          api.logger.info?.(`clawxkairos: [tick] result=${JSON.stringify(r)}`),
        ).catch((e: any) => api.logger.info?.(`clawxkairos: [tick] error=${e}`));
      }
    }, delay);
  });
}
