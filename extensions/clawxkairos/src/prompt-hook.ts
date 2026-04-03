import type { OpenClawPluginApi } from "../api.js";
import type { KairosState } from "./config.js";
import { KAIROS_BRIEF_PROMPT, KAIROS_SYSTEM_PROMPT, buildTickContext } from "./kairos-prompt.js";

/**
 * Registers the before_prompt_build hook that injects kairos-mode
 * system instructions and tick context markers.
 *
 * Uses ctx.trigger to distinguish:
 * - "heartbeat" → full kairos prompt + tick marker (KAIROS-driven turn)
 * - "user"      → brief kairos prompt (user is talking, stay concise)
 */
export function registerPromptHook(api: OpenClawPluginApi, state: KairosState): void {
  api.on("before_prompt_build", (_event, ctx) => {
    if (!state.active) return;

    if (ctx.trigger === "heartbeat") {
      return {
        appendSystemContext: KAIROS_SYSTEM_PROMPT,
        prependContext: buildTickContext(),
      };
    }

    return {
      appendSystemContext: KAIROS_BRIEF_PROMPT,
    };
  });
}
