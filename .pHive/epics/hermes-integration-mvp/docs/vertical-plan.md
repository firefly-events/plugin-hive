# Vertical Plan — hermes-integration-mvp

Slice the horizontal map into commit-worthy increments. Each slice leaves Hive in a working state on its own merits, AND each slice unblocks a Hermes-side consumer step (planned in companion follow-on epic).

## 1. Slicing Strategy

```
STRATEGY:
  Total horizontal items: ~13
  Planned slices: 3
  First slice goal: /hive:context-snapshot emits valid JSON to stdout against a fixture
                    epic — Hermes (or any external tool) can read repo state programmatically
  Final slice goal: All 3 contract surfaces shipped (context-snapshot, standup --format slack,
                    triage --json) with versioned schemas and snapshot tests

  Slicing rationale: Each slice ships one self-contained CLI contract. Slice 1 first because
    it's library-first (composer reusable beyond the skill) and lowest-coupling. Slice 2 next
    because it builds on existing Routines-bridge contract (no new architecture, just output
    flag). Slice 3 last because it touches the most fragile invariant (triage single-writer)
    and stories can absorb learnings from Slice 1 JSON-output conventions.
```

## 2. Vertical Slice Plan

```
## Slice 1: context-snapshot read surface

WHAT WORKS AFTER THIS SLICE:
  /hive:context-snapshot emits a valid JSON blob to stdout describing repo state
  (branch, epics, stories, recent episodes, open triage items, metric verdicts).
  An external tool (Hermes, a shell script, ANY consumer) can pipe and parse it.
  Schema is versioned; future additions are additive-only.

LAYERS TOUCHED:
  Library (hive/lib):
    - NEW context-snapshot.mjs composer
    - Reuses hive/lib/story-status.mjs deriveStoryStatus
  Skills:
    - NEW /hive:context-snapshot skill wrapping the composer
    - Flags: --write (file output), --epic <id> (filter), --schema-version (print version)
  References:
    - NEW hive/references/context-snapshot-schema.md (JSON schema spec)
  Tests:
    - tests/lib/context-snapshot.test.ts (composer unit tests)
    - tests/skills/context-snapshot.test.ts (CLI integration)
  State (read-only):
    - cycle-state, stories, episodes, triage queue (graceful-absent), metrics blocks

NOT YET:
  - Standup --format slack flag
  - Triage --json flag
  - Hermes-side consumer (companion epic)

VERIFIED BY:
  - Composer unit: returns valid schema given fixture inputs (bun test)
  - Schema validation: output validates against context-snapshot-schema.md JSON schema
  - CLI integration: stdout vs --write produce byte-identical content (snapshot test)
  - Graceful absence: missing triage queue / missing metrics blocks / no epics → composer
    returns empty arrays not errors
  - Manual: run /hive:context-snapshot on this very repo, eyeball output for sanity

COMMIT REPRESENTS: New read-only context-snapshot skill + library composer + versioned
                   JSON schema. Standalone, no dependency on other slices.

---

## Slice 2: standup --format slack

BUILDS ON: nothing (independent of Slice 1)

WHAT WORKS AFTER THIS SLICE:
  /hive:standup --format slack emits Phase 1 standup report in Slack-friendly markdown
  (no interactive prompts, thread-aware sections, code-block tables). Default behavior
  unchanged when flag is omitted. Hermes can invoke this from cron, capture stdout,
  post to Slack channel verbatim.

LAYERS TOUCHED:
  Skills:
    - MODIFIED skills/standup/SKILL.md — add --format flag handling
    - When --format=slack: emit Phase 1 only, skip Phase 2/3 interactive elements
  References:
    - NEW hive/references/standup-slack-format.md (markdown spec)
    - MODIFIED hive/references/routines-integration.md — note Hermes equivalence
  Tests:
    - tests/skills/standup-format-slack.test.ts (snapshot test against fixture state)

NOT YET:
  - Auto-approval under cron (intentionally deferred — operator-driven Phase 2/3 at MVP)
  - Cross-Slack-workspace support (single workspace MVP)

VERIFIED BY:
  - Snapshot test: --format=slack against fixture cycle-state matches committed snapshot
  - Default behavior preservation: --format=default (or omitted) produces byte-identical
    output to pre-change behavior (regression guard)
  - Manual: invoke against this repo, copy/paste output into Slack, eyeball formatting

COMMIT REPRESENTS: Standup gains slack output flag + Routines doc updated to acknowledge
                   Hermes-class coordinators. No state machine or workflow changes.

---

## Slice 3: triage --json

BUILDS ON: Slice 1 JSON output conventions (reuse schema_version + envelope shape)

WHAT WORKS AFTER THIS SLICE:
  /hive:triage commands emit machine-parseable JSON when --json is passed:
    - /hive:triage --list --json → array of entries
    - /hive:triage <id> --json → single entry detail
    - /hive:triage <description> --json → confirmation with new entry id
    - /hive:triage <id> --advance ... --json → state transition confirmation
    - /hive:triage <id> --hand-off --json → hand-off confirmation + linked epic info
  Triage's single-writer invariant on queue.yaml is preserved (no behavior changes,
  only output formatting).

LAYERS TOUCHED:
  Skills:
    - MODIFIED skills/triage/SKILL.md — add --json flag handling per sub-command
  References:
    - INLINE in SKILL.md — document JSON output shape per sub-command
  Tests:
    - tests/skills/triage-json.test.ts (snapshot per sub-command)

NOT YET:
  - Slack bot itself (companion epic)
  - Hermes notification logic (companion epic)
  - Auto-approval flows (operator-driven at MVP)

VERIFIED BY:
  - Snapshot tests: each --json sub-command produces expected JSON shape
  - State invariant regression: with --json flag, no extra writes to queue.yaml occur
    (write-count assertion in test)
  - Default behavior preservation: without --json flag, output is byte-identical to
    pre-change behavior
  - Manual: full round-trip — /hive:triage "test bug" --json → parse id → /hive:triage
    <id> --advance clarified --json → parse → repeat through to plan-ready

COMMIT REPRESENTS: Triage gains --json output across sub-commands. State machine
                   unchanged. Contract surface for Hermes-bot (or any external
                   intake bridge) is stable.
```

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY
─────────────────────────────────────────────────────────────────────────────

                  │ Slice 1                  │ Slice 2              │ Slice 3            │
                  │ context-snapshot         │ standup --format     │ triage --json      │
                  │                          │ slack                │                    │
──────────────────┼──────────────────────────┼──────────────────────┼────────────────────┤
Skills            │ NEW /hive:context-       │ MOD standup          │ MOD triage         │
                  │ snapshot                 │ (--format flag)      │ (--json flag)      │
──────────────────┼──────────────────────────┼──────────────────────┼────────────────────┤
References        │ NEW JSON schema doc      │ NEW slack-format     │ inline in SKILL    │
                  │                          │ doc + Routines mod   │                    │
──────────────────┼──────────────────────────┼──────────────────────┼────────────────────┤
Library           │ NEW composer             │ (none)               │ (none)             │
──────────────────┼──────────────────────────┼──────────────────────┼────────────────────┤
Tests             │ composer + CLI tests     │ slack snapshot       │ per-sub-cmd        │
                  │                          │                      │ snapshot           │
──────────────────┼──────────────────────────┼──────────────────────┼────────────────────┤
State             │ READ: all sources        │ READ: standup        │ READ: queue.yaml   │
(read-only)       │                          │ existing state       │                    │
─────────────────────────────────────────────────────────────────────────────

Each column is a commit-worthy, independently-shippable working state. Slice 1 has no
dependency on Slice 2/3. Slice 2 has no dependency on Slice 1/3. Slice 3 reuses JSON
envelope conventions from Slice 1 (recommended for consistency, not required).
```

## 4. Deferred Items

```
DEFERRED (not in current slice plan — explicit):
  - Hermes-side Slack bot, cron script, context-snapshot consumer
    → Companion epic "hermes-bridge-mvp" (planned later in ~/Code/hermes-agent)
  - Auto-approval of standup Phase 2/3 under cron
    → Follow-on slice once we trust the Hermes channel; opt-in flag
  - Cross-machine sync protocol (git pull / SSH / shared FS)
    → Not needed at MVP (same-system runtime per user decision)
  - kg_why Python 3.13 hotfix
    → Out of scope; capture as triage entry post-merge
  - Multica adapter changes (vector 7)
    → Out of scope; existing Multica integration unchanged
  - Memory bridge (vector 6) — Hermes reading ~/.claude/hive/memories/
    → Out of scope; agent memories already filesystem-readable, no Hive change needed
  - Review notifications (vector 4)
    → Out of scope; gets folded into follow-on after intake bridge proves out

RATIONALE: Each deferred item is either (a) Hermes-side code that doesn't belong here,
(b) explicit future-slice work tracked under deferred vectors, or (c) out-of-scope
broader Hive cleanup. Deferring preserves MVP focus on contract surface only.
```

## 5. Risk by Slice

```
RISK PER SLICE:
  Slice 1: Medium — JSON schema versioning shape is long-term contract. Mitigation:
           additive-only rule + schema_version field + small initial schema (only what's
           needed today). Bad initial shape can't be fixed without breaking consumers.
  Slice 2: Low — output flag on existing skill. Behavior preservation via snapshot
           regression test makes default-path safety mechanical.
  Slice 3: Medium — touching triage (the single-writer-invariant skill) carries risk
           of accidentally introducing a write path through --json branches. Mitigation:
           write-count assertion in test, code review focus on read-vs-write paths.
```

## 6. Moldability Notes

- **Slice order is loose.** Slice 2 could ship first if Slack delivery is more time-pressured than persistent context. Slice 3 last is recommended for risk reasons (single-writer-invariant) but not required.
- **Slice 1 schema is the constraint.** Once Slice 1 ships and a consumer starts depending on the schema, that schema becomes a contract. Subsequent slices SHOULD reuse the same JSON envelope conventions (top-level `schema_version`, error shape, optional/required key conventions) for consistency.
- **Slice 1 can be split** if it grows too large. Acceptable sub-slices: (1a) library composer + unit tests, (1b) skill wrapper + CLI integration tests, (1c) `--write` flag + `--epic` filter. Default: ship as one slice with stories that map to these phases.
- **New slices may emerge.** If Slack format spec balloons during Slice 2 implementation (multiple message types, threading edge cases), spin off a follow-on slice. Don't bloat Slice 2.
- **Dropping a slice is safe.** Each slice is independently valuable. If Slice 3 is descoped, Slices 1+2 still ship a useful context-snapshot + Slack standup surface for Hermes.
