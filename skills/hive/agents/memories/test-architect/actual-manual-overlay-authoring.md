---
name: actual-manual-overlay-authoring
description: "How to author the native script + verify/vision_tap overlay for actual-manual test flows"
type: pattern
last_verified: 2026-06-16
ttl_days: 90
source: epic/am-8
---

The `actual-manual` tier uses a thin JSON overlay (`scenarios/flow-bindings/<scenario-id>.json`)
to tell the runner *how* to actuate each step. The overlay is parallel to the scenario's `steps`
array — index-to-index, same length. It does not duplicate scenario content; it only specifies
actuation method + optional preconditions + optional truth-signal.

Schema reference: `hive/references/actual-manual-overlay-schema.md`

## Choosing `how` per step

| Situation | Use |
|-----------|-----|
| Navigation, form fill, known ARIA role or selector | `how: "native"` |
| Selectorless click — no stable role/selector, locate by pixel | `how: "vision"` |

Default to `native`. Reach for `vision` only when native targeting is not viable (e.g., a
rendered canvas element, a custom non-ARIA widget, or a UI whose selector is unstable across
builds). Vision actuation is more expensive and less deterministic than native.

### `how: "native"` — acts available

`goto`, `fill`, `tapRole`, `tapText`, `wait` — see schema doc for `args` shape per act.

### `how: "vision"` — target label

Set `target` to a short, human-readable description of the element the model should ground and
click (e.g., `"Post Now button"`). The label is passed to Qwen2.5-VL; be specific but not brittle.

## `setup[]` — pre-action primitives

Add `setup` when the step's main action requires a precondition not guaranteed by the prior
step. Common cases:

- A CTA is only enabled after a field is filled → `setup: [{ "act": "fill", "args": { ... } }]`
- A vision step may run after a page reset → re-fill any required fields in `setup`

`setup` items are native primitives (same `act`/`args` shape, no `how`). They run in order
before the step's main action.

## `truth` — choosing a truth-signal

Vision verify alone is unreliable for two classes of outcomes:

1. **Enabled-state** — vision cannot read disabled/enabled DOM state.
2. **Ephemeral / async outcomes** — toasts and network events vanish before a screenshot lands.

For these cases, add `truth` to the step. The truth-signal is **authoritative**: if it diverges
from the vision observation, the truth-signal wins and the divergence is recorded.

| What you need to verify | `truth` value |
|-------------------------|---------------|
| A CTA became active after input | `cta_enabled` |
| A form/action was submitted (network event) | `posted` |

Vision verify still runs alongside — it is the manual observation layer. The truth-signal is the
backstop.

When vision verify alone is sufficient (e.g., a new screen appeared, a modal opened, an element
became visible), omit `truth` entirely.

## Hybrid-verify rule — summary

> Prefer a truth-signal for enabled-state and for ephemeral/async outcomes.
> Vision verify is the manual observation; the truth-signal is authoritative.
> Divergence between them is itself a signal, not a failure to be suppressed.

## Worked pattern

```json
{
  "scenario": "my-scenario",
  "steps": [
    { "how": "native", "act": "goto", "args": { "url": "https://app.example.com/compose" } },
    {
      "how": "native",
      "act": "fill",
      "args": { "selector": "[data-testid=caption-input]", "value": "Hello world" },
      "truth": "cta_enabled"
    },
    {
      "how": "vision",
      "target": "Post Now button",
      "setup": [
        { "act": "fill", "args": { "selector": "[data-testid=caption-input]", "value": "Hello world" } }
      ],
      "truth": "posted"
    }
  ]
}
```

Step 0: native goto — deterministic, no truth needed.  
Step 1: native fill; `truth: cta_enabled` catches enabled-state authoritatively.  
Step 2: vision click (selectorless); `setup` re-fills in case of page reset; `truth: posted`
catches the network event even if the toast has already dismissed.
