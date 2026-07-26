# Grill Record — headless-question-protocol

**Source draft:** .pHive/epics/headless-question-protocol/docs/design-discussion.md
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** absent (heuristic pass — research brief predates this field)
**round_number:** 1
**unresolved_count:** 5
**Generated:** 2026-07-25T22:45:00Z

## Summary

- Vocabulary mismatches: clean
- Hidden assumptions: 2 findings
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: clean

## Vocabulary mismatches

Clean — no CONTEXT.md term contradictions found; "headless" / "interactive" usage is
consistent throughout the draft.

## Hidden assumptions

- **H1** — Draft assumes a TTY probe (`sys.stdin.isatty()` / `[ -t 0 ]`) run via the Bash
  tool is a meaningful signal for "is a human present in this Claude Code session."
  - Draft location: §2.1a, tier 3 ("TTY probe fallback")
  - Why this matters: a Bash tool invocation's subprocess stdio is whatever Claude Code's
    shell wrapper provides, which may not reflect whether the *session* is interactive from
    a human's perspective — an interactive Claude Code session's Bash tool calls could
    plausibly report non-tty regardless, making tier 3 either always-false (harmless but
    dead code) or occasionally wrong (a human session misclassified as headless). This
    hasn't been verified against actual Claude Code Bash-tool behavior.
  - Question for planner: is tier 3 worth keeping if its behavior is unverified, or should
    the design drop the TTY fallback and rely on tiers 1-2 (`HIVE_HEADLESS`, `CI=true`) plus
    the safe interactive default — accepting that a naive `claude -p` invocation that sets
    neither env var falls through to interactive (which is safe, just non-optimal) rather
    than risk a fallback that could misfire in the other direction?

- **H2** — Draft asserts the streaming `jq` rewrite of `metrics-stop-dispatch.sh` "stays
  well under the 15s timeout" for the proposed 10MB default, with no measurement cited.
  - Draft location: §5 Open Question 2
  - Why this matters: if the assumption is wrong, the size-guard default is set from a
    guess, not a bound — exactly the problem this story is trying to fix, just moved to a
    different constant.
  - Question for planner: should the corresponding story require an actual benchmark
    (synthetic large-transcript fixture, timed) before picking the default, rather than
    shipping the 10MB guess as-is?

## Unresolved tensions

- **U1** — The request explicitly asks to bound the Stop hook "so it can't stall background
  sessions," but §2.2 explicitly declines to detect background/`--bg` sessions at all,
  substituting a universal cost-bound instead.
  - Draft location: §2.2 "Not proposed" paragraph
  - Tension: the literal ask names background sessions specifically; the draft's mitigation
    protects *all* sessions equally (which is a superset that covers the ask, but isn't the
    same shape as what was requested) and never says so explicitly to the user before now.
  - Question for planner: is "bound the hook for everyone, since we can't reliably target
    just background sessions" an acceptable substitution to present as the resolution, or
    does the user want this called out explicitly as a scope decision before stories are
    written (rather than buried in a "not proposed" aside)?

- **U2** — The gateway design (§2.1) doesn't state whether a single question envelope holds
  *all* of a skill-phase's pending prompts (batched) or whether each individual "Ask:" point
  gets its own envelope + a full skill re-invocation to resume.
  - Draft location: §2.1b-c (envelope schema shows one `questions:` list, implying batching,
    but §2.1c's "re-invokes the same skill command" language is written per-question)
  - Tension: kickoff alone has 7+ prompt points across phases (research brief Part 1 lists
    lines 13/22/24/26/36/41/46 plus kickoff-protocol.md's elicitation and discovery blocks).
    If each one is a separate envelope + separate full-skill re-run, a headless kickoff could
    require 7+ round trips through an entire skill re-invocation — expensive and slow for a
    driving orchestrator, arguably worse than the prose-scraping workaround it replaces.
  - Question for planner: should envelopes batch to phase-boundary granularity (one envelope
    per skill *phase*, covering all prompts within that phase) rather than per-question, to
    bound round trips? This changes the story slicing for kickoff integration either way.

## Convention violations

- **C1** — The new `metrics.stop_dispatch_max_transcript_bytes` config knob (§2.2b) doesn't
  state a resolution-precedence tier, unlike every other config knob introduced elsewhere in
  this draft and in this codebase's established pattern.
  - Draft location: §2.2b
  - Convention: this repo documents explicit env-over-config-over-default precedence for
    every comparable knob (e.g. `hive.config.yaml`'s `planning.mode` / `sidecar_retention`
    resolution chains, and this draft's own §2.1a for `HIVE_HEADLESS`) — `hive/references/skill-prelude.md`'s "Root-first config precedence" subsection is the canonical pattern.
  - Question for planner: confirm the new knob follows the same root-config-first pattern
    (root `hive.config.yaml` → shipped `hive/hive.config.yaml` baseline → hardcoded default),
    with no env override needed (this one isn't likely to need a per-invocation override), and
    say so explicitly in the story so it isn't implemented ad hoc.

## Posture mismatches

Clean — the shared question-gateway primitive sits in `hive/lib` alongside existing
cross-skill primitives (`config.py`/`config.js`, `git_flow.py`), consistent with the
composable-substrate posture rather than violating it.

## Notes

The plan for this epic is being authored by Claude directly, in-session, rather than through
Codex-backed researcher/writer personas — a deviation from the `feedback_codex_general_backend`
convention noted in CONTEXT.md. This was an explicit, disclosed user choice (lightweight
in-session planning, confirmed via AskUserQuestion at the top of this session), not an
oversight, and is consistent with the "user-directed, not director-chair" posture — noted
here for the record, not raised as a finding.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each
finding above ends with a question for the planner; resolving them (by revision or explicit
accepted-deviation) happens next, before stories are written.
