/**
 * GuardClaw Config Schema
 * 
 * Configuration schema for the GuardClaw plugin using TypeBox.
 */

import { Type } from "@sinclair/typebox";

export const guardClawConfigSchema = Type.Object({
  privacy: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      checkpoints: Type.Optional(
        Type.Object({
          onUserMessage: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")])
            )
          ),
          onToolCallProposed: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")])
            )
          ),
          onToolCallExecuted: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")])
            )
          ),
        })
      ),
      rules: Type.Optional(
        Type.Object({
          keywords: Type.Optional(
            Type.Object({
              S2: Type.Optional(Type.Array(Type.String())),
              S3: Type.Optional(Type.Array(Type.String())),
            })
          ),
          patterns: Type.Optional(
            Type.Object({
              S2: Type.Optional(Type.Array(Type.String())),
              S3: Type.Optional(Type.Array(Type.String())),
            })
          ),
          tools: Type.Optional(
            Type.Object({
              S2: Type.Optional(
                Type.Object({
                  tools: Type.Optional(Type.Array(Type.String())),
                  paths: Type.Optional(Type.Array(Type.String())),
                })
              ),
              S3: Type.Optional(
                Type.Object({
                  tools: Type.Optional(Type.Array(Type.String())),
                  paths: Type.Optional(Type.Array(Type.String())),
                })
              ),
            })
          ),
        })
      ),
      localModel: Type.Optional(
        Type.Object({
          enabled: Type.Optional(Type.Boolean()),
          provider: Type.Optional(Type.String()),
          model: Type.Optional(Type.String()),
          endpoint: Type.Optional(Type.String()),
        })
      ),
      guardAgent: Type.Optional(
        Type.Object({
          id: Type.Optional(Type.String()),
          workspace: Type.Optional(Type.String()),
          model: Type.Optional(Type.String()),
        })
      ),
      session: Type.Optional(
        Type.Object({
          isolateGuardHistory: Type.Optional(Type.Boolean()),
          baseDir: Type.Optional(Type.String()),
        })
      ),
    })
  ),
});

/**
 * Default configuration values.
 *
 * Detection relies entirely on the local LLM judge (localModelDetector).
 * Rule-based detection is kept as an optional fallback but NOT enabled by default.
 */
export const defaultPrivacyConfig = {
  enabled: true,
  checkpoints: {
    onUserMessage: ["localModelDetector" as const],
    onToolCallProposed: ["localModelDetector" as const],
    onToolCallExecuted: ["localModelDetector" as const],
  },
  rules: {
    keywords: {
      S2: [] as string[],
      S3: [] as string[],
    },
    patterns: {
      S2: [] as string[],
      S3: [] as string[],
    },
    tools: {
      S2: { tools: [] as string[], paths: [] as string[] },
      S3: { tools: [] as string[], paths: [] as string[] },
    },
  },
  localModel: {
    enabled: true,
    provider: "ollama",
    model: "openbmb/minicpm4.1",
    endpoint: "http://localhost:11434",
  },
  guardAgent: {
    id: "guard",
    workspace: "~/.openclaw/workspace-guard",
    model: "ollama/openbmb/minicpm4.1",
  },
  session: {
    isolateGuardHistory: true,
    baseDir: "~/.openclaw",
  },
};
