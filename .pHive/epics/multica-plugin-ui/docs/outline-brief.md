# Squad-leader brief — multica-plugin-ui structured outline (Phase D, REGEN v2)

**You are `tpm`, leader of `planning-team-squad`** (architect=codex/gpt-5.5,
technical-writer=codex/gpt-5.4-mini, researcher=codex). **You ORCHESTRATE — delegate.**

> **Why a regen:** the first outline was gutted (137 lines; missing Risk Registry and the
> mandatory Elicitation section). The repo now has an **enforcing skill** that forbids that.
> This run MUST follow it.

### Delegation (gap-corrected + anti-stall)
Create a FRESH issue assigned to the member at creation (`multica issue create --assignee
<member> --status todo …`). A status-flip does NOT spawn. **ANTI-STALL: if a child sits in
`todo` >3 min without going in_progress, CANCEL it and create a brand-new fresh issue
assigned to the same member.** Poll children to in_review/done; read via `multica issue
comment list`. Members commit to work_dirs.

## THE BINDING CONSTRAINT — use the skill

The writer MUST author the outline by following
**`skills/hive/skills/structured-outline/SKILL.md`** (now on this branch). That skill lists
the **mandatory sections** and a **completeness gate**: a structured outline missing any
mandatory section is INCOMPLETE and must not be handed off. Target **~1000 lines (800–1200)**.
The first attempt dropped Part 5 (Risk Registry) and Part 7 (Elicitation) — those are
explicitly required this time.

Mandatory parts (per the skill): 1 Executive Summary · 2 Detailed Approach (per phase:
Changes/Interfaces/Validation) · 3 Verification Plan (+ coverage matrix + what's NOT
verified) · 3b Cross-Cutting Concerns · 4 File Change Manifest · 5 **Risk Registry** ·
6 Dependency Map · 7 **Elicitation (Why-won't-this-work / Assumptions VERIFIED-ASSUMED-RISKY
/ Simplest version / Regrets / Over-engineering)** · 8 Decision Points.

## Inputs (read first, on origin `feat/multica-plugin-ui`)
- `skills/hive/skills/structured-outline/SKILL.md` — **the format contract.**
- `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` — the 6 approved slices (the phases).
- `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md` — the 9-layer map.
- `.pHive/epics/multica-plugin-ui/docs/design-discussion.md` — 4 locked forks.

## Delegation plan

1. **Detailed content → `architect` (gpt-5.5).** Produce the substance for ALL parts, with
   special care on the reasoning-heavy ones the mini writer can't carry: **Part 5 Risk
   Registry** (table: risk/severity/likelihood/mitigation/owner; detailed mitigation for
   high-severity) and **Part 7 Elicitation** (adversarial self-critique — the 5 sub-sections).
   Also Part 2 per-phase Changes/Interfaces/Validation (one phase per approved slice),
   Part 3 Verification + coverage matrix, Part 4 File Manifest, Part 6 Dependency Map,
   Part 8 Decision Points. Cite real `~/Code/spikes/multica` paths + the H/V doc seams.
2. **Synthesize → `technical-writer`.** Author
   `.pHive/epics/multica-plugin-ui/docs/structured-outline.md` **following
   `skills/hive/skills/structured-outline/SKILL.md` exactly** — all mandatory parts in order,
   ~1000 lines, completeness gate satisfied. Preserve the architect's Risk Registry +
   Elicitation verbatim. Mark any genuine gap `[data not provided: <what>]`; never drop a part.

## Boundaries
- Produce structured-outline.md only. Do NOT write story YAMLs, publish, or advance a gate.
- When children terminal + doc committed, post a final summary on THIS issue: child id +
  member + status + **a per-part present/absent checklist** (1–8 + 3b) proving the
  completeness gate is satisfied.
