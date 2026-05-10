# Rubric Format

**Version:** 1.0
**Status:** Authoritative
**Audience:** `hive/agents/reviewer.md`, `hive/agents/peer-validator.md`, and any future
caller that needs a single, runtime-agnostic definition of pass/fail criteria over an
evaluated artifact.
**Last updated:** 2026-05-09

## Overview

This document defines **the** machine-readable rubric format that Hive uses for
criterion-based evaluation. A rubric is a declarative list of criteria, each with a
severity, that consumers evaluate independently and then aggregate using the rule in
[Aggregation rule](#aggregation-rule) below.

Two consumers share this format:

- **`hive/agents/reviewer.md`** — produces a single `change_verdict` per review by
  rolling per-criterion outcomes up through the aggregation rule.
- **`hive/agents/peer-validator.md`** — emits one finding row per criterion using the
  same per-criterion outcomes.

The schema is **runtime-agnostic**. It does not encode whether a caller invokes the
rubric inside a convergence loop, as a single-shot gate, or both. That decision belongs
to the workflow that consumes the rubric, not to the rubric file itself.

## Schema

The JSON Schema fixture below is the canonical contract. Any rubric file MUST validate
against it. The schema is delimited by stable HTML comment markers so that test code
and tooling can extract it deterministically; do not move, rename, or duplicate the
markers.

<!-- schema:rubric:start -->
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hive.dev/schemas/rubric-format/v1.json",
  "title": "Hive Rubric",
  "type": "object",
  "required": ["rubric_id", "version", "criteria"],
  "additionalProperties": false,
  "properties": {
    "rubric_id": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9-]*$",
      "description": "Stable identifier for this rubric. Lowercase, hyphenated."
    },
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      "description": "Semver of the rubric definition itself."
    },
    "description": {
      "type": "string",
      "description": "Optional human-readable purpose of the rubric."
    },
    "criteria": {
      "type": "array",
      "minItems": 1,
      "description": "One or more criteria, each evaluated independently to pass or fail.",
      "items": {
        "type": "object",
        "required": ["id", "severity", "description"],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]*$",
            "description": "Stable identifier for the criterion within this rubric."
          },
          "severity": {
            "type": "string",
            "enum": ["critical", "improvement"],
            "description": "Drives the aggregation rule. critical fails block; improvement fails do not."
          },
          "description": {
            "type": "string",
            "description": "Plain-language statement of what the criterion checks."
          },
          "evidence_required": {
            "type": "boolean",
            "description": "If true, the consumer MUST cite specific evidence (file:line or excerpt) for both PASS and FAIL results. Default true."
          }
        }
      }
    }
  }
}
```
<!-- schema:rubric:end -->

### Field semantics

- **`rubric_id`** — chosen by the rubric author; appears in metrics events and episode
  records. Two rubrics with the same `rubric_id` and different `version` are treated as
  successive revisions of the same rubric.
- **`version`** — semver of the rubric file itself, not of any consumer. A consumer
  refactor that changes how it reads the rubric does not bump the rubric version.
- **`criteria[].severity`** — the only field the aggregation rule reads. Two values:
  - `critical` — a `fail` on this criterion blocks integration.
  - `improvement` — a `fail` on this criterion is reported but does not block.
- **`criteria[].evidence_required`** — when omitted, defaults to `true`. Consumers
  reading this flag MUST refuse to record an outcome without cited evidence.

### Schema versioning

The schema's own version is encoded in `$id` (`/v1.json`). A non-backward-compatible
change to the schema requires a new `$id` (`/v2.json`) and a parallel rubric file
revision; the field shape above is the v1 contract.

## Aggregation rule

Both consumers evaluate every criterion in the rubric, producing one of:

- `pass` — evidence shows the criterion is satisfied.
- `fail` — evidence shows the criterion is violated, OR no satisfying evidence exists
  and `evidence_required` is `true` (the default).

The two consumers then aggregate identically — they MUST agree on every per-criterion
outcome — but report at different surfaces:

| Step | Reviewer (`reviewer.md`) | Peer-validator (`peer-validator.md`) |
|------|--------------------------|--------------------------------------|
| 1 | Evaluate each criterion → `pass`/`fail` | Evaluate each criterion → `pass`/`fail` |
| 2 | Roll up to a single `change_verdict` (rule below) | Emit one row per criterion: `PASS` or `FAIL` |

The roll-up rule for `change_verdict`:

1. If **any** criterion with `severity: critical` is `fail` → `change_verdict: needs_revision`.
2. Else if **any** criterion with `severity: improvement` is `fail` → `change_verdict: needs_optimization`.
3. Else → `change_verdict: passed`.

This is the load-bearing invariant that makes the two consumers **stacked, not
redundant**: they share the per-criterion outcomes, so a `change_verdict: passed` from
the reviewer cannot coexist with a `FAIL` row from the peer-validator on the same
rubric and same evaluated artifact. A workflow that runs both consumers can rely on
this invariant when interpreting their outputs.

### Caller-decided invocation pattern

The schema and aggregation rule are silent on whether a caller runs the rubric once or
in a loop. Both patterns are supported by the same rubric file:

- A workflow MAY wrap a consumer in a convergence loop, re-invoking it on the same
  artifact until `change_verdict: passed` or a circuit breaker trips. The rubric file
  is the convergence criterion in this case.
- A workflow MAY run a consumer once as a deterministic single-shot gate. The rubric
  file is the gate definition in this case.
- A workflow MAY do both, in either order. The aggregation rule guarantees the two
  consumers agree on per-criterion outcomes.

The rubric file does not encode which pattern is in use; that lives in the workflow
YAML and is out of scope for this document.

## Example rubric

```json
{
  "rubric_id": "session-spec-conformance",
  "version": "1.0.0",
  "description": "Verdict criteria for stories that touch the session substrate.",
  "criteria": [
    {
      "id": "spec-fidelity",
      "severity": "critical",
      "description": "Every acceptance criterion in the story has a corresponding implementation."
    },
    {
      "id": "domain-compliance",
      "severity": "critical",
      "description": "All modified files are within the modifying agent's write domain."
    },
    {
      "id": "convention-adherence",
      "severity": "improvement",
      "description": "Existing utilities are reused; no new patterns introduced without justification."
    }
  ]
}
```

## Out of scope

- Per-criterion runtime overrides. Criteria are declarative; consumers do not flip
  severity at evaluation time. If a workflow needs different severities for the same
  underlying check, define a separate rubric file with a different `rubric_id`.
- Loop-control parameters (`max_iterations`, `timeout`, …). These belong to the
  invoking workflow, not to the rubric.
- Aggregation surfaces other than `change_verdict` and per-criterion rows. New
  consumers added in future stories MUST first justify why an existing surface does
  not fit before extending the format.

## See also

- [`hive/agents/reviewer.md`](../agents/reviewer.md) — `change_verdict` consumer.
- [`hive/agents/peer-validator.md`](../agents/peer-validator.md) — per-criterion row consumer.
- [`hive/references/predicate-grammar.md`](predicate-grammar.md) §Risk #13 —
  `change_verdict` vs `cycle_verdict` distinction; predicate consumers MUST bind to
  `$step.output.change_verdict`.
- [`hive/references/session-system-prompt-spec.md`](session-system-prompt-spec.md) §1 —
  substrate semantics; rubric consumers run as ordinary persona steps over this
  substrate, with caller-decided invocation pattern.
