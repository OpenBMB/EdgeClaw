---
name: tool-governance
description: Guidelines for safe tool usage under ClawXGovernor. Follow these rules to avoid dangerous operations and work efficiently with tool risk controls.
metadata:
  openclaw:
    skillKey: clawxgovernor
    requires:
      config:
        - plugins.entries.clawxgovernor.enabled
---

# Tool Usage Governance

The ClawXGovernor plugin monitors all tool calls for safety. Follow these guidelines:

## Risk Levels

| Level            | Tools                          | Default Action    |
| ---------------- | ------------------------------ | ----------------- |
| read             | find, grep, read, glob, search | Allow             |
| workspace_write  | edit, write, apply_patch       | Allow             |
| exec             | exec, code_execution, shell    | Requires approval |
| network          | web_search, fetch              | Allow             |
| subagent_control | sessions_spawn, sessions_send  | Requires approval |

## Before Executing Shell Commands

1. Consider whether the command could be destructive
2. Never run commands that delete system files, format disks, or create fork bombs
3. If unsure about a command's safety, use `clawxgovernor__tool_risk_classify` to check first

## Loop Prevention

The governor blocks tool calls that repeat more than 3 times consecutively with identical parameters. If you get blocked for looping:

1. Change your approach — try a different tool or different parameters
2. If you genuinely need to repeat a call, explain why to the user first

## Long Tool Results

When a tool returns more than 4000 characters of output:

- The governor automatically creates a summary in `~/.openclaw/cc-tool-governor/summaries/`
- Reference the summary instead of repeating the full output
- If you need the full output, tell the user where the complete data is stored

## Audit Trail

Use `clawxgovernor__tool_audit_query` to review recent tool call history:

- Check which tools were called and their risk classifications
- Review any blocked or approval-required calls
- Useful for debugging when tools seem to behave unexpectedly
