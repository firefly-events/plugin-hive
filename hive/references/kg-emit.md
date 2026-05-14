# KG Emit Helper

`hive/lib/kg-emit.js` exports:

```js
emitKgEvent({ subject, predicate, object, sourceEpic, sourceAgent })
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
