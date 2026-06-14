# Grill Record — state-dir-resolver

**Source draft:** `.pHive/epics/state-dir-resolver/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (5 signals)
**Generated:** 2026-06-08T06:05:00Z

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 2 findings
- Unresolved tensions: 2 findings
- Convention violations: clean
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — "config-first" (the requirement's own words, restated at lines 5, 9, 23) contradicts the proposed precedence at lines 142–148 / 206, which puts `HIVE_STATE_DIR` env **first** when present. Under the proposed rule the resolver is config-first only in the absence of env — i.e. env-first-then-config. The draft uses "config-first" as the headline promise while specifying env-override behavior.
  - Draft location: line 23 ("config-first by default, with `HIVE_STATE_DIR` as an explicit override") vs line 144 ("1. Explicit `HIVE_STATE_DIR` environment override, when present.")
  - Reference: requirement text "config-first, cwd-fallback"; `.pHive/CONTEXT.md` state-dir glossary
  - Question for planner: is the contract "config-first" (config wins, env only fills the unset case) or "env-override" (env wins when set)? Pick one term and use it consistently — the two readings produce different behavior for a developer who exports `HIVE_STATE_DIR` in a shell that also has a configured `paths.state_dir`.

## Hidden assumptions

- **H1** — The draft assumes the Node and Python resolvers can "mirror" `_resolve_target_project()` / relative-path canonicalization (lines 85–86, 90–94) identically to the shell implementation, without citing how target-project resolution actually works in `hooks/common.sh` or whether it shells out / reads additional state.
  - Draft location: lines 85–86 ("Resolve `paths.target_project` using the same target-project/cwd semantics as `_resolve_target_project()`")
  - Why this matters: if the three implementations canonicalize relative paths even slightly differently (symlink handling, trailing slash, `target_project: null` fallback to cwd), state splits across directories — which is the draft's own #1 High risk (line 158).
  - Question for planner: should the epic carry a shared cross-runtime conformance fixture (one set of input→expected-path cases all three resolvers must satisfy) as the drift guard, rather than three independently-written unit suites?

- **H2** — The draft treats `_resolve_state_dir()` as the authoritative "reference contract" (lines 19, 96, 182) but the brief notes it has only ever been exercised by metrics + interrupt hooks. Its behavior for absolute `paths.state_dir`, `target_project: null`, or already-canonical paths is assumed correct, not verified.
  - Draft location: line 182 ("The shell resolver is the reference contract")
  - Why this matters: if the reference itself has an untested edge case, mirroring it faithfully propagates the bug to two more runtimes.
  - Question for planner: should story 1 include a characterization-test pass that pins the shell resolver's current behavior across edge inputs *before* it becomes the cross-runtime spec?

## Unresolved tensions

- **U1** — Requirement wording ("config-first") vs proposed env-override precedence. The draft acknowledges the `release_post.mjs`-vs-`common.sh` split (risk signal 1, line 166) and *resolves* it toward env-override — but that resolution silently overrides the requirement's "config-first" framing rather than flagging that it changes the contract.
  - Draft location: lines 23, 144–148, 166
  - Tension: honoring existing env-injection ergonomics (scripts/tests) vs honoring the literal "config-first" requirement.
  - Question for planner: is overriding the requirement's "config-first" wording an accepted, documented decision (and does the maintainer affirm env-override at the open-questions gate, Q2)?

- **U2** — DAG-executor split-brain. The draft keeps `.pHive/hive.config.yaml` and `.pHive/runtime/...` **fixed** (lines 138, 140, 200) but relocates `.pHive/runs` and `.pHive/meta-team/worktrees` **through the resolver** (line 139). Both currently live under the same `.pHive` root; after relocation the executor reads its opt-in config from a fixed `.pHive` path while writing run-state to a relocated `<state_dir>/runs`.
  - Draft location: lines 138–140
  - Tension: "consumer-side lock" (config location is a contract) vs "runtime state relocates" — applied to two path families rooted in the same directory.
  - Question for planner: is a one-subsystem split (fixed config root + relocated run-state) actually coherent, or should the DAG executor be all-fixed or all-relocated until the opt-in-location question (Q1) is answered?

## Convention violations

No findings. The draft correctly honors root-first config precedence (root `hive.config.yaml` over shipped baseline), reuses the existing `${HIVE_STATE_DIR}` prose convention rather than inventing a placeholder, and respects the maintainer-override layer. Consistent with project feedback memos on config precedence and BYO-enhancements.

## Posture mismatches

- **P1** — Three parallel resolver implementations (shell + Node + Python, lines 15–19) is a defensible practical choice, but it departs from the single-source-of-truth posture without proposing a drift-prevention mechanism. The draft names cross-runtime divergence as its top risk (line 158) yet the mitigation is only "add tests per runtime" (lines 226–240) — three independent suites can each pass while diverging from each other.
  - Draft location: lines 15–21, 158, 226–240
  - Posture reference: composable-substrate / single-source-of-truth (`.pHive/CONTEXT.md`); the shell resolver is already declared canonical (line 19)
  - Question for planner: should the design make the shell resolver's behavior the *executable spec* (shared golden fixture consumed by all three runtimes' tests — see H1), so "mirror" is enforced rather than asserted?

## Notes

The draft is coherent and decision-ready; findings cluster on one theme — **cross-runtime fidelity is asserted, not enforced.** V1/U1 (precedence wording), H1/P1 (shared conformance fixture), and H2 (characterize-before-spec) all point at the same structural strengthener: pin the shell resolver's behavior as a shared test vector and make the other two runtimes prove conformance against it. That single addition would convert the draft's #1 risk from "watch out for divergence" into a gated invariant. Recommend the structured outline carry a dedicated "resolver contract + conformance fixture" story ahead of subsystem adoption.

## Out of scope (this pass)

Grill does not propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner revises the draft (or documents accepted deviations) before stories are written.
