---
name: meta-meta-optimize
status: live
description: |
  LOCAL-ONLY maintainer skill for the plugin-hive repo. Drives the
  /meta-meta-optimize Karpathy-style auto-improvement cycle on the plugin
  itself (control-plane, swarm configs, agent personas). Not shipped in
  plugin.json and fixed to maintainer-skills/meta-meta-optimize/SKILL.md by
  L9-meta-meta-location + Q-new-A. BL2.2 makes this the live orchestration path.
---

# Meta-Meta Optimize

This is the LIVE maintainer path as of BL2.2. Dry-run mode is retired; read this file as the runner and follow the referenced step files in order.

## Scope Boundaries

- Path lock: this skill stays at `maintainer-skills/meta-meta-optimize/SKILL.md` per `L9-meta-meta-location`
- Packaging boundary: local-only, never registered in `plugin.json`, and does not ship on the public skill surface
- Promotion path: use `promotion_adapter.DirectCommitAdapter`; never use PR-flow semantics here
- Swarm boundary: this is two-swarm-aware but only for the maintainer swarm; do not assume `/meta-optimize` behavior

## Preconditions

Before starting, verify all of the following:

- The repo is clean-worktree-capable: you can create a new git worktree without colliding with unresolved local state
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` exists and contains at least one candidate
- `hive/lib/meta-experiment/` is importable from this repo
- You can read the active charter and prior ledger for the maintainer swarm

If the backlog is missing or empty, stop immediately with `status: no_candidate`, do not create a worktree, and do not start a cycle.

## Worktree Isolation

Worktree isolation is the default and MANDATORY path.

1. Create exactly one worktree for the cycle at `.pHive/meta-team/worktrees/{cycle_id}/` using `git worktree add`.
2. Run steps 4, 5, and 6 inside that worktree.
3. In step 7, promote the worktree tip back to the main checkout through `DirectCommitAdapter`.
4. In step 8, remove the worktree only after the close gate passes.

Do not mutate the control plane from the main checkout while steps 4-6 are running.

## Shared-Library Handoffs

Use the shared runtime under `hive/lib/meta-experiment/`. Do not reimplement any of these handoffs in the skill:

- `envelope`: build it at boot, keep it current through the cycle, and require the final fields by steps 6-8
- `baseline`: capture before step 4 writes; this is reserved for BL2.3, so if baseline-capture prerequisites are missing, stop after boot
- `compare`: use as step-06 input for candidate-versus-baseline evaluation
- `promotion_adapter`: instantiate `DirectCommitAdapter` in step 7
- `rollback_watch`: post-cycle concern in BL2.4 territory; this skill stops after close
- `closure_validator`: non-bypassable step-08 close gate

## Live Cycle

Follow these sections in order. Each step section tells you which workflow file to load.

### Step 1 Boot

Load and follow `hive/workflows/steps/meta-team-cycle/step-01-boot.md`.

- Establish `cycle_id`
- Load the prior ledger
- Read the maintainer charter
- Build the initial `envelope`
- Produce the boot report

Gate: step 1 is complete only when the boot report exists.

Stop condition: if baseline-capture prerequisites are missing, step 1 now performs the BL2.3 baseline availability check and may stop after boot before any implementation work begins.

### Step 2 Analysis

Load and follow `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`.

Use the current cycle context, charter constraints, backlog candidate, and prior ledger context to produce the cycle analysis outputs.

### Step 3 Proposal

Load and follow `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` when metric signal is present.

If there is no metric signal, load and follow `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md` instead. Step 3b is the backlog fallback path for no metric signal; it selects from `.pHive/meta-team/queue-meta-meta-optimize.yaml` rather than inventing a proposal path.

Do not run both branches for the same cycle. Choose one based on whether metric signal exists.

### Step 4 Implementation

Load and follow `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`.

Run step 4 inside `.pHive/meta-team/worktrees/{cycle_id}/`. Keep all writes inside the worktree and use the shared-library handoffs already established by boot rather than ad hoc lifecycle state.

### Step 5 Testing

Load and follow `hive/workflows/steps/meta-team-cycle/step-05-testing.md`.

Run step 5 inside the same worktree and keep test evidence attached to the cycle outputs for later evaluation.

### Step 6 Evaluation

Load and follow `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`.

Run step 6 inside the same worktree. Use `compare` as the candidate-versus-baseline input to produce the evaluation verdict and the `metrics_snapshot` needed for close.

### Step 7 Promotion

Load and follow `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`.

At the start of step 7, instantiate `DirectCommitAdapter(repo_path=<plugin-hive root>)`.

Pass `candidate_ref` plus the step-06 decision verdict into `adapter.promote(envelope, decision)`.

On success:

- capture `commit_ref` from the promotion evidence
- record the adapter's `rollback_target` in the `promoted_changes` output
- stage insights to `.pHive/insights/meta-meta-optimize/cycle-{cycle_id}/`

On `PromotionFailure`:

- treat it as a promotion failure
- keep the main tree untouched
- log the failure reason in the cycle outputs
- advance to step 8 with `status: discarded`

### Step 8 Close

Load and follow `hive/workflows/steps/meta-team-cycle/step-08-close.md`.

This gate is non-bypassable: assemble the envelope from the step-06 and step-07 output graph (`rollback_target` -> `rollback_ref` renaming happens here), then invoke `closure_validator.validate_closable(envelope)` before the cycle closes.

The cycle may NOT close without `commit_ref`, `metrics_snapshot`, and `rollback_ref`.

If the close gate passes:

- append the ledger entry exactly as step 8 requires
- remove the worktree after the close completes

If the close gate fails:

- record the close rejection reason
- do not append the ledger
- do not remove the worktree yet

### Post-close observation (BL2.4)

- Observe the cycle only while `now` remains inside the envelope `observation_window`
- A follow-up maintainer run invokes `hive.lib.meta_experiment.rollback_watch.evaluate_watch(...)` with a post-close snapshot
- Bind `auto_revert_callback` to `DirectCommitAdapter.rollback` so a trip performs a real git revert in the main checkout
- If the watch trips: set `regression_watch.state` to `tripped`, transition `decision` to `reverted`, and record the revert commit in the ledger trail
- If the observation window elapses without a trip: treat the experiment as stable
- `evaluate_watch(...)` is post-close and cadence-driven; do not inline it into steps 1-8

## Insights And Ledger

- Step 7 stages per-cycle insights under `.pHive/insights/meta-meta-optimize/cycle-{cycle_id}/`
- Step 8 appends the cycle record to the maintainer ledger by following `step-08-close.md`
- Do not append the ledger from any earlier step

## Failure Modes

- Missing backlog: stop before boot with `status: no_candidate`; no worktree, no envelope mutation, no cycle
- Promotion failure: treat `PromotionFailure` as discard, keep the main tree untouched, log the reason, and continue to step 8 for close handling
- Close gate failure: record `close_rejected`, do not append the ledger, do not remove the worktree, and leave the cycle incomplete until the missing evidence is fixed

## What This Skill Must Not Do

- Mutate the control plane outside the dedicated worktree while steps 4-6 are in progress
- Register itself in `plugin.json` or otherwise ship publicly
- Use PR-flow, public-swarm, or `/meta-optimize` promotion semantics
- Reimplement `envelope`, `baseline`, `compare`, `promotion_adapter`, `rollback_watch`, or `closure_validator`
- Bypass `closure_validator.validate_closable(envelope)` or close with missing `commit_ref`, `metrics_snapshot`, or `rollback_ref`
- Remove the worktree before the step-08 close gate passes

## References

- `maintainer-skills/meta-meta-optimize/SKILL.md` is fixed by `L9-meta-meta-location`
- `Q-new-A` keeps `/meta-meta-optimize` local-only and out of `plugin.json`
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` is the maintainer backlog input
- `hive/lib/meta-experiment/README.md` defines the shared-runtime boundaries
- `hive/workflows/steps/meta-team-cycle/step-01-boot.md`
- `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`
- `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
- `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md`
- `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`
- `hive/workflows/steps/meta-team-cycle/step-05-testing.md`
- `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
- `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`
- `hive/workflows/steps/meta-team-cycle/step-08-close.md`
