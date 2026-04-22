> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 1: Load State

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT skip any state source — episodes, cycle state, and task tracker are ALL required for accurate reconstruction
- Do NOT assume state from memory or prior conversation — this is a fresh session, read from disk
- Do NOT proceed to standup presentation until all state sources have been read
- If a state directory does not exist, record it as empty — do NOT treat missing directories as errors

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute all reads in order. Compile findings into a state reconstruction report. No user interaction required.

## CONTEXT BOUNDARIES

**Inputs available:**
- `<HIVE_STATE_DIR>/episodes/` — status marker YAML files organized by epic/story/step
- `<HIVE_STATE_DIR>/cycle-state/` — accumulated decisions, blocked items, Linear ticket mappings
- `hive.config.yaml` — task_tracking.adapter field determines if external tracker is configured
- Active epic IDs from `<HIVE_STATE_DIR>/epics/` directory listing

**NOT available:**
- Agent memories (loaded in step 2)
- Cross-cutting concerns (loaded in step 2)
- User input (not needed until step 4)

## YOUR TASK

Reconstruct the orchestrator's working context from all persistent state sources so the standup can present an accurate picture of where things stand.

## TASK SEQUENCE

### 0. Pull overnight meta-team work

Before reading local state, check for remote commits from scheduled overnight runs (e.g., the meta-team nightly cycle). These run in the cloud, commit directly to the remote branch, and will not be reflected in local state until pulled.

```bash
git fetch
BEHIND=$(git rev-list --count HEAD..@{upstream} 2>/dev/null || echo 0)
```

- If `BEHIND` is `0`: nothing to pull, proceed to task 1
- If `BEHIND` is `> 0`:
  1. Check for uncommitted local changes (`git status --porcelain`)
  2. If working tree is clean: `git pull --ff-only` and record the pulled commits in the standup report
  3. If working tree has uncommitted changes: report the `BEHIND` count and note that a manual pull is needed after handling local work — do NOT force-pull over uncommitted changes
  4. List any commits with `[meta-team]` prefix — these are overnight autonomous cycle results that should be surfaced prominently in the standup report

Record the pull result for the state reconstruction report:
- `overnight_pulls`: list of commit hashes + subjects pulled
- `meta_team_commits`: subset of overnight_pulls with `[meta-team]` prefix
- `pull_skipped_reason`: populated only if pull was skipped (uncommitted changes, merge conflict, not a git repo)

### 1. Identify active epics
List directories under `<HIVE_STATE_DIR>/epics/`. For each epic directory, read `epic.yaml` to get the epic ID, title, and story list. Record which epics have active (non-completed) stories.

### 2. Read episode status markers
For each active epic, read all status marker files under `<HIVE_STATE_DIR>/episodes/{epic-id}/`. Follow the episode schema:
- Each marker has `step_id`, `story_id`, `epic_id`, `agent`, `status`, `timestamp`
- Status values: `completed`, `in_progress`, `failed`, `skipped`
- Group markers by story to determine each story's current phase and status
- Pay special attention to `failed` and `in_progress` markers — these indicate work that needs continuation or retry

### 3. Read cycle state
For each active epic, read `<HIVE_STATE_DIR>/cycle-state/{epic-id}.yaml`. Extract:
- `decisions` — accumulated decisions with phase, key, value, rationale
- Story-level status overrides (blocked, failed)
- `linear` ticket mappings (if present)
- `constraints` and `scope_boundaries` (if present)

### 4. Check task tracker configuration
Read `hive.config.yaml` and check `task_tracking.adapter`:
- If `null` or missing: local mode only, skip external tracker queries
- If `linear`: note that Linear integration is active, record any ticket IDs from cycle state for cross-reference

### 5. Identify failed and blocked stories
Cross-reference episodes and cycle state to build a list of:
- **Failed stories:** have a `failed` episode marker, need retry or user decision
- **Blocked stories:** marked `blocked` in cycle state, need dependency resolution or user input
- **In-progress stories:** have `in_progress` markers but no completion, may need continuation

### 6. Compile state reconstruction report
Produce a structured report with the following sections:

```
## State Reconstruction Report

### Overnight Remote Work
- Commits pulled: {N}
- Meta-team cycle: {cycle_id if meta-team commits present, else "no run"}
- [if pull skipped] Skip reason: {reason}

### Active Epics
- {epic-id}: {title} — {N} stories ({M} completed, {K} remaining)

### Story Status Summary
| Story ID | Epic | Status | Current Phase | Last Updated |
|----------|------|--------|---------------|--------------|
| {id}     | {ep} | {status} | {phase}     | {timestamp}  |

### Failed Stories (need attention)
- {story-id}: {failure reason from episode conclusions}

### Blocked Stories (need resolution)
- {story-id}: {blocker description from cycle state}

### In-Progress Stories (may need continuation)
- {story-id}: {last completed step, next expected step}

### Cycle State Decisions (recent)
- [{phase}] {key}: {value} — {rationale}

### Task Tracker Mode
- Mode: {local | linear}
- Ticket IDs loaded: {count or N/A}
```

## SUCCESS METRICS

- [ ] Remote fetched and `BEHIND` count computed
- [ ] Overnight commits pulled (or pull skip reason recorded)
- [ ] Meta-team commits identified and surfaced in report
- [ ] All directories under `<HIVE_STATE_DIR>/epics/` scanned for active epics
- [ ] All episode markers under `<HIVE_STATE_DIR>/episodes/` read for active epics
- [ ] All cycle state files under `<HIVE_STATE_DIR>/cycle-state/` read for active epics
- [ ] Task tracker adapter checked in `hive.config.yaml`
- [ ] Failed, blocked, and in-progress stories identified and listed
- [ ] State reconstruction report produced with all sections populated

## FAILURE MODES

- Skipping episode reads for an active epic — leads to incomplete standup, user misses failed/blocked work
- Assuming state from a prior conversation instead of reading from disk — this is a fresh session, stale assumptions cause incorrect status reporting
- Treating a missing `<HIVE_STATE_DIR>/episodes/` directory as a fatal error — new projects have no episodes yet, report empty state
- Not cross-referencing cycle state with episodes — a story may show `completed` in episodes but `blocked` in cycle state due to a later regression

## NEXT STEP

**Gating:** State reconstruction report is complete with all sections.
**Next:** Load `workflows/steps/daily-ceremony/step-02-load-memories.md`
**If gating fails:** Report which state sources could not be read and why. Do not proceed until resolved.
