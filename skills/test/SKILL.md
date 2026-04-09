---
name: test
description: Run the test swarm — context gathering, test authoring, execution, bug triage, and reporting.
---

# Hive Test

Run the test swarm pipeline on a story, PR, or the current codebase.

**Input:** `$ARGUMENTS` optionally contains a story ID, PR number, or "all" for full suite.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `state/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with testing:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed normally.

## Process

Load `hive/workflows/test-swarm.workflow.yaml` and execute the pipeline. Each step has a step file at `hive/workflows/steps/test-swarm/`.

## Pipeline

| Step | Agent | Step File | Purpose |
|------|-------|-----------|---------|
| 0. Rebuild | test-scout | `step-00-rebuild.md` | Rebuild from latest commit, deploy to devices |
| 1. Scout | test-scout | `step-01-scout.md` | Detect frameworks, scan tests, read baseline |
| 2. Architect | test-architect | `step-02-architect.md` | Map ACs to tests, author scripts, verify testId render |
| 3. Worker | test-worker | `step-03-worker.md` | Execute tests, capture artifacts to `state/test-artifacts/` |
| 4. Inspector | test-inspector | `step-04-inspector.md` | Coverage analysis, gap detection |
| 5. Sentinel | test-sentinel | `step-05-sentinel.md` | Bug filing with AI hypothesis |
| 6. Triage | test-sentinel | `step-06-triage.md` | Categorize: transient, story issue, or human blocker |
| 7. Report | test-inspector | `step-07-report.md` | Consolidated test report |
| 8. Promote | test-architect | `step-08-promote.md` | Promote passing patterns to baseline |

## Artifact Paths

ALL test artifacts go to `state/test-artifacts/{epic-id}/{story-id}/`:
- Screenshots → `screenshots/`
- Logs → `logs/`
- Results → `results.yaml`

**NEVER scatter artifacts in the project root.**

## Known Limitations

- **Maestro port 7001:** Single driver — iOS and Android must serialize, cannot run in parallel. Unit/integration tests can still parallel.
- **testId render visibility:** A testId in source doesn't guarantee the component is visible. The architect step verifies render visibility to catch layout anti-patterns.

## Key References

- `hive/workflows/test-swarm.workflow.yaml` — workflow definition
- `hive/references/test-swarm-architecture.md` — full architecture doc
- `hive/agents/test-scout.md`, `test-architect.md`, `test-worker.md`, `test-inspector.md`, `test-sentinel.md` — agent personas
