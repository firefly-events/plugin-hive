# Research Brief — autonomous-cycle-loop

## Goal

Make the SDLC cycle more autonomous and operator-light by:

1. Turning standup into an interactive queue-router (visibility-weigh stories, push to GH/hive:ready, migrate local → tracker).
2. Letting `/plan` run inside a sandcastle container (issue → planning artifacts → PR).
3. Adding a "simulated manual testing" mode to `/test` (natural-language walkthroughs).
4. Letting `/execute` hand off the completed story batch to `/test` and/or `/review` automatically.

Out of scope per user direction: pushing these stories as GH issues yet (`Phase D` step 19 / 19a is a no-op for this epic — the user wants to validate decomposition locally first).

## Codebase landscape

### Standup (`skills/standup/SKILL.md`)
- 3-phase: (1) state reconstruct + triage surfacing + metrics health; (2) planning short-list; (3) execution kickoff.
- Already reads `.pHive/triage/queue.yaml` (read-only); triage skill is the single writer.
- Has empty-state collapse discipline for both triage and metrics health sections.
- Today: no interactive queue routing — user picks today's work from the report manually; no per-story visibility classifier; no GH push from standup.

### Triage (`skills/triage/SKILL.md`)
- Five-state machine `inbox → clarified → prioritized → plan-ready → closed`.
- Owns `.pHive/triage/queue.yaml`.
- Explicitly out of scope: "Push to external trackers (Linear, GitHub Issues). Optional adapter write-back is a separate follow-on."  This epic is that follow-on, narrowed to the operator-driven path in standup.

### Plan (`skills/plan/SKILL.md`)
- Phases 0 → A → B → A2 (grill) → B2 (H/V) → B3 (outline) → C (stories) → D (publish).
- Phase D step 19 publishes via `TaskTrackingDispatch.invoke('createStory', …)`; step 19a labels with `hive:*` for sandcastle ops.
- gate_mode warning auto-bypasses kickoff gate; pre-flight `/hive:why` query is established.
- Already designed to run from `--from-triage <id>`.
- Not yet wired for a sandcastle environment — assumes interactive operator and dirty-tree hard-stop.

### Sandcastle dispatch (`skills/sandcastle-gh-init/SKILL.md` + `.github/workflows/hive-dispatch.yml`)
- Triggers on `issues: labeled` with `hive:ready`.
- Two-job graph: `derive` (extracts epic + concurrency key from labels) → `run` (pulls `ghcr.io/firefly-events/sandcastle:latest`, runs the bridge against the issue).
- Bridge sets `HIVE_EXECUTION_MODE=team` to suppress nested isolation.
- Per-epic-branch PR flow (pe-3): first story creates `feat/<epic-id>` + draft PR `[epic] <epic-id>`; subsequent stories update the PR body in place (capped at 25 entries).
- Memory note: "Sandcastle bridge observability" — bridge needs `tail -F` agent log + `if: failure() || cancelled()` + cron-aligned `maxIterations: 1` / `idleTimeoutSeconds: 1800`.

### Execute (`skills/execute/SKILL.md`)
- Loads `epic.yaml`, runs each story through the methodology workflow YAML (`hive/workflows/classic.workflow.yaml`, `tdd…`, `bdd…`).
- Story-level `scope_drift_score` emit at story boundary.
- Delegation rules: orchestrator coordinates only; story-level parallelism via `TeamCreate`; step-level sequencing via `Agent`.
- Terminal phase per workflow YAML is currently `integrate` (commit/push). No automatic handoff to `/test` or `/review` after the integrate step today — the operator runs those skills explicitly.

### Test (`skills/test/SKILL.md`)
- "Test swarm" — context gathering, test authoring, execution, bug triage, reporting.
- Today targets unit/integration code tests; no simulated-manual mode.

### Review (`skills/review/SKILL.md`)
- Argument-parsed: staged | branch | PR | files. `gh pr diff <N>` for PR review.
- No batch / handoff entry point from /execute today.

### Task-tracking adapter (`hive/lib/task-tracking-dispatch/index.ts` + `hive/lib/external/github-issues-adapter.js`)
- Adapter ABI shipped via Epic C; GitHub adapter is built-in.
- `createStory({title, body, labels, parent_id})` returns `{id, url}`.
- `publishStoriesToIssues({epicId, storyIds, config})` is the OUTBOUND label pass (step 19a). Adds `hive:ready`, `hive:epic:<id>`, `hive:story:<id>` to existing issues created by step 19.
- `gate_mode: warning` already wired — failures are warn-and-continue.

### Cross-cutting concerns
- `documentation` — applies to any story changing skill files, workflows, agent personas, config keys.
- `versioning` — applies if consumer-visible changes ship.
- `metrics` — applies broadly; stories without observable surface get `metric.applies: false` + justification.

## Inconsistency risk signals

(For Phase A2 grill consumption.)

1. **"Interactive" vs the no-team-lead rule.** Memory `[No team-lead intermediary]`: orchestrator spawns workflow agents directly. An "interactive standup" must remain orchestrator-driven; do not introduce a new persona that mediates.
2. **Visibility weighing vs the existing triage prioritization.** Triage already has `priority`/`severity`. Risk: re-implementing prioritization with a new vocabulary in standup. Resolution: visibility is orthogonal to priority — visibility = "should a human watch this run" — not "how important is this".
3. **Sandcastle plan dispatch vs the existing `hive:ready` semantics.** Today `hive:ready` triggers /execute via the bridge. Adding /plan dispatch must use a distinct label (proposed: `hive:plan`) to avoid overloading the label and breaking workers that read `hive:ready` as "ready to execute".
4. **Simulated manual testing vs BDD methodology.** BDD already produces Gherkin behavior specs (`behavior-spec` step). Risk of duplication. Resolution: simulated-manual is a different kind of artifact — a stepwise human-walkthrough script for stories where automated tests cannot cover the surface (UI flow, third-party integration, perceptual outcome). It is complementary, not replacement.
5. **Execute → test/review handoff vs the orchestrator coordination contract.** The orchestrator MUST NOT implement tests itself. A handoff at the end of /execute must invoke the /test or /review skills, not inline their work.
6. **Dirty tree hard-stop inside sandcastle.** `/plan` Phase 0 hard-stops on uncommitted changes. Sandcastle starts on a clean tree (the bridge checks out the issue label branch); this is consistent — no relaxation needed.
7. **Repo match check inside sandcastle.** `/plan` step 0a hard-stops on cwd-vs-`task_tracking.repo` mismatch. Sandcastle runs in the configured repo by construction — also consistent.

## Validation note

context7 not invoked — no external library API is in scope. All references are internal Hive surfaces. Confidence: high.
