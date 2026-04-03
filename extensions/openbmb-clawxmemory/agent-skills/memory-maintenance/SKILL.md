---
name: memory-maintenance
description: Diagnose and maintain ClawXMemory index health using scripts and tools. Use when installation, indexing, or data quality looks wrong.
homepage: https://github.com/OpenBMB/ClawXMemory/tree/main/clawxmemory
metadata: {"openclaw":{"skillKey":"openbmb-clawxmemory","requires":{"config":["plugins.entries.openbmb-clawxmemory.enabled"]}}}
---

# Memory Maintenance

Use this skill for diagnosis and maintenance of ClawXMemory storage/indexes.

## Mixed Mode Policy

- Prefer tool calls for normal user-facing retrieval flows.
- Use scripts only for diagnostics, data checks, and troubleshooting.

## Recommended Workflow

1. Read current memory behavior with tools:
   - `memory_overview`
   - `memory_list`
   - `memory_search`
   - `memory_get`
2. If the user wants an immediate refresh or you see pending memory, run `memory_flush`.
3. If behavior is still suspicious, run scripts:
   - `node {baseDir}/scripts/inspect-indexes.mjs --db <path>`
   - `node {baseDir}/scripts/recent-sessions.mjs --db <path> --limit 5`
4. Compare script output with tool output.
5. Report concrete findings:
   - missing data
   - stale indexing
   - low extraction quality
   - query mismatch

## Script Defaults

- Default DB path: `~/.openclaw/clawxmemory/memory.sqlite`
- You can override with `--db /absolute/path/to/memory.sqlite`

## Common Debug Cases

- Install succeeds but recall empty: start with `memory_overview`, then check table counts and `lastIndexedAt`.
- Project answers weak: start with `memory_search`, then inspect `l2_project` and recent `l1` ids using `memory_get`.
- Timeline mismatch: inspect `l2_time` ids from `memory_search`, then compare against the latest `l0` sessions.
- Recent turn not visible yet: inspect `pendingL0` in `memory_overview`, then run `memory_flush`.

## Guardrails

- Scripts are read-only diagnostics in this skill.
- Do not modify DB directly from this skill unless user explicitly asks for data repair.
