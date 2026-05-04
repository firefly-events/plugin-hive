# Story Spec Schema (minimal)

Story specs are YAML documents at `.pHive/epics/{epic-id}/stories/{story-id}.yaml`.
This reference covers only the fields consumed by executor predicates +
cross-workflow domain routing. The full set of legacy fields
(description, acceptance_criteria, files_to_modify, code_examples,
design_decisions, cross_cutting, complexity, ...) is documented inline
in the planning workflow step files; those fields are passed through
the executor as opaque context and do not require schema enforcement
here.

## metadata

```yaml
metadata:
  needs_backend: bool   # true iff the story requires backend changes
  needs_frontend: bool  # true iff the story requires frontend changes
```

Both default to `false` when absent. Stories may set either, both, or
neither.

### Why these specific booleans

The strict-Archon predicate grammar
(`hive/references/predicate-grammar.md`) only resolves
`$<node-id>.<field-path>` against an output graph. There is no
`$story.metadata.X` form. Story-domain routing therefore happens via
booleans materialised onto a node's `outputs` map at the start of the
workflow (typically `preflight` in `development.classic`), and the
predicates address `$preflight.output.needs_backend == true` etc.

This pre-computation is also a hedge against the grammar's `contains`
omission: a single boolean is decidable; "story domain list contains
backend" is not.

### Where they're consumed

- `development.classic.workflow.yaml` — the `backend-implement` and
  `frontend-implement` nodes use `when:` predicates that resolve to
  these booleans (after `preflight` materialises them).

### How to set them in a story

```yaml
# .pHive/epics/{epic-id}/stories/{story-id}.yaml
id: my-story
title: Something
metadata:
  needs_backend: true
  needs_frontend: true
acceptance_criteria:
  - ...
```

### Migration

Stories that pre-date this schema have neither field. Workflow nodes
that gate on these booleans treat the missing-field case as `false`
(predicate evaluator's fail-closed semantics). For development.classic
that means a story without metadata produces NO implementation —
authors should set at least one of the two booleans on every story
that flows through development.classic post-cutover.
