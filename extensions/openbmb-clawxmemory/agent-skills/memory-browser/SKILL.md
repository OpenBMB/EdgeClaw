---
name: memory-browser
description: Browse ClawXMemory status and recent indexes using memory_overview first, then memory_list, and memory_get only for exact detail reads.
homepage: https://github.com/OpenBMB/ClawXMemory/tree/main/clawxmemory
metadata: {"openclaw":{"skillKey":"openbmb-clawxmemory","requires":{"config":["plugins.entries.openbmb-clawxmemory.enabled"]}}}
---

# Memory Browser

Use this skill when the user asks what ClawXMemory currently remembers, what indexes exist, or whether memory is fresh and healthy.

## Primary Path

1. Call `memory_overview` for counts, freshness, and runtime health.
2. Call `memory_list` to browse recent or filtered memory indexes.
3. If the user wants exact detail for one item, call `memory_get` only for that specific id.

## Example User Requests

- "What do you remember?"
  Start with `memory_overview`, then `memory_list({ level: "l2" })`.
- "What L2 project memory entries exist?"
  Use `memory_list({ level: "l2_project" })`.
- "What recent timeline memory entries exist?"
  Use `memory_list({ level: "l2_time" })`.
- "Why was this not remembered?"
  Start with `memory_overview`, then use `memory_flush` if the user wants an immediate refresh.

## Guardrails

- Keep browse answers concise; do not dump raw records unless the user asks.
- Prefer `memory_list` for browsing and `memory_get` for exact inspection.
- If overview shows pending work or runtime issues, say that clearly.
