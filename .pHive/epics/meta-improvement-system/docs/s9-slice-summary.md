# S9 — B-L2 Cycle: First End-to-End `/meta-meta-optimize` Run (MVL) — Slice Summary

**Status:** complete
**Milestone:** MVL (Minimum Viable Loop)
**Branch:** `meta-improvement-system-s9` (stacked on `meta-improvement-system-s8`)
**Stories:** BL2.1, BL2.2, BL2.3, BL2.4, BL2.5, BL2.6 (all shipped)
**Execution mode:** sequential (strict dependency chain)
**Commits:** 10 on s9 (6 story integrate commits + 2 proving-run experiment commits + 1 auto-revert commit + 1 infrastructure-only commit)

## What shipped

S9 is the MVL slice — it makes the `/meta-meta-optimize` maintainer cycle *genuinely executable* end-to-end, proven by two live runs on the branch itself. The slice binds BL2.1's concrete promotion adapter, BL2.2's live skill orchestration, BL2.3's evidence composition, BL2.4's armed regression watch, BL2.5's first clean cycle, and BL2.6's deliberate-regression auto-revert proof into a single working control plane.

| Story | Role | Key artifact |
|-------|------|--------------|
| BL2.1 | Concrete maintainer `PromotionAdapter` — worktree-native, ff-only + cherry-pick fallback, discard-on-failure | `hive/lib/meta-experiment/direct_commit_adapter.py` (+ `PromotionFailure` exception); 11 tests |
| BL2.2 | Live skill orchestration over rewritten 8-step control plane; dry-run scaffold retired | `maintainer-skills/meta-meta-optimize/SKILL.md` rewritten; 9 text-inspection tests |
| BL2.3 | Compose baseline + metrics + compare + close validation into live path; placeholder rejection in close gate; preserve PR-only evidence shape for S10 | `closure_validator.py` placeholder guards; step-01/06/08 wiring; 11 integration tests |
| BL2.4 | Arm real `regression_watch` on committed experiments; bind `DirectCommitAdapter.rollback` as auto-revert callback; persist rollback_result to envelope for later proof citation | `rollback_watch.arm_watch` + `make_direct_commit_auto_revert`; `envelope.set_observation_window`; 10 activation tests |
| BL2.5 | First live `/meta-meta-optimize` cycle against a dormant archive candidate; verification doc with durable artifact refs | `scripts/run_first_live_cycle.py`; `.pHive/audits/mvl-proof/2026-04-22T10-29-48Z/proof.yaml`; real promotion commit `96d4100`; 7 structural tests |
| BL2.6 | **MVL integrity gate.** Real commit-then-revert proof: deliberate threshold-exceeding regression → live `regression_watch → closure gate → auto-revert` path → real `git revert` on the branch | `scripts/run_rollback_realism_proof.py`; `.pHive/audits/mvl-proof/2026-04-22T10-41-35Z/proof.yaml`; real commits `548c2f6` (regressive) + `c869413` (auto-revert); 10 E2E tests |

## Test coverage

- **Targeted (new to S9):** 47 tests added across 4 new files (direct-commit adapter, skill orchestration, live cycle integration, rollback-watch activation, first-live-cycle, rollback-realism E2E)
- **Full `tests/meta_meta/` suite:** **69 tests passing** (was 26 at end of S8)
- **Lib unit tests (`hive/lib/meta-experiment/tests/`):** **64 passing** (no regression; required `--import-mode=importlib`)

## Escalations resolved

**`rollback-realism-proof-ambiguity`** (MAJOR, scope S9/BL2.4/BL2.6): **RESOLVED**. The reviewer's 10-item integrity checklist passed unanimously — both commits resolve via `git rev-parse --verify`; the revert's parent IS the regressive commit (no history rewrite); the proof artifact's three integrity flags (`manual_revert_used`, `mock_callback_used`, `synthetic_closure_used`) are all `false`; no mock-family imports in the script; callback is a bound `DirectCommitAdapter.rollback` method; `evaluate_watch` ran with `envelope_writer=envelope` so the trip + rollback_result landed on disk. CI-replayable via `test_rollback_realism_e2e.py`.

## Architectural guardrails engaged

1. **A2.1–A2.5 authority model preserved.** Step 1-7 remain output-graph-only; step 8 is the single lifecycle-writer. BL2.3's wiring explicitly emits `metrics_snapshot` + `commit_ref` + `rollback_target` via the output graph; step-8 assembles the envelope (renaming `rollback_target` → `rollback_ref` at the single canonical point) before invoking `closure_validator.validate_closable`.
2. **Two-swarm boundary held.** The maintainer skill stays path-locked to `maintainer-skills/`, uses `DirectCommitAdapter` only, never registers in `plugin.json`, and forbids PR-flow semantics.
3. **Worktree isolation mandatory.** Both live runs created `.pHive/meta-team/worktrees/{cycle_id}/`, executed inside, and cleaned up on close. `git worktree list` returns to main-only after each run.
4. **Closure evidence shape preserved.** The shared validator accepts `commit_ref` XOR `pr_ref`; BL2.3's placeholder guards (`TBD`, `pending`, `N/A`, `unknown` — case/whitespace normalized) cover both fields plus `rollback_ref`. S10's PR-only close records remain compatible without refactoring.
5. **No-stub realism.** BL2.4's activation tests prove the callback binding via `callback.__self__ is adapter` + `callback.__func__ is DirectCommitAdapter.rollback`. BL2.6 extends that proof into a real `git revert` on the current branch.

## Live run artifacts

Two cycles committed into `.pHive/metrics/` + `.pHive/audits/mvl-proof/`:

- **BL2.5 cycle** `meta-2026-04-22` (no-op): candidate `mmo-2026-04-21-001` (MANIFEST.md append). Commit `96d4100`; rollback target `ea5b73a` (BL2.4's commit). Decision: `accept`. Worktree cleaned.
- **BL2.6 cycle** `meta-2026-04-22-r2` (deliberate regression): candidate `mmo-2026-04-21-002` (AUDIT-NOTE.md append). Regressive commit `548c2f6`; rollback target `c2407ca`; auto-revert commit `c869413`. Decision transitioned `accept → reverted`. Envelope shows `regression_watch.state=tripped` + `rollback_result.success=true`.

## Known follow-ups (tracked but not blockers)

1. **`observation_window` immutability tension.** `envelope.set_observation_window` was added in BL2.4 but `observation_window` lives in `IMMUTABLE_ENVELOPE_FIELDS`. Both live-run scripts work around it by pre-setting `observation_window` at envelope create time and calling `arm_watch(envelope_writer=None)` with manual `set_regression_watch` persistence. Either narrow-mutabilize the field or drop the setter in a future cleanup.
2. **`run_first_live_cycle.py` idempotence caveat.** Re-invocation on the same date auto-suffixes `-r2/-r3` for the cycle_id but would re-append the provenance line to MANIFEST.md. Acceptable for a one-shot proof; harden if the script becomes part of a scheduled loop.
3. **BL2.5/BL2.6 coexistence.** Both proofs share `.pHive/audits/mvl-proof/`; BL2.5's tests filter by `type == "mvl-proof"` and BL2.6's by `type == "mvl-proof-rollback-realism"` so they stay idempotent alongside each other.

## Execution notes

- Codex (`codex:codex-rescue`) handled all development; Opus 4.7 handled all reviewers. The single exception was BL2.5/BL2.6's *running* phase: Codex sandbox refused `git worktree add` / branch creation with `Operation not permitted`. The orchestrator (this session) executed both proving runs directly and captured the resulting artifacts + commits.
- Three of six stories (BL2.1, BL2.3, BL2.4) went through a needs_optimization review cycle. All must-fixes landed in the same story's commit before integrate — no fix-loop carry-over between stories.
- S9 opens with the escalation partition step: the three cycle-state escalations (`rollback-realism-proof-ambiguity`, `manifest-ownership-under-specification`, `closure-evidence-shape-mismatch`) partition into zero valid pre-exec records (the trigger wasn't in the catalog; the other two had `placement: in-planning`, outside the step-2b enum). The substance of each was honored through story content rather than a specialist phase.

## What ships next

S10 (BL3.1–BL3.7) builds the public `/meta-optimize` skill that targets consumer projects via a PR-only promotion adapter. It reuses the shared runtime under `hive/lib/meta-experiment/` — in particular the PR-only branch of `closure_validator`'s evidence check that S9 deliberately preserved.
