# Insights — am-2-flow-bindings-schema

## `assert.throws` doesn't return the error in Node's test runner

`assert.throws(fn)` returns `undefined`, not the thrown error. To assert on error
properties (`.code`, `.scenarioId`, `.stepIndex`), wrap in try/catch. Pattern used:

```js
function assertThrows(fn) {
  try { fn(); throw new assert.AssertionError({ message: 'Expected to throw' }); }
  catch (e) { if (e.message === 'Expected to throw') throw e; return e; }
}
```

## Extensible enum via exported mutable Set

`KNOWN_TRUTH_SIGNALS` is an exported `Set`. Consumers add new signals before calling
`loadBindings`; the validator then accepts them without any code change. This satisfies
"extensible enum" without reflection or registration ceremony. Same pattern for `KNOWN_ACT_VALUES`.

## Overlay is parallel-indexed, not keyed by step id

Steps are positional (index 0 of overlay = index 0 of scenario). This keeps the overlay minimal
and avoids duplicating step ids that don't exist on the scenario schema. The runner (am-4) must
enforce equal-length before executing.

## setup[] shares the native primitive shape without `how`

Setup items are `{ act, args }` — exactly a native step minus `how`. Kept them without a
`how` field deliberately: `how` only makes sense at the top step level where native/vision
splits. Setup is always native by definition.
