/**
 * GuardClaw Types
 * 
 * Core type definitions for the GuardClaw plugin.
 */

export type SensitivityLevel = "S1" | "S2" | "S3";

export type SensitivityLevelNumeric = 1 | 2 | 3;

export type DetectorType = "ruleDetector" | "localModelDetector";

export type Checkpoint = "onUserMessage" | "onToolCallProposed" | "onToolCallExecuted";

export type PrivacyConfig = {
  enabled?: boolean;
  checkpoints?: {
    onUserMessage?: DetectorType[];
    onToolCallProposed?: DetectorType[];
    onToolCallExecuted?: DetectorType[];
  };
  rules?: {
    keywords?: {
      S2?: string[];
      S3?: string[];
    };
    tools?: {
      S2?: {
        tools?: string[];
        paths?: string[];
      };
      S3?: {
        tools?: string[];
        paths?: string[];
      };
    };
  };
  localModel?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    endpoint?: string;
  };
  guardAgent?: {
    id?: string;
    workspace?: string;
    model?: string;
  };
  session?: {
    isolateGuardHistory?: boolean;
  };
};

export type DetectionContext = {
  checkpoint: Checkpoint;
  message?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  sessionKey?: string;
  agentId?: string;
  recentContext?: string[];
};

export type DetectionResult = {
  level: SensitivityLevel;
  levelNumeric: SensitivityLevelNumeric;
  reason?: string;
  detectorType: DetectorType;
  confidence?: number;
};

export type SessionPrivacyState = {
  sessionKey: string;
  isPrivate: boolean;
  highestLevel: SensitivityLevel;
  detectionHistory: Array<{
    timestamp: number;
    level: SensitivityLevel;
    checkpoint: Checkpoint;
    reason?: string;
  }>;
};

export function levelToNumeric(level: SensitivityLevel): SensitivityLevelNumeric {
  switch (level) {
    case "S1":
      return 1;
    case "S2":
      return 2;
    case "S3":
      return 3;
  }
}

export function numericToLevel(numeric: SensitivityLevelNumeric): SensitivityLevel {
  switch (numeric) {
    case 1:
      return "S1";
    case 2:
      return "S2";
    case 3:
      return "S3";
  }
}

export function maxLevel(...levels: SensitivityLevel[]): SensitivityLevel {
  const numeric = levels.map(levelToNumeric);
  const max = Math.max(...numeric) as SensitivityLevelNumeric;
  return numericToLevel(max);
}
