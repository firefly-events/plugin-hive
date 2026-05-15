# KG Emit Helper

`hive/lib/kg-emit.js` exports:

```js
emitKgEvent({ subject, predicate, object, sourceEpic, sourceAgent })
emitSupersededEvent({ subject, predicate, priorObject, newObject, sourceEpic, sourceAgent })
```

Parameters:

- `subject`: KG triple subject.
- `predicate`: KG predicate, validated by the existing `kg_write()` path.
- `object`: KG triple object.
- `sourceEpic`: writer epic namespace, stored as `source_epic`.
- `sourceAgent`: writer agent name, stored as `source_agent`.

Return:

- `{ emitted: true, metadata }` after a successful write.
- `{ emitted: false, metadata: null }` when emission is disabled or the local KG is unavailable.

The returned metadata follows the B0.2 contract: `subject`, `predicate`, `object`, `source_epic`, `source_agent`, `valid_from`, `valid_until`.

`emitSupersededEvent()` is additive: it marks the prior
`(subject, predicate, priorObject)` triple historical by setting
`valid_until`, then inserts exactly one `superseded` provenance edge whose
object is `priorObject->newObject` after object sanitization. It does not
insert the replacement authoritative triple; callers that own the replacement
write keep doing so.

## `emit_lifecycle_at`

`emit_lifecycle_at` is a scalar knob in `hive.config.yaml`.

- `phase`: emit lifecycle triples at phase boundaries. This is the default.
- `story`: emit lifecycle triples at story boundaries.
- `step`: emit lifecycle triples at individual workflow steps.
- `off`: disable lifecycle KG emission. The helper does not call `kg_write()` and does not increment `kg_writes_total`.

Accepted values are exactly `phase`, `story`, `step`, and `off`.

## Example

```js
const { emitKgEvent } = require('./kg-emit');

await emitKgEvent({
  subject: 'S1.1-emit-foundation-knob-counter',
  predicate: 'phase_failed',
  object: 'test phase failed',
  sourceEpic: 'kg-signal-revival',
  sourceAgent: 'tester',
});
```

Supersession example:

```js
const { emitSupersededEvent } = require('./kg-emit');

await emitSupersededEvent({
  subject: 'S2.2-superseded-emit-sites',
  predicate: 'story-spec',
  priorObject: 'old-hash',
  newObject: 'new-hash',
  sourceEpic: 'kg-signal-revival',
  sourceAgent: 'plan',
});
```

## Python Parity

`hive/lib/kg_emit.py` mirrors the JS helper for Python executor code:

```python
from hive.lib.kg_emit import emit_kg_event, emit_superseded, sanitize_obj

emit_kg_event(
    subject="S1.2-phase-failed-walker-emit",
    predicate="phase_failed",
    obj=sanitize_obj("HandlerError: phase failed"),
    source_epic="kg-signal-revival",
    source_agent="dag-executor",
)

emit_superseded(
    subject="S2.2-superseded-emit-sites",
    predicate="story-spec",
    prior_object="old-hash",
    new_object="new-hash",
    source_epic="kg-signal-revival",
    source_agent="plan",
)
```

The Python helper reads the same `emit_lifecycle_at` knob through
`hive/lib/config.py`, writes the same triple metadata shape to
`~/.claude/hive/kg.sqlite`, and increments `kg_writes_total{predicate}`
after successful writes. Tests can override the SQLite path with
`HIVE_KG_SQLITE_PATH`.

`phase_failed` is emitted by the Python DAG executor at the terminal
failure-recording seam. The object is sanitized to a lowercase kebab-case
reason with stack trace fragments, absolute paths, newlines, and
non-`[a-z0-9-]` characters removed before the KG write.
