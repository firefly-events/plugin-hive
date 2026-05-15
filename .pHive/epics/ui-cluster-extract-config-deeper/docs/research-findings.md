## Section A — Cluster current state

Path check: the requested `skills/hive/skills/<name>/SKILL.md` files do not exist for any of the five cluster names; current top-level paths are under `skills/<name>/SKILL.md`, except `ui-audit`, which has been removed.

Surface inventory:

| Cluster member | Current file path | Total line count | Approximate breakdown | Status |
|---|---:|---:|---|---|
| brand-system | `skills/brand-system/SKILL.md` | 109 | invocation logic: ~38 lines; ui-designer prompt content: ~34 lines; inline config: ~2 citation lines plus HTML guide requirements | Epic B W6 extracted ✓ |
| design-system | `skills/design-system/SKILL.md` | 89 | invocation logic: ~45 lines; ui-designer prompt content: ~16 lines; inline config: ~2 citation lines plus preview requirements | Epic B W6 extracted ✓ |
| ui-audit | absent; collapsed into `skills/design-review/SKILL.md` and `hive/workflows/design-review.workflow.yaml` | N/A current; story cites deleted 185-line file | direct SKILL absent; replacement has target-selection logic plus workflow tasks | Epic B W6 extracted ✓ |
| polish-audit | `skills/polish-audit/SKILL.md` | 162 | invocation logic: ~55 lines; animations prompt: ~26 lines; ui-designer prompt content: ~31 lines; inline config/report format: ~21 lines | not yet extracted |
| visual-qa | `skills/visual-qa/SKILL.md` | 128 | invocation logic: ~40 lines; ui-designer prompt content: ~49 lines; inline config/report format: ~22 lines | not yet extracted |

Current path evidence:

```text
skills/brand-system/SKILL.md:22
### 1. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full. This is the agent you will spawn. The persona includes Frame0 CLI reference, tool discovery protocol, and output format.

### 2. Spawn ui-designer for brand creation

Spawn a subagent with the full ui-designer persona and this task:
```

```text
skills/design-system/SKILL.md:34
### 2. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full.

### 3. Spawn ui-designer for token generation

Spawn a subagent with the full ui-designer persona and this task:
```

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-11-ui-audit-collapse.yaml:26
  Outcome:
    - skills/ui-audit/SKILL.md DELETED
    - skills/design-review/SKILL.md grows to ~180 lines with new flag + branching for artifact-target
    - References to ui-audit elsewhere (plugin.json marketplace entry, README, hive/GUIDE.md) updated
```

```text
skills/polish-audit/SKILL.md:81
### 5. Step 2 — UI designer synthesis

Spawn a subagent with the full ui-designer persona and this task:
```

```text
skills/visual-qa/SKILL.md:41
### 2. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full.

### 3. Spawn ui-designer for fidelity comparison

Spawn a subagent with the full ui-designer persona and this task:
```

## Section B — Existing `hive/references/` structure

`hive/references/` currently has 73 top-level entries. UI-related reference files present at max depth 3: `hive/references/brand-system-schema.yaml`, `hive/references/design-token-spec.md`, `hive/references/ui-skill-gates.md`, `hive/references/html-preview-format.md`, `hive/references/wireframe-protocol.md`, and document/template references with design-related names.

There is no `hive/references/brand-system/` directory; Epic B W6 landed `hive/references/brand-system-schema.yaml`.

There is no `hive/references/design-system/` directory; Epic B W6 landed `hive/references/design-token-spec.md`.

There is no `hive/references/ui-prompts/` directory.

`a-11-ui-audit-collapse` landed extracted ui-audit pieces in `skills/design-review/SKILL.md` and `hive/workflows/design-review.workflow.yaml`; it did not create a `hive/references/ui-audit/` directory.

Established extracted-config convention from Epic B W6: source SKILL keeps procedural invocation and cites a canonical reference file in `hive/references/`.

```text
skills/brand-system/SKILL.md:36
**Part 1: brand-system.yaml (required)**

See hive/references/brand-system-schema.yaml for the canonical schema. Produce a structured brand system conforming to that schema and write it to .pHive/brand/brand-system.yaml.
```

```text
skills/design-system/SKILL.md:45
Convert it to W3C Design Token format JSON and write to .pHive/brand/tokens.json.

See hive/references/design-token-spec.md for the canonical W3C Design Token spec. Produce W3C-format JSON tokens at .pHive/brand/tokens.json conforming to that spec.
```

```text
hive/references/ui-skill-gates.md:1
# UI Skill Gates Reference

Centralized gate specification for UI skills. Each skill's `SKILL.md` references this document rather than re-specifying gate logic inline.
```

## Section C — ui-designer persona vs prompts

Persona-defining sections in `hive/agents/ui-designer.md`: frontmatter identity/tools/domain, "You are..." identity, "What you do", step-file rule, tool discovery protocol, Frame0 quick-reference, expertise, quality standards, planning scale call, marketing assets, output format, insight capture, shutdown readiness.

Prompt-content sections in cluster SKILLs are the task blocks that tell ui-designer what to do for one specific skill invocation.

Persona evidence:

```text
hive/agents/ui-designer.md:32
You are a visual design agent that creates wireframes, design briefs, and UI specifications. You advocate for the user in every design decision — optimizing for clarity, accessibility, and intuitive interaction.
```

```text
hive/agents/ui-designer.md:43
## Step files

Your wireframe workflow is defined in step files at `hive/workflows/steps/ui-design/`. When the orchestrator spawns you for a UI design task, it loads the relevant step file alongside this persona. The step file tells you HOW to execute; this persona tells you WHO you are.
```

Cluster prompt blocks:

```text
skills/brand-system/SKILL.md:32
**Task for ui-designer:**

You are creating a complete brand system for this project. Your output has two parts:
```

Framing variation: brand-system frames ui-designer as creator of a complete brand system with YAML plus HTML visual guide.

```text
skills/design-system/SKILL.md:43
Read .pHive/brand/brand-system.yaml.

Convert it to W3C Design Token format JSON and write to .pHive/brand/tokens.json.
```

Framing variation: design-system frames ui-designer as converter from brand YAML to W3C token JSON plus preview.

```text
hive/workflows/design-review.workflow.yaml:54
  - id: design-critique
    agent: ui-designer
    task: >
      Review the provided UI artifacts from a UI/UX design perspective.
      Evaluate: visual hierarchy and information architecture, consistency with
      established design patterns and brand system, usability heuristics (Nielsen's 10),
```

```text
hive/workflows/design-review.workflow.yaml:86
  - id: synthesis
    agent: ui-designer
    task: >
      Synthesize all domain critiques into a unified target-aware review verdict.
      Collect findings from: accessibility critique (if run), animations critique
      (if run), and your own design critique. Merge and deduplicate findings.
```

Framing variation: ui-audit no longer has its own SKILL; its replacement frames ui-designer as design critique plus target-aware synthesis inside the design-review workflow.

```text
skills/polish-audit/SKILL.md:86
Synthesize animation and polish opportunities into a polish report.

Animation opportunities from animations-specialist:
{animation_opportunities}

Prior ui-audit verdict (for context): {prior_verdict}
```

Framing variation: polish-audit frames ui-designer as a synthesizer of animation-specialist output into prioritized polish opportunities.

```text
skills/visual-qa/SKILL.md:50
Run a visual QA comparison between the design artifacts and the implementation.

Design artifacts to compare:
{for each brief in scope:}
```

Framing variation: visual-qa frames ui-designer as a fidelity comparator between design artifacts and implementation.

## Section D — Thin-invocation pattern (Epic B W6 substrate)

`a-08-brand-system-extract-config.yaml` and `a-09-design-system-extract-config.yaml` describe "before" as inline config/spec inside ui-designer task prompts and "after" as external reference files with SKILL citations.

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:23
  Extract the brand-system.yaml schema to hive/references/brand-system-
  schema.yaml. Replace the inline block in skills/brand-system/SKILL.md
  with a citation. Net delta target ~-90 lines from the SKILL.md.
```

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:27
acceptance_criteria:
  - "hive/references/brand-system-schema.yaml exists with the canonical YAML schema"
  - "skills/brand-system/SKILL.md inline schema block (~100 lines) replaced with citation: 'See hive/references/brand-system-schema.yaml for the canonical schema.'"
```

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:17
  Same shape as a-08 (sibling story): config data embedded in a
  procedural skill. Extract the W3C token spec to hive/references/
  design-token-spec.md (or .yaml). Replace inline block with citation.
```

```text
.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:23
acceptance_criteria:
  - "hive/references/design-token-spec.{md|yaml} exists with the W3C token spec"
  - "skills/design-system/SKILL.md inline W3C spec block replaced with citation"
```

Confirm/refute statement: confirmed for 3 of 5 cluster members if "thin-invocation pattern + extracted references" includes `brand-system` and `design-system` extracted config plus `ui-audit` collapse into design-review/workflow; not confirmed for ui-designer prompt extraction, because brand-system/design-system still contain direct ui-designer task prompts.

## Section E — D2 dissent quote

D2 dissent in synthesis recommendation:

```text
.pHive/epics/hive-composability-audit/docs/recommendation.md:290
**D2. UI ceremony cluster repeats `spawn ui-designer with embedded prompt` 5+ times.** Mattpocock posture would say: collapse the 5 into 1 ceremony skill OR atomicize the ui-designer prompt. Section 2 actions A-08/A-09/A-11 (W6) cover 3 of 5; deeper extract-config-the-prompts question is open. **Partially-addressed dissent.** See Section 7 — Next epics for the unaddressed remainder.
```

Architect-expanded D2 quote:

```text
.pHive/epics/hive-composability-audit/docs/recommendation-architect-sections.md:154
**D2. UI ceremony cluster repeats `spawn ui-designer with embedded prompt` 5+ times.** Brand-system, design-system, ui-audit, polish-audit, visual-qa, design-review repeat the same shape. Researcher §3.2 + matrix §3 flagged. Mattpocock posture would say: collapse the 5 into 1 ceremony skill with sub-modes OR atomicize the ui-designer prompt as the real shared primitive. Architect leans toward the second (extract ui-designer prompts to `references/ui-prompts/`, reduce each skill to a thin invocation). Section 2 actions A-08/A-09/A-11 (W6) cover 3 of the 5; the deeper extract-config-the-prompts question is open. Section 5 acknowledges this as **partially-addressed dissent** (posture-check §6.4 item 2).
```

Epic F anchor:

```text
.pHive/epics/hive-composability-audit/docs/recommendation.md:395
**Epic F — `ui-cluster-extract-config-deeper`** (≤4 stories) — **D2 partial-resolution follow-on** (unchanged letter)
- **Scope:** extract ui-designer prompts to `references/ui-prompts/`; reduce brand-system / design-system / polish-audit / visual-qa to thin invocations. Resolves D2 dissent fully.
```

## Section F — Outstanding work scope

Cluster SKILLs needing thin-invocation reduction: 2 of 5 confirmed for SKILL-body reduction (`skills/polish-audit/SKILL.md`, `skills/visual-qa/SKILL.md`); brand-system and design-system already had config/spec extraction but still contain direct ui-designer prompts; ui-audit has no current SKILL file.

Distinct direct ui-designer prompt blocks in current cluster SKILL files: 4 blocks across 4 files: `skills/brand-system/SKILL.md:32-67`, `skills/design-system/SKILL.md:42-58`, `skills/polish-audit/SKILL.md:85-115`, `skills/visual-qa/SKILL.md:49-97`.

Additional ui-audit replacement prompt blocks: 2 workflow tasks across 1 file: `hive/workflows/design-review.workflow.yaml:54-84` and `hive/workflows/design-review.workflow.yaml:86-117`.

Total prompt blocks touching the D2 cluster surface if the ui-audit replacement is included: 6 distinct ui-designer prompt/task blocks across 5 files.

Known absent destination: `hive/references/ui-prompts/` does not exist.

Cross-cutting substrate observed: `skills/design-review/SKILL.md` invokes `hive/workflows/design-review.workflow.yaml` steps and passes workflow `task` content to spawned agents; direct SKILLs embed task prompts inline.

```text
skills/design-review/SKILL.md:95
Execute `hive/workflows/design-review.workflow.yaml` steps in order. For each step that is
NOT skipped, spawn a subagent with the full persona, the step `task`, `artifact_target`,
target-specific `artifact_paths` passed as `design_artifacts`, target-specific verdict
vocabulary, implementation `tech_stack` context when available, and prior step outputs.
```

```text
skills/brand-system/SKILL.md:28
Spawn a subagent with the full ui-designer persona and this task:
```

```text
skills/polish-audit/SKILL.md:83
Spawn a subagent with the full ui-designer persona and this task:
```

## Section G — Open questions

Q1. Recommendation: Decide whether `references/ui-prompts/` stores one file per skill or one aggregate file with named sections.

Q2. Recommendation: Decide whether prompt paths follow `ui-prompts/<skill-name>.md` or `<skill-name>/ui-prompt.md`.

Q3. Recommendation: Decide whether `hive/agents/ui-designer.md` remains unchanged or loses any prompt-like content during extraction.

Q4. Recommendation: Decide whether `design-review.workflow.yaml` ui-designer tasks are in Epic F scope as the ui-audit replacement.

Q5. Recommendation: Decide whether brand-system and design-system count as already thin enough for SKILL-body reduction or still need prompt-body extraction.

Q6. Recommendation: Decide whether extracted prompts are loaded directly by SKILL files or routed through workflow/agent-spawn conventions.

Q7. Recommendation: Decide whether polish-audit always invokes ui-designer or supports a non-ui-designer mode.

Q8. Recommendation: Decide whether extracted prompt files should preserve exact current markdown/task text or normalize report formats across the cluster.
