# Research Brief — Hermes Orchestrator Skills

**Epic:** hermes-orchestrator-skills
**Date:** 2026-06-23
**Grounding decision:** plan off repo bridge (`cli.mjs` + `cycle-reconciler.md` are the contract; reconcile live Studio fork surface at `/execute`, not upstream Multica docs).

## 1. North Star

Lights-on software factory. Human in the loop **only** at planning and review. Orchestrator + agents own everything else: monitor stories, advance approved work through impl → review → done, kick off pre-approved flows, watch the cron/daemon health. Hermes is the persistent external orchestrator that replaces the ephemeral, inconsistent in-session "orchestrator persona" (which was never a stable agent — just skill code + plugin-hive preferences).

## 2. The seam Hermes already uses (the contract)

`hive/lib/multica-story-dispatch/cli.mjs` — the single interface. Subcommands:

| Subcommand | Purpose |
|---|---|
| `dispatch` | dispatch a story to an agent/squad; returns Multica `task_id` |
| `status` / `poll` | poll a live task to terminal status |
| `episode` | write an episode marker |
| `epic-status` | roll up reconciler state for an epic |
| `comment` | post a comment to an issue |
| `write-state` | persist `hermes_reconciler` cross-tick state (the ONLY durable-write path) |
| `create-issue` | create a Multica issue (used by `/plan` Phase D, NOT by Hermes autonomously) |
| `cancel` | cancel a dispatched task |
| `reconcile` | fetch-from-bare + ff-merge branch reconciliation |

Fork MCP-tool wrappers named in `cycle-reconciler.md`: `multica_dispatch_story`, `multica_poll_task`, `multica_epic_status`, `multica_write_state`. The runbook treats these as "the ONLY interface you use." **Open question:** whether these MCP wrappers already exist in the Studio fork or must be built — resolved by the plan-off-repo-bridge decision as an execute-time reconcile (candidate story: expose `cli.mjs` subcommands as MCP tools).

## 3. Orchestrator logic already codified

`hive/references/cycle-reconciler.md` — "Hermes Tick State-Machine Runbook." Designed to be **pasted as the per-tick system prompt for a Hermes cron job.** This is the existing precedent for what a "Hermes-side skill" is: a runbook markdown + the `multica_*` MCP tools. Contents:

- **7-position phase machine:** `pending → dispatched_impl → impl_terminal → dispatched_review → review_terminal → done` (+ revision loop-back to `dispatched_impl`, attempt++).
- **State home:** `hermes_reconciler:` block in `.pHive/cycle-state/<epic>.yaml`. Top-level fields: `gate_state` (must be `pre_approved` to proceed), `in_flight_story_id`, `in_flight_task_id`, `dispatched_at` (watchdog timer), `current_phase`. Per-story fields under `stories.<id>`.
- **Durability rule:** "A dispatch is not durable until you have called `multica_write_state`." Never touch the YAML directly.
- **Watchdog:** `dispatched_at` drives stuck-detection / rescue. Hermes has no clock/shell — timestamps come from the cron Run Time; placeholder values silently break rescue.

This means **reconcile-tick is ~80% already built** — the epic formalizes it into the skill set and builds the *sibling* flows in the same pattern.

## 4. Read / monitor surface

- `hive/lib/context-snapshot.mjs` → `composeContextSnapshot({ stateDir, epic, episodeLimit })`. Read-only JSON: epics, stories (via `deriveStoryStatus`), recent episodes, open triage, metric verdicts. Built explicitly "for consumption by external coordinators (Hermes, custom schedulers)." Skill: `/hive:context-snapshot` (stdout default, `--write` opt-in, `--epic` filter).
- Raw `multica issue list/get`, `multica daemon status`.
- `epic-status` subcommand = reconciler-state read.

## 5. Bootstrap surface

`/hive:multica-init` + `hive/lib/multica-bootstrap/index.mjs`. Ordered: health → cli → auth → workspace → daemon → skills → agents → squads → autopilots → repo-bind → gitignore-seed. Studio-specific caveats live in memory (Keychain creds, GUI Aqua session for daemon, `issue rerun` as ground truth, bare-repo per-task worktrees, reconcile = fetch-from-bare + ff-merge + Aqua ghpr push).

## 6. Flow entry points (what kickoff-plan / kickoff-exec trigger)

- `/plan` → `planning-routing` → `plan-mode-multica` (`HIVE_PLANNING_MODE=multica` or `planning.mode: multica`). Human gates: design-discussion review, H/V, outline sign-off, final confirm. **These gates are always local to the orchestrator — Multica completion is artifact-readiness, never sign-off.**
- `/execute` → step 5e DAG/Multica front-door (`binding=multica`) + step 6e `execute-mode-multica`. Fallback to local sequential on daemon-down/dispatch-error.
- `/test`, `/review` → `binding=multica` with local fallback.
- `/ship`, `/status`, `/standup`, `/triage`.

## 7. Cron surface (what watch-cron monitors)

- Meta nightly = a **RemoteTrigger routine**, not a repo workflow (per memory: must read open PRs + target develop).
- Autonomous nightly standup loop (PR #211).
- `multica daemon status`; daemon must be GUI-session-bootstrapped on Studio to read Keychain.

## 8. Hard constraints from memory (must honor)

- **Open PR ≠ merge authorization.** Hermes must not merge/tag/release without explicit go.
- **Headless orchestrator exits after dispatch** (no episode marker/PR) → persistence is the reconcile-tick job, not a fire-and-forget.
- **Multica skips pre-shutdown insight capture** → orchestrator must distill post-terminal from messages sidecar.
- **Over-claims "pushed"** when nothing is on origin → reconcile = git merge --ff-only verification, not trust.
- **Story creation always gated** (user directive 2026-06-23): Hermes never mints stories; `/plan` and `/triage --hand-off` are the only creation paths, both human-gated.

## 9. Gaps / unknowns (→ become stories or execute-time reconciles)

1. Do the `multica_*` MCP wrappers exist in the fork, or wrap `cli.mjs` as MCP tools? (execute-time reconcile)
2. Hermes-agent skill/runbook consumption format on Studio (`~/Code/hermes-agent`) — confirm the "paste-as-system-prompt" pattern is the artifact, or whether Hermes has a native skill registry.
3. How a Hermes cron selects *which* epic to reconcile (epic-of-record pointer vs scan all open epics).
4. Review-verdict human gate mechanics — how Hermes surfaces a review-terminal verdict to the human and waits (Discord deferred; dashboard at 127.0.0.1:9119).
