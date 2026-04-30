# Meta-Optimize Maintainer Procedures

This reference covers the local-only `meta-meta-optimize` swarm: how to run it,
manage the candidate queue, interpret cycle outcomes, and read the ledger. The
swarm is not shipped in `plugin.json` and must never appear on the public skill
surface.

## Overview

The runner is `maintainer-skills/meta-meta-optimize/SKILL.md`. It drives an
autonomous improvement cycle on the `plugin-hive` control plane using the
`DirectCommitAdapter` — changes are promoted straight to the active development
branch rather than opening a PR.

The cycle processes **exactly one candidate per nightly run**. Create a dated
branch (`meta-meta/nightly-YYYYMMDD`) before starting; all commits land there
and a PR is opened for human review after the cycle closes.

## Queue Management

The candidate queue lives at `.pHive/meta-team/queue-meta-meta-optimize.yaml`.
It is **human-edit-only** (Q-new-D locked): the automated cycle reads it but
never modifies it.

Guidelines for adding candidates:

- Prefer **ADD-style edits** on dormant or archived files — they produce a
  deterministic diff regardless of file state and cannot silently become no-ops.
- Run `git log --since="1 week" -- <path>` before seeding a candidate. If the
  target is actively churning, wait or pick a dormant alternative.
- Avoid "normalize" or "fix trailing whitespace" entries unless the issue has
  been manually verified at the exact target path.
- Destructive or wide-scope changes belong in a planning epic, not this queue.

## Running a Cycle

1. Read `maintainer-skills/meta-meta-optimize/SKILL.md` end-to-end.
2. Check all preconditions (clean worktree, non-empty queue, baseline metrics).
3. Create and switch to `meta-meta/nightly-YYYYMMDD`.
4. Follow steps 1–8 as prescribed by the SKILL.md runner.
5. Push the dated branch and open a PR for human review; never merge it yourself.

## Cycle Outcomes

| Decision   | Meaning |
|------------|---------|
| `accept`   | Candidate promoted to the active branch via direct commit. |
| `discard`  | Proposal blocked or evaluated as `needs_revision`; live repo untouched. |
| `reverted` | Accepted then auto-reverted by the BL2.4 rollback watch after a regression. |

## Reading the Ledger

`.pHive/meta-team/ledger.yaml` records every completed cycle. Key fields:

- `experiment_id` — matches the cycle ID (e.g., `meta-2026-04-30`)
- `decision` — terminal outcome (`accept` / `discard` / `reverted`)
- `commit_ref` — SHA of the promoted commit (absent for `discard`)
- `rollback_ref` — SHA the system can revert to if the watch trips
- `audit_path` — path to the MVS proof artifact for accepted cycles

## Regenerate the MVS Proof

Regenerate the canonical BL3.6 MVS proof by running:

`HIVE_WRITE_MVS_PROOF=1 pytest tests/meta_optimize/test_meta_optimize_e2e.py`
