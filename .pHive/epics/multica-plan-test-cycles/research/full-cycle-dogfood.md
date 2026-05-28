# Full Cycle Dogfood - mpt-11

Date: 2026-05-28
Branch: `feat/multica-plan-test-cycles`
Dogfood target: throwaway validation of the Multica plan -> execute -> test cycle wiring.

## Scope

This run validated the final S6 gate against the live Multica issue substrate after
the prerequisite wiring stories landed:

- Plan half: `mpt-8-wire-plan-phase0` / PLU-161.
- Execute half: `mpt-11-full-cycle-dogfood` / PLU-164, the current Multica-dispatched developer run.
- Test half: `mpt-10-wire-test-simulated-manual` / PLU-163.

The concrete throwaway feature was the dogfood workstream itself: prove the newly
documented plan-mode and test-mode Multica paths on the shared epic branch, then
record the result in this research artifact.

## Run Evidence

| Cycle phase | Multica issue | Run/task id | Agent | Status evidence | Branch/commit evidence |
|---|---:|---|---|---|---|
| Plan wiring checkpoint | PLU-161 `mpt-8-wire-plan-phase0` | `b2f70cc0-f20e-4220-95de-7c98d0c706e4` | `developer` | Multica run completed at `2026-05-28T20:25:50Z`; final issue status `in_review`. | Pushed `e3dfddaf5774410d4c5b5e061ec330bf02b27c78` to `origin/feat/multica-plan-test-cycles`. |
| Execute checkpoint | PLU-164 `mpt-11-full-cycle-dogfood` | `23c2283d-09b4-4bc4-94a7-24300fc0c8d4` | `developer` | Multica run started at `2026-05-28T20:34:14Z`; this artifact is the run output. | Started from `c31ba6268cd1f1e685980bf095af1c72a6f584d7` on `origin/feat/multica-plan-test-cycles`; this story commits only this log. |
| Test wiring checkpoint | PLU-163 `mpt-10-wire-test-simulated-manual` | `b5c7cb7f-adc3-4b0b-9d0e-4f43c72d5967` | `developer` | Multica run completed at `2026-05-28T20:34:11Z`; final issue status `in_review`. | Pushed `c31ba6268cd1f1e685980bf095af1c72a6f584d7` to `origin/feat/multica-plan-test-cycles`. |

The PLU-161 and PLU-163 run messages both show the same serial-against-trunk
pattern: checkout or reuse the shared branch worktree, `git fetch`, rebase/check
against `origin/feat/multica-plan-test-cycles`, then push `HEAD` back to that branch.
Both commits are reachable from `origin/feat/multica-plan-test-cycles`.

## Verification Verdict

Verdict: pass with one branch-hygiene caveat.

The build matched the plan for the implemented cycle wiring:

- `/plan` Phase 0 now resolves `HIVE_PLANNING_MODE=multica` / `planning.mode: multica`
  and delegates Multica work to `planning-routing` -> `plan-mode-multica`, while
  keeping user review gates local.
- `/test --simulated-manual` now resolves `HIVE_TEST_MODE=multica` / `test.mode:
  multica` and delegates selected Multica work to `test-mode-multica`, while keeping
  the local executor as the default fallback.
- The test-side verification for PLU-163 ran
  `node --test tests/hive-lib/scenarios-load.test.mjs tests/multica-execute-mode-skill.test.mjs tests/multica-episode-sync.test.mjs`
  with 28 passing tests.
- This dogfood run also reran the package-level Multica adapter and task-tracking
  dispatch suites before editing this artifact:
  - `hive/adapters/multica`: 8 passing tests.
  - `hive/lib/task-tracking-dispatch`: 23 passing tests.

## Episode / Run Capture

Multica execution history captured each cycle checkpoint as task/run records:

- PLU-161 run `b2f70cc0-f20e-4220-95de-7c98d0c706e4`.
- PLU-163 run `b5c7cb7f-adc3-4b0b-9d0e-4f43c72d5967`.
- PLU-164 run `23c2283d-09b4-4bc4-94a7-24300fc0c8d4`.

No `.pHive/episodes/multica-plan-test-cycles/...` files were present on the branch
before this dogfood pass. For this S6 story, the committed research log is therefore
the durable run artifact, and the Multica task records are the platform-side episode
evidence.

## Branch Hygiene Findings

Shared-branch handling held for the S6 workstream commits:

- PLU-161 and PLU-163 pushed directly to `origin/feat/multica-plan-test-cycles`.
- PLU-164 used the existing shared-branch worktree at
  `/Users/don/multica_workspaces/21c6d282-d6b4-4b25-8d0d-a85e96038416/0cf72e6b/workdir/plugin-hive`
  because Git refused to check out the already-attached branch in the daemon-created
  `agent/developer/23c2283d` worktree.

Caveat: `git ls-remote --heads origin 'agent/developer/*'` still shows pre-existing
remote `agent/developer/*` branches. This dogfood run did not create or push a new
agent branch, but the global "no orphan agent branches" invariant is not clean in the
repository as observed on 2026-05-28.

## Follow-ups

- Decide whether S6 requires committed `.pHive/episodes/multica-plan-test-cycles/*`
  markers in addition to Multica platform run records. The current branch has no such
  episode directory for this epic.
- Clean up or explicitly tolerate the existing remote `agent/developer/*` branches;
  otherwise future branch-hygiene checks will continue to report the invariant as
  only locally satisfied by individual runs.
