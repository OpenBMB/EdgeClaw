/**
 * Synchronous wrapper around the async LLM detection function.
 *
 * Uses `synckit` (Worker thread + Atomics.wait) to run `detectByLocalModel`
 * synchronously so that the `tool_result_persist` hook can consume its result
 * before returning — enabling LLM-quality detection that actually modifies
 * the persisted transcript.
 *
 * Timeout gracefully falls back to S1 (safe).
 */

import { fileURLToPath } from "node:url";
import { createSyncFn } from "synckit";
import type { DetectionContext, DetectionResult, PrivacyConfig } from "./types.js";

const FALLBACK_S1: DetectionResult = {
  level: "S1",
  levelNumeric: 1,
  reason: "LLM sync detection unavailable",
  detectorType: "localModelDetector",
  confidence: 0,
};

const workerPath = fileURLToPath(new URL("./llm-detect-worker.ts", import.meta.url));

let _syncDetect: ((context: DetectionContext, config: PrivacyConfig) => DetectionResult) | null =
  null;

function getSyncDetect() {
  if (!_syncDetect) {
    _syncDetect = createSyncFn<
      (context: DetectionContext, config: PrivacyConfig) => DetectionResult
    >(workerPath, { timeout: 20_000, tsRunner: "tsx" });
  }
  return _syncDetect;
}

export function syncDetectByLocalModel(
  context: DetectionContext,
  config: PrivacyConfig,
): DetectionResult {
  try {
    return getSyncDetect()(context, config);
  } catch (err) {
    console.warn("[GuardClaw] syncDetect fallback to S1:", (err as Error)?.message?.slice(0, 120));
    return FALLBACK_S1;
  }
}
