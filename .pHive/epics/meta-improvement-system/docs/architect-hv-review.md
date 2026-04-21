---
title: Architect H/V review + NEW QUESTION resolutions
author: architect (codex-backed)
date: 2026-04-20
epic: meta-improvement-system
phase: Phase B2 collab review
inputs: horizontal-plan.md, vertical-plan.md, user-decisions-dd.md
---

# Part A: H/V plan review

## 1. Horizontal layering — verdict
Verdict: architecturally coherent, with one important caveat on file placement.

The horizontal map is materially improved from the Phase A state. The layers now separate:
- policy/config (`L1-L2`)
- telemetry carrier + emission (`L3-L4`)
- control plane + authority (`L5-L7`)
- experiment runtime abstraction (`L8`)
- swarm-specific consumers (`L9-L10`)
- fallback substrate (`L11`)

That is the right decomposition. It avoids the earlier failure mode where lifecycle semantics, permissions, and metrics were implicitly braided together in the old meta-team loop.

The clean seams I do see:
- `L3` vs `L4`: schema/storage is distinct from emitters.
- `L8` vs `L9/L10`: shared lifecycle is distinct from swarm policy/promotion mode.
- `L5` vs `L6`: step obligations are separated from grant definitions, with an explicit closure-property audit.
- `L7` vs `L9/L10`: charters/references are policy inputs, not hidden behavior in the skills.

The one caveat: the plan still treats the L8/L9 filesystem placement as undecided. That is not a cosmetic detail. If L8 is mis-modeled as a skill and L9 sits in the shipped skill tree, the clean conceptual seam is weakened by packaging ambiguity.

## 2. Vertical slice invariants — verdict
Verdict: mostly coherent slice-by-slice, and the B0-before-C freeze sequencing lands correctly.

What is working:
- Slice 1 (`B0`) exists explicitly to prevent Epic C from freezing against a guessed consumer. That directly resolves the prior sequencing alarm.
- Slice 2 (`C1`) keeps metrics inert until schemas and primitives exist.
- Slices 3 and 4 correctly treat Epic A as archive/reset first, then control-plane rewrite second. That is the right split for removing contradictory authority before introducing the new one.
- Slice 5 puts hooks behind `metrics.enabled: false` by default, so landing emitters before kickoff UX is awkward but still coherent.
- Slice 7 isolates the shared lifecycle library before either swarm depends on it.
- Slice 8 intentionally keeps `/meta-meta-optimize` non-destructive while backlog mode and local-only placement are established.
- Slice 9 is the first slice that truly composes the system; making it the MVS is defensible.

The working-state invariant is preserved in the pragmatic control-plane sense the plan claims:
- no slice leaves an actively contradictory authority model live
- no slice requires an unbuilt downstream consumer to function
- default-off metrics prevents half-wired telemetry from producing surprise writes
- shipped-user surface does not appear until Slice 10

## 3. Alarm-by-alarm verification

### Alarm 1: Epic C / Epic B coupling
Addressed.

Evidence:
- Slice 1 is a dedicated `B0` consumer-contract sliver.
- Both plans explicitly state `B0` must precede Epic C schema freeze.
- The vertical plan makes `S1 before S2` a non-moldable dependency.

Architectural read: this is now fixed, not merely acknowledged.

### Alarm 2: Metrics dual-schema carrier
Addressed.

Evidence:
- User signed off on dual-schema under `.pHive/metrics/`.
- Horizontal plan cleanly separates `events/*.jsonl` from experiment-envelope documents.
- C1 is scoped to schemas + primitives only, which keeps the carrier clean before emitters arrive.

Architectural read: this follows the shared-carrier / dual-schema pattern correctly.

### Alarm 3: Experiment isolation asymmetry
Addressed.

Evidence:
- `meta-meta-optimize`: worktree default, direct-commit adapter, local-only.
- `meta-optimize`: worktree/equivalent isolation plus PR-only promotion.
- The plans no longer pretend the two swarms share the same mutation semantics.

Architectural read: the important asymmetry is now real policy, not commentary.

### Alarm 4: Baseline + rollback + threshold = one envelope
Mostly addressed, with one constraint to keep enforcing.

Evidence:
- The envelope fields in user decisions are carried through into L3/L8/Slice 1/Slice 7.
- Closure validator depends on commit/ref + metrics snapshot + rollback target.
- Rollback watch is modeled as part of the same lifecycle object, not a separate subsystem.

Constraint:
- The plans must keep resisting drift back into extra threshold classes or extra rollback modes. User Q3 explicitly rejected that expansion.

Architectural read: the envelope unification is present and should be treated as frozen unless a concrete consumer forces change.

## 4. Specific slice concerns (if any)
There are two real concerns, both bounded.

Concern 1: Slice 5 before Slice 6 is coherent but slightly operator-hostile.
- With hooks live before kickoff UX, brownfield operators can only enable metrics by manual config edit until Slice 6 lands.
- This is not a design break because default is OFF and the write path is gated.
- I do not consider it a sequencing flaw; just keep the docs explicit between those slices.

Concern 2: Slice 9 only counts as the MVS if it proves both halves of closure, not only successful close.
- The plan already includes the positive proof: closed cycle with real commit hash, metrics snapshot, and `rollback_ref`.
- The plan also includes the negative proof: fabricated `commit: TBD` must be rejected.
- That is good.
- The remaining subtlety is rollback realism: the observation-window test must exercise an actual committed experiment followed by an actual revert path, not only a mocked callback.

On that basis: Slice 9 does genuinely exercise the closure invariant, but only if the verification remains integration-grade for rollback and not just unit-grade inside L8.

## 5. Overall H/V review verdict: approve-with-escalation
The H/V plans are architecturally sound enough to proceed. The major prior alarms are materially addressed, the B0 sequencing is correctly anchored, the two-swarm asymmetry is now policy-bearing instead of rhetorical, and Slice 9 is a defensible MVS.

The escalation is narrow:
- resolve L8 and L9 filesystem placement in a way that preserves the abstraction seam and the local-only packaging boundary
- keep Slice 9 verification honest by requiring a real revert-path exercise, not only a synthetic closure pass

## 6. Flags (if any)
- `moderate` packaging-boundary flag: do not place the local-only maintainer skill in the same shipped skill tree unless there is a hard mechanism preventing accidental bundling beyond "we will remember not to register it."
- `minor` verification flag: Slice 9 rollback-watch validation must hit a real committed experiment + revert path once, or the MVS claim overstates what was proven.

# Part B: NEW QUESTION resolutions

## NEW QUESTION 1 — L8 shared lifecycle library location
**Recommendation:** Option A — `hive/lib/meta-experiment/`

Rationale:
- L8 is a shared code module, not an operator-facing skill. Modeling it as `SKILL.md` would blur "reusable runtime library" with "instructional entrypoint."
- It is consumed by both skills and potentially by non-skill code paths later (workflow helpers, validators, adapters, tests). That is a library shape.
- Repo scan shows strong conventions for executable skills under `skills/.../SKILL.md`, but no evidence that reusable runtime code lives as skills. Introducing `hive/lib/` is a cleaner new convention than overloading the skill convention.
- Keeping L8 outside the shipped skill tree reduces packaging confusion and keeps the L8/L9/L10 seam explicit: skills orchestrate; library implements lifecycle primitives.
- Discoverability is still easy: both `/meta-optimize` and local `/meta-meta-optimize` can point to `hive/lib/meta-experiment/` as their shared runtime dependency in their docs/comments.

Rejected alternative:
- Option B (`skills/hive/skills/meta-experiment/SKILL.md`) makes the library look like a user- or maintainer-invoked skill, which it is not. That would be semantic drift, not just a naming issue.

## NEW QUESTION 2 — L9 `/meta-meta-optimize` file location
**Recommendation:** Option B — `maintainer-skills/meta-meta-optimize/`

Rationale:
- L9 is intentionally local-only. The cleanest way to preserve that is to keep it outside the plugin's shipped `./skills/` root declared in `.claude-plugin/plugin.json`.
- Putting it under `skills/hive/skills/` would rely on convention to avoid accidental registration or future bundling. That is too weak for a self-modifying control-plane tool.
- Treating it as pure CLI (`scripts/meta-meta-optimize/`) is the wrong abstraction. The plan describes a workflow/skill-style orchestrator that reads charters, backlog, teams, and lifecycle primitives. It should remain a skill-shaped artifact, just not a shipped one.
- A dedicated `maintainer-skills/` tree makes the separation legible: public skills live under `skills/`; maintainer-only local skills live elsewhere.
- L9 can import the shared runtime from `hive/lib/meta-experiment/`, which keeps the code-sharing path straightforward without smuggling local-only behavior into the shipped surface.
- Accidental bundling prevention becomes structural, not procedural: the plugin manifest points at `./skills/`, so `maintainer-skills/` is out-of-package by default.

Rejected alternatives:
- Option A (`skills/hive/skills/meta-meta-optimize/`) keeps discoverability but weakens the ship/local boundary.
- Option C (`scripts/meta-meta-optimize/`) over-corrects by discarding the skill idiom the workflow actually wants.

## Summary
The H/V plans are ready to move forward. The architecture now lands the consumer-contract-first sequencing, dual-schema metrics carrier, swarm-policy asymmetry, and unified experiment envelope correctly, and Slice 9 is a valid MVS if rollback verification is exercised against a real revert path. The remaining escalation is structural rather than conceptual: place L8 as a real shared library under `hive/lib/meta-experiment/`, and place L9 as a maintainer-only skill outside the shipped skill root so the local-only boundary is enforced by layout rather than memory.

REVIEW: architect
VERDICT: approve-with-escalation
COMMENTS:
  - B0-before-C-freeze is now correctly enforced as a hard sequencing dependency rather than a note.
  - The dual-schema metrics carrier is coherent and matches the signed user decision.
  - The two swarms now have real policy asymmetry: worktree/direct-commit local L9 versus PR-only shipped L10.
  - Slice 9 is a defensible MVS only if rollback-watch proves a real committed revert path, not just synthetic closure success.
  - L8 and L9 placement should be resolved structurally to avoid packaging-boundary drift later.
NEW_Q1_VERDICT: Option A — L8 is shared runtime code, so it belongs in a library path, not a SKILL.md path.
NEW_Q2_VERDICT: Option B — L9 should stay skill-shaped but live outside the shipped `./skills/` root to prevent accidental bundling.
