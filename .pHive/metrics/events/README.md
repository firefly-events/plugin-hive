# Event Records

## Purpose

`.pHive/metrics/events/` is reserved for append-only JSONL event records within the metrics carrier. These records support run-scoped measurement history for the meta-improvement-system when metrics collection is later enabled.

## Record class

This directory holds append-only JSONL event records. File partitioning is not fixed by this README: records may be organized as one file per run or by a rolling daily policy. That partitioning decision is deferred to `C1.2`.

## Schema authority

No event record format is approved yet. The authoritative schema for records in this directory is planned for `.pHive/metrics/metrics-event.schema.md`, to be authored by `C1.2`. Until that schema exists, no ad hoc JSONL shape is permitted here.

## Default OFF

Metrics writes are opt-in at kickoff and default OFF per `user-decisions-dd.md` Q-new-B. Until opt-in exists and the event schema is defined, this directory is expected to remain empty.

## Write boundary

No records can be written from this story. Record creation remains blocked until `C1.2` defines the schema and the later wiring stories add the write path. This README establishes carrier intent only and defines no active hook or emitter behavior.

## What this README does NOT commit to

This README does not commit to:

- whether files are per-run or rolling daily
- concrete field names, validation rules, or examples before `C1.2`
- retention or rotation policy
- consumer query behavior
