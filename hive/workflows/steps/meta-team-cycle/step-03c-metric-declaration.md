> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 03c: Metric Declaration

## Purpose

Apply the `metrics` cross-cutting concern (per `.pHive/cross-cutting-concerns.yaml`) to every proposal that step-03 approved, so each proposal carries a falsifiable `metric:` block — or an explicit `applies: false` opt-out with a justified one-line reason — before any implementation work begins. This is the per-cycle analog of `/plan` SKILL step 14/14a (see cross-reference §0 below): the proposal is the unit-of-work, and a proposal without a measurable claim (or a defensible opt-out) is not eligible to advance to step-04 implementation.

**Gate mode (default: blocking).** Read `meta_optimize.metric_gate` from `hive.config.yaml` before enrichment begins:
- `blocking` (default): proposals that fail the §4 gate receive `status: rejected_metric_gate` and are excluded from `enriched_proposals` handed to step-04. The cycle continues with the passing subset. Cycle-level failure occurs only when zero proposals pass. Rejected proposals are surfaced in the step summary and in the step-07 PR body under "Rejected by metric gate".
- `advisory`: the legacy non-blocking behavior — gate failures are reported in the step summary but every proposal (including failing ones) passes through to step-04; the user/orchestrator decides whether to proceed with gaps.

## When this step runs

This step runs after step-03-proposal and before step-04-implementation. It is wired via the `/meta-optimize` SKILL routing (`skills/hive/skills/meta-optimize/SKILL.md`) and the workflow YAML (`hive/workflows/meta-team-cycle.workflow.yaml`); the workflow `depends_on: [proposal]` and `implementation` reads `enriched_proposals` from this step's output.

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- This step is additive enrichment only — do not drop, re-rank, or rewrite proposals from step-03
- Surface the `metrics` concern's `planning_prompt` verbatim when evaluating each proposal (do not paraphrase)
- Every emitted proposal MUST carry exactly one of: full `metric:` block (`applies: true`), `metric: {applies: false, justification: "<one-line reason>"}`, or `un-falsifiable: true` tag (last is reserved — see §5 below)
- Apply the M-03 / `/plan` step 14a review-gate rules verbatim: reject one-word justifications (`N/A`, `none`, `-`, `pending`, `TBD`, `not applicable`); reject `verify_at` values of `"eventually"`, `"someday"`, or empty
- Read `meta_optimize.metric_gate` from `hive.config.yaml` (blocking | advisory; default `blocking`) before enrichment begins — this determines whether gate failures exclude proposals from step-04 or are advisory-only
- When `metric_gate: blocking` (default): a failed gate marks the proposal `status: rejected_metric_gate` and removes it from the `enriched_proposals` output; the cycle continues with passing proposals; cycle failure only when zero proposals pass
- When `metric_gate: advisory`: gate failures are reported but all proposals pass through to step-04 (legacy behavior)
- Mirror the canonical `metric:` shape from `hive/references/story-yaml-schema.md` §3.1 exactly — no field renames, no additions

## EXECUTION PROTOCOLS

**Mode:** autonomous

Read each `approved_proposals[*]` entry, apply the metrics-concern `planning_prompt`, write a `metric:` block onto each entry, then emit the enriched set as `enriched_proposals` for step-04 to consume.

## CONTEXT BOUNDARIES

**Inputs available:**
- `approved_proposals` from step-03 (workflow output)
- `cycle_id` from step-01 (for summary scoping)
- `.pHive/cross-cutting-concerns.yaml` — read the `metrics` concern (id: `metrics`) verbatim; surface its `planning_prompt`, do not synthesize a new one
- `hive/references/story-yaml-schema.md` §3 — canonical `metric:` block shape; do NOT deviate
- `.pHive/metrics/metrics-event.schema.md` — referenced when `metric.source.kind: events`
- `.pHive/metrics/experiment-envelope.schema.md` — referenced when `metric.source.kind: envelope` or `envelope_id` is present

**NOT available:**
- User input (autonomous step)
- Authority to drop or re-rank approved proposals (that is step-03's job)
- Authority to mutate the metrics concern's `planning_prompt` or `applies_when` clause

## YOUR TASK

For each proposal in `approved_proposals`, evaluate the `metrics` concern's `applies_when` clause, surface its `planning_prompt`, and enrich the proposal record with the canonical `metric:` block (or a defensible opt-out). Validate every block against the M-03 step-14a review gate and emit `enriched_proposals` plus a per-cycle summary.

## TASK SEQUENCE

### 0. Read gate mode and cross-reference

Read `meta_optimize.metric_gate` from `hive.config.yaml`. If the key is absent, default to `blocking`. Record the resolved mode; it governs §4 gate enforcement throughout this step.

**Cross-reference — /plan §14a drift risk acknowledged.** This step's gate rules mirror `/plan` SKILL.md step 14a verbatim (same field list, same reject tokens, same `verify_at` constraints). Any future update to `/plan` §14a MUST be reflected here and vice-versa. See `.pHive/epics/meta-improvement-reset/docs/design-discussion.md` §3.3 for the design rationale and `hive/workflows/steps/meta-team-cycle/step-03c-metric-declaration.md` as the cross-cutting enforcement point.

### 1. Load the metrics concern

- Read `.pHive/cross-cutting-concerns.yaml` and locate the entry with `id: metrics`.
- Capture its `applies_when` clause and `planning_prompt` text verbatim — these are the per-proposal evaluation prompts. Do not paraphrase.
- If the concern file is missing or the `id: metrics` entry is absent: log a warning and emit `enriched_proposals` equal to `approved_proposals` (no enrichment, no gate failures). This step degrades gracefully when the concern catalog is unavailable; downstream steps should not block on this case.

### 2. For each approved proposal: apply `applies_when`

For each `approved_proposals[i]`:

- Evaluate the metrics-concern `applies_when` text against the proposal's `title`, `rationale`, `implementation_plan`, and `charter_objective`. The clause text describes the trigger ("Story claims to improve, reduce, accelerate, or otherwise change a measurable outcome..."); apply it to proposal-shaped objects rather than story-shaped objects, mapping `description` → `rationale` and `implementation_plan` to the story's `steps` shape.
- If `applies_when` is FALSE (pure-substrate proposal — e.g., schema doc, planner-prompt edit, gitignored config seeding): assign `metric: { applies: false, justification: "<one-line reason that names the substrate kind or explains why the proposal has no observable surface>" }`. Move to step 3.
- If `applies_when` is TRUE: continue to step 2a.

#### 2a. Surface the `planning_prompt` (applies:true branch)

Surface the metrics concern's `planning_prompt` verbatim alongside the proposal's title and rationale. The prompt is the four trend/claim questions:
- what number moves (`metric.name` + `metric.direction`)
- by how much (`metric.baseline` + `metric.target`)
- in what window (`metric.window`)
- measured how (`metric.source.kind` + `metric.source.ref`, plus `metric.envelope_id` when `source.kind: envelope`)

Resolve each answer from the proposal's `rationale`, `implementation_plan`, and (when applicable) the relevant epic-level metric envelope under `.pHive/metrics/experiments/`. If the answer for any field is genuinely indeterminate from the proposal record, choose between:
- emitting a best-effort `metric:` block with `baseline: null` (the schema permits null baselines per §3.2.5) and a documented `source.kind: manual` + concrete `source.ref` recipe, OR
- routing the proposal to the `un-falsifiable: true` branch (§5 below) — reserved for proposals whose effect is genuinely unmeasurable (not merely "I have not been given the numbers"). Default lean: prefer the `manual` recipe, since most cycle work IS measurable given a one-shot read.

### 3. Write the `metric:` block onto the proposal record

Conform the emitted block to `hive/references/story-yaml-schema.md` §3.1 verbatim. Two shapes:

**applies: true:**

```yaml
metric:
  applies: true
  name: string                # dotted, e.g., "meta_team.proposal_pass_rate"
  direction: up | down
  unit: count | ratio | seconds | ms | tokens | bytes | bool | <unit>
  baseline: <number> | null
  target: <number>
  window: string              # "epic-close" | "next-3-cycles" | "7d post-merge" | etc.
  source:
    kind: events | sql | envelope | manual
    ref: string
  envelope_id: string | null  # optional explicit link; use this OR source.kind=envelope, not both
  verify_at: string           # ISO-8601 OR anchored relative form (NOT "eventually")
  owner: string               # agent role on the hook for verification (developer | reviewer | tpm | tester)
```

**applies: false:**

```yaml
metric:
  applies: false
  justification: string       # full sentence referencing proposal content; one-word answers fail §4
```

The block sits at the top level of the proposal object (sibling to `id`, `title`, `discovery_source`, `addresses_findings`, etc.), matching the story-level placement defined in §3 of the schema reference. Do not nest the block inside `rationale` or `cross_cutting`.

### 4. Apply the review gate (mirrors `/plan` step 14a)

For each enriched proposal, validate the `metric:` block before emitting:

- **Required-block presence:** Every proposal has exactly one of `metric.applies: true` or `metric.applies: false` (no missing block, no both-set).
- **When `applies: true`:** `name`, `direction`, `unit`, `target`, `window`, `source.kind`, `source.ref`, `verify_at`, `owner` are all present and non-empty.
  - `direction` is `up` or `down` (case-sensitive).
  - `source.kind` is one of `events | sql | envelope | manual`.
  - `verify_at` is NOT `"eventually"`, `"someday"`, or empty. ISO-8601 timestamps and anchored relative forms (`"story integrate step"`, `"epic close"`, `"first cycle post-merge"`, `"next-3-cycles"`) are accepted.
  - If `source.kind: envelope`: either `source.ref` or `envelope_id` MUST resolve to a file under `.pHive/metrics/experiments/`.
- **When `applies: false`:** `justification` is a full sentence that references proposal content. Reject (gate fails) when the justification is a single word or generic token: `N/A`, `none`, `-`, `pending`, `TBD`, `not applicable`, empty string. Case-insensitive match.

Gate failure enforcement depends on the mode resolved in §0:

- **`blocking` (default):** A failing proposal is assigned `status: rejected_metric_gate` with the specific failing field named (e.g., `metric.verify_at`). It is removed from `enriched_proposals` — step-04 will NOT process it. The cycle continues with all proposals that passed the gate. If ALL proposals fail (zero-pass condition), the cycle itself is marked failed and step-04 is not called. All rejected proposals are recorded in `gate_failures` in the step summary (§6) and surface in the step-07 PR body under "Rejected by metric gate".
- **`advisory`:** Gate failures are recorded under `gate_failures` in the step summary but the proposal remains in `enriched_proposals` and step-04 receives it unchanged. The orchestrator or user decides whether to proceed with gaps or send the proposal back to step-03.

### 5. `un-falsifiable: true` tag (reserved)

For proposals whose effect is genuinely unmeasurable AND for which an `applies: false` justification would not honestly describe the proposal (i.e., the proposal does claim a real outcome, but no carrier exists to read it), add the tag `un-falsifiable: true` at the proposal top level alongside `metric: { applies: false, justification: "<reason carrier absent>" }`.

This tag is informational only. Step-04 ignores it; the step-08 close-step summary surfaces all un-falsifiable proposals so the close summary makes the cohort visible. Use sparingly — most cycle work IS measurable given a one-line manual read; preferring `source.kind: manual` over the un-falsifiable tag keeps the auto-improvement loop honest.

### 6. Emit `enriched_proposals` and the step summary

Workflow output:

```yaml
phase: metric-declaration
enriched_proposals:
  - { proposal object with metric: block (and optional un-falsifiable: true) }
metric_declaration_summary: |
  ## Metric Declaration Summary — Cycle {cycle_id}

  Gate mode: blocking | advisory          # resolved from hive.config.yaml

  Enriched proposals (passed gate): {N}
    applies: true            {N}
    applies: false           {N}
    un-falsifiable: true     {N}

  Rejected by metric gate:  {N}           # 0 when metric_gate: advisory
  {for each rejected proposal}
    proposal-{N}: status=rejected_metric_gate; metric.<field> = <value> ({rule that failed})

  Advisory gate failures:   {N}           # 0 when metric_gate: blocking
  {for each advisory failure}
    proposal-{N}: metric.<field> = <value> ({rule that failed})

  Top declared metrics (applies: true):
    proposal-{N}: <metric.name> ({direction}): <baseline> → <target> over <window>; verify_at=<verify_at>; owner=<owner>

  Cycle outcome: {continuing with N passing proposals | ZERO proposals passed — cycle failed}
```

The summary mirrors the `METRICS:` / `UN-FALSIFIABLE:` / `GATE_FAILURES:` rendering of `/plan` SKILL.md step 18 so that meta-team-cycle output and `/plan` output use the same vocabulary and a reader scanning either knows what they're looking at.

### 7. Persist (optional, mirrors step-03 §6)

Append to `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml`:

```yaml
phase: metric-declaration
metric_gate_mode: blocking | advisory
enriched_proposals:
  - { proposal objects with metric: blocks }         # passing proposals only when blocking
rejected_proposals:                                  # populated only when metric_gate_mode: blocking
  - proposal_id: proposal-{N}
    status: rejected_metric_gate
    field: metric.<field>
    rule: <one of: applies-missing | direction-invalid | source.kind-invalid | verify_at-eventually | verify_at-empty | applies:false-one-word | envelope-unresolved>
metric_gate_failures:                                # advisory failures (metric_gate_mode: advisory only)
  - proposal_id: proposal-{N}
    field: metric.<field>
    rule: <same rule set as above>
```

The persistent record is optional in the sense that the workflow output graph carries `enriched_proposals` directly to step-04; the cycle-state append is for human auditability and for downstream meta-meta-optimize feedback (so the gate's false-positive rate can itself be measured).

## Non-scope

This step does NOT:
- Re-rank or rewrite proposals from step-03 (those decisions are step-03's)
- Modify the metrics concern definition in `.pHive/cross-cutting-concerns.yaml` (read-only)
- Pass rejected proposals to step-04 when `metric_gate: blocking` (rejected proposals are excluded; advisory mode preserves pass-through)
- Write to `.pHive/metrics/events/*.jsonl` or to envelope files (this is declaration, not instrumentation)
- Render an `un-falsifiable: true` tag automatically — the tag is a deliberate choice the step must defend per §5

## Output

Hand step-04 the proposals that passed the metric gate, each carrying a `metric:` block per `hive/references/story-yaml-schema.md` §3. Step-04 reads `enriched_proposals` instead of `approved_proposals` (the workflow YAML's `implementation` step input binds to this step's output, not to step-03's).

When `metric_gate: blocking` (default): `enriched_proposals` contains only proposals that passed §4. Rejected proposals appear in `rejected_proposals` and are NOT forwarded to step-04.

When `metric_gate: advisory`: `enriched_proposals` contains all approved proposals regardless of gate status.

Expected handoff:

```yaml
enriched_proposals:
  - { proposal object with metric: block, optional un-falsifiable: true }
rejected_proposals: [ ... ]     # blocking mode: proposals with status=rejected_metric_gate
metric_declaration_summary: <string summary per §6>
metric_gate_failures: [ ... ]   # advisory mode: failures present but proposals pass through
```

## SUCCESS METRICS

- [ ] Gate mode resolved from `hive.config.yaml → meta_optimize.metric_gate` (default: `blocking`)
- [ ] Metrics concern loaded from `.pHive/cross-cutting-concerns.yaml`; `applies_when` and `planning_prompt` surfaced verbatim
- [ ] Every `approved_proposals[*]` entry enriched with exactly one of `metric.applies: true` or `metric.applies: false`
- [ ] `applies: true` blocks contain all required fields per `hive/references/story-yaml-schema.md` §3.1
- [ ] `applies: false` blocks include a full-sentence `justification` referencing proposal content; one-word answers caught by §4
- [ ] `verify_at` values of `"eventually"`, `"someday"`, or empty are caught by the §4 gate
- [ ] `blocking` mode: gate-failing proposals assigned `status: rejected_metric_gate` and excluded from `enriched_proposals`; cycle continues with passing subset; cycle-level failure only when zero proposals pass
- [ ] `advisory` mode: gate failures recorded in summary; all proposals included in `enriched_proposals` (legacy behavior preserved)
- [ ] Cross-reference to /plan §14a present in §0; drift risk acknowledged

## FAILURE MODES

- `.pHive/cross-cutting-concerns.yaml` absent or `id: metrics` entry missing: log warning, emit `enriched_proposals` = `approved_proposals` unchanged, no gate failures. Do NOT block step-04.
- `approved_proposals` empty: emit `enriched_proposals: []` and `metric_declaration_summary` with all-zero counts. Move to step-04 — implementation will close cycle on its own zero-proposal path.
- Proposal lacks a `rationale` or `implementation_plan` field (malformed step-03 output): emit `metric: { applies: false, justification: "Malformed proposal record (no rationale or implementation_plan); cannot evaluate applies_when." }` plus a gate-failure entry, and continue. Do NOT block the whole step.
- Schema validation failure when shaping a `metric:` block (e.g., `direction` value other than `up|down`): record a gate failure for that proposal with `rule: direction-invalid` (or equivalent), retain whatever fields are valid, emit the proposal with the partial block, and continue. The gate is informative; the step is enrichment-only.

## NEXT STEP

**Gating (blocking mode):** `enriched_proposals` contains only proposals that passed the metric gate. If at least one proposal passes, proceed to step-04. If zero proposals pass, mark the cycle failed and do not call step-04.
**Gating (advisory mode):** `enriched_proposals` contains all approved proposals; gate failures are advisory only.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`
**If enrichment fails:** Report which proposals could not be enriched and why (in the step summary); emit best-effort blocks. In blocking mode, proposals with enrichment errors are treated as gate failures and excluded from step-04.
