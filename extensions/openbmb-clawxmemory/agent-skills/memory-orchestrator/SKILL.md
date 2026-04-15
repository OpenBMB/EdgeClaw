---
name: memory-orchestrator
description: Orchestrate ClawXMemory retrieval using memory_search first and memory_get for exact file reads. Use when the user asks for historical context, project progress, project collaboration rules, or user profile facts.
homepage: https://github.com/OpenBMB/ClawXMemory/tree/main/clawxmemory
metadata: {"openclaw":{"skillKey":"openbmb-clawxmemory","requires":{"config":["plugins.entries.openbmb-clawxmemory.enabled"]}}}
---

# Memory Orchestrator

Use this skill when the answer depends on ClawXMemory rather than only the current chat turn.

## Primary Path

1. If the user is asking what memory exists or what ClawXMemory currently remembers, use `memory_overview` or `memory_list`.
2. Otherwise call `memory_search` with a concise query.
3. Read the returned:
   - `route`
   - `context`
   - `selectedProjectId`
   - `disambiguationRequired`
   - `refs.files`
   - `debug`
4. If `context` already contains the needed evidence, answer from it directly.
5. If exact verification is still useful, call `memory_get` with the smallest possible subset of `refs.files`.

## Current Tool Contract

`memory_search(...)` returns the live retrieval contract:

- `route`
  - `none`
  - `user`
  - `project_memory`
- `context`
  - The rendered ClawXMemory recall block for this turn
- `selectedProjectId`
  - The formal project chosen for recall, or `null`
- `disambiguationRequired`
  - `true` when the query looks project-oriented but no formal project was selected
- `refs.files`
  - Relative file ids that can be passed into `memory_get`
- `debug`
  - Trace-oriented diagnostic metadata

Do not assume any old `l2 / l1 / l0 / enoughAt` fields exist.

## Clarification Guardrail

If `memory_search` says:

- `disambiguationRequired = true`, or
- `route = project_memory` but `selectedProjectId = null`, or
- `refs.files` is empty for a project-specific question

then you must:

1. Say that no single formal project was selected from memory.
2. Ask a focused clarification question.
3. Do **not** list or guess project names that are not explicitly present in retrieved memory.

Example clarification:

- "我还没有选中唯一的项目。你说的是哪个项目？"
- "这个问题需要先确认具体项目名，你是在说哪个项目？"

## Tool Usage Notes

- Prefer concise query strings.
- Keep `memory_search.limit` small unless the user explicitly wants breadth.
- Use `memory_get` only with ids returned from `memory_search` or `memory_list`.
- If evidence is missing, say so directly instead of filling gaps from memory guesses.
- When retrieved evidence conflicts, prefer the newest retrieved file and mention the conflict.

## Example

```text
User asks: "这个项目现在的阶段和下一步是什么？"
1) memory_search({ query: "这个项目现在的阶段和下一步是什么？", limit: 5 })
2) If disambiguationRequired=true, ask which project the user means.
3) Otherwise answer from context.
4) Only if needed, verify one or two refs.files with memory_get.
```

## Guardrails

- Do not fabricate details not supported by retrieved memory.
- Do not fabricate or enumerate project names when retrieval did not select one.
- Do not call `memory_get` with guessed ids.
- If retrieval is empty or unresolved, ask a targeted follow-up instead of pretending memory certainty.
