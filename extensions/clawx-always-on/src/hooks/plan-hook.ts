import type { OpenClawPluginApi } from "../../api.js";
import { AlwaysOnPlanService } from "../plan/service.js";

export function registerPlanHook(api: OpenClawPluginApi, planService: AlwaysOnPlanService): void {
  api.on("before_dispatch", (event, ctx) => {
    return planService.handleBeforeDispatch(
      { content: event.content },
      {
        channelId: ctx.channelId,
        accountId: ctx.accountId,
        conversationId: ctx.conversationId,
        sessionKey: ctx.sessionKey,
        senderId: ctx.senderId,
      },
    );
  });
}
