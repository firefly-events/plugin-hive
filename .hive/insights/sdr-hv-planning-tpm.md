# Insights — state-dir-resolver H/V planning (TPM)

Non-obvious, reusable learnings surfaced during the H/V pass.

## 1. Conformance fixture > "watch for drift"

When the same contract must hold across N runtimes (here: shell, Node, Python), the
default temptation is to write three independent implementations + reviewer vigilance.
That doesn't scale. The grill-record P1/H1 lock landed on a **shared golden test
vector** — one fixture, three test harnesses, identical-path assertion. This converts
the #1 cross-runtime risk from "watch for divergence" into a **gated CI invariant**.

Reusable pattern: any time a contract crosses runtimes, the *first* deliverable should
be the conformance fixture, not the implementations. Implementations become consumers
of the fixture. Saves arguing about edge cases mid-implementation.

## 2. Characterize-test the spec, don't redesign it

Shell `_resolve_state_dir()` already works for hooks. The temptation when porting to
two more runtimes is to redesign the resolver "properly." The grill-H2 ruling chose
the opposite: **pin the existing shell behavior with a characterize test, THEN make it
the cross-runtime spec.** That eliminates a class of "we improved it slightly" drift
bugs.

Reusable pattern: when porting an existing implementation to new runtimes, write the
characterize test from observed behavior of the reference (not from docs / intent),
and treat any deviation as a bug in the new port, not a feature in the old one.

## 3. "Policy fixed, transient state relocates" is not split-brain

Q1 ruling on DAG-executor: `.pHive/hive.config.yaml` (executor opt-in) and the runtime
registry stay FIXED; run-state outputs relocate through the resolver. On first read
this looks inconsistent. On second read it's a clean **policy vs transient state**
split: opt-in policy is a durable consumer contract (other code keys off the literal
path); run-state is per-execution scratch.

Reusable pattern: when a subsystem has hardcoded paths that look like relocation bugs,
classify each path as **policy / contract / transient** before mechanical rewrite.
Contracts and policy locks are not bugs.

## 4. Run-state archival — temp dir is the ARCHIVE, not the live location

The earlier design discussion floated "move run-state to a temp dir to avoid the
orphan-gap." Maintainer rejected that direction because run-state must survive
suspend/resume; temp wouldn't be durable. The refined Q1 decision flips the model:
**temp is the archive destination for aged terminal runs**, not the live location.
Live + suspended runs stay durable under `<state_dir>/runs`; only terminal runs older
than threshold get moved to temp, where OS purge reclaims them.

That's the elegant reconciliation: durability AND footprint bounding. Reusable pattern:
when a design has a footprint-bounding goal that conflicts with a durability goal,
look for a **time-bound** state classifier (here: terminal + age) that lets you satisfy
both — durable while live, ephemeral once done.

## 5. Suspend-aware guard is non-negotiable

The archival sweep MUST consult run-state status. Archiving an active or suspended run
destroys resumable state — the worst possible failure mode of an "automated cleanup"
job. The slice's hard guard (`active | suspended → SKIP regardless of age`) plus a
`--dry-run` mode is not optional polish; it's the difference between a sweep that
saves disk and a sweep that loses work.

Reusable pattern: any automated cleanup that touches state with lifecycle must have
(a) a status-consulting hard guard, (b) a dry-run mode, (c) tests that simulate
the unsafe-to-clean states. Treat (a)–(c) as part of the v1 slice, not v2.

## 6. Subsystem-coherent slicing > mechanical batching

The brief found 41 actionable clusters across ~14 Node modules + ~6 Python modules +
shell + prose. A naive plan would slice by file count ("5 files per slice"). The
better cut is **one coherent subsystem per slice** (story/session, metrics,
snapshot+triage, task/release/handoff, scenarios/audits, DAG run-state). Each subsystem
slice is reviewable on its own merits (the cluster either honors the resolver or it
doesn't), and the working-state invariant is meaningful (the subsystem works end-to-end
under the configured state dir, not "5 random files changed").

Reusable pattern: when slicing a horizontal scan, prefer subsystem boundaries over
file-count boundaries. Subsystem boundaries already exist in the codebase as
import graphs and ownership; you don't have to invent them.

## 7. Env-override precedence wording is a load-bearing detail (Q2)

`design-discussion.md` §1 said "config-first, with env as override." Reviewers read
that as "config wins; env is a tie-breaker." `design-decisions.md` Q2 corrected it to
**env-override → config → default**: env wins when set; absent env hits config (never
skips to default). The two phrasings sound similar but ship different code.

Reusable pattern: precedence rules need ordered-list spelling-out (1. X, 2. Y, 3. Z)
in the binding decision doc, not narrative prose. Narrative phrasing of precedence is
where cross-runtime drift originates.
