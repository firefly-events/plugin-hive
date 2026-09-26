# Vertical Planning — Slice Plan — headless-question-protocol

**Input:** horizontal-plan.md + design-discussion.md

## 1. Slicing Strategy

```
STRATEGY:
  Total horizontal items: ~20
  Planned slices: 6
  First slice goal: prove the runtime-mode + gateway primitive works standalone,
    before any real skill depends on it
  Final slice goal: kickoff, design, and plan all drivable headlessly via structured
    envelopes; Stop hook bounded independently; PR ready for firefly-events/plugin-hive

  Slicing rationale: the gateway stack (runtime-mode -> gateway+schema) is a hard
  dependency for every skill-integration slice, so it goes first and alone (Step 1)
  rather than being built inline with the first consumer — that lets Steps 2-4 be pure
  call-site wiring against an already-proven primitive, and lets us catch poll-mode
  timing bugs in isolation instead of debugging them through a full kickoff run. The
  Stop hook (Step 5) has no dependency on the gateway and is sequenced after the
  gateway/skill work only for narrative flow in this doc — it can be built and reviewed
  in parallel by a second workstream at any point.
```

## 2. Vertical Slice Plan

```
## Step 1: Runtime-mode detection + question gateway, proven standalone

WHAT WORKS AFTER THIS STEP:
  A small smoke-test script can call detect_interactive_mode() under HIVE_HEADLESS=1,
  HIVE_HEADLESS=0, CI=true, and no-env-set, and get the correct {mode, source} every
  time. A second smoke test drives question_gateway.ask_or_emit() with a fixture
  question set: in headless mode it writes a correctly-shaped envelope (with a
  renewable deadline field) to .pHive/questions/, and a simulated "orchestrator"
  writing answer: back into that file is correctly consumed on the next
  ask_or_emit() call for the same phase (no re-prompt). Deadline renewal is exercised:
  a fresh, later deadline written before expiry keeps the envelope valid and pending;
  an unrenewed, expired deadline triggers headless.deadline_expired_action.

LAYERS TOUCHED:
  Runtime-mode:
    - hive/lib/runtime_mode.py, hive/lib/runtime_mode.js
  Gateway:
    - hive/lib/question_gateway.py, hive/lib/question_gateway.js
    - hive/references/question-envelope-schema.md
    - new config block: headless.* (answer_intake_mode, poll_interval_seconds,
      poll_timeout_seconds, poll_timeout_action) in hive/hive.config.yaml baseline

NOT YET:
  - No real skill calls the gateway yet
  - No AskUserQuestion wiring for the interactive path (stubbed/tested separately)

VERIFIED BY:
  - Unit tests: runtime_mode precedence tiers (both langs)
  - Fixture test: envelope write -> external answer write -> resume-consume, both
    exit-on-pending and poll modes
  - Schema doc reviewed against the story-yaml-schema.md / triage-queue-schema.md
    convention shape (structural check, not just prose)

COMMIT REPRESENTS: Headless question-gateway primitive — proven standalone, not yet wired to any skill

---

## Step 2: Kickoff integration

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  `HIVE_HEADLESS=1 claude -p "/hive:kickoff"` against a fresh project writes a
  phase-scoped envelope at the first prompt point instead of blocking, exits cleanly
  with an AWAITING_ANSWERS status, and — after an external answer-write — a second
  invocation resumes at that phase and continues to the next phase's envelope (or
  completes kickoff if that was the last phase). Interactive kickoff is unchanged
  (byte-identical prose/behavior to before this epic).

LAYERS TOUCHED:
  Kickoff:
    - skills/kickoff/SKILL.md (7 prompt points route through the gateway)
    - hive/references/kickoff-protocol.md (phase-to-envelope mapping per horizontal-plan.md)

NOT YET:
  - Design, plan integration
  - Stop hook fix

VERIFIED BY:
  - End-to-end headless run against a scratch project directory: 4 phase envelopes
    written and resumed in sequence, project-profile.yaml correctly populated at the end
  - Interactive-mode regression: existing kickoff prompts still block/prompt exactly as
    before (no envelope writing when HIVE_HEADLESS unset and no CI)

COMMIT REPRESENTS: Kickoff drivable headlessly end-to-end via structured envelopes

---

## Step 3: Design integration

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  A headless `/design` run hits Touchpoint 1 (rendition selection) or Touchpoint 2
  (brief sign-off), writes an envelope instead of blocking on AskUserQuestion, and
  resumes correctly after an external answer. Interactive `/design` unchanged.

LAYERS TOUCHED:
  Design:
    - skills/design/SKILL.md:123
    - hive/references/wireframe-protocol.md (Touchpoints 1 and 2)

NOT YET:
  - Plan integration
  - Stop hook fix

VERIFIED BY:
  - Headless run through both touchpoints with fixture answers
  - Interactive-mode regression: touchpoints still call AskUserQuestion and still block

COMMIT REPRESENTS: Design's wireframe touchpoints drivable headlessly

---

## Step 4: Plan integration

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  A headless `/hive:plan` run hits the branch-switch confirm, 14b (version_bump), or
  14c (sidecar_retention) prompts and writes envelopes instead of blocking; resumes
  correctly. Interactive `/hive:plan` unchanged — this exact planning session's own
  behavior (the one producing this document) is the regression baseline for the
  interactive path.

LAYERS TOUCHED:
  Plan:
    - skills/plan/SKILL.md:106, :707, :713

NOT YET:
  - Stop hook fix

VERIFIED BY:
  - Headless run hitting all three prompt points with fixture answers
  - Interactive-mode regression against this same epic's planning session behavior

COMMIT REPRESENTS: Plan's release/sidecar/branch prompts drivable headlessly

---

## Step 5: Stop hook — streaming rewrite + size guard

BUILDS ON: (independent — no dependency on Steps 1-4)

WHAT WORKS AFTER THIS STEP:
  `metrics-stop-dispatch.sh` produces byte-identical token/wall-clock metric rows to
  the current `jq -c -s` implementation on a normal-size fixture transcript, using a
  streaming pass instead of a full-file slurp. On a transcript over
  `metrics.stop_dispatch_max_transcript_bytes`, the hook skips the parse, logs one line
  noting the skip, and exits 0 well within the 15s timeout — measured, not assumed.

LAYERS TOUCHED:
  Stop hook:
    - hooks/metrics-stop-dispatch.sh (streaming rewrite + size guard)
    - hive.config.yaml / hive/hive.config.yaml (new metrics.stop_dispatch_max_transcript_bytes key, root-first precedence)

NOT YET:
  - Any change to hook registration/timeout in .claude-plugin/plugin.json (not needed —
    the in-script guard is the fix, per design discussion §2.2)

VERIFIED BY:
  - Byte-for-byte regression: old-slurp output vs new-streaming output on the same
    normal-size fixture
  - Benchmark: synthetic large-transcript fixture, timed, used to derive the default
    threshold with measured margin under 15s
  - Guard test: transcript above threshold skips parse, logs the skip line, exits 0

COMMIT REPRESENTS: Stop hook bounded — no unbounded full-transcript slurp, cost capped for every session

---

## Step 6: Docs / PR polish

BUILDS ON: Steps 1-5 (needs finished behavior to document accurately)

WHAT WORKS AFTER THIS STEP:
  `hive/references/question-envelope-schema.md` is complete and matches this repo's
  schema-doc convention. The PR to `firefly-events/plugin-hive` has a description
  covering: what changed, the Minerva `submitAnswers`-compatible answer shape, the
  `HIVE_HEADLESS` contract, and a note that this ships PR-only (never touching Don's
  live deployment) per the scope doc's sequencing note.

LAYERS TOUCHED:
  Docs/PR:
    - hive/references/question-envelope-schema.md (final polish pass)
    - PR description (not a repo file — Phase D / ship-time artifact)

NOT YET:
  - Nothing — this is the final slice

VERIFIED BY:
  - Schema doc reviewed against triage-queue-schema.md's structural convention
  - PR description reviewed for Minerva-compatibility claims against the actual
    envelope schema shipped (no drift between doc and code)

COMMIT REPRESENTS: Epic complete — ready to open the upstream PR
```

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY
──────────────────────────────────────────────────────────────────────────────────
              │ Step 1      │ Step 2     │ Step 3     │ Step 4     │ Step 5      │ Step 6 │
              │ (gateway)   │ (kickoff)  │ (design)   │ (plan)     │ (stop hook) │ (docs) │
──────────────┼─────────────┼────────────┼────────────┼────────────┼─────────────┼────────┤
Runtime-mode  │ py+js       │            │            │            │             │        │
──────────────┼─────────────┼────────────┼────────────┼────────────┼─────────────┼────────┤
Gateway       │ py+js+schema│            │            │            │             │ polish │
──────────────┼─────────────┼────────────┼────────────┼────────────┼─────────────┼────────┤
Kickoff       │             │ 7 pts wired│            │            │             │        │
──────────────┼─────────────┼────────────┼────────────┼────────────┼─────────────┼────────┤
Design        │             │            │ 2 pts wired│            │             │        │
──────────────┼─────────────┼────────────┼────────────┼────────────┼─────────────┼────────┤
Plan          │             │            │            │ 3 pts wired│             │        │
──────────────┼─────────────┼────────────┼────────────┼────────────┼─────────────┼────────┤
Stop hook     │             │            │            │            │ streaming+  │        │
              │             │            │            │            │ guard       │        │
──────────────┴─────────────┴────────────┴────────────┴────────────┴─────────────┴────────┘

Steps 2-4 each independently build on Step 1 (not on each other) — they can run in any
order or in parallel once Step 1 lands. Step 5 has no dependency on Step 1 at all.
```

## 4. Deferred Items

```
DEFERRED (not in current slice plan):
  - Other skills' blocking prompts (ship, standup, daily-ceremony step files) —
    outside the literal + confirmed scope (kickoff, design, plan only)
  - Background-session-specific detection for the Stop hook — explicitly decided
    against in design discussion §2.2 (universal cost-bound instead)
  - Any change to the .claude-plugin/plugin.json hook timeout values — the in-script
    size guard is the fix; the wrapper-level timeout stays as a backstop, unchanged
  - Envelope schema versioning/migration story — v1 schema only, no upgrade path
    needed yet since nothing consumes an older version
  - TTY-probe-based headless detection — dropped in grill resolution (H1), not deferred
    for later, actively rejected as a design choice

RATIONALE: all four are either explicitly out of the confirmed scope (open questions
1 and 4 in the design discussion) or would add speculative complexity (versioning,
timeout retuning) with no current consumer.
```

## 5. Risk by Slice

```
RISK PER SLICE:
  Step 1: Medium — new shared primitive; poll-mode timing edge cases (answer written
          exactly at a poll boundary, timeout race) are the trickiest thing in this
          whole epic to get right, and every downstream slice depends on it being right.
  Step 2: Medium-high — largest surface (7 prompt points, 4 phases), and kickoff is the
          most load-bearing skill in this plugin; an interactive-mode regression here
          is the highest-visibility failure mode in the epic.
  Step 3: Low — 2 touchpoints, well-isolated, design's blocking behavior is already
          narrowly scoped in wireframe-protocol.md.
  Step 4: Low — 3 prompt points, narrowly scoped, and this exact session is a live
          interactive-mode regression baseline.
  Step 5: Medium — jq streaming rewrite must preserve exact aggregation semantics
          (select(.type == "assistant" and .message.usage != null)) or token metrics
          silently drift; mitigated by the mandatory byte-for-byte regression test.
  Step 6: Low — documentation and PR narrative, no behavioral risk.
```

## 6. Moldability Notes

- Steps 2, 3, and 4 (kickoff/design/plan integration) have no dependency on each other —
  they can be reordered, parallelized across two workstreams, or one could be dropped
  from this epic and shipped as a fast-follow without invalidating the rest.
- Step 5 (Stop hook) can be pulled forward to Step 1 position or run fully in parallel
  from the start — it was sequenced last only for narrative flow in this document, not
  because of a real dependency.
- Step 1's deadline-renewal support (vs. a fixed one-shot expiry) could be descoped to a
  fast-follow if it proves complex under implementation — a fixed, non-renewable deadline
  still satisfies the literal scope-doc requirements; renewal was added specifically for
  your "flexibility for long-running Hive sessions" feedback and is the one piece of this
  plan that isn't directly traceable to the original scope doc, so it's the first thing to
  cut if effort needs to shrink.
- Step 6 grows or shrinks with however much the PR review process demands — not fixed.
