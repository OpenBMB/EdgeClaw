---
name: session-memory
description: Guidelines for using incremental session memory. Session notes are clues, not absolute truths — use tools for details.
metadata:
  openclaw:
    skillKey: clawxgovernor
    requires:
      config:
        - plugins.entries.clawxgovernor.enabled
---

# Session Memory Guide

The ClawXGovernor plugin automatically records key facts from each turn into session notes. A lightweight hint is injected at the start of each turn so you have basic continuity.

## How it works

1. **Automatic capture**: After each of your replies, key bullet points are extracted and saved to `~/.openclaw/cc-session-memory/notes/<sessionId>.md`
2. **Hint injection**: At the start of each turn, the most recent session notes (last 5 lines) are injected as a `[Session Memory Hint]` in your context
3. **On-demand retrieval**: You can actively read or search session notes via MCP tools

## Important rules

1. **Session notes are clues, not absolute facts.** They are extracted summaries, not verbatim records. When precision matters, verify through tools.

2. **For detailed recall, use search tools.** When you need exact details from earlier in the session:
   - Use `clawxgovernor__session_note_read` to read the full session notes
   - Use `clawxgovernor__session_note_search` to search across sessions

3. **You can explicitly save important facts.** If the user tells you something important (a project name, a deadline, a preference), use `clawxgovernor__session_note_append` to ensure it's captured.

4. **Don't rely on prompt-stuffing.** The hint is intentionally short. This is by design — full notes would waste token budget. Trust the system: hints for orientation, tools for details.

## Available tools

| Tool                                 | When to use                               |
| ------------------------------------ | ----------------------------------------- |
| `clawxgovernor__session_note_append` | Explicitly save an important fact         |
| `clawxgovernor__session_note_read`   | Review full session history               |
| `clawxgovernor__session_note_search` | Find specific information across sessions |
