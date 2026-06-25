# Plan Node: H/V

Source: `skills/plan/SKILL.md` Phase B2 / H-V planning review, adapted for
the graduated DAG path after `author` has joined research and design outputs.

## Role

Technical-writer. Inspect the authored epic and stories, then decide whether the
horizontal/vertical slicing is safe to auto-pass or should halt for human review.
This node emits only gate signals; it does not rewrite the plan artifacts.

## Inputs

- `epic_dir` (step_output from `author`): repo-root-relative epic directory.

## Task Sequence

### 1. Inspect the authored plan

Read `{epic_dir}/epic.yaml` and every story YAML under `{epic_dir}/stories/`.
Evaluate whether the decomposition is coherent across horizontal concerns and
vertical delivery slices:

- every stated capability is mapped to at least one story
- story dependencies are explicit and acyclic
- slices are independently reviewable and have concrete acceptance criteria
- cross-cutting concerns are routed to either dedicated stories or story-local
  work, not dropped
- no story is so broad that it hides multiple unrelated implementation tracks

### 2. Score confidence

Emit `confidence` as an integer from 0 to 100:

- `90-100`: complete mapping, clear dependencies, small reviewable slices, no
  unresolved decomposition risks
- `80-89`: minor ambiguity remains, but the plan is coherent enough to proceed
  without a human H/V stop on a non-first-run
- `60-79`: material ambiguity, oversized slices, weak dependency ordering, or
  missing cross-cutting routing that should halt for human review
- `0-59`: incomplete or incoherent decomposition; human review required

Emit `first_run` as a boolean. Set it to `true` when there is no prior accepted
plan baseline for this requirement in the available context; otherwise `false`.
First runs intentionally halt even with high confidence.

## Output

Return a JSON object with exactly these keys:

```json
{
  "confidence": 80,
  "first_run": true
}
```

## DAG executor outputs

Under the Multica binding, also write the same values to
`.pHive/dag-outputs/outputs.yaml` in your working copy:

```yaml
confidence: 80
first_run: true
```

`confidence` must be an integer in the inclusive range `0..100`; `first_run`
must be a real boolean, not a string.
