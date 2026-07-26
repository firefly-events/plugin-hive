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

This PR went through three rounds of CodeRabbit review; this description reflects
the final shipped state, not the initial draft. See the review-round summary near
the bottom for what each round caught.

## 1. Headless question protocol

### Detection

`hive/lib/runtime_mode.{py,js}` — `detect_interactive_mode()` (Python) /
`detectInteractiveMode()` (JS, camelCase per this repo's existing
`config.py`/`config.js` per-language naming convention):

1. `HIVE_HEADLESS=1` forces headless, `HIVE_HEADLESS=0` forces interactive (wins over
   everything else).
2. `CI=true` is treated as headless.
3. Default: interactive — an environment that sets neither variable behaves exactly
   as it did before this PR. No behavior change is possible without an explicit
   signal.

No TTY-probe fallback — a Bash-tool subprocess's stdio doesn't reliably reflect
whether a human is present in the calling session; only the two explicit signals
above are decisive.

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

**Delete-on-consume.** The gateway deletes an envelope file the moment its answers
are extracted — it does not persist as an answered record. This is a correctness
requirement, not cleanup: phase ids (`1a`, `1b`, etc.) are reused across genuinely
separate invocations of the same skill (e.g. a re-kickoff months after the original
kickoff both use phase `1a`). Without deletion, a later invocation would silently
match the OLD answered envelope forever and never ask again. This was found and
fixed during CodeRabbit review (round 3) — see `hive/references/question-envelope-schema.md`'s
"Deletion on consume" section for the full rationale and the consequence for
multi-field validation retries (a round-1 envelope's *valid* answers must be
persisted by the calling skill before the round-1 envelope is deleted, since a
fresh round-2 process has no other way to recover them).

**Topic-scoped phase ids for `/design`.** Envelope lookup is keyed by `skill` +
`phase` only. Kickoff/plan effectively have one invocation in flight per project,
so simple phase ids are safe (combined with delete-on-consume). `/design` explicitly
supports multiple concurrent topics, so its phase ids always embed the topic slug
(`touchpoint-1-round-1-<topic>`) to prevent two unrelated `/design` runs from
matching each other's envelopes — also found and fixed during review.

### Where it's wired

| Skill | Prompt points | Phase ids |
|---|---|---|
| `skills/kickoff/SKILL.md` + `hive/references/kickoff-protocol.md` | scenario detection (rare), metrics opt-in, ship-target (kind+notes+custom-command batched), project classification, developer-discovery elicitation (7 questions — corrected from an initial miscount of 5, see below), CONTEXT.md backfill opt-in | `scenario-detect`, `1a`, `1b` (+`1b-round-2` on invalid custom command), `project-classification` (+`-round-2` on invalid `project_type`), `2b-ii`, `4b` |
| `skills/design/SKILL.md` + `hive/references/wireframe-protocol.md` | rendition selection, brief sign-off (both loop-aware) | `touchpoint-{1,2}-round-{N}-<topic>` |
| `skills/plan/SKILL.md` | branch-switch confirmation, release-intent (version_bump) question | `branch-switch-confirm`, `14b-version-bump` |

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
`transcript_skipped` row (with a `run_id`, registered in `EVENT_METRIC_TYPES`) rather
than failing silently.

This bounds cost for **every** session, not just backgrounded ones — no reliable
signal exists anywhere in this codebase to detect "is this a `claude --bg` session"
specifically, and a universal bound is a strict superset of "protect background
sessions."

**Hardening added during review:** the aggregation pipeline now captures its full
output and checks exit status once, rather than letting a malformed transcript line
partway through emit a partial-totals blob followed by a second fallback blob; the
final JSON row is built via `jq -nc` instead of manual `printf` interpolation
(a model name containing `"` previously produced invalid JSON); and distinct
model-name cardinality is capped at 20 with a deterministic overflow marker so a
pathological transcript can't grow the aggregator's memory/sort cost unboundedly.

## Testing

- `hive/lib/test/runtime_mode.test.mjs` / `runtime_mode_test.py` — 7/7 each, all
  precedence tiers
- `hive/lib/test/question_gateway.test.mjs` / `question_gateway_test.py` — 12/12
  each, covering envelope write/resume/expiry/renewal/closure-invariant,
  delete-on-consume + stale-answer-not-reused, skill-slugging in both write and
  lookup paths, and non-numeric-config fallback
- `hooks/test/metrics-stop-dispatch.test.sh` — 12/12, byte-for-byte parity,
  size-guard behavior, malformed-transcript-emits-one-payload, and
  quoted-model-name-produces-valid-JSON
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

**63/63 tests passing** across all suites (Python: 32 including the pre-existing
`hive/lib/metrics` suite; JS: 19; bash: 12).

## Review-round summary (for reviewers)

This PR went through three rounds of CodeRabbit review before being presented for
human review. Rather than re-summarize every finding here, the short version:

- **Round 1** (8 findings, 6 fixed): envelope filename collision risk, unsanitized
  `skill` path component, silently-masked parse failures, non-numeric config value
  not validated, an incorrect "5 questions" claim that would have dropped 3
  kickoff settings from headless mode, a missing phase-id table entry.
- **Round 2** (12 findings, 5 fixed + 2 proactively addressed): NaN-producing config
  fallback, missing `run_id` on the Stop hook's skip row, conditional follow-up
  questions within one phase that couldn't actually re-prompt (fixed by batching
  or round-counters), cross-topic envelope collision risk in `/design` (fixed by
  topic-scoped phase ids), plus proactively documenting the round-resume algorithm
  for loop-driven touchpoints.
- **Round 3** (12 findings, 6 fixed): **delete-on-consume** (the most significant
  fix — a real correctness bug, not just a documented limitation, see above), a
  symmetric slugging bug introduced by round 1's own fix, a self-contradictory
  doc note, a miscounted qid claim, JSON-injection and partial-output-corruption
  bugs in the Stop hook, and unbounded model-cardinality growth.

Two findings were deliberately not changed (held the same position across multiple
review rounds, explained inline both times): the JS/Python naming convention
(matches this repo's existing `config.js`/`config.py` precedent) and a suggestion
to maintain a separate durable resume-state file for `/design`'s touchpoints instead
of probing envelopes on demand (probing is simpler, bounded, and avoids a second
source of truth).

## Planning artifacts

Full design discussion, adversarial grill pass, horizontal/vertical plans, and story
decomposition at `.pHive/epics/headless-question-protocol/`. Story YAMLs there
carry `IMPLEMENTATION NOTE` blocks documenting every place the final shipped
behavior diverged from the original plan-time estimate (phase counts, question
counts, the 14c descope, delete-on-consume) — kept as an honest record rather than
silently rewriting the planning docs to match reality after the fact.
