# Step 4b: Scenario Replay

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT proceed if `execute-platform-a` output is absent — this step is gated on worker results
- Do NOT fabricate results — load only from the canonical artifact path via `loadResults`
- Do NOT write to results.yaml — this step is read-only with respect to worker artifacts
- Do NOT pass raw results downstream — emit the structured replay output defined in the CONTRACT section below

## EXECUTION PROTOCOLS

**Mode:** autonomous

Replay the execution results from step-03-worker (execute-platform-a) into a structured summary that the downstream inspector (step-04-inspector / validate-coverage) can consume without re-reading the raw artifact file.

## CONTEXT BOUNDARIES

**Inputs available:**
- `platform_a_results` — output name from step `execute-platform-a` (the raw results.yaml path)
- Story ID and epic ID — from workflow context (used to resolve the canonical artifact path)

**NOT available (do not read or assume):**
- Coverage analysis (not yet done — that is step-04-inspector's job)
- Bug reports (not filed yet — step-05-sentinel)
- Platform-B results (optional, handled separately)

## YOUR TASK

Load and replay the execution results produced by step-03-worker. Validate structural integrity. Emit a `replay_summary` output that validate-coverage can consume directly.

## TASK SEQUENCE

### 1. Resolve the results artifact path

The canonical results file is located at:

```
.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml
```

Derive `{epic-id}` and `{story-id}` from workflow context. Confirm the file exists before loading. If absent:

```
Error: step-04b scenario-replay: results.yaml not found at
  .pHive/test-artifacts/{epic-id}/{story-id}/results.yaml
Worker step (execute-platform-a) must complete before scenario-replay runs.
```

Fail immediately — do not invent or fallback to a partial path.

### 2. Load results via loadResults

Import `loadResults` from `hive/lib/scenarios/load.mjs`:

```javascript
import { loadResults } from 'hive/lib/scenarios/load.mjs';

const { execution_results: er } = loadResults(
  '.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml'
);
```

`loadResults` validates the full `execution_results` envelope on load — if it throws, surface the `.code` and `.message` directly and halt:

```
Error [{code}]: step-04b scenario-replay loader failed — {message}
Artifact path: {filePath}
```

Supported `.code` values: `FILE_NOT_FOUND`, `YAML_PARSE_ERROR`, `VALIDATION_ERROR`.

### 3. Replay test results

Iterate `er.results[]` and produce a structured replay:

```
REPLAY — {er.story_id} @ {er.executed_at}
  platform: {er.platform}
  device:   {er.device}

  RESULTS:
    [pass] {test_id} — {requirement_ref}  ({duration_ms}ms)
    [fail] {test_id} — {requirement_ref}  ({duration_ms}ms)
      error: {error}
    [skip] {test_id} — {requirement_ref}
    ...

  SUMMARY:
    total:    {summary.total}
    passed:   {summary.passed}
    failed:   {summary.failed}
    skipped:  {summary.skipped}
    duration: {summary.total_duration_ms}ms

  ARTIFACTS:
    screenshots: {artifacts.screenshots_dir}
    logs:        {artifacts.logs_dir}
    results:     {artifacts.results_file}
```

Flag any `fail` results prominently — these are the primary inputs for step-05-sentinel.

### 4. Compute replay_status

Derive a single `replay_status` scalar for the downstream inspector:

| Condition | replay_status |
|-----------|--------------|
| `summary.failed == 0` | `all_pass` |
| `summary.failed > 0 && summary.passed > 0` | `partial_pass` |
| `summary.failed > 0 && summary.passed == 0` | `all_fail` |
| `summary.total == summary.skipped` | `all_skipped` |

### 5. Emit replay_summary output

Produce the structured `replay_summary` (this is the output consumed by validate-coverage):

```yaml
replay_summary:
  story_id: "{er.story_id}"
  epic_id: "{er.epic_id}"
  replayed_at: "{ISO 8601 timestamp}"
  platform: "{er.platform}"
  device: "{er.device}"
  replay_status: "{all_pass | partial_pass | all_fail | all_skipped}"
  results:
    - test_id: "{test_id}"
      requirement_ref: "{requirement_ref}"
      status: "pass | fail | skipped"
      duration_ms: {number}
      error: "{error message or null}"
      screenshot: "{path or null}"
  summary:
    total: {number}
    passed: {number}
    failed: {number}
    skipped: {number}
    total_duration_ms: {number}
  failed_test_ids:
    - "{test_id}"   # only entries where status == fail
  artifacts:
    screenshots_dir: "{er.artifacts.screenshots_dir}"
    logs_dir: "{er.artifacts.logs_dir}"
    results_file: "{er.artifacts.results_file}"
```

`failed_test_ids` is an empty list when `replay_status == all_pass`. It is the sentinel's primary input for filing bugs.

## OUTPUT CONTRACT (for downstream consumers)

`validate-coverage` (step-04-inspector) consumes `replay_summary` as follows:

| Field | Consumer |
|-------|----------|
| `replay_summary.results[]` | Maps each result to an acceptance criterion via `requirement_ref`; determines coverage status per-AC |
| `replay_summary.summary` | Provides aggregate pass/fail counts for the coverage report |
| `replay_summary.replay_status` | Quick gate: `all_fail` or `all_skipped` → inspector should flag as critical gap before mapping individual criteria |
| `replay_summary.failed_test_ids` | Inspector marks corresponding ACs as having failing tests (partial coverage at best) |

`file-bugs` (step-05-sentinel) consumes `failed_test_ids` and `artifacts.screenshots_dir` from the same object.

## DAG executor outputs (required)

Before finishing, WRITE this step's declared output to
`.pHive/dag-outputs/outputs.yaml` (create the directory) in your working copy,
as a flat `key: value` YAML map. The DAG executor reads this file from your
work_dir and merges it onto this step's output graph so downstream nodes
(`validate-coverage`, `file-bugs`) can consume the value; without it those edges
resolve to nothing and the run fails. This file is gitignored execution scratch —
do not commit it.

```yaml
replay_summary:
  summary:
    total: <int>
    passed: <int>
    failed: <int>
    skipped: <int>
  replay_status: "<all_pass | partial_pass | all_fail | all_skipped>"
  failed_test_ids: [<ids, or empty list>]
  results: [<the per-test result objects you replayed>]
```

Use the concrete values you computed in steps 3–5 (the same structured
`replay_summary` block). Do NOT fabricate `replay_status` — it must derive from
`summary.failed`. Do not omit the key.

## SUCCESS METRICS

- [ ] `results.yaml` loaded without error via `loadResults`
- [ ] All `er.results[]` entries replayed and displayed
- [ ] `replay_status` computed correctly from `summary.failed` / `summary.passed`
- [ ] `replay_summary` emitted with all fields populated
- [ ] `failed_test_ids` accurate (no false positives, no omissions)

## FAILURE MODES

- **Missing artifact:** results.yaml absent because worker did not complete — fail immediately, do not guess a path.
- **Loader error on valid-looking file:** surface `.code` verbatim; the most common cause is a schema mismatch from a worker that wrote non-canonical fields.
- **Empty results array:** `loadResults` rejects an empty `results[]` — this surfaces as `VALIDATION_ERROR` before this step can proceed. Fix the worker output.
- **Fabricating replay_status:** `all_pass` must come from `summary.failed == 0`, not from absence of visible failure output — always check the `summary` block.

## NEXT STEP

**Gating:** `replay_summary` is produced and `replay_status` is set.

**If `replay_status == all_pass`:** proceed to `validate-coverage`.

**If `replay_status == partial_pass` or `all_fail`:** proceed to `validate-coverage` AND surface the failed test count as a pre-inspection warning — the inspector should expect coverage gaps correlated with the failing tests.

**If `replay_status == all_skipped`:** emit warning:
```
Warning: step-04b — all {summary.total} tests were skipped.
validate-coverage will likely report zero coverage. Investigate worker step.
```
Then proceed to `validate-coverage`.

**Next:** Load `hive/workflows/steps/test-swarm/step-04-inspector.md`
