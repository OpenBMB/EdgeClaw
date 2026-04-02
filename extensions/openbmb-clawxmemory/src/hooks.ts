import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryPluginRuntime } from "./runtime.js";

const COMMAND_HOOK_EVENTS = [
  "command:new",
  "command:reset",
  "command:status",
  "command:help",
  "command:commands",
  "command:whoami",
  "command:id",
  "command:usage",
  "command:think",
  "command:thinking",
  "command:t",
  "command:verbose",
  "command:v",
  "command:reasoning",
  "command:reason",
  "command:model",
  "command:models",
  "command:queue",
  "command:activation",
  "command:restart",
  "command:bash",
  "command:compact",
  "command:stop",
  "command:elevated",
  "command:elev",
  "command:exec",
  "command:config",
  "command:debug",
  "command:context",
  "command:skill",
  "command:approve",
  "command:allowlist",
  "command:tts",
  "command:voice",
  "command:send",
  "command:subagents",
  "command:dock-telegram",
  "command:dock_telegram",
  "command:dock-discord",
  "command:dock_discord",
  "command:dock-slack",
  "command:dock_slack",
];

export function registerMemoryHooks(api: OpenClawPluginApi, runtime: MemoryPluginRuntime): void {
  if (!api.on) return;

  api.on("before_prompt_build", runtime.handleBeforePromptBuild, { priority: 60 });
  api.on("before_tool_call", runtime.handleBeforeToolCall, { priority: 60 });
  api.on("after_tool_call", runtime.handleAfterToolCall);
  api.on("before_message_write", runtime.handleBeforeMessageWrite, { priority: 80 });
  api.on("agent_end", runtime.handleAgentEnd);
  api.on("before_reset", runtime.handleBeforeReset);

  api.registerHook?.("message:received", runtime.handleInternalMessageReceived, {
    name: "openbmb-clawxmemory.message-received",
    description: "Track inbound business messages for ClawXMemory without indexing command turns.",
  });
  api.registerHook?.(COMMAND_HOOK_EVENTS, runtime.handleInternalCommandEvent, {
    name: "openbmb-clawxmemory.command-turn-filter",
    description: "Keep OpenClaw command/system turns visible in chat but out of ClawXMemory.",
  });
}
