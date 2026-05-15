---
epic_id: ui-cluster-extract-config-deeper
branch: "proposed: feat/ui-cluster-extract-config-deeper"
methodology: "proposed: classic"
scale: small-to-medium
date: 2026-05-12
---

# Design Discussion: UI Cluster Prompt Extraction

## 1. Goal

This epic should finish the D2 follow-on by moving reusable ui-designer task prompts out of UI cluster SKILL bodies and into `hive/references/ui-prompts/`.
The target is not a new mega-skill.
The target is the Mattpocock posture named by the audit: atomize the ui-designer prompt as the shared primitive while keeping each SKILL as a thin invocation shell.

Concrete done state:

| Surface | Before | After target |
|---|---|---|
| `skills/brand-system/SKILL.md` | 109 lines; prompt at `skills/brand-system/SKILL.md:32` | thinner SKILL; cites `hive/references/ui-prompts/brand-system.md` |
| `skills/design-system/SKILL.md` | 89 lines; prompt at `skills/design-system/SKILL.md:42` | thinner SKILL; cites `hive/references/ui-prompts/design-system.md` |
| `skills/polish-audit/SKILL.md` | 162 lines; prompt at `skills/polish-audit/SKILL.md:85` | thinner SKILL; cites `hive/references/ui-prompts/polish-audit.md` |
| `skills/visual-qa/SKILL.md` | 128 lines; prompt at `skills/visual-qa/SKILL.md:49` | thinner SKILL; cites `hive/references/ui-prompts/visual-qa.md` |
| `hive/agents/ui-designer.md` | persona and tool protocol | unchanged unless a story finds task-specific prompt text |

If the orchestrator wants full D2 closure including the ui-audit replacement, add `hive/references/ui-prompts/design-review-design-critique.md` and `hive/references/ui-prompts/design-review-synthesis.md` for the workflow tasks at `hive/workflows/design-review.workflow.yaml:54` and `hive/workflows/design-review.workflow.yaml:86`.
That inclusion is the main scope tension.

## 2. What I found

The audit's D2 dissent is explicit:
`.pHive/epics/hive-composability-audit/docs/recommendation.md:290` says the UI ceremony cluster repeats `spawn ui-designer with embedded prompt` and that W6 covered only 3 of 5.

Epic F's audit scope is also explicit:
`.pHive/epics/hive-composability-audit/docs/recommendation.md:395` says to extract ui-designer prompts to `references/ui-prompts/` and reduce `brand-system`, `design-system`, `polish-audit`, and `visual-qa` to thin invocations.

The YAML definition matches the basic Epic F scope and gate:
`.pHive/episodes/hive-composability-audit/s4-synthesis-recommendation/next-epics.yaml:62`.

Epic B W6 is the precedent:
`a-08` extracted brand schema to `hive/references/brand-system-schema.yaml`, and `a-09` extracted the design token spec to `hive/references/design-token-spec.md`.
Both left procedural SKILL invocation in place and replaced inline content with citations.

The ui-designer persona already states the persona-vs-execution boundary:
`hive/agents/ui-designer.md:45` says step files tell HOW to execute and the persona tells WHO the agent is.
That makes `hive/agents/ui-designer.md` a poor place for skill-specific task prompts.

The current direct prompt blocks are:
`skills/brand-system/SKILL.md:32`,
`skills/design-system/SKILL.md:42`,
`skills/polish-audit/SKILL.md:85`,
and `skills/visual-qa/SKILL.md:49`.

The missing convention is the destination:
`hive/references/ui-prompts/` does not exist, per `.pHive/epics/ui-cluster-extract-config-deeper/docs/research-findings.md:252`.

## 3. Proposed approach

- Create one prompt file per skill under `hive/references/ui-prompts/<skill-name>.md`. This chooses the Q1/Q2 option closest to the audit wording and avoids a large aggregate file with hidden named sections.

- Preserve current prompt text first, then only normalize citations where the extracted prompt needs to reference existing files such as `hive/references/brand-system-schema.yaml`, `hive/references/design-token-spec.md`, and `hive/references/html-preview-format.md`. This follows the W6 byte-equivalence posture.

- Reduce `skills/polish-audit/SKILL.md` and `skills/visual-qa/SKILL.md` more aggressively than brand/design because they still contain inline report formats and prompt bodies. The SKILLs should load context, load persona, cite the prompt file, inject variables, spawn ui-designer, and write outputs.

- Leave `hive/agents/ui-designer.md` unchanged. It is persona/tool protocol content, and the source boundary at `hive/agents/ui-designer.md:45` supports keeping prompts outside the persona file.

- Use direct SKILL load for the four direct SKILLs: each SKILL reads the relevant prompt file and passes that content to the ui-designer spawn. Do not introduce a new routing layer unless the design-review workflow is included.

- Keep polish-audit's ui-designer invocation required for this epic. Optional ui-designer mode would be behavior change, not extraction; defer it unless the orchestrator explicitly expands Q7.

## 4. Architecture impacts

New files:
`hive/references/ui-prompts/brand-system.md`,
`hive/references/ui-prompts/design-system.md`,
`hive/references/ui-prompts/polish-audit.md`,
and `hive/references/ui-prompts/visual-qa.md`.

Possible additional files:
`hive/references/ui-prompts/design-review-design-critique.md` and `hive/references/ui-prompts/design-review-synthesis.md` if Q4 includes the ui-audit replacement workflow.

Modified files:
`skills/brand-system/SKILL.md`,
`skills/design-system/SKILL.md`,
`skills/polish-audit/SKILL.md`,
and `skills/visual-qa/SKILL.md`.

Possible modified file:
`hive/workflows/design-review.workflow.yaml` if Q4 is in scope.

Unchanged by default:
`hive/agents/ui-designer.md`.

Pattern established:
UI cluster SKILLs contain gate checks, context loading, persona loading, prompt-reference loading, spawn wiring, output capture, and report writing.
Task instructions live in `hive/references/ui-prompts/`.

Downstream consumers:
the direct `/hive:brand-system`, `/hive:design-system`, `/hive:polish-audit`, and `/hive:visual-qa` commands should behave the same.
Any docs or tests that assert SKILL line counts may need updates.
There is no Epic D coupling.

## 5. Risks

**Medium: prompt drift between SKILLs after extraction.**
Mitigation: preserve current prompt text on first extraction and add clear source comments or headings in each prompt file.

**Medium: conditional invocation could break existing skill behavior.**
Mitigation: keep `polish-audit` ui-designer synthesis required for Epic F; treat optional mode as a later behavior story.

**Medium: reader confusion if persona-vs-prompt split is unclear.**
Mitigation: add a short header to every `hive/references/ui-prompts/*.md` file saying it is task prompt content loaded by a SKILL, not an agent persona.

**Low: design-review workflow scope could expand story count.**
Mitigation: make Q4 an orchestrator decision before story writing; keep the audit-specified four direct SKILLs as the minimum scope.

**Low: extracted files could hide required variables.**
Mitigation: list required placeholders at the top of each prompt file, such as `{animation_opportunities}`, `{prior_verdict}`, `{brief_path}`, and `{story_id}`.

## 6. Dependencies

Epic B W6 must already be merged because it supplies the thin-invocation precedent and the `ui-audit` collapse substrate.

Post-2.0 placement is intentional:
`.pHive/epics/hive-composability-audit/docs/recommendation.md:395` lists Epic F under conditional/follow-on epics.

No Epic D coupling:
sandcastle follow-on work is unrelated to markdown/YAML prompt extraction.

No external dependency:
Context7 is N/A because no library API is being selected.

## 7. Open questions

Q1. Recommendation: one prompt file per skill. Reasoning: W6 used one canonical reference per extracted concern, not one aggregate registry.

Q2. Recommendation: use `hive/references/ui-prompts/<skill-name>.md`. Reasoning: the audit names `references/ui-prompts/` directly, and flat files match `brand-system-schema.yaml` / `design-token-spec.md` simplicity.

Q3. Recommendation: leave `hive/agents/ui-designer.md` unchanged. Reasoning: it is persona/tool protocol, and `hive/agents/ui-designer.md:45` already separates persona from execution instructions.

Q4. Recommendation: decide at orchestrator gate; default minimum scope excludes `design-review.workflow.yaml`, full D2 closure includes it. Reasoning: audit Epic F names four SKILLs, but research found two ui-designer workflow tasks replacing ui-audit.

Q5. Recommendation: still extract brand-system and design-system prompt bodies. Reasoning: W6 extracted config/spec data, but direct task prompts remain at `skills/brand-system/SKILL.md:32` and `skills/design-system/SKILL.md:42`.

Q6. Recommendation: direct SKILL load for direct SKILLs; workflow routing only for design-review if Q4 is included. Reasoning: W6 precedent kept SKILL-local invocation and cited references.

Q7. Recommendation: keep polish-audit always invoking ui-designer. Reasoning: optional synthesis changes behavior; Epic F is extraction, not a mode redesign.

Q8. Recommendation: preserve current markdown/task text first. Reasoning: W6 acceptance criteria emphasized unchanged outputs and equivalent behavior.

## 8. Verification strategy

VERIFICATION PLAN:
  Tools: `wc -l`, `rg`, markdown review, targeted command dry-runs if available
  Platforms: local Hive plugin repository only
  Automated: grep checks that inline prompt headings no longer appear in SKILL bodies and that SKILLs cite `hive/references/ui-prompts/*.md`
  Manual: compare extracted prompt files against original SKILL prompt blocks for content preservation
  Not verifying: external library behavior, because there are no external libraries in scope

Minimum checks:
`rg "Task for ui-designer|Spawn a subagent with the full ui-designer persona and this task" skills/brand-system/SKILL.md skills/design-system/SKILL.md skills/polish-audit/SKILL.md skills/visual-qa/SKILL.md`.

Expected outcome:
SKILLs still spawn ui-designer, but the embedded task block is replaced by prompt-reference loading and citation.

## 9. Scale assessment

SCALE ASSESSMENT:
  Files affected: ~8-10 core files; ~10-12 if design-review workflow is included
  Story count: ~3-4 (audit says <=4)
  Subsystems: SKILL bodies (2-3), references dir convention, persona file
  Migration: required for any consumer of brand/design/polish/visual-qa SKILLs? yes, but behavior-preserving
  Cross-team: none
  Unknowns: Q1-Q8 distilled
  RECOMMENDATION: small | medium | medium-large | large
  RATIONALE: medium. The code changes are small and markdown-only, but the prompt boundary affects four commands and possibly the design-review workflow; `--fast` is appropriate if the orchestrator excludes H/V and keeps Q4 out of scope.

## 10. Team review summary

Placeholder for collaborative review gate.

The orchestrator should review Q4 before user gate because that is the only decision likely to change story count or line count materially.
