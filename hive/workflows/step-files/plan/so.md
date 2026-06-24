# Plan Node: Structured Outline

Source: `skills/plan/SKILL.md` Phase B3 / structured-outline review, adapted
for the graduated DAG path after `author` has produced the epic and stories.

## Role

Technical-writer. Inspect the authored epic and stories for remaining structural
questions before the plan proceeds to reconcile and output validation. This node
emits only gate signals; it does not rewrite the plan artifacts.

## Inputs

- `epic_dir` (step_output from `author`): repo-root-relative epic directory.

## Task Sequence

### 1. Inspect outline completeness

Read `{epic_dir}/epic.yaml` and every story YAML under `{epic_dir}/stories/`.
Identify unresolved questions that would make the plan unsafe to proceed without
human review. Treat these as open questions:

- missing or contradictory acceptance criteria
- unclear story dependency ordering
- unresolved implementation boundary choices
- missing file ownership for required changes
- cross-cutting concern routing that is absent or ambiguous
- risks that require an explicit human decision before execution

Do not include cosmetic notes or implementation preferences as open questions.

### 2. Emit machine-readable gate signals

Emit `open_questions` as a list of concise strings. Emit
`open_questions_count` as the integer length of that list. The companion integer
is required because the predicate grammar forbids function calls such as
`len(open_questions)`.

Emit `first_run` as a boolean. Set it to `true` when there is no prior accepted
plan baseline for this requirement in the available context; otherwise `false`.
First runs intentionally halt even when `open_questions_count` is zero.

## Output

Return a JSON object with exactly these keys:

```json
{
  "open_questions": [],
  "open_questions_count": 0,
  "first_run": true
}
```

## DAG executor outputs

Under the Multica binding, also write the same values to
`.pHive/dag-outputs/outputs.yaml` in your working copy:

```yaml
open_questions: []
open_questions_count: 0
first_run: true
```

`open_questions` must be a list of strings, `open_questions_count` must be an
integer matching the list length, and `first_run` must be a real boolean, not a
string.
