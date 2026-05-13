---
project: ui-cluster-extract-config-deeper
date: 2026-05-12
source_findings: .pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md
primary_inputs:
  - .pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md
  - .pHive/epics/hive-composability-audit/docs/recommendation.md
  - .pHive/episodes/hive-composability-audit/s4-synthesis-recommendation/next-epics.yaml
---

# Research Brief: UI Cluster Extract Config Deeper

## Executive summary

The composability audit explicitly left D2 only partially resolved: the UI ceremony cluster still repeats `spawn ui-designer with embedded prompt` across multiple skills, and the Mattpocock posture says the shared primitive is the ui-designer task prompt rather than each ceremony shell.
Epic B W6 already shipped the first layer of the pattern by extracting `brand-system` schema data to `hive/references/brand-system-schema.yaml`, extracting `design-system` token spec data to `hive/references/design-token-spec.md`, and collapsing `ui-audit` into `design-review --artifact-target implementation`.
What remains is not schema extraction; it is prompt-body extraction from the current direct ui-designer task blocks in `skills/brand-system/SKILL.md`, `skills/design-system/SKILL.md`, `skills/polish-audit/SKILL.md`, and `skills/visual-qa/SKILL.md`.
Research also found two additional ui-designer workflow task blocks in `hive/workflows/design-review.workflow.yaml` if the ui-audit replacement is counted as still inside the D2 surface.
The destination directory `hive/references/ui-prompts/` does not exist today, so Epic F must establish the convention before reducing SKILL bodies.
The work is bounded: the audit defines Epic F as `<=4` stories and the codebase evidence is markdown/YAML-only.
Confidence is high because all evidence is local and source-controlled; no external package or library behavior is involved.

## Context

D2 sits in the audit's explicit dissent section, not in ordinary backlog grooming.
The audit names it as a place where Hive plausibly loses to Mattpocock posture: `.pHive/epics/hive-composability-audit/docs/recommendation.md:290`.

Audit Section 7 places the follow-on as conditional/post-2.0 Epic F:
`.pHive/epics/hive-composability-audit/docs/recommendation.md:395`.

The recommendation doc says 2.0 ships with CWC 2026 A-group, Epic A, Epic B, and Epic C merged; conditional epics D/E/F are post-2.0 follow-ons:
`.pHive/epics/hive-composability-audit/docs/recommendation.md:359`.

The YAML definition agrees on the Epic F purpose and gate:
`.pHive/episodes/hive-composability-audit/s4-synthesis-recommendation/next-epics.yaml:62`.

The YAML file uses the earlier dependency name `structural-refactor-and-uncouple`, while the final recommendation uses `structural-refactor-and-gate-lift`.
Treat the final recommendation document as the superseding audit artifact because it records the 2026-05-08 post-user-review scope expansion.

Mattpocock posture framing:
the D2 resolution is to atomize the ui-designer prompt as the shared primitive, not to keep repeating embedded task blocks inside each skill shell.

## Cluster surface

Requested path note:
the requested `skills/hive/skills/<name>/SKILL.md` paths do not exist.
Current files are top-level `skills/<name>/SKILL.md`, except `ui-audit`, which has been removed.
This matches the research finding at `.pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md:3`.

| Cluster member | Current path | Lines | W6 status | ui-designer prompt blocks |
|---|---:|---:|---|---:|
| brand-system | `skills/brand-system/SKILL.md` | 109 | W6 config extracted | 1 direct block, `skills/brand-system/SKILL.md:32` |
| design-system | `skills/design-system/SKILL.md` | 89 | W6 config extracted | 1 direct block, `skills/design-system/SKILL.md:42` |
| ui-audit | absent; collapsed into `skills/design-review/SKILL.md` | N/A | W6 collapsed | 0 direct SKILL blocks; 2 workflow blocks if replacement counted |
| polish-audit | `skills/polish-audit/SKILL.md` | 162 | not yet extracted | 1 direct block, `skills/polish-audit/SKILL.md:85` |
| visual-qa | `skills/visual-qa/SKILL.md` | 128 | not yet extracted | 1 direct block, `skills/visual-qa/SKILL.md:49` |

Direct prompt block count:
4 current direct ui-designer prompt blocks across 4 SKILL files, per `.pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md:246`.

Expanded D2 surface:
6 ui-designer prompt/task blocks across 5 files if `hive/workflows/design-review.workflow.yaml:54` and `hive/workflows/design-review.workflow.yaml:86` are included as the ui-audit replacement, per `.pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md:248`.

Known missing destination:
`hive/references/ui-prompts/` does not exist, per `.pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md:252`.

## Thin-invocation precedent

Epic B W6 established that procedural SKILLs should keep invocation flow while moving reusable config/spec content into `hive/references/`.

Acceptance criteria excerpt:

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:27
acceptance_criteria:
  - "hive/references/brand-system-schema.yaml exists with the canonical YAML schema"
  - "skills/brand-system/SKILL.md inline schema block (~100 lines) replaced with citation: 'See hive/references/brand-system-schema.yaml for the canonical schema.'"
  - "Net line delta on skills/brand-system/SKILL.md is >=-85 lines"
  - "ui-designer task still produces .pHive/brand/brand-system.yaml conforming to the same schema"
```

Sibling acceptance criteria excerpt:

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:23
acceptance_criteria:
  - "hive/references/design-token-spec.{md|yaml} exists with the W3C token spec"
  - "skills/design-system/SKILL.md inline W3C spec block replaced with citation"
  - "Net line delta on skills/design-system/SKILL.md is >=-50 lines"
  - "ui-designer task still produces W3C-format JSON tokens conforming to the same spec"
```

Canonical current structure excerpt:

```text
skills/brand-system/SKILL.md:36
**Part 1: brand-system.yaml (required)**

See hive/references/brand-system-schema.yaml for the canonical schema. Produce a structured brand system conforming to that schema and write it to .pHive/brand/brand-system.yaml.

Derive colors from the project context (existing code, product name, industry, user-provided hints). If no hints are given, establish a professional, accessible palette with all four WCAG-compliant roles (primary, secondary, neutral, surface).
```

Canonical current structure excerpt:

```text
skills/design-system/SKILL.md:43
Read .pHive/brand/brand-system.yaml.

Convert it to W3C Design Token format JSON and write to .pHive/brand/tokens.json.

See hive/references/design-token-spec.md for the canonical W3C Design Token spec. Produce W3C-format JSON tokens at .pHive/brand/tokens.json conforming to that spec.
```

The precedent is thin invocation by citation, not full consolidation into one UI ceremony skill.
`a-11-ui-audit-collapse` is the separate consolidation precedent: `skills/ui-audit/SKILL.md` was deleted, and `skills/design-review/SKILL.md` gained `--artifact-target {design|implementation}` mode support.
See `.pHive/epics/structural-refactor-and-gate-lift/stories/a-11-ui-audit-collapse.yaml:26`.

Collapse acceptance criteria excerpt:

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-11-ui-audit-collapse.yaml:37
acceptance_criteria:
  - "skills/ui-audit/SKILL.md removed"
  - "skills/design-review/SKILL.md accepts --artifact-target {design|implementation} flag (default: design)"
  - "When --artifact-target=implementation, design-review runs the audit-mode workflow (gate on .pHive/project-profile.yaml, target implementation)"
  - "When --artifact-target=design, design-review runs current behavior (gate on design briefs OR brand system, target design artifacts)"
```

## D2 dissent quote

```text
.pHive/epics/hive-composability-audit/docs/recommendation.md:290
**D2. UI ceremony cluster repeats `spawn ui-designer with embedded prompt` 5+ times.** Mattpocock posture would say: collapse the 5 into 1 ceremony skill OR atomicize the ui-designer prompt. Section 2 actions A-08/A-09/A-11 (W6) cover 3 of 5; deeper extract-config-the-prompts question is open. **Partially-addressed dissent.** See Section 7 — Next epics for the unaddressed remainder.
```

Expanded architect framing from the raw findings:

```text
.pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md:230
**D2. UI ceremony cluster repeats `spawn ui-designer with embedded prompt` 5+ times.** Brand-system, design-system, ui-audit, polish-audit, visual-qa, design-review repeat the same shape. Researcher §3.2 + matrix §3 flagged. Mattpocock posture would say: collapse the 5 into 1 ceremony skill with sub-modes OR atomicize the ui-designer prompt as the real shared primitive. Architect leans toward the second (extract ui-designer prompts to `references/ui-prompts/`, reduce each skill to a thin invocation). Section 2 actions A-08/A-09/A-11 (W6) cover 3 of the 5; the deeper extract-config-the-prompts question is open. Section 5 acknowledges this as **partially-addressed dissent** (posture-check §6.4 item 2).
```

## Persona vs prompt boundary

`hive/agents/ui-designer.md:32` defines the stable persona: visual design agent, user advocacy, clarity, accessibility, and intuitive interaction.

`hive/agents/ui-designer.md:43` makes the boundary explicit:
step files tell the agent how to execute, while the persona tells the agent who it is.

Cluster SKILL prompt blocks are invocation-specific task content:
brand creation at `skills/brand-system/SKILL.md:32`, token conversion at `skills/design-system/SKILL.md:42`, polish synthesis at `skills/polish-audit/SKILL.md:85`, and fidelity comparison at `skills/visual-qa/SKILL.md:49`.

This supports leaving `hive/agents/ui-designer.md` unchanged unless a future story finds actual skill-specific prompt text inside the persona file.

## Validation status and confidence

Validation type:
codebase-only.

External research:
not needed.

Context7:
N/A; this is markdown/YAML skill and reference structure, not third-party library usage.

Confidence:
high.

Reason:
the requested source files were read directly, the current SKILL paths and line counts were verified, and the open questions are copied from the researcher's Section G rather than invented.

## Open questions

Q1. Recommendation: Decide whether `references/ui-prompts/` stores one file per skill or one aggregate file with named sections.

Q2. Recommendation: Decide whether prompt paths follow `ui-prompts/<skill-name>.md` or `<skill-name>/ui-prompt.md`.

Q3. Recommendation: Decide whether `hive/agents/ui-designer.md` remains unchanged or loses any prompt-like content during extraction.

Q4. Recommendation: Decide whether `design-review.workflow.yaml` ui-designer tasks are in Epic F scope as the ui-audit replacement.

Q5. Recommendation: Decide whether brand-system and design-system count as already thin enough for SKILL-body reduction or still need prompt-body extraction.

Q6. Recommendation: Decide whether extracted prompts are loaded directly by SKILL files or routed through workflow/agent-spawn conventions.

Q7. Recommendation: Decide whether polish-audit always invokes ui-designer or supports a non-ui-designer mode.

Q8. Recommendation: Decide whether extracted prompt files should preserve exact current markdown/task text or normalize report formats across the cluster.
