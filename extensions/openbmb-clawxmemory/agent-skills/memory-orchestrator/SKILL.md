---
name: memory-orchestrator
description: Orchestrate ClawXMemory retrieval using memory_search first and memory_get for exact record reads. Use when the user asks for historical context, project progress, timeline, or profile facts.
homepage: https://github.com/OpenBMB/ClawXMemory/tree/main/clawxmemory
metadata: {"openclaw":{"skillKey":"openbmb-clawxmemory","requires":{"config":["plugins.entries.openbmb-clawxmemory.enabled"]}}}
---

# Memory Orchestrator

Use this skill when the task depends on conversation history, project status, timeline, or user profile facts.

## Primary Path (Tool-first)

1. If the user is asking what memory exists or what ClawXMemory currently remembers, use `memory_overview` or `memory_list` instead of retrieval.
2. Otherwise call `memory_search` with the user's question.
3. Read `intent`, `enoughAt`, returned `context`, and `refs`.
4. If the returned context is sufficient, answer from it directly.
5. If you need exact verification, call `memory_get` with the smallest relevant id set from `refs`.
6. If `memory_search` returns weak or empty evidence, say so clearly and ask a targeted follow-up question.

## Fallback Strategy

- Time-oriented question: prefer `refs.l2` entries whose `level` is `l2_time`, then verify with `memory_get({ level: "l2_time", ids })`.
- Project-oriented question: prefer `refs.l2` entries whose `level` is `l2_project`, then verify with `memory_get({ level: "l2_project", ids })`.
- Fact/profile question: start with `memory_search`, then inspect only the most relevant `l1` or `l0` ids if the answer needs precise support.

## Tool Usage Notes

- Prefer concise query strings; avoid copying the entire user prompt unless necessary.
- Keep `limit` small, usually `4` to `8`, unless the user asks for exhaustive history.
- For browse-only questions, use `memory_overview` / `memory_list` rather than `memory_search`.
- Use `memory_get` only after `memory_search` has given you the ids worth reading.
- If evidence conflicts, prefer the newest verified `l1` / `l0` record and say that the history appears inconsistent.

## Minimal Example

```text
User asks: "Where is this project now?"
1) memory_search({ query: "recent project progress", limit: 6 })
2) Read refs.l2 and choose the best l2_project id
3) memory_get({ level: "l2_project", ids: ["<l2-id>"] })
4) If exact wording still matters, read the linked l1 or l0 ids with memory_get
```

## Example User Requests

- "What do you remember?"
  Use `memory_overview` or `memory_list`, not `memory_search`.
- "What project memory entries exist?"
  Use `memory_overview` or `memory_list`, not `memory_search`.
- "What is the latest progress on this project?"
  Start with `memory_search`, then verify the most relevant `l2_project` entry with `memory_get` if needed.

## Guardrails

- Do not fabricate details not supported by retrieved memory.
- Prefer newer verified entries over older ones when there is conflict.
- Do not call `memory_get` with guessed ids.
- If retrieval is empty, state uncertainty clearly and ask a targeted follow-up question.
