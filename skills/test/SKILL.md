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

### Phase 0a — Low-Effort Skip Gate

Evaluate this gate **first, before any substrate selection or dispatch** — it must short-circuit every route (local pipeline and the Phase 0b Multica DAG front door alike).

Read `${HIVE_STATE_DIR}/session-effort.txt` (see State Directory Resolution). This file is written by `hooks/effort-gate.sh` and holds one of `low | medium | high | xhigh`.

- **Effort == `low`:** skip test-swarm dispatch entirely — this covers both the local swarm pipeline (steps 1–8) and the Phase 0b DAG front-door route — and fall back to a minimal check (or no-op). Emit one loud log line naming the tier and the skip reason, plus how to force a full run:

  ```
  [warn] test skip: effort=low reason=low-effort-swarm-skip — skipping full test-swarm dispatch. Force a full run with CLAUDE_EFFORT=medium (or higher), or remove ${HIVE_STATE_DIR}/session-effort.txt.
  ```

  Do not proceed to Phase 0b or invoke `skills/hive/skills/test-dispatch/SKILL.md` when this branch fires.

- **Effort == `medium` / `high` / `xhigh`, or the file is absent/unreadable:** this gate is a no-op — proceed to substrate selection below exactly as today. Never skip at `medium` or above.

Before entering the swarm pipeline, invoke `skills/hive/skills/test-dispatch/SKILL.md` with the parsed `$ARGUMENTS`, root `hive.config.yaml`, consumer `${HIVE_STATE_DIR}/hive.config.yaml`, and current integration branch. Consume `mode_decision`, `mode_reason`, and `runner_path`.

Switch `mode_decision` to the appropriate execution path. The swarm pipeline below is the default (`local`) path.

### Phase 0b — DAG Front Door (Multica)

When `mode_decision == multica`, route the test run through the DAG front door instead of the local swarm pipeline. This is the symmetric sibling of the s9 (planning-routing) and s11 (execute) DAG front-door paths.

**DAG front-door invocation:**

```python
from hive.lib.dag_executor.run import run, resolve_spawn_binding

result = run(
    "hive/workflows/test-swarm.workflow.yaml",
    binding=resolve_spawn_binding(flow="execution")[0],
    context={
        "story_spec": story_spec,
        "baseline_path": baseline_path,
        "report_artifact_path": f"{HIVE_STATE_DIR}/test-artifacts/{epic_id}/{story_id}/results.yaml",
    },
)
```

Emit one INFO log line at dispatch:

```
[info] test routing: graph=hive/workflows/test-swarm.workflow.yaml binding=multica reason=dag-multica
```

Graph completion is an **artifact-readiness signal only** — not a user sign-off. The calling orchestrator retains all gate checks and the final verdict presentation.

**Fallback.** If the Multica binding fails:

- Daemon down (ECONNREFUSED, timeout during `binding=multica` init): emit `[warn] test routing: dag-multica daemon down — falling back to local` and route through the local swarm pipeline below.
- Dispatch error (graph-step error, node timeout): emit `[warn] test routing: dag-multica dispatch failed: {error} — falling back to local` and apply the same local fallback.

**Local fallback (backend unset).** When `mode_decision != multica`, this step is skipped entirely. The existing local swarm pipeline below is unchanged — no regression.

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
