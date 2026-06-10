---
name: test
description: Run the test swarm — context gathering, test authoring, execution, bug triage, and reporting.
---

# Hive Test

Run the test swarm pipeline on a story, PR, or the current codebase.

**Input:** `$ARGUMENTS` optionally contains a story ID, PR number, or "all" for full suite.

## $ARGUMENTS

Parse `$ARGUMENTS` as natural language. Flags are optional; all have defined defaults.

## Phase 0 — Substrate Selection

Before entering the swarm pipeline, invoke `skills/hive/skills/test-dispatch/SKILL.md` with the parsed `$ARGUMENTS`, root `hive.config.yaml`, consumer `${HIVE_STATE_DIR}/hive.config.yaml`, and current integration branch. Consume `mode_decision`, `mode_reason`, and `runner_path`.

Switch `mode_decision` to the appropriate execution path. The swarm pipeline below is the default (`local`) path.

## State Directory Resolution

All state paths in this skill and its step files are written as `${HIVE_STATE_DIR}/...`. Resolve `HIVE_STATE_DIR` from `paths.state_dir` in the root `hive.config.yaml`; fall back to `.pHive` when unset.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If the kickoff checks pass, proceed silently. This skill is read-only-shaped. On a fresh repo without `${HIVE_STATE_DIR}/project-profile.yaml`, emit the warning below and proceed with sane defaults instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Process

Load `hive/workflows/test-swarm.workflow.yaml` and execute the pipeline. Each step has a step file at `hive/workflows/steps/test-swarm/`.

When `/test` is configured as the review gate for a resolved Hive story, project the review-entry transition from [`status-lifecycle.md`](../../hive/references/status-lifecycle.md) only after the test gate successfully records its final verdict/report: update that story YAML's `status:` projection from `in_progress` to `in_review`.

This write is gated on test-gate success. Do not write `in_review` on `/test` entry, when scenario resolution fails, when the test swarm fails before recording a verdict, or when `/test` is being used only for exploratory/local validation rather than as the story's review gate. `/test` does not own `complete`, review-fail rework, or `shipped`; those remain owned by `/review` and `/ship`.

## Pipeline

| Step | Agent | Step File | Purpose |
|------|-------|-----------|---------|
| 0. Rebuild | test-scout | `step-00-rebuild.md` | Rebuild from latest commit, deploy to devices |
| 1. Scout | test-scout | `step-01-scout.md` | Detect frameworks, scan tests, read baseline |
| 2. Architect | test-architect | `step-02-architect.md` | Map ACs to tests, author scripts, verify testId render |
| 3. Worker | test-worker | `step-03-worker.md` | Execute tests, capture artifacts to `${HIVE_STATE_DIR}/test-artifacts/` |
| 4b. Scenario Replay | test-inspector | `step-04b-scenario-replay.md` | Load worker results via `loadResults`; emit `replay_summary` for inspector |
| 4. Inspector | test-inspector | `step-04-inspector.md` | Coverage analysis against `replay_summary`; gap detection |
| 5. Sentinel | test-sentinel | `step-05-sentinel.md` | Bug filing with AI hypothesis |
| 6. Triage | test-sentinel | `step-06-triage.md` | Categorize: transient, story issue, or human blocker |
| 7. Report | test-inspector | `step-07-report.md` | Consolidated test report |
| 8. Promote | test-architect | `step-08-promote.md` | Promote passing patterns to baseline |

## Artifact Paths

ALL test artifacts go to `${HIVE_STATE_DIR}/test-artifacts/{epic-id}/{story-id}/`:
- Screenshots → `screenshots/`
- Logs → `logs/`
- Results → `results.yaml`

**NEVER scatter artifacts in the project root.**

## Known Limitations

> **Parallel-call-site annotation (audit pass):** `parallel_rationale: variation` — platform workers (web/iOS/Android) run the same test spec against disjoint platform targets; the workflow runner serializes Maestro (port 7001) but unit/integration suites parallelize freely. Out-of-scope for the `ed-7` story-level fan-out gate (workflow-internal parallelism, not story dispatch); catalogued in [`hive/references/parallel-call-sites.md`](../../hive/references/parallel-call-sites.md) §3 (`test-swarm:platform-workers`).

- **Maestro port 7001:** Single driver — iOS and Android must serialize, cannot run in parallel. Unit/integration tests can still parallel.
- **testId render visibility:** A testId in source doesn't guarantee the component is visible. The architect step verifies render visibility to catch layout anti-patterns.

## Key References

- `hive/workflows/test-swarm.workflow.yaml` — workflow definition
- `hive/references/test-swarm-architecture.md` — full architecture doc
- `hive/references/status-lifecycle.md` — Canonical command-owned story lifecycle; `/test` may own only the success-gated `in_progress -> in_review` projection when it is the configured review gate.
- `hive/agents/test-scout.md`, `hive/agents/test-architect.md`, `hive/agents/test-worker.md` (worker persona), `hive/agents/test-inspector.md`, `hive/agents/test-sentinel.md` — agent personas
