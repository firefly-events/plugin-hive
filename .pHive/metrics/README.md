# Metrics Carrier

## Purpose

`.pHive/metrics/` is the dual-schema carrier for the meta-improvement-system's metrics artifacts. It is reserved for per-run event records in `events/*.jsonl` and per-experiment envelope records in `experiments/*.yaml`, which later slices use to support the auto-improvement loop.

## Dual-schema split

The carrier is intentionally split by record class:

- `events/` holds append-only JSONL event records.
- `experiments/` holds per-envelope YAML experiment records.

Consumer requirements for both record classes are defined at the contract level in [`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`](../epics/meta-improvement-system/docs/b0-consumer-contract.md), especially §1 for the experiment envelope and §2-§3 for consumer expectations. This README names the storage split; it does not redefine the contract.

## Default OFF

Metrics writes are opt-in at kickoff and default OFF per `user-decisions-dd.md` Q-new-B. Without explicit opt-in, this directory is expected to remain empty. In this slice, the carrier exists as inert structure only; no live hook wiring or emitter behavior is defined here.

## Schema authority

Only approved schema files define record shape. For this carrier, that authority is expected to land in:

- `.pHive/metrics/metrics-event.schema.md` in `C1.2`
- `.pHive/metrics/experiment-envelope.schema.md` in `C1.3`

Ad hoc record formats are not permitted. If a shape is not described by an approved schema file, it is out of contract for this directory.

## Retention notes

At the contract level, event records are append-only within a run. Retention, rotation, and pruning policy are not yet specified and remain an S2-deferrable decision. This README does not commit the carrier to a retention schedule or file rotation rule beyond the JSONL/YAML split.

## Directory layout

- See [events/README.md](/Users/don/Documents/plugin-hive/.pHive/metrics/events/README.md) for the event-record carrier.
- See [experiments/README.md](/Users/don/Documents/plugin-hive/.pHive/metrics/experiments/README.md) for the experiment-envelope carrier.

## What this README does NOT commit to

This README does not commit to:

- emission semantics
- a hook site list or emitter implementation
- config keys or kickoff UX details
- a retention or rotation policy
- storage layout beyond append-only JSONL events and YAML experiment envelopes
- consumer-side query implementation
