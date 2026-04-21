# Experiment Envelopes

## Purpose

`.pHive/metrics/experiments/` is reserved for per-experiment envelope records in YAML. Each envelope is the experiment-level carrier described by the B0 consumer contract and is intended to track a single experiment through decision and closure.

## Record class

This directory holds one YAML envelope record per experiment. The envelope field set must align with [`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`](../../epics/meta-improvement-system/docs/b0-consumer-contract.md) §1, which is the contract-level source of truth for the approved envelope fields.

## Closure invariant

The closure invariant is non-bypassable. Per `b0-consumer-contract.md` §1.11 and `user-decisions-dd.md` Q3, an envelope cannot be closed unless `decision`, `commit_ref`, `metrics_snapshot`, and `rollback_ref` are present. This README does not authorize any weaker close state.

## Schema authority

No envelope syntax is approved yet. The authoritative schema for records in this directory is planned for `.pHive/metrics/experiment-envelope.schema.md`, to be authored by `C1.3`. Mutation rules, including which fields are mutable after creation, are also in `C1.3` scope.

## Default OFF

Metrics writes are opt-in at kickoff and default OFF per `user-decisions-dd.md` Q-new-B. Until opt-in exists and the envelope schema is defined, this directory is expected to remain empty.

## Write boundary

This story does not permit envelope writes. The carrier is documentation-only in this slice, and no live hook or emitter behavior is defined here.

## What this README does NOT commit to

This README does not commit to:

- concrete YAML field syntax before `C1.3`
- post-creation mutation rules before `C1.3`
- retention policy
- consumer-side query implementation
