# Question Envelope Schema

Schema specification for `.pHive/questions/<skill>-<invocation-id>.yaml` — the persistence
surface for the headless question protocol (epic `headless-question-protocol`, story
`hqp-2-question-gateway-envelope`). This is the machine-readable channel a headless
orchestrator (Minerva, an FFE-swarm agent, or any `claude -p` driver) reads to discover
pending questions and writes to submit answers, replacing the interactive-only
`AskUserQuestion` / prose-prompt path when no human is present.

This file is a **planning-state data** artifact, not a runtime workflow config. It records
one skill invocation's pending or answered questions for one phase. It does NOT carry
execution metadata, agent state, or workflow-step results.

## Target path

`.pHive/questions/<skill>-<invocation-id>.yaml`

One file per **skill phase**, not per individual question — a phase's questions are batched
into a single envelope's `questions:` list (see "Why phase-batching" below). The gateway
(`hive/lib/question_gateway.{py,js}`) creates the directory and file on first use. Consumers
MUST handle absence gracefully (treat as "no pending questions").

## Why phase-batching, not per-question envelopes

Kickoff alone has 7+ distinct prompt points across ~4 phases. A per-question envelope would
mean a fully headless kickoff run needs 7+ full skill re-invocations to complete — slower and
more brittle than the prose-scraping workaround this protocol replaces. Batching every
question raised within one skill phase into a single envelope bounds a headless run to
roughly one round trip per phase.

## Top-level structure

```yaml
# .pHive/questions/kickoff-2026-07-25T22-10-00Z.yaml
id: kickoff-2026-07-25T22-10-00Z
skill: kickoff
phase: "1a"
status: pending
provenance:
  raised_by: kickoff
  raised_at: "2026-07-25T22:10:00Z"
deadline: "2026-07-25T22:40:00Z"
renewal_count: 0
questions:
  - qid: metrics-opt-in
    text: "Enable metrics tracking?"
    kind: single-select
    options: ["yes", "no"]
    required: true
    answer: null
  - qid: project-type
    text: "What type of project is this?"
    kind: single-select
    options: ["web", "mobile", "cli", "library", "other"]
    required: true
    answer: null
```

## Required top-level fields

| Field | Type | Populated when | Notes |
|---|---|---|---|
| `id` | string | envelope created | `<skill>-<ISO-8601-ish timestamp, colon-free>`. Matches the filename stem. |
| `skill` | string | envelope created | The skill that raised these questions (`kickoff` \| `design` \| `plan`). |
| `phase` | string | envelope created | Skill-defined phase/step identifier. Used on resume to match the envelope back to the skill's current position. |
| `status` | enum | envelope created; mutated on answer/renewal | `pending` \| `answered`. See "Mutation rules" below. |
| `provenance.raised_by` | string | envelope created | Same as `skill` — kept as a nested field for symmetry with other `.pHive/` provenance blocks (e.g. cross-cutting-concerns evaluation records). |
| `provenance.raised_at` | ISO 8601 timestamp | envelope created | When the envelope was first written. |
| `deadline` | ISO 8601 timestamp | envelope created; mutated on renewal | `raised_at + headless.answer_deadline_seconds` at creation. Renewable — see "Deadline renewal" below. |
| `renewal_count` | integer | envelope created (0); incremented on renewal | How many times an orchestrator has extended `deadline` without yet answering. |
| `questions` | array of question objects | envelope created | One entry per question raised in this phase. See "Question object fields" below. |

## Question object fields

| Field | Type | Notes |
|---|---|---|
| `qid` | string | Stable identifier for this question within the envelope, unique per envelope. |
| `text` | string | The question text — identical to what would be shown via `AskUserQuestion` or prose in the interactive path. |
| `kind` | enum | `single-select` \| `multi-select` \| `free-text`. Mirrors `AskUserQuestion`'s option shape. |
| `options` | array of strings or null | Present for `single-select`/`multi-select`; null for `free-text`. |
| `required` | boolean | Whether an answer is mandatory before the skill can proceed. |
| `answer` | string, array of strings, or null | `null` until answered. Written in place by the orchestrator. Array for `multi-select`, string otherwise. |

## Mutation rules

Two independent mutation paths on a `pending` envelope — answering (which leads to deletion)
and renewing (non-terminal, extends validity):

```
pending -> answered      (orchestrator writes answer: on every required question + flips status)
pending -> pending        (orchestrator renews: writes a later deadline + increments renewal_count)
answered -> <deleted>     (gateway deletes the file on consume; see "Deletion on consume" below)
```

**Answering.** The orchestrator writes `answer:` for every `required: true` question and sets
`status: answered`. On the skill's next re-invocation, the gateway reads this envelope,
returns the answers, **deletes the envelope file** (see "Deletion on consume" below), and the
skill proceeds to its next phase (which may write a new envelope).

**Deadline renewal (OAuth-refresh shape, not a poll loop).** Before `deadline` lapses, an
orchestrator that needs more time writes a fresh, later `deadline` and increments
`renewal_count` — the envelope stays `status: pending`. This is a property of the envelope,
not of the skill process: the skill never sits in a loop watching the file: it writes the
envelope once, exits, and re-checks only when re-invoked. An orchestrator can renew any number
of times before eventually answering.

**Expiry.** On re-invocation, if the matched envelope is `status: pending` and `deadline` has
lapsed with no renewal since, the gateway applies `headless.deadline_expired_action`:
`re-emit` (default — write a fresh envelope with a new deadline, non-destructive) or `fail`
(raise a machine-readable error, for orchestrators that want expiry treated as unrecoverable).

## Closure invariant

An envelope is closed (fully resolved) only when `status: answered` AND every `required: true`
question has a non-null `answer`. A `status: answered` envelope with a missing required answer
is malformed — the gateway treats it as if `status` were still `pending` (defensive: an
orchestrator that flips `status` prematurely doesn't silently corrupt skill resumption).

## Deletion on consume

The gateway deletes an envelope file immediately after successfully extracting its answers
(the moment the closure invariant above is first satisfied on a resume) — the file does not
persist as an answered record. This is a deliberate correctness requirement, not just
cleanup: skill phase ids (`1a`, `1b`, `touchpoint-1-round-1-<topic>`, etc.) are **reused
across genuinely separate invocations** of the same skill — e.g. a re-kickoff run months
after the original kickoff both use phase `1a`. If a consumed envelope stayed on disk,
`find_envelope_for_phase` would match the OLD answered envelope forever, silently
short-circuiting every future invocation's re-kickoff preservation prompt with a stale
answer instead of asking again. Deleting on consume is simpler and more robust than adding
an invocation/run-id dimension to every phase id.

**Consequence for multi-field validation retries.** When one envelope batches several
questions and only some of them need a round-2 retry (e.g. kickoff's `project-classification`
phase batches `project_type` + `has_ui`, and only an invalid `project_type` answer triggers a
round-2 envelope), the calling skill MUST persist every **valid** answer from the round-1
envelope immediately upon consuming it — before deletion, the round-1 envelope was the only
place those answers lived; after deletion, a fresh round-2 process has no way to recover them.
See `hive/references/kickoff-protocol.md` and `skills/kickoff/SKILL.md` for the concrete
per-field persistence-on-consume requirements this creates.

**Consumers should not rely on answered envelopes as an audit trail.** If a durable record of
what was asked/answered is needed, that's the calling skill's responsibility (e.g. writing to
`.pHive/project-profile.yaml`, `hive.config.yaml`, or an episode marker) — this schema is a
transient handoff channel, not a log.

## Single writer per field group

Two writers, disjoint field ownership — this is not a single-writer schema like
`triage/queue.yaml`:

- **The Hive skill / gateway** writes `id`, `skill`, `phase`, `provenance`, the initial
  `deadline`/`renewal_count: 0`, and every `questions[].{qid,text,kind,options,required}`.
  It never writes `answer` or mutates `status` to `answered`. It is also the **only** party
  that deletes the file (on consume — see "Deletion on consume" above); the orchestrator
  never deletes an envelope itself.
- **The orchestrator** writes `questions[].answer`, `status: answered`, and (for renewal only)
  a later `deadline` + incremented `renewal_count`. It never invents new `qid`s or edits
  question text/options.

## Phase-id scoping (skill-specific)

`phase` values are opaque strings to this schema and the gateway — matching is exact-string
equality, never a filesystem path. Whether a given `phase` value is scoped to a single
invocation or reused across invocations is entirely up to the calling skill's own convention:

- **Kickoff / plan** use simple phase ids (`1a`, `1b`, `branch-switch-confirm`, etc.) that
  assume at most one invocation in flight per project — combined with delete-on-consume
  above, this is safe because a stale envelope never lingers to be matched by a later,
  unrelated invocation.
- **Design** explicitly supports multiple concurrent topics
  (`.pHive/design/<topic>/`), so its phase ids always embed the topic slug
  (`touchpoint-1-round-1-<topic>`) to prevent two unrelated `/design` runs for different
  topics from ever matching each other's envelopes. See
  `hive/references/wireframe-protocol.md`'s "Headless Mode" section for the full convention,
  including the round-counter suffix for its iteration loops.

## Config

Resolved root-first (root `hive.config.yaml` → shipped `hive/hive.config.yaml` baseline →
hardcoded default), same precedence as every other knob in this epic:

```yaml
headless:
  answer_deadline_seconds: 1800   # generous default — matches this repo's existing
                                   # Multica story/persona timeout precedents
                                   # (planning.multica.persona_timeout_seconds,
                                   # execution.multica.story_timeout_seconds)
  deadline_expired_action: re-emit  # re-emit | fail
```

## Interactive-mode note

None of the above applies when `hive/lib/runtime_mode.{py,js}`'s `detect_interactive_mode()`
resolves to `interactive` — the gateway calls `AskUserQuestion` (or emits the existing prose)
exactly as before this protocol existed, and no envelope file is ever written.

## Minerva compatibility

The answer-submission shape (`answer:` + `status: answered`, written directly onto the
envelope the skill wrote) mirrors Minerva's own `submitAnswers` contract — an orchestrator
that already knows how to answer Minerva's structured questions needs no translation layer to
answer Hive's.

## What this schema does NOT commit to

- Envelope versioning / schema migration — this is a v1 schema; no upgrade path exists yet
  because nothing consumes an older version.
- Cross-skill or cross-epic question aggregation — each envelope is scoped to one skill
  invocation's one phase.
- A polling API or any mechanism where the skill process itself watches the file — the skill
  always writes-and-exits; only the orchestrator's own scheduling decides when to re-invoke or
  renew.
- Background-session-specific behavior — this schema doesn't know or care whether the
  orchestrator driving it is itself backgrounded; that's outside its scope.

## See also

- `.pHive/epics/headless-question-protocol/docs/design-discussion.md` §2.1 — the design
  rationale for phase-batching and the renewable-deadline mechanism
- `hive/lib/question_gateway.py` / `hive/lib/question_gateway.js` — the primitive that reads
  and writes this schema
- `hive/lib/runtime_mode.py` / `hive/lib/runtime_mode.js` — the interactive/headless
  detection this schema's behavior is gated on
- `hive/references/triage-queue-schema.md` — sibling schema doc this one's structure mirrors
