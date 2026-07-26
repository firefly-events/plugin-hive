# Design Discussion — Headless Question Protocol

**Epic:** headless-question-protocol
**Source:** `docs/scope/plugin-hive-headless-question-protocol.md`
**Date:** 2026-07-25

## 0. Prelude

No prior KG decisions matched (`/hive:why` query against this topic returned zero results —
clean slate). No `north_star` block present in `.pHive/project-profile.yaml` (file doesn't
exist yet — this repo hasn't run `/hive:kickoff`; `gate_mode: warning` applies, planning
proceeds with sane defaults per the skill prelude).

## 1. Goal

Make plugin-hive's user-input surfaces (kickoff's elicitation prompts, design's wireframe
touchpoints, plan's release/sidecar prompts) drivable by a headless orchestrator — Minerva
today, any FFE-swarm agent tomorrow — without the orchestrator having to scrape prose out of
a transcript. Two independent-but-bundled deliverables, per the scope doc and this epic's
scoping:

1. **Headless question protocol** — structured, machine-readable question emission +
   symmetric answer intake, activated only when no interactive user is present; zero behavior
   change when a user IS present.
2. **Bound the global Stop hook** — `metrics-stop-dispatch.sh` currently does an unbounded
   full-transcript slurp-and-parse on every session close (`matcher: ""`, fires always), with
   no size guard. On large transcripts this is a real per-session tax that can make
   `claude --bg` sessions (exactly the kind a headless orchestrator drives) slow to close or
   appear to hang.

These are bundled into one epic (per your choice) because they share a root motivation —
*plugin-hive needs to behave predictably when nobody is watching* — even though they touch
different subsystems (skills/prompts vs. a hook script) and have no code dependency on each
other. They will ship in one PR to `firefly-events/plugin-hive`.

## 2. Proposed approach

### 2.1 Headless question protocol

**Core architectural decision: one shared "question gateway" primitive, not three ad-hoc
patches.** Research confirmed 15+ blocking prompt sites across kickoff (prose "Ask the user"),
design (`AskUserQuestion` touchpoints), and plan (`AskUserQuestion`-shaped prose confirms).
Patching each skill's prose independently would produce three slightly different
"is-headless" checks and three slightly different envelope shapes — exactly the drift the
scope doc is trying to eliminate. Instead:

**a. Runtime-mode detection helper** — `hive/lib/runtime_mode.{py,js}` (dual-implemented,
matching the existing `config.py`/`config.js` convention), exposing one function:
`detect_interactive_mode()` → `{ mode: "interactive" | "headless", source: "env" | "ci" | "tty" | "default" }`.
Precedence (matches this repo's existing env > config > default idiom used for
`planning.mode` resolution):
1. Explicit override — `HIVE_HEADLESS=1` forces headless, `HIVE_HEADLESS=0` forces
   interactive. This is the primary, reliable signal: a driving orchestrator (Minerva, an FFE
   swarm agent) sets it before invoking `claude -p`.
2. `CI=true` — treated as headless (standard CI convention).
3. **Default: interactive.** This is the backward-compatibility guarantee (requirement #4 in
   the scope doc) — an unrecognized environment never silently starts writing envelope files
   instead of asking the user.

**No TTY-probe tier.** An earlier draft included a `sys.stdin.isatty()` fallback as tier 3.
Dropped after review: a Bash-tool subprocess's stdio reflects whatever Claude Code's shell
wrapper provides, not whether a human is actually present in the session — that signal is
unverified and could misfire in either direction. Relying on it for a real behavior change
(writing an envelope instead of asking) is worse than the alternative: a naive `claude -p`
invocation that sets neither `HIVE_HEADLESS` nor `CI` simply falls through to interactive
(tier 3 above), which is safe — it just means that orchestrator doesn't get the benefit until
it sets the env var, which is documented as the required contract.

**b. Question envelope schema** — `hive/references/question-envelope-schema.md`, following
this repo's established schema-doc convention (Purpose/Data-shape/Cardinality/Storage-rule
table, mutation-rules with an explicit transition table, closure invariant, worked examples,
"does NOT commit to" closing fence — same shape as `triage-queue-schema.md`). Target path:
`.pHive/questions/<skill>-<invocation-id>.yaml`, one file **per skill phase**, batching every
pending prompt within that phase into one `questions:` list — not one file per individual
question. Kickoff alone has 7+ distinct prompt points across its phases; a per-question
envelope + full-skill-re-invocation round trip for each one would make headless kickoff
slower and more brittle than the prose-scraping workaround it's replacing. Batching at the
phase boundary means a headless run costs roughly one round trip per phase (research brief
counts ~4-5 distinct phases in kickoff-protocol.md), not one per prompt. Fields deliberately
mirror `AskUserQuestion`'s own shape so the gateway can pass either path through with no
translation loss:

```yaml
id: kickoff-2026-07-25T22-10-00Z
skill: kickoff
phase: "1a"                       # skill-defined phase/step id, for resumability
status: pending                   # pending -> answered (single forward transition)
provenance:
  raised_by: kickoff
  raised_at: "2026-07-25T22:10:00Z"
questions:
  - qid: metrics-opt-in
    text: "Enable metrics tracking?"
    kind: single-select            # single-select | multi-select | free-text
    options: ["yes", "no"]
    required: true
    answer: null                   # filled in-place by the orchestrator on submit
```

**c. Symmetric answer intake — renewable deadline, not a poll loop.** The orchestrator writes
`answer:` (and flips `status: answered`) directly onto the same envelope file, mirroring
Minerva's own `submitAnswers` shape per the scope doc's explicit compatibility requirement.
The skill invocation itself always follows the simple path: write the envelope, print a
structured `AWAITING_ANSWERS` status block to stdout, exit cleanly. No process sits in a
poll loop — that idea from the previous revision is dropped per your correction; you weren't
asking for the skill to hold a session open and watch a file, you were asking for control over
*how long an answer stays valid to wait for*, the same way an OAuth token has a renewable
expiry rather than a fixed one-shot deadline. That's a property of the **envelope**, not of
the skill process:

```yaml
id: kickoff-2026-07-25T22-10-00Z
skill: kickoff
phase: "1a"
status: pending                   # pending -> answered (terminal) | pending -> pending (renewed)
provenance:
  raised_by: kickoff
  raised_at: "2026-07-25T22:10:00Z"
deadline: "2026-07-25T22:40:00Z"  # raised_at + headless.answer_deadline_seconds; renewable
renewal_count: 0                  # incremented each time an orchestrator extends deadline
questions: [ ... ]                # unchanged from 2.1b
```

- **`headless.answer_deadline_seconds`** (new config, root-first precedence) sets the initial
  `deadline` at envelope-creation time. Default is deliberately generous, not a short ceiling —
  this repo already runs Multica personas/stories with 1800s (30-min) timeouts
  (`planning.multica.persona_timeout_seconds`, `execution.multica.story_timeout_seconds`), so
  the default answer deadline matches that precedent: 1800s, overridable per-project.
- **Renewal** — before `deadline` lapses, an orchestrator that's still working on producing an
  answer (e.g. waiting on its own upstream human-in-the-loop) writes a fresh, later `deadline`
  and increments `renewal_count` — the same envelope, the same `pending` status, just an
  extended expiry. This is the OAuth-refresh shape you asked for: renew before expiry to keep
  the request alive, rather than a fixed timeout or a process sitting in a loop.
- **Expiry handling** — on re-invocation, the skill checks the matched envelope for its
  current phase: `status: answered` → consume and proceed (unchanged from before).
  `status: pending` and `now < deadline` → still valid, nothing to do differently, re-exit
  with the same `AWAITING_ANSWERS` status (the orchestrator hasn't answered yet, that's fine).
  `status: pending` and `now >= deadline` with no renewal → **expired**, governed by
  `headless.deadline_expired_action`: `re-emit` (default — write a fresh envelope with a new
  deadline and exit again, non-destructive) or `fail` (hard error, for orchestrators that want
  an expired deadline treated as unrecoverable).

This is simpler than the poll-mode design it replaces — one behavior for the skill process
(always exit-on-write), one new orthogonal piece of state on the envelope (a renewable
deadline) that the orchestrator controls entirely through ordinary writes to the same file it
already writes answers to. On re-entry, the skill checks `.pHive/questions/` for an
`answered`-status envelope matching its current phase before re-prompting, consumes it, and
continues to the next phase — which may itself pause on a new phase-scoped envelope. Net
effect: a fully headless kickoff run costs one round trip per **phase**, not per **question**
(see batching decision in 2.1b), and an orchestrator that needs more time than the default
deadline extends it explicitly instead of racing a hardcoded clock.

**d. Call-site integration** — kickoff (`skills/kickoff/SKILL.md`,
`hive/references/kickoff-protocol.md`) and plan (`skills/plan/SKILL.md` steps 0/14b/14c) route
their prose prompts through the gateway. Design's two `AskUserQuestion` touchpoints
(`skills/design/SKILL.md:123`, `hive/references/wireframe-protocol.md`) route through the same
gateway when headless — **this is slightly broader than the literal request wording ("kickoff
and plan skills"), but the scope doc's own "Why" section cites design's `AskUserQuestion`
usage as evidence of the gap**, and the shared-gateway architecture makes including it nearly
free (one more call site through the same primitive) versus leaving a known gap. Flagged as
Open Question 1 below for explicit confirmation rather than assumed.

**e. Backward compatibility** — when `detect_interactive_mode()` resolves to `interactive`,
the gateway calls `AskUserQuestion` (or emits the existing prose) exactly as today; the
envelope-writing branch is never entered. This is a pure additive branch, not a rewrite of the
interactive path.

### 2.2 Bound the global Stop hook

Two independent fixes, both defense-in-depth (neither depends on confirming exactly how
Claude Code enforces hook timeouts internally — treated as an unconfirmed assumption, see
Risks):

**a. Remove the unbounded slurp.** `hooks/metrics-stop-dispatch.sh:111-130` uses
`jq -c -s` (slurp) to load the entire JSONL transcript into memory before aggregating. Since
the transcript is already one JSON object per line, this doesn't need slurp mode — replace
with a streaming aggregation (`jq -c` without `-s`, or an `awk`/incremental-sum pass) that
never holds the full transcript in memory and processes it as a true single pass. This is the
actual O(n)-memory fix, not just a time cutoff.

**b. Add an explicit size/line-count guard, in-script, before any parse is attempted.** A new
config knob `metrics.stop_dispatch_max_transcript_bytes` — resolved root `hive.config.yaml` →
shipped `hive/hive.config.yaml` baseline → hardcoded default, the same root-first precedence
documented in `hive/references/skill-prelude.md`'s "Root-first config precedence" subsection
that every other knob in this doc follows (no env-override tier needed; this is an infra
tuning knob, not a per-invocation runtime toggle). If the transcript exceeds it, skip the
parse, log one line to the existing metrics-events stream noting the skip (not silent), and
exit 0. This removes reliance on the harness-level `timeout: 15` as the *only* backstop — the
script bounds its own worst case regardless of how reliably the external timeout is enforced.
The default byte threshold is not being guessed — the implementing story must benchmark the
streaming rewrite (2.2a) against a synthetic large-transcript fixture and pick a threshold
with a measured margin under the 15s timeout, not assume one (see Open Question 2).

Both fixes extend the existing `|| true` + `trap 'exit 0' ERR` convention (already the
documented shared idiom per `hooks/notify-agent-complete.sh:17-19`) rather than replacing it —
"metrics failure must not suppress sentinel" stays true, we're just making the *normal* path
cheap instead of relying on the *failure* path to save it.

**Explicit scope decision — surfaced for your confirmation, not assumed:** the request names
background sessions specifically ("so it can't stall background sessions"). This design
deliberately does **not** try to detect "is this a `claude --bg` session" and skip the hook
only for those — research found no existing signal for that (`HIVE_BACKGROUND`/`--bg` reaches
`skills/execute`'s dispatch mode, not the hook layer), and introducing one would mean
asserting an unverified Claude Code CLI behavior. Instead, the fix bounds cost for **every**
session, background or not. This is a superset of what was asked (it covers the background
case) but isn't the same shape as "detect and skip for background" — flagged explicitly as
Open Question 4 rather than silently substituted.

## 3. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Claude Code's Stop-hook timeout enforcement behavior (does it kill the process cleanly at 15s?) is unverified from inside this repo | medium | Design doesn't depend on it — the in-script size guard bounds cost independent of harness enforcement |
| Expanding scope to include design's `AskUserQuestion` touchpoints is broader than the literal request | low | Flagged as Open Question 1; cheap to descope if you say no |
| A shared question-gateway primitive is new cross-cutting infra — higher review surface than 3 independent patches | medium | The alternative (3 divergent envelope shapes) is the exact failure mode the scope doc is trying to prevent; one primitive is more auditable, not less |
| `HIVE_HEADLESS` env-var convention doesn't yet exist anywhere — Minerva/FFE swarm need to actually set it | medium | Documented explicitly in the new schema doc + PR description; an invocation that forgets it safely falls through to interactive (no silent envelope-writing) rather than misbehaving |
| Streaming rewrite of `metrics-stop-dispatch.sh`'s jq aggregation could subtly change what gets counted (e.g. edge cases in `select(.type == "assistant" and .message.usage != null)`) | medium | Story includes a fixture-transcript regression test comparing old-slurp vs new-streaming output byte-for-byte before cutover |

## 4. Dependencies

- No dependency between the two workstreams (question protocol vs. stop hook) — they can be
  built and reviewed as parallel story clusters within the epic.
- Question-gateway lib + schema is a hard prerequisite for all three skill-integration stories
  (kickoff, design, plan) — those stories `depends_on` it.
- Stop-hook streaming rewrite and the size-guard are best done together (one story) since the
  guard needs to sit in front of whichever aggregation method is used.

## 5. Open questions — resolved

1. **Include design's `AskUserQuestion` touchpoints?** → **Yes.** Design's two touchpoints are
   in scope; §2.1d stands.
2. **Answer-intake control** → resolved by redesigning §2.1c: a renewable `deadline` field on
   the envelope (OAuth-refresh shape, per your correction — not a poll loop), generous default
   (1800s, matching this repo's existing Multica timeout precedents), extendable via ordinary
   writes to the same envelope, with a non-destructive default expiry action (`re-emit`, not
   `fail`).
3. **`HIVE_HEADLESS` env var name** → **Confirmed.**
4. **Universal cost-bound vs. background-specific detection for the Stop hook** → **Confirmed**
   (with reassurance noted): bounding cost for every session is a strict superset of "protect
   background sessions" — interactive sessions get the same cheap streaming parse, nothing
   gets slower or behaves differently for them. It only becomes the wrong call if some session
   class specifically *wants* the old unbounded full-fidelity slurp, and nothing in this repo
   or the request suggests that's true.
5. **`metrics.stop_dispatch_max_transcript_bytes` default value** — still open at the *number*
   level (not a design disagreement): the implementing story benchmarks the streaming rewrite
   against a synthetic large-transcript fixture and derives a threshold with measured margin
   under the 15s timeout, rather than shipping a guess (per grill finding H2). No action needed
   from you unless you have a target transcript size in mind before that story runs.

## Grill resolution

Round 1 grill (`.pHive/epics/headless-question-protocol/docs/grill-record.md`) surfaced 5
findings — 2 hidden assumptions, 2 unresolved tensions, 1 convention violation, 0 vocabulary
mismatches, 0 posture mismatches. All 5 resolved by revision above: H1 (TTY-probe reliability)
by dropping the tier entirely; H2 (unmeasured jq-streaming assumption) by requiring a
benchmark in the implementing story instead of asserting a number; U1 (background-detection
substitution) by surfacing it as Open Question 4 instead of an unstated design choice; U2
(per-question vs. per-phase envelope granularity) by committing to phase-boundary batching;
C1 (missing config precedence) by stating the root-first resolution chain explicitly. No
findings were accepted-as-deviation without a change — `unresolved_count` for this draft is
now 0.

## 6. Scale assessment

**Medium.** Multi-file (skills/kickoff, skills/design, skills/plan, hooks/, hive/lib/,
hive/references/), multiple layers (prompt-level skill prose, a new shared lib primitive, a
bash hook script, a new schema doc), single repo, no migration of existing data, roughly
6-8 stories. Not Large: no multi-system integration, no long-horizon phased rollout, bounded
entirely within this one plugin repo. Recommend: run Horizontal + Vertical planning
(Phase B2) to slice the shared-gateway-first dependency correctly, then straight to stories —
skip the structured-outline phase (Large-only).
