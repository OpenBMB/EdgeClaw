---
name: context-inspect
description: Inspect the current context engine working set status. Use when you suspect context loss, need to check token budget, or want to understand what the model can currently "see".
metadata:
  openclaw:
    skillKey: clawxgovernor
    requires:
      config:
        - plugins.entries.clawxgovernor.enabled
---

# Context Inspect

When you feel like you might have lost context about earlier parts of the conversation, or when the user asks about your memory/context status, use the `clawxgovernor__context_inspect` MCP tool.

## When to use

- You notice you're repeating work you've already done
- The user says "you forgot" or "we already discussed this"
- You want to check how much token budget remains before a long operation
- After a compaction event, to verify what was preserved

## How to use

1. Call `clawxgovernor__context_inspect` with no parameters (or optional `sessionId`)
2. Read the returned state: `totalTokens`, `tokenBudget`, `segments`, `lastCompactTime`
3. If `totalTokens / tokenBudget > 0.8`, warn the user that context is getting full
4. If `lastCompactTime` is recent, check `hasReinjection` to see if summaries were preserved

## Budget check

Use `clawxgovernor__context_budget_check` to get a quick budget summary:

- `usageRatio`: how full the context is (0.0 to 1.0)
- `estimatedRemainingTurns`: rough estimate of turns before compaction triggers
- `willCompactSoon`: boolean warning

## Manual compaction

Only use `clawxgovernor__context_force_compact` in extreme cases:

- Context is clearly corrupted or full of irrelevant content
- The user explicitly asks to "reset" or "clear" context
- Always provide a `reason` explaining why you're triggering manual compaction
