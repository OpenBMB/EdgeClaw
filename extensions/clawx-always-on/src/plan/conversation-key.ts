import type { PluginCommandContext } from "../../api.js";

type PlanHookContext = {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
};

function stripKnownPrefix(value: string | undefined, channelId: string): string | undefined {
  if (!value) return undefined;
  const genericPrefixes = ["channel:", "chat:", "user:"];
  for (const prefix of genericPrefixes) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  const channelPrefix = `${channelId}:`;
  return value.startsWith(channelPrefix) ? value.slice(channelPrefix.length) : value;
}

function deriveDiscordConversationId(
  ctx: Pick<PluginCommandContext, "from" | "to">,
): string | undefined {
  const rawTarget = ctx.to ?? ctx.from;
  if (!rawTarget) return undefined;
  if (rawTarget.startsWith("discord:channel:")) {
    return `channel:${rawTarget.slice("discord:channel:".length)}`;
  }
  if (rawTarget.startsWith("discord:user:")) {
    return `user:${rawTarget.slice("discord:user:".length)}`;
  }
  if (rawTarget.startsWith("discord:")) {
    return `user:${rawTarget.slice("discord:".length)}`;
  }
  if (rawTarget.startsWith("channel:") || rawTarget.startsWith("user:")) {
    return rawTarget;
  }
  return undefined;
}

function deriveTelegramConversationId(
  ctx: Pick<PluginCommandContext, "from" | "to" | "messageThreadId">,
): string | undefined {
  const rawTarget =
    ctx.to && ctx.to.startsWith("slash:") ? (ctx.from ?? ctx.to) : (ctx.to ?? ctx.from);
  const baseConversationId = stripKnownPrefix(rawTarget, "telegram");
  if (!baseConversationId) return undefined;
  const threadId =
    typeof ctx.messageThreadId === "number" || typeof ctx.messageThreadId === "string"
      ? String(ctx.messageThreadId).trim()
      : "";
  if (threadId && !baseConversationId.includes(":topic:")) {
    return `${baseConversationId}:topic:${threadId}`;
  }
  return baseConversationId;
}

function deriveConversationIdFromCommand(ctx: PluginCommandContext): string | undefined {
  if (ctx.channel === "discord") {
    return deriveDiscordConversationId(ctx);
  }
  if (ctx.channel === "telegram") {
    return deriveTelegramConversationId(ctx);
  }
  // webchat and other channels: prefer to/from, fall back to senderId
  return stripKnownPrefix(ctx.to ?? ctx.from, ctx.channel) ?? ctx.senderId;
}

function buildConversationKey(params: {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
}): string | undefined {
  const channelId = params.channelId?.trim().toLowerCase();
  const conversationId = params.conversationId?.trim();
  if (!channelId || !conversationId) return undefined;
  return `${channelId}:${params.accountId?.trim() || "default"}:${conversationId}`;
}

export function resolvePlanConversationKeyFromCommand(
  ctx: PluginCommandContext,
): string | undefined {
  return buildConversationKey({
    channelId: ctx.channel,
    accountId: ctx.accountId,
    conversationId: deriveConversationIdFromCommand(ctx),
  });
}

export function resolvePlanConversationKeyFromHook(ctx: PlanHookContext): string | undefined {
  return buildConversationKey({
    channelId: ctx.channelId,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId ?? ctx.senderId,
  });
}
