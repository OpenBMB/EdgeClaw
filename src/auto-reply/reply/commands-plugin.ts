/**
 * Plugin Command Handler
 *
 * Handles commands registered by plugins, bypassing the LLM agent.
 * This handler is called before built-in command handlers.
 */

import { matchPluginCommand, executePluginCommand } from "../../plugins/commands.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

function isPluginCommandContinuationResult(
  result: Awaited<ReturnType<typeof executePluginCommand>>,
): result is { continueWithBody: string } {
  const candidate = result as { continueWithBody?: unknown } | null;
  return (
    typeof result === "object" && result !== null && typeof candidate?.continueWithBody === "string"
  );
}

function applyContinuationBody(target: Record<string, unknown>, body: string): void {
  target.Body = body;
  target.BodyForAgent = body;
  target.BodyStripped = body;
  target.CommandBody = body;
  target.RawBody = body;
}

/**
 * Handle plugin-registered commands.
 * Returns a result if a plugin command was matched and executed,
 * or null to continue to the next handler.
 */
export const handlePluginCommand: CommandHandler = async (
  params,
  allowTextCommands,
): Promise<CommandHandlerResult | null> => {
  const { command, cfg } = params;

  if (!allowTextCommands) {
    return null;
  }

  // Try to match a plugin command
  const match = matchPluginCommand(command.commandBodyNormalized);
  if (!match) {
    return null;
  }

  // Execute the plugin command (always returns a result)
  const result = await executePluginCommand({
    command: match.command,
    args: match.args,
    senderId: command.senderId,
    channel: command.channel,
    channelId: command.channelId,
    isAuthorizedSender: command.isAuthorizedSender,
    gatewayClientScopes: params.ctx.GatewayClientScopes,
    commandBody: command.commandBodyNormalized,
    config: cfg,
    from: command.from,
    to: command.to,
    accountId: params.ctx.AccountId ?? undefined,
    messageThreadId:
      typeof params.ctx.MessageThreadId === "string" ||
      typeof params.ctx.MessageThreadId === "number"
        ? params.ctx.MessageThreadId
        : undefined,
    threadParentId: params.ctx.ThreadParentId?.trim() || undefined,
  });

  if (isPluginCommandContinuationResult(result)) {
    applyContinuationBody(params.ctx as Record<string, unknown>, result.continueWithBody);
    if (params.rootCtx && params.rootCtx !== params.ctx) {
      applyContinuationBody(params.rootCtx as Record<string, unknown>, result.continueWithBody);
    }
    command.rawBodyNormalized = result.continueWithBody;
    command.commandBodyNormalized = result.continueWithBody;
    return {
      shouldContinue: true,
    };
  }

  return {
    shouldContinue: false,
    reply: result,
  };
};
