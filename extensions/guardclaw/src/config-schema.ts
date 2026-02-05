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
        })
      ),
    })
  ),
});

/**
 * Default configuration values
 */
export const defaultPrivacyConfig = {
  enabled: true,
  checkpoints: {
    onUserMessage: ["ruleDetector" as const],
    onToolCallProposed: ["ruleDetector" as const],
    onToolCallExecuted: ["ruleDetector" as const],
  },
  rules: {
    keywords: {
      S2: ["password", "api_key", "secret", "token", "credential"],
      S3: ["ssh", "id_rsa", "private_key", ".pem", ".key"],
    },
    tools: {
      S2: {
        tools: ["exec"],
        paths: [],
      },
      S3: {
        tools: ["system.run"],
        paths: ["~/.ssh", "/etc", "~/.aws", "~/.config"],
      },
    },
  },
  localModel: {
    enabled: false,
    provider: "ollama",
    model: "llama3.2:3b",
    endpoint: "http://localhost:11434",
  },
  guardAgent: {
    id: "guard",
    workspace: "~/.openclaw/workspace-guard",
    model: "ollama/llama3.2:3b",
  },
  session: {
    isolateGuardHistory: true,
  },
};
