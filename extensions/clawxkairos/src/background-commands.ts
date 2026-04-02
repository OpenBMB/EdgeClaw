import type { OpenClawPluginApi } from "../api.js";
import type { KairosConfig, KairosState } from "./config.js";

/**
 * Registers a before_tool_call hook that automatically sets yieldMs on
 * exec tool calls during kairos mode. This causes long-running shell
 * commands to be backgrounded after autoBackgroundAfterMs, so the agent
 * isn't blocked waiting for slow commands.
 *
 * The exec tool already supports yieldMs natively — we just inject the
 * value when the agent hasn't set one explicitly.
 */
export function registerBackgroundCommands(
  api: OpenClawPluginApi,
  cfg: Required<KairosConfig>,
  state: KairosState,
): void {
  api.on("before_tool_call", (event, ctx) => {
    if (!state.active) return;
    if (ctx.trigger !== "heartbeat") return;
    if (event.toolName !== "exec") return;

    const params = event.params ?? {};

    if (params.yieldMs !== undefined || params.background !== undefined) return;

    return {
      params: {
        ...params,
        yieldMs: cfg.autoBackgroundAfterMs,
      },
    };
  });
}
