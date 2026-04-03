import type { OpenClawPluginApi } from "../api.js";
import type { KairosConfig, KairosState } from "./config.js";

/**
 * Registers a before_tool_call hook that intercepts sessions_spawn calls
 * during kairos mode and re-issues them as non-blocking via the
 * subagent runtime API.
 *
 * The original synchronous spawn is blocked, and the plugin fires
 * api.runtime.subagent.run() instead — which returns a runId immediately.
 * A system event is enqueued so the main agent learns about the spawn
 * on its next tick.
 */
export function registerAsyncSubagent(
  api: OpenClawPluginApi,
  cfg: Required<KairosConfig>,
  state: KairosState,
): void {
  if (!cfg.asyncSubagents) return;

  api.on("before_tool_call", (event, ctx) => {
    if (!state.active) return;
    if (ctx.trigger !== "heartbeat") return;
    if (event.toolName !== "sessions_spawn") return;

    const params = event.params ?? {};
    const task = typeof params.task === "string" ? params.task : "";
    if (!task) return;

    const sessionKey = `kairos-sub-${Date.now()}`;

    api.runtime.subagent
      .run({
        sessionKey,
        message: task,
        model: typeof params.model === "string" ? params.model : undefined,
        deliver: false,
      })
      .then((result) => {
        const targetSession = ctx.sessionKey;
        if (!targetSession) return;

        api.runtime.system.enqueueSystemEvent(
          `[clawxkairos] Sub-agent spawned asynchronously.\n` +
            `  task: ${task.slice(0, 200)}\n` +
            `  runId: ${result.runId}\n` +
            `  sessionKey: ${sessionKey}\n` +
            `Use the subagents tool to check status.`,
          { sessionKey: targetSession, trusted: true },
        );
      })
      .catch((err) => {
        api.logger.warn?.(`clawxkairos: async subagent spawn failed: ${String(err)}`);
      });

    return {
      block: true,
      blockReason:
        `[clawxkairos] Sub-agent spawned asynchronously (session: ${sessionKey}). ` +
        `The main loop continues. Check status via the subagents tool.`,
    };
  });
}
