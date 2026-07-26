# Horizontal Planning Scan — headless-question-protocol

**Input:** design-discussion.md (post-grill, post-user-feedback) + research-brief.md

## 1. Layer Inventory

- **Runtime-mode detection** (`hive/lib/`) — new. Senses interactive vs. headless.
- **Question gateway + envelope schema** (`hive/lib/`, `hive/references/`) — new. The shared
  "ask or emit" primitive and its machine-readable contract.
- **Kickoff integration** (`skills/kickoff/SKILL.md`, `hive/references/kickoff-protocol.md`) —
  modified. 7+ prose prompt points route through the gateway.
- **Design integration** (`skills/design/SKILL.md`, `hive/references/wireframe-protocol.md`) —
  modified. 2 `AskUserQuestion` touchpoints route through the gateway.
- **Plan integration** (`skills/plan/SKILL.md`) — modified. Branch-switch confirm (step 0),
  version_bump (14b), sidecar_retention (14c) route through the gateway.
- **Stop hook** (`hooks/metrics-stop-dispatch.sh`, `.claude-plugin/plugin.json`,
  `hive.config.yaml` / `hive/hive.config.yaml`) — modified. Streaming rewrite + size guard.
- **Docs / PR surface** (`docs/scope/`, PR description, `hive/references/question-envelope-schema.md`) — new/modified. Minerva-compatibility contract, upstream PR narrative.

## 2. Per-Layer Requirements

```
## Layer: Runtime-mode detection

MODULE:
  - hive/lib/runtime_mode.py — detect_interactive_mode() -> {mode, source}
  - hive/lib/runtime_mode.js — same contract, JS side (dual-impl convention)

PRECEDENCE:
  - HIVE_HEADLESS=1|0 (explicit override, wins)
  - CI=true (headless)
  - default: interactive

TESTS:
  - unit tests for each precedence tier, both langs

---

## Layer: Question gateway + envelope schema

SCHEMA DOC:
  - hive/references/question-envelope-schema.md — Purpose/Data-shape/Cardinality/
    Storage-rule table, mutation-rules (pending -> answered), closure invariant,
    worked examples, "does NOT commit to" fence (matches triage-queue-schema.md shape)

GATEWAY MODULE:
  - hive/lib/question_gateway.py / .js — ask_or_emit(question_spec[]) -> answers[]
    - interactive path: calls AskUserQuestion (or emits prose, call-site's choice)
    - headless path: batches question_spec[] into one phase-scoped envelope at
      .pHive/questions/<skill>-<invocation-id>.yaml with a renewable deadline field,
      prints AWAITING_ANSWERS status, exits cleanly (single behavior, no poll loop)
    - resume path: on re-entry, checks .pHive/questions/ for the matching envelope —
      answered -> consume, returns answers[] instead of prompting; still-pending and
      not expired -> re-exit AWAITING_ANSWERS; expired with no renewal ->
      headless.deadline_expired_action (re-emit fresh envelope, or fail)

CONFIG KEYS (new, root-first precedence):
  - headless.answer_deadline_seconds (default 1800) — initial envelope deadline
  - headless.deadline_expired_action: re-emit | fail (default re-emit)

TESTS:
  - fixture-driven: write envelope, simulate late answer-write, confirm resume path
    consumes it and does not re-prompt
  - deadline renewal: orchestrator extends deadline before expiry, envelope stays
    pending and valid; expiry with no renewal triggers deadline_expired_action

---

## Layer: Kickoff integration

PROMPT POINTS (route through gateway):
  - skills/kickoff/SKILL.md:13,22,24,26,36,41,46
  - hive/references/kickoff-protocol.md:45,58,99,145,182,320-363,756-786,906

PHASE-TO-ENVELOPE MAPPING:
  - Phase 1a (metrics opt-in, project-type, has-ui) -> one envelope
  - Phase 1b (ship-target) -> one envelope
  - Phase 2b-iii elicitation (5 questions) -> one envelope
  - Phase 3b discovery (north-star, optional) -> one envelope

---

## Layer: Design integration

TOUCHPOINTS (route through gateway):
  - skills/design/SKILL.md:123 (Touchpoint 1 — rendition selection)
  - hive/references/wireframe-protocol.md:38,58 (Touchpoint 1 + 2)

NOTE:
  - wireframe-protocol.md:91-92's "must run in main session, not background teammate"
    constraint is about the INTERACTIVE path; unaffected — headless path never runs in
    a background teammate either, it writes an envelope and returns.

---

## Layer: Plan integration

PROMPT POINTS (route through gateway):
  - skills/plan/SKILL.md:106 (branch-switch confirm)
  - skills/plan/SKILL.md:707 (14b version_bump)
  - skills/plan/SKILL.md:713 (14c sidecar_retention)

---

## Layer: Stop hook

SCRIPT CHANGES:
  - hooks/metrics-stop-dispatch.sh:111-130 (_extract_tokens) — replace jq -c -s slurp
    with a streaming pass (jq -c, no -s, or incremental awk sum)
  - new size guard before any parse: read transcript byte size, compare against
    metrics.stop_dispatch_max_transcript_bytes, skip + log-one-line + exit 0 if over

CONFIG:
  - metrics.stop_dispatch_max_transcript_bytes (new, root-first precedence, default
    TBD by benchmark — see vertical-plan Step covering this)

TESTS:
  - fixture transcripts: small (unaffected), just-under-threshold, just-over-threshold
  - byte-for-byte regression: old slurp output vs new streaming output on the same
    fixture, before cutover
  - benchmark: synthetic large transcript, timed, to derive the default threshold

---

## Layer: Docs / PR surface

DELIVERABLES:
  - hive/references/question-envelope-schema.md (see gateway layer)
  - PR description: Minerva-compatibility note (submitAnswers shape), upstream framing
    per docs/scope/plugin-hive-headless-question-protocol.md's "PR-only to FFE" instruction
  - CHANGELOG / release notes entry if this repo maintains one for the plugin
```

## 3. Cross-Layer Dependencies

```
DEPENDENCIES:

Question gateway          -> Runtime-mode detection (needs detect_interactive_mode())
Kickoff integration        -> Question gateway (needs ask_or_emit() + envelope schema)
Design integration         -> Question gateway (same)
Plan integration           -> Question gateway (same)
Stop hook fix               -> (none — fully independent of the gateway stack)
Docs/PR surface             -> all of the above (final wrap, needs finished behavior to document accurately)
```

The gateway stack (runtime-mode -> gateway+schema -> {kickoff, design, plan}) is a strict
dependency chain. The Stop hook fix has zero dependency on it and can be built, reviewed, and
even merged independently — this is the parallel story-cluster referenced in the design
discussion.

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP
──────────────────────────────────────────────────────────────────────────
Runtime-mode │ detect_interactive_mode()                                  │
             │ (env/CI/default precedence, py+js)                        │
─────────────┼─────────────────────────────────────────────────────────────
Gateway      │ question_gateway.{py,js}  │ question-envelope-schema.md   │
             │ ask_or_emit(), poll modes │ .pHive/questions/ contract    │
─────────────┼───────────────┬───────────────┬───────────────────────────
Skill        │ kickoff        │ design         │ plan                     │
integration  │ (7 prompt pts) │ (2 touchpoints)│ (branch/14b/14c)         │
─────────────┴───────────────┴───────────────┴───────────────────────────

(independent cluster)
Stop hook    │ metrics-stop-dispatch.sh streaming rewrite + size guard    │
             │ + metrics.stop_dispatch_max_transcript_bytes config knob  │
──────────────────────────────────────────────────────────────────────────
Docs/PR      │ question-envelope-schema.md polish │ PR description       │
──────────────────────────────────────────────────────────────────────────
```

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected: 7 (runtime-mode, gateway, kickoff, design, plan, stop-hook, docs/PR)
  Total items: ~20 (2 lib modules + schema + 3 skill integrations + hook rewrite +
               guard + config keys + docs)
  New vs modified: 5 new (runtime_mode, question_gateway, question-envelope-schema.md,
                   headless.* config block, metrics.stop_dispatch_max_transcript_bytes),
                   4 modified (kickoff, design, plan skills; metrics-stop-dispatch.sh)
  Estimated total effort: medium

  LARGEST LAYER: Kickoff integration (7+ distinct prompt points across 4 phases)
  RISKIEST LAYER: Question gateway (new shared primitive, poll-mode timing edge cases,
                  and it's the hard dependency every skill-integration story sits behind)
```
