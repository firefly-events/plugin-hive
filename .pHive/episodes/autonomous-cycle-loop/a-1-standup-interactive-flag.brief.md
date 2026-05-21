# A.1 — /standup --interactive flag + Phase 1.5 hook

**Hive story id:** `a-1-standup-interactive-flag`
**Epic:** `autonomous-cycle-loop`
**Complexity:** medium
**Methodology:** classic

## Description

Add `--interactive` flag to /standup and an opt-in Phase 1.5 (Interactive
Routing) entry point between Phase 1 (standup report) and Phase 2 (planning
short-list). When the flag or config knob is set, the workflow loads the new
routing step. When unset, behavior is byte-equivalent to today.

## Acceptance Criteria

- skills/standup/SKILL.md documents --interactive flag and reads standup.interactive_default from hive.config.yaml (consumer override layer wins).
- hive/workflows/daily-ceremony.workflow.yaml gains an optional phase entry 'interactive-routing' between standup and planning, gated on the flag/config.
- Without --interactive and with default config, /standup runs Phase 1, Phase 2, Phase 3 with no Phase 1.5 step (byte-equivalent diff against pre-change runs on a fixture project).
- With --interactive, /standup runs the Phase 1.5 step (step file existence verified; full behavior implemented in A.2).

## Workflow Steps (classic methodology)

### research (researcher)
Confirm the daily-ceremony workflow YAML structure and how /standup loads it; identify the right insertion point.

### implement (developer)
Add flag parsing + config plumb to skill markdown; add the optional phase entry to the workflow YAML.

### test (tester)
Run /standup without --interactive on a fixture project, confirm no Phase 1.5; run with --interactive, confirm Phase 1.5 is entered (even if its step is a stub at this point).

### review (reviewer)
Verify config knob defaults to false; verify no other skill is affected.

### integrate (developer)
Commit + push.

## Key Files

- `skills/standup/SKILL.md` — Skill entry point; argument parsing + config read
- `hive/workflows/daily-ceremony.workflow.yaml` — Workflow definition; the new phase entry lives here
- `hive/workflows/steps/daily-ceremony/` — Step files dir; new file added in A.2

## Cross-Cutting Concerns

- **documentation**: Update skill markdown to describe the flag; add a short note in the workflow YAML comment header.

---
*Dispatched from Hive epic `autonomous-cycle-loop` via Multica execution mode. Run the full classic workflow (research → implement → test → review → integrate) inside this issue. Commit on epic branch `feat/autonomous-cycle-loop`; open a story PR when done.*