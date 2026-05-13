---
project: brand-system-2.0-update
date: 2026-05-12
source_of_truth: .pHive/epics/hive-composability-audit/docs/recommendation.md:405-408
trigger: automatic on 2.0 merge
branch_base: main
primary_inputs:
  - .pHive/epics/hive-composability-audit/docs/recommendation.md
  - .pHive/epics/ui-cluster-extract-config-deeper/docs/research-brief.md
  - orchestrator pre-research findings for Epic H
---

# Research Brief: Brand System 2.0 Update

## Epic identity

Epic ID: `brand-system-2.0-update`.
Source of truth: `.pHive/epics/hive-composability-audit/docs/recommendation.md:405-408`.
Trigger: automatic on 2.0 merge.
Merge event: PR #67, `dev/hive-2.0` to `main`.
Branch base: `main`, post-2.0 merge.

Epic H entry:

```text
.pHive/epics/hive-composability-audit/docs/recommendation.md:405
**Epic H — `brand-system-2.0-update`** (≤3 stories)
- **Scope:** update `project_oss_rollout_brand` memo + brand-system YAML + brand-guide HTML to reflect "Hive is to be directed" reframe. Deprecate "director's chair" framing; introduce "composable substrate, user-directed" framing.
- **Dependencies / gates:** Epic A + B + C signed off + content-stable; brand update follows the artifact reality, not precedes it.
- **Trigger:** automatic on 2.0 merge.
```

This brief is research planning only.
It does not rewrite the brand or edit brand artifacts.

## Reframe statement

FROM: `"director's chair"`; Hive directs swarms; disciplined swarms, kickoff to ship.

TO: `"composable substrate, user-directed"`; user directs Hive; Hive provides composable atoms and workflow primitives.

Rationale: user course-correction during composability audit review on 2026-05-08.

Audit citation:

```text
.pHive/epics/hive-composability-audit/docs/recommendation.md:239
### North-Star alignment — REFRAMED

.pHive/epics/hive-composability-audit/docs/recommendation.md:241
Per user course-correction 2026-05-08, the brand reframes from *"director's chair"* (Hive directs swarms) to *"composable substrate, user-directed"* (user directs Hive; Hive provides composable atoms + workflow primitives). See §5.5.
```

Section 5.5 citation:

```text
.pHive/epics/hive-composability-audit/docs/recommendation.md:298
### 5.5 North-Star statement — REFRAMED

.pHive/epics/hive-composability-audit/docs/recommendation.md:300
`project_oss_rollout_brand` (locked 2026-04-30) had defined the brand as *"a director's chair for the agentic SDLC — disciplined swarms, kickoff to ship."* Per user course-correction 2026-05-08, the brand reframes:

.pHive/epics/hive-composability-audit/docs/recommendation.md:302
> **Hive is to be directed.** Hive provides composable substrate — atomic skills, workflow primitives, memory architecture, adapter ABI, sandbox substrate — under user (or external orchestrator) direction. Discipline + composability are co-equal differentiators.

.pHive/epics/hive-composability-audit/docs/recommendation.md:306
1. **Composability and discipline are co-equal.** Mattpocock posture *"we don't impose"* is closer to right than original audit acknowledged. Hive's differentiator is **disciplined composable substrate** — the discipline (cross-LLM verification gate, governance policies, structured memory, audited workflows) is preserved; the impositions (kickoff-gate paternalism, hard-coded methodology routing, embedded knowledge in massive skill files) are walked back. REFINE-DEEPER removes the impositions while preserving the discipline.

.pHive/epics/hive-composability-audit/docs/recommendation.md:307
2. **Direction is the user's, not Hive's.** *How* Hive provides substrate is open to author-bias correction — Section 2's 36-action plan is precisely that correction. *That* the user directs is the brand-level commitment. This is the inverse of original §5.5: original shipped "Hive directs, user accepts"; reframe ships "user directs, Hive composes."
```

Implication: sandcastle and adapter ABI are brand-coherent under the reframe; they show isolated execution and pluggable trackers; user directs which substrate and which tracker.

## Artifact inventory

Tracked public surfaces carrying old framing:

| Surface | Status | Lines | Hit count | Evidence |
|---|---:|---:|---:|---|
| `README.md` | update | not counted in pre-research | 1 known public hit | `README.md:9` |
| `README.md` | mostly aligned | not counted in pre-research | no rewrite signal in North Star | `README.md:345+` |

Required tracked update evidence:

```text
README.md:9 — hero tagline: `> **A director's chair for the agentic SDLC — disciplined swarms, kickoff to ship.**`
```

Already aligned tracked evidence:

```text
README.md:345+ — `## North Star` section text is ALREADY reframe-aligned ("compose those primitives", "lights-on software factory", "compose-don't-rebuild"). Minimal change needed.
```

Tracked director-mentions that should be left as history:

| Surface | Status | Lines | Hit count | Reason |
|---|---:|---:|---:|---|
| `CHANGELOG.md` | leave | not counted in pre-research | director mentions present | 2.0.0 entry documents the reframe |
| `.pHive/epics/hive-composability-audit/docs/*.md` | leave | not counted in pre-research | director mentions present | audit history |
| `.pHive/epics/structural-refactor-and-gate-lift/epic.yaml` | leave | not counted in pre-research | director mentions present | historical |
| `.pHive/epics/kg-augmented-meta-signal/docs/readme-drift-checklist.md` | leave | not counted in pre-research | director mentions present | historical |

Gitignored brand source:
lives only in `/Users/don/Documents/plugin-hive` worktree at `.pHive/brand/`.

| Surface | Status | Lines | Hit count | Evidence |
|---|---:|---:|---:|---|
| `.pHive/brand/vision.md` | update | 102 | 5 | director's chair on lines 9, 11, 27, 30, 31 |
| `.pHive/brand/brand-system.yaml` | update | 212 | 4 | director's chair on lines 15, 37, 153, 168 |
| `.pHive/brand/brand-guide.html` | update | 1,468 | 7 | director's chair on lines 662, 702, 879, 882, 885, 1403, 1414 |
| `.pHive/brand/value-prop.md` | likely leave | 133 | 0 | grep clean for director/chair |

Gitignored related surfaces:

| Surface | Status | Lines | Hit count | Evidence |
|---|---:|---:|---:|---|
| `.pHive/brand/launch-blog.md` | audit in design phase | not counted in pre-research | unknown | may carry old voice statements |
| `.pHive/brand/oss-rollout-playbook.md` | audit in design phase | not counted in pre-research | unknown | may carry old voice statements |
| `.pHive/brand/flayr-campaign-brief.md` | audit in design phase | not counted in pre-research | unknown | may carry old voice statements |
| `.pHive/brand/show-hn-comment.md` | audit in design phase | not counted in pre-research | unknown | may carry old voice statements |

Auto-memory surface:

| Surface | Status | Lines | Hit count | Evidence |
|---|---:|---:|---:|---|
| `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_oss_rollout_brand.md` | update | not counted in pre-research | 1 known locked-decision hit | `Vision tagline: "A director's chair for the agentic SDLC..."`; `REFRAME PENDING` note already exists |

Memo constraint:
brand artifacts are intentionally gitignored.
Pattern is:
`For consumer-facing assets needing tracking, copy from .pHive/brand/ to assets/.`

## What changes

`README.md`: revise the hero tagline at `README.md:9`; leave `README.md:345+` mostly intact unless design review finds a small consistency issue.

`~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_oss_rollout_brand.md`: revise the locked-decision positioning memo, resolve the existing `REFRAME PENDING` note, and preserve unrelated locked decisions.

`.pHive/brand/vision.md`: revise sections carrying old positioning at lines 9, 11, 27, 30, and 31; design phase should decide whether current-stance-versus-destination framing still works.

`.pHive/brand/brand-system.yaml`: revise positioning fields at lines 15 and 37, voice statement at line 153 only where it carries old positioning, and house language at line 168 only where it carries old positioning; preserve schema shape unless design phase finds a direct field-level need.

`.pHive/brand/brand-guide.html`: revise sections at lines 662, 702, 879, 882, 885, 1403, and 1414; audit body copy around `Every builder a director` at lines 879-885; keep visual identity, token usage, layout intent, and proof-of-shipping narrative unless directly contradicted by the reframe.

`.pHive/brand/value-prop.md`: no required director/chair update from current grep evidence; leave unless design-phase coherence review finds indirect positioning drift.

Related launch surfaces: audit `launch-blog.md`, `oss-rollout-playbook.md`, `flayr-campaign-brief.md`, and `show-hn-comment.md` for old voice statements; only update if they carry old positioning.

Historical audit surfaces: leave unchanged; they document the decision path.

## What stays

Brand name stays: Hive, locked 2026-04-30.

Logo stays: Concept 4, Hex with Adjacent Cells Forming, locked 2026-04-30.

Co-brand stays: Concept 5, firefly-in-hex.

Color palette stays: Firefly plus Hive White.

Typography stays: Montserrat plus JetBrains Mono.

Voice cadence stays: builder-to-builder; postmortem-cadenced; generous credit; no `"we're excited to announce"` energy.

Scope boundary: positioning alignment only; no name, logo, palette, typography, or voice-cadence refresh.

## Risks

Risk 1:
sub-statements leaning on the director metaphor may survive headline edits; highest known concentration is `brand-guide.html:879-885`.

Risk 2:
old positioning could be removed too broadly; inspirations credit table and Flayr dogfood narrative are likely proof surfaces, not positioning surfaces.

Risk 3:
historical audit records could be accidentally normalized.
Leave-alone surfaces:
`CHANGELOG.md`;
`.pHive/epics/hive-composability-audit/docs/*.md`;
`.pHive/epics/structural-refactor-and-gate-lift/epic.yaml`;
`.pHive/epics/kg-augmented-meta-signal/docs/readme-drift-checklist.md`.

Risk 4:
`vision.md` may need structural judgment, not phrase replacement, because under reframe the current stance itself becomes the substrate.

Risk 5:
tracked and gitignored surfaces may drift; tracked README lives here, while gitignored brand source lives in `/Users/don/Documents/plugin-hive`.

Risk 6:
the reframe could be mistaken for softer discipline; audit §5.5 keeps discipline and composability co-equal.

## Open questions

Q1. Which exact brand-guide sections around `brand-guide.html:879-885` are positioning architecture versus ordinary body copy?

Q2. Should `vision.md` keep current-stance-versus-destination structure under the substrate frame?

Q3. Should related launch surfaces with unknown hit counts be in Epic H execution scope, or only audited after named surfaces align?

Q4. How should gitignored brand source in `/Users/don/Documents/plugin-hive` synchronize back to tracked consumer-facing assets under the copy-to-`assets/` pattern?

Q5. Which invariants need explicit story acceptance criteria so this positioning pass does not become a visual identity refresh?

## Scope class assessment

Provisional scope class: SMALL.

Reason: audit defines Epic H as `≤3 stories`.

Work type: doc-only.

Expected implementation surface: memo, YAML, HTML, and one tracked README tagline.

No code changes, package behavior, external research, or migration logic expected.

Complexity driver: coherence review across brand source, guide copy, and public README.

Blast radius: brand positioning and documentation only.

Primary acceptance risk: overwriting history or visual identity decisions instead of aligning positioning.

Confidence: medium-high.

Reason: the authoritative audit source is readable and explicit; known director/chair hit locations are supplied by orchestrator pre-research; rewrite content remains a design-phase decision.

## References

Primary audit source: `.pHive/epics/hive-composability-audit/docs/recommendation.md:239-241`.

North-Star section: `.pHive/epics/hive-composability-audit/docs/recommendation.md:298-307`.

Epic H source of truth: `.pHive/epics/hive-composability-audit/docs/recommendation.md:405-408`.

Tracked public update: `README.md:9` hero tagline carries old framing.

Tracked public mostly-aligned section: `README.md:345+ — ## North Star`.

Historical tracked leave-alone surfaces: `CHANGELOG.md`; `.pHive/epics/hive-composability-audit/docs/*.md`; `.pHive/epics/structural-refactor-and-gate-lift/epic.yaml`; `.pHive/epics/kg-augmented-meta-signal/docs/readme-drift-checklist.md`.

Gitignored brand source root: `/Users/don/Documents/plugin-hive/.pHive/brand/`.

Brand source inventory: `vision.md` — 102 lines; director's chair on lines 9, 11, 27, 30, 31. `brand-system.yaml` — 212 lines; director's chair on lines 15, 37, 153, 168. `brand-guide.html` — 1,468 lines; director's chair on lines 662, 702, 879, 882, 885, 1403, 1414. `value-prop.md` — 133 lines; no director/chair references found.

Related brand surfaces: `launch-blog.md`; `oss-rollout-playbook.md`; `flayr-campaign-brief.md`; `show-hn-comment.md`.

Auto-memory: `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_oss_rollout_brand.md`.

Memo rule: brand artifacts are intentionally gitignored; for consumer-facing assets needing tracking, copy from `.pHive/brand/` to `assets/`.

Reference-format source: `.pHive/epics/ui-cluster-extract-config-deeper/docs/research-brief.md`.
