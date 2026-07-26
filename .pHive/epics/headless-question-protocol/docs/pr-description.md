# Headless question protocol + bounded Stop hook

Fork-and-PR-back per `docs/scope/plugin-hive-headless-question-protocol.md`
(Minerva Risk-A drivability spike finding). Two independent workstreams, one PR:

1. **Headless question protocol** — kickoff, design, and plan can now be driven by a
   non-interactive orchestrator (Minerva today, any `claude -p` driver tomorrow)
   instead of degrading to unparseable prose when `AskUserQuestion` is unavailable.
2. **Bounded Stop hook** — `metrics-stop-dispatch.sh`'s unbounded full-transcript
   slurp is replaced with a streaming pass + a size guard, so it can't tax large or
   long-running (`claude --bg`) sessions.

Sequencing note per the scope doc: **this is a PR to `firefly-events/plugin-hive`
only** — it does not touch any live deployment.

## 1. Headless question protocol

### Detection

`hive/lib/runtime_mode.{py,js}` — `detect_interactive_mode()`:

1. `HIVE_HEADLESS=1` forces headless, `HIVE_HEADLESS=0` forces interactive (wins over
   everything else).
2. `CI=true` is treated as headless.
3. Default: interactive — an environment that sets neither variable behaves exactly
   as it did before this PR. No behavior change is possible without an explicit
   signal.

### Question envelopes

`hive/lib/question_gateway.{py,js}` + `hive/references/question-envelope-schema.md`.
When headless, a skill batches every question raised at one phase boundary into a
single envelope at `.pHive/questions/<skill>-<invocation-id>.yaml`, prints an
`AWAITING_ANSWERS` status, and exits. An orchestrator answers by writing `answer:` +
`status: answered` directly onto that file — **this mirrors Minerva's own
`submitAnswers` shape**, so an orchestrator that already knows how to answer
Minerva's structured questions needs no translation layer here.

If an orchestrator needs more time than the default 1800s window, it writes a later
`deadline` onto the same envelope before the current one lapses (an explicit
`renewal_count` increments each time) — an OAuth-refresh shape rather than a
fixed timeout or a polling loop. On resume, the skill re-checks
`.pHive/questions/` for the matching phase and continues from there instead of
re-prompting.

### Where it's wired

| Skill | Prompt points |
|---|---|
| `skills/kickoff/SKILL.md` + `hive/references/kickoff-protocol.md` | scenario detection (rare), metrics opt-in, ship-target elicitation, project classification, developer-discovery elicitation, CONTEXT.md backfill opt-in |
| `skills/design/SKILL.md` + `hive/references/wireframe-protocol.md` | rendition selection, brief sign-off (both loop-aware — each feedback round is a distinct phase id) |
| `skills/plan/SKILL.md` | branch-switch confirmation, release-intent (version_bump) question |

Interactive behavior is byte-unchanged in every case — every prose edit in this PR is
additive (verified per-file via diff review: every removed line reappears verbatim
plus a headless annotation, no instructional content dropped).

### Known gap

`skills/plan/SKILL.md`'s sidecar-retention question (a newer plugin release's step
14c) is not present in this repo's `develop` branch source at the time of this PR —
only the branch-switch confirm and version_bump prompts exist here and are wired.
Step 14c will need the same treatment once it lands on `develop`.

## 2. Bounded Stop hook

`hooks/metrics-stop-dispatch.sh`'s token-extraction step used `jq -c -s` (slurp),
loading the entire JSONL transcript into memory before aggregating — no size guard,
no line cap. Benchmarked on an 884MB / 3M-line synthetic transcript: **13.57s wall
time, ~7.5GB peak RSS**, right at the edge of the 15s hook timeout.

Replaced with a single streaming `jq | awk` pass (O(1) memory in transcript size —
the transcript is already one JSON object per line, so slurp mode was never
required). Same fixture: **~9.5s, ~2.8MB peak memory**, byte-identical token/model
output (verified by regression test against the original implementation).

Added an in-script size guard — new `metrics.stop_dispatch_max_transcript_bytes`
config key, default 300MB (benchmarked: ~3.1s, ~12s margin under the 15s timeout, not
guessed) — that skips the parse entirely above the threshold, logging one
`transcript_skipped` row rather than failing silently.

This bounds cost for **every** session, not just backgrounded ones — no reliable
signal exists anywhere in this codebase to detect "is this a `claude --bg` session"
specifically, and a universal bound is a strict superset of "protect background
sessions."

## Testing

- `hive/lib/test/runtime_mode.test.mjs` / `runtime_mode_test.py` — 7/7 each, all
  precedence tiers
- `hive/lib/test/question_gateway.test.mjs` / `question_gateway_test.py` — 7/7 each,
  envelope write/resume/expiry/renewal/closure-invariant
- `hooks/test/metrics-stop-dispatch.test.sh` — 8/8, byte-for-byte parity + size-guard
  behavior
- **Live end-to-end headless smoke test** (kickoff): ran a real, separate
  `claude -p --plugin-dir <this branch>` session against a fresh scratch project
  with `HIVE_HEADLESS=1`. Confirmed: (1) headless mode detected, prompt routed
  through the gateway instead of asked inline, `.pHive/questions/kickoff-*.yaml`
  written with `phase: 1a`; (2) after simulating an orchestrator answer
  (`answer: yes`, `status: answered`) and re-invoking, kickoff consumed the answer
  without re-prompting, wrote `metrics.enabled: true` to `hive.config.yaml`
  correctly, and progressed to the next phase (`project-classification`),
  writing a fresh envelope there. This is real, executed behavior, not a diff
  review — the prose-only skill-integration stories (hqp-3/4/5) are no longer an
  unverified gap for the mechanism they share; only design (hqp-4) and plan
  (hqp-5)'s specific touchpoints haven't individually been smoke-tested the same
  way (same underlying gateway, already proven).

## Planning artifacts

Full design discussion, adversarial grill pass, horizontal/vertical plans, and story
decomposition at `.pHive/epics/headless-question-protocol/`.
