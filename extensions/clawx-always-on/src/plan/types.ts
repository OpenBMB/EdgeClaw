import type { AlwaysOnTaskRequestOptions } from "../command-options.js";

export type AlwaysOnPlanStatus = "active" | "completed" | "cancelled" | "failed";

export type AlwaysOnPlanTurn = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type AlwaysOnPlan = {
  id: string;
  conversationKey: string;
  status: AlwaysOnPlanStatus;
  initialPrompt: string;
  requestOptionsJson?: string;
  turnsJson: string;
  roundCount: number;
  originSessionKey?: string;
  finalPrompt?: string;
  createdTaskId?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type AlwaysOnPlanUpdatePatch = {
  status?: AlwaysOnPlanStatus;
  requestOptionsJson?: string | null;
  turnsJson?: string;
  roundCount?: number;
  originSessionKey?: string | null;
  finalPrompt?: string | null;
  createdTaskId?: string | null;
  failureReason?: string | null;
  updatedAt?: number;
  completedAt?: number | null;
};

export type AlwaysOnPlanRequestOptions = AlwaysOnTaskRequestOptions;
