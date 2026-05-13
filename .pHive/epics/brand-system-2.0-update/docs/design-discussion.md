---
epic_id: brand-system-2.0-update
branch: "proposed: feat/brand-system-2.0-update"
methodology: classic
scale: small
date: 2026-05-12
source_of_truth: .pHive/epics/hive-composability-audit/docs/recommendation.md:405-408
---

# Design Discussion: Brand System 2.0 Update

## 1. Goal

Update Hive brand artifacts so canonical source surfaces carry the post-2.0 framing: `composable substrate, user-directed`, replacing `director's chair` positioning across the canonical source set. The public claim should move from Hive directing swarms to users directing Hive through composable atoms, workflow primitives, memory architecture, adapter ABI, and sandbox substrate. This is needed now because PR #67 is the 2.0 cut, the audit made the reframe explicit, and stale public brand language at `README.md:9` would be the first surface consumers see after merge.

Audit source:
> ### North-Star alignment — REFRAMED
>
> Per user course-correction 2026-05-08, the brand reframes from *"director's chair"* (Hive directs swarms) to *"composable substrate, user-directed"* (user directs Hive; Hive provides composable atoms + workflow primitives). See §5.5.

Epic H source:
> **Epic H — `brand-system-2.0-update`** (≤3 stories)
> - **Scope:** update `project_oss_rollout_brand` memo + brand-system YAML + brand-guide HTML to reflect "Hive is to be directed" reframe. Deprecate "director's chair" framing; introduce "composable substrate, user-directed" framing.
> - **Dependencies / gates:** Epic A + B + C signed off + content-stable; brand update follows the artifact reality, not precedes it.
> - **Trigger:** automatic on 2.0 merge.

The research brief already holds the artifact inventory. This discussion inherits that inventory and does not re-enumerate it.

## 2. Proposed approach

Use three stories. The cut is visibility-first, source-first, then verification. That order keeps public drift low while preserving the larger brand-source rewrite for a single coherence pass.

**H-01: Tracked-surface reframe.**

Scope: `README.md:9` hero tagline.

Spot-check: `README.md:345+` `## North Star` section coherence.

Why this story exists: `README.md:9` is the public first impression and currently carries the old hero claim. It is the lowest-risk, highest-visibility change. It gates downstream stories because the public surface is what consumers see before they reach brand docs or local memory.

Expected posture: replace the hero tagline only after user selects the wording gate. Do not rewrite the full `## North Star` section unless the spot-check finds direct contradiction. The research brief says `README.md:345+` is already reframe-aligned around `compose those primitives`, `lights-on software factory`, and `compose-don't-rebuild`.

**H-02: Brand-source rewrite.**

Scope: `/Users/don/Documents/plugin-hive/.pHive/brand/vision.md`, `/Users/don/Documents/plugin-hive/.pHive/brand/brand-system.yaml`, and `/Users/don/Documents/plugin-hive/.pHive/brand/brand-guide.html`.

Local-state warning: these live in the `/Users/don/Documents/plugin-hive/` worktree and are gitignored. They are still canonical brand source state.

Scale: three files, about 1,782 lines total touched by review surface: 102 lines in `vision.md`, 212 lines in `brand-system.yaml`, and 1,468 lines in `brand-guide.html`.

Known targets: `brand-system.yaml:153`, `brand-guide.html:1403`, and `brand-guide.html:879-885`.

Why this story exists: this is the substantive rewrite. It should preserve voice cadence while changing positioning, sub-statements, and the `Every builder a director` body copy. Doing these files together avoids a half-updated brand source where the guide, YAML, and vision disagree.

Expected posture: change positioning architecture, not identity system. Keep the schema and guide structure unless a sentence-level rewrite forces minor local movement. Do a line-by-line audit around the known `director` and `chair` references.

**H-03: Memo + verification.**

Scope: `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_oss_rollout_brand.md` Locked-decisions section.

Verification: run final grep across tracked surface. `grep -rln "director's chair"` should return only intentional historical-audit paths: `CHANGELOG.md` 2.0.0 entry and `.pHive/epics/hive-composability-audit/`.

Why this story exists: the memo should copy final language after H-02, not pre-write its own variant. The final grep is the protection against drift across tracked files. H-03 is intentionally last because verification depends on H-01 and H-02 being complete.

Expected posture: resolve the existing `REFRAME PENDING` note from the memo. Do not edit historical audit records. Do not normalize the 2.0.0 changelog entry.

## 3. Reframe replacement vocabulary

This section proposes candidates for review. It does not lock final words. The user picks at the gate before H-01 and H-02 execution.

Current public hero: `README.md:9` uses `A director's chair for the agentic SDLC -- disciplined swarms, kickoff to ship.`

Hero tagline candidates:

1. `Composable substrate for the agentic SDLC -- user-directed, disciplined, kickoff to ship.`
2. `User-directed substrate for the agentic SDLC -- composable primitives, disciplined delivery.`
3. `A composable substrate for agentic delivery -- user-directed from kickoff to ship.`

Tradeoffs: candidate 1 preserves the strongest continuity with the current cadence and keeps `disciplined`. Candidate 2 is cleaner and more explicit about primitives, but loses `kickoff to ship`. Candidate 3 is shortest and avoids swarm language, but softens the operational factory claim.

Sub-statement candidates for `brand-system.yaml:153` and `brand-guide.html:1403`:

1. `Composable substrate. User-directed. Built in production, shared in public.`
2. `Disciplined substrate. Composable by default. Directed by the user.`
3. `Production-proven primitives for user-directed agentic work.`

Tradeoffs: candidate 1 is closest to the requested reframe and strongest for brand recall. Candidate 2 keeps discipline as a co-equal differentiator, but is heavier. Candidate 3 reads more product-specific and less manifesto-like.

`Every builder a director` replacement options for `brand-guide.html:879-885`:

1. `Every builder directs the substrate.`
2. `Builders direct the work; Hive composes the primitives.`
3. `Every builder gets production-grade primitives they can direct.`

Tradeoffs: option 1 keeps the cadence and flips agency to the user. Option 2 is clearest on the reframe, but less slogan-like. Option 3 explains more, but may read too functional for brand-guide body copy.

Surface option A: H-01 can use a concise hero tagline while H-02 uses a fuller statement in brand source. This reduces README density. The cost is one more wording variant to keep coherent.

Surface option B: use the same core sentence everywhere. This improves consistency. The cost is that `README.md:9`, `brand-system.yaml:153`, and `brand-guide.html:1403` have different layout constraints.

Gate: pick a hero candidate, a sub-statement candidate, and a body-copy direction before writing stories. Do not lock wording inside this design discussion.

## 4. What stays

Brand name stays: Hive.

Logo stays: concept 4 plus concept 5 co-brand.

Colors stay.

Typography stays.

Voice cadence stays: builder-to-builder, postmortem-cadenced, no launch-hype posture.

Inspirations credit stays.

Flayr dogfood narrative stays.

The `lights-on software factory` trajectory framing in the `README.md:345+` `## North Star` section stays. The research brief says that section is already reframe-aligned.

## 5. Risks

**R1 (low): Lost coherence between sub-statements and new positioning.**
Mitigation: run a line-by-line audit of `brand-guide.html` during H-02, with special attention to `brand-guide.html:879-885` and `brand-guide.html:1403`.

**R2 (low): Memo update drifts from final brand-source language.**
Mitigation: H-03 runs after H-02 and copies final wording from the brand-source rewrite.

**R3 (medium): `Director` metaphor appears in more sub-statements than the research brief surfaced.**
Mitigation: use wider grep terms during H-02 and H-03: `chair`, `swarm direction`, `directs swarms`, and `every builder a director` variants.

**R4 (low): Brand artifacts are gitignored, so changes do not go through PR review.**
Mitigation: commit a tracked delta summary at `.pHive/epics/brand-system-2.0-update/docs/h-02-brand-diff-summary.md`.

**New planning note: cycle-state branch base conflict.**
`.pHive/cycle-state/brand-system-2.0-update.yaml:6` currently says `branch_base: dev/hive-2.0`. This design discussion treats execution branch base as an open confirmation because the task requires post-merge `main`.

## 6. Dependencies / sequencing

Sequence: H-01 -> H-02 -> H-03.

This is not parallelizable. H-03 verification depends on H-01 and H-02 being complete. H-02 incorporates the finalized H-01 tagline wording so brand source and README do not diverge on day one.

Execution depends on PR #67, the Hive 2.0 cut, merging into `main` first. The cycle state records the trigger as `auto on PR #67 (Hive 2.0) merge` at `.pHive/cycle-state/brand-system-2.0-update.yaml:5`.

Branch base for execution: `main`, after PR #67 merges.

Pre-merge planning is fine. Implementation waits.

Open branch-base discrepancy: `.pHive/cycle-state/brand-system-2.0-update.yaml:6` currently says `branch_base: dev/hive-2.0`. Q5 asks the user to confirm that execution branches from `main`, not `dev/hive-2.0`.

## 7. Open questions for user

Q1. Final hero tagline wording -- which candidate, or what override?

Q2. `Every builder a director` body copy replacement -- which substrate-aligned phrase should replace it?

Q3. Should `disciplined` survive in the new tagline because audit section 5.5 retains discipline and composability as co-equal differentiators, or should the tagline drop it?

Q4. `brand-guide.html` assets/ exports -- does this work also re-export PNGs/SVGs that depend on new positioning copy, or is that a follow-on?

Q5. Branch base -- confirm work branches off `main` after PR #67 merges, not `dev/hive-2.0`.

## 8. Scale assessment

SMALL.

Reason: the audit caps Epic H at `<=3 stories`, and this design keeps it to three.

Work type: doc-only, no code.

Expected changed surfaces: one tracked README line plus local gitignored brand source plus one memory memo plus one tracked summary document.

No H/V planning. No structured outline.

Per `/plan` skill flow: design discussion -> directly to stories, Phase C.

Primary complexity: copy coherence, not engineering risk.

## 9. Cross-cutting concerns

None expected.

The work is positioning-only. It should not alter runtime behavior, package interfaces, tracker adapters, sandbox behavior, or workflow execution.

## 10. Out of scope

- Logo redesign
- Color palette change
- Typography change
- Voice cadence change
- Inspirations credit table edits
- Flayr dogfood narrative rewrite
- 2.0.0 CHANGELOG entry, already on `dev/hive-2.0` via `f6a61e9`
- `assets/` directory PNG/SVG regeneration, separate follow-on
