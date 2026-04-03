import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../api.js";
import type { KairosConfig, KairosState } from "./config.js";

const SleepSchema = Type.Object({
  duration_ms: Type.Number({
    description: "How long to sleep in milliseconds",
  }),
});

const SLEEP_TOOL_NAME = "Sleep";

const SLEEP_DESCRIPTION = `Wait for a specified duration. The user can interrupt the sleep at any time.

Use this when you have nothing useful to do, when you're waiting for something, or when the user tells you to rest.

You can call this concurrently with other tools — it won't interfere with them.

Prefer this over \`exec(sleep ...)\` — it doesn't hold a shell process.

Each wake-up costs an API call, but the prompt cache expires after 5 minutes of inactivity — balance accordingly.`;

export function createSleepTool(cfg: Required<KairosConfig>, state: KairosState): AnyAgentTool {
  return {
    name: SLEEP_TOOL_NAME,
    label: "Sleep",
    description: SLEEP_DESCRIPTION,
    parameters: SleepSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const raw = typeof params.duration_ms === "number" ? params.duration_ms : cfg.minSleepMs;
      const clamped = Math.max(cfg.minSleepMs, Math.min(cfg.maxSleepMs, raw));

      await new Promise<void>((resolve) => {
        state.sleepResolve = resolve;
        state.sleepTimer = setTimeout(() => {
          state.sleepTimer = null;
          state.sleepResolve = null;
          resolve();
        }, clamped);

        if (state.sleepTimer && typeof state.sleepTimer.unref === "function") {
          state.sleepTimer.unref();
        }

        signal?.addEventListener(
          "abort",
          () => {
            if (state.sleepTimer) {
              clearTimeout(state.sleepTimer);
              state.sleepTimer = null;
            }
            state.sleepResolve = null;
            resolve();
          },
          { once: true },
        );
      });

      return {
        type: "text" as const,
        text: `Slept for ${clamped}ms.`,
      };
    },
  };
}
