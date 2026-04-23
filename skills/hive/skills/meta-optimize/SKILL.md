---
name: meta-optimize
status: live
description: |
  Use when a consumer wants to run the public meta-improvement cycle against
  their target project. This skill is the shipped orchestration surface: it
  resolves `HIVE_TARGET_PROJECT`, honors kickoff metrics opt-in, follows the
  shared meta-team workflow, and promotes retained changes as PR-shaped
  artifacts against the consumer repo.
---

# Meta Optimize

This is the LIVE public path for `/meta-optimize`. Read this file as the runner and follow the referenced workflow and shared-library handoffs in order.

## Scope Boundaries

- Path: shipped at `skills/hive/skills/meta-optimize/SKILL.md` and registered through `./skills/` auto-discovery in `.claude-plugin/plugin.json`
- Packaging: public marketplace surface. Never reference private maintainer-only directories or maintainer-only skill names from this path.
- Promotion path: use `PrPromotionAdapter`; never use direct-commit promotion semantics on the public path
- Swarm boundary: two-swarm-aware, but this skill operates only for the public swarm against the consumer target project

## Preconditions

Before starting, verify all of the following:

- Kickoff metrics opt-in is explicit and defaults OFF. If metrics are OFF, inform the user and stop, or continue only in backlog-backed mode when `{HIVE_TARGET_PROJECT}/.pHive/meta-team/queue-meta-optimize.yaml` is populated.
- `HIVE_TARGET_PROJECT` resolves through `paths.target_project` in the root `hive.config.yaml`, with invoking cwd fallback when unset
- The target project is a git repository with a clean working tree before creating the cycle worktree

If the target is dirty, not a git repo, or unresolved, stop before boot and do not start the cycle.

## Worktree Isolation

Worktree isolation is the default public path.

Follow `hive/references/meta-experiment-isolation.md` for the shared git-native isolation model. On the public path, run the cycle against the user's resolved target project under worktree-default isolation, keep implementation/testing/evaluation work inside the target-project worktree, promote via a PR-shaped artifact, and remove the worktree only after close has assembled valid PR-shaped evidence.

## Shared-Library Handoffs

Use the shared runtime under `hive/lib/meta-experiment/`. Do not reimplement these handoffs in the skill:

- `baseline`: capture or load baseline metrics before evaluation when metrics-backed operation is available
- `compare`: use as the step-06 candidate-versus-baseline decision input
- `PrPromotionAdapter.promote`: the only promotion handoff for the public path in step 7
- `rollback_watch.evaluate_watch`: post-close observation hook for accepted experiments
- `closure_validator.validate_closable`: non-bypassable step-08 close gate for PR-shaped close evidence

Unknown consumer metric dimensions are tolerated on the public path. Known dimensions continue through the shared comparison flow, and unknown ones are skipped deterministically instead of crashing the cycle.

## Live Cycle

Follow these sections in order. Each step section maps to the shared workflow and step files; this skill orchestrates the public target-project path rather than re-specifying the step internals.

### Step 1 Boot

Load and follow `hive/workflows/steps/meta-team-cycle/step-01-boot.md`.

- Resolve `HIVE_TARGET_PROJECT` for the consumer repo, not the plugin-hive maintainer root
- Build the public cycle envelope and boot context for the consumer target
- Verify metrics opt-in state before allowing the metrics-backed branch to continue

Gate: step 1 is complete only when the boot report exists and the target-project prerequisites pass.

### Step 2 Analysis

Load and follow `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`.

- Analyze the resolved consumer target project under the public charter/state boundary
- Keep the scan target-bound to `HIVE_TARGET_PROJECT`
- Do not import maintainer-only assumptions about plugin-hive-local files or archives

### Step 3 Proposal

Load and follow `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` when metrics signal is present and yields ranked proposals.

If kickoff metrics were enabled but the baseline-to-compare proposal path produces no ranked proposals above threshold, load and follow `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md` as the public backlog-selection branch.

Do not run both branches for the same cycle. The public fallback branch consumes the consumer-managed backlog file at `{HIVE_TARGET_PROJECT}/.pHive/meta-team/queue-meta-optimize.yaml`.

### Step 4 Implementation

Load and follow `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`.

- Run step 4 inside the consumer target-project worktree
- Keep writes inside that worktree
- Return structured changes through the shared workflow outputs rather than inline control-plane writes

### Step 5 Testing

Load and follow `hive/workflows/steps/meta-team-cycle/step-05-testing.md`.

- Run step 5 inside the same target-project worktree
- Keep test evidence attached to the cycle outputs for later evaluation and close
- Preserve the public swarm's read-only testing boundary

### Step 6 Evaluation

Load and follow `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`.

- Run step 6 inside the same target-project worktree
- Use `compare` to produce the decision input from baseline-versus-candidate metrics
- Emit the raw `metrics_snapshot` needed for the PR-shaped close record

### Step 7 Promotion

Load and follow `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`.

At the start of step 7, instantiate:

```python
PrPromotionAdapter(repo_path=HIVE_TARGET_PROJECT)
```

Pass the step-06 candidate and decision into `adapter.promote(envelope, decision)`.

On success:

- capture `pr_ref` from the promotion evidence
- capture `pr_state` from the promotion evidence
- record the adapter `rollback_target`
- keep the promotion evidence PR-shaped for downstream close

The public evidence shape is `pr_ref` + `pr_state` + rollback-target. This path never rewrites the consumer target branch directly.

On promotion failure:

- treat it as a promotion failure
- keep the target branch untouched
- log the failure reason in cycle outputs
- advance to step 8 with discard/rejection evidence only

### Step 8 Close

Load and follow `hive/workflows/steps/meta-team-cycle/step-08-close.md`.

This gate is non-bypassable: assemble the close record from the step-06 and step-07 output graph, then invoke `closure_validator.validate_closable()` before the cycle closes.

On the public path, closure evidence is PR-shaped:

- `pr_ref` from step 7 promotion evidence
- `pr_state` from step 7 promotion evidence
- `rollback_ref` assembled from the promotion `rollback_target`
- `metrics_snapshot` from step 6

If the close gate passes:

- append the ledger entry exactly as the close step requires
- keep the final record PR-shaped rather than commit-shaped
- remove the worktree after close completes

If the close gate fails:

- record the close rejection reason
- do not append the ledger
- do not remove the worktree yet

## Backlog Fallback

Trigger this branch only when both conditions are true:

- kickoff metrics state is enabled
- the baseline -> compare proposal path yields no ranked proposals above threshold

Consumer backlog location:

`{HIVE_TARGET_PROJECT}/.pHive/meta-team/queue-meta-optimize.yaml`

Consumers populate backlog entries manually. The public path reads:

- `id`
- `title`
- `description` or `rationale`
- `status`
- optional `priority`

Selection rule:

- mirror `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md`
- preserve the human-authored order
- select the first entry whose `status` is `pending`
- if no pending entry exists, stop with no backlog fallback candidate

Lifecycle rule:

- the cycle still runs baseline -> candidate -> compare -> PR promotion -> close
- only the proposal source changes from metric-ranked proposal to human backlog entry

Boundary:

- this is human-edit-only
- no auto-surfacing
- no new qualitative-ingestion path
- no auto-generated backlog items

## Closure

Close records on the public path use PR-shaped evidence. Rely on `closure_validator.validate_closable()` for the hard close gate; the shared validator accepts `pr_ref` + `pr_state` plus the non-empty `metrics_snapshot` and rollback reference assembled from the promotion output.

## Failure Modes

- Metrics OFF and backlog empty: stop immediately after informing the user that kickoff metrics are disabled and no backlog-backed candidate is available
- Target resolution failure: stop before boot with no worktree and no cycle
- Dirty target repo: stop before boot until the target working tree is clean
- Promotion failure: treat adapter failure as discard/rejection, keep the consumer target branch untouched, and continue to close handling
- Close gate failure: record `close_rejected`, do not append the ledger, and leave the cycle incomplete until the missing PR-shaped evidence is fixed

## What This Skill Must Not Do

- Reimplement the shared workflow step logic inline
- Assume plugin-hive-local maintainer state, archives, or maintainer-only backlog files
- Promote by direct mutation of the consumer target branch
- Bypass `closure_validator.validate_closable()`
- Auto-populate the consumer backlog template or invent fallback candidates when the backlog is empty

## References

- `hive/references/meta-optimize-contract.md`
- `hive/references/state-boundary.md`
- `hive/references/meta-experiment-isolation.md`
- Maintainer-only procedures live in `hive/references/meta-optimize-maintainer.md`
- `hive/workflows/meta-team-cycle.workflow.yaml`
- `hive/workflows/steps/meta-team-cycle/step-01-boot.md`
- `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`
- `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
- `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md`
- `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`
- `hive/workflows/steps/meta-team-cycle/step-05-testing.md`
- `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
- `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`
- `hive/workflows/steps/meta-team-cycle/step-08-close.md`
