---
name: compact-guide
description: Behavioral guidance for long conversations with context compaction. Follow these rules to avoid redundant work after context is compressed.
metadata:
  openclaw:
    skillKey: clawxgovernor
    requires:
      config:
        - plugins.entries.clawxgovernor.enabled
---

# Long Conversation Behavior Guide

After context compaction, some older messages are replaced by a summary. Follow these rules to maintain quality:

## Rules

1. **Trust the summary.** If a `[Previous Context Summary]` section is present in your system prompt, it accurately describes what happened before. Do not ask the user to repeat information that is in the summary.

2. **Do not repeat completed work.** If the summary says a task was completed, do not redo it. If you need to verify, use a tool to check the result (e.g., read the file, check the state) rather than redoing the entire operation.

3. **Recent tool summaries are reliable.** The `[Recent Tool Result Summaries]` section contains compressed versions of recent long tool outputs. Reference these instead of re-running the same tool calls.

4. **When in doubt, inspect.** Use `clawxgovernor__context_inspect` to check what the context engine currently sees. This is better than guessing.

5. **Warn about approaching limits.** If you notice `estimatedRemainingTurns` is low (< 3), proactively tell the user that context is getting full and suggest wrapping up or starting a fresh session.

6. **Do not fight compaction.** If old messages are gone, they are gone intentionally. Work with the summary rather than trying to reconstruct the original conversation.
