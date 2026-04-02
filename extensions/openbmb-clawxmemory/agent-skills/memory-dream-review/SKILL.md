---
name: memory-dream-review
description: Review ClawXMemory memory quality with a read-only Dream pass over recent L1, linked project memories, and the global profile.
homepage: https://github.com/OpenBMB/ClawXMemory/tree/main/clawxmemory
metadata:
  {
    "openclaw":
      {
        "skillKey": "openbmb-clawxmemory",
        "requires": { "config": ["plugins.entries.openbmb-clawxmemory.enabled"] },
      },
  }
---

# Memory Dream Review

Use this skill when the user asks to audit memory quality, clean up duplicate project memories, inspect profile drift, or decide what should be promoted into longer-term memory.

## Primary Path

1. Call `memory_dream_review`, usually with `focus: "all"`.
2. Report findings in this order:
   - `projectRebuild`
   - `cleanup`
   - `profileSuggestions`
   - `ambiguous`
   - `noAction`
   - `timeLayerNotes`
3. State clearly that Dream review is read-only and no memory records were modified.
4. Only call `memory_get` if the user asks to inspect one specific finding in detail.

## Focus Guidance

- Project cleanup or duplicate project summaries:
  use `memory_dream_review({ focus: "projects" })`
- Profile drift or promotion questions:
  use `memory_dream_review({ focus: "profile" })`
- Mixed governance review:
  use `memory_dream_review({ focus: "all" })`

## Guardrails

- Do not imply that Dream already rewrote L2 or profile memory.
- Treat `timeLayerNotes` as integrity observations only, not rewrite instructions.
- Prefer citing the returned `evidenceRefs` instead of guessing where a finding came from.
