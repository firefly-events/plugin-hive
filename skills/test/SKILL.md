---
name: test
description: Run the test swarm — context gathering, test authoring, execution, bug triage, and reporting.
---

# Hive Test

Run the test swarm pipeline on a story, PR, or the current codebase.

**Input:** `$ARGUMENTS` optionally contains a story ID, PR number, or "all" for full suite.

## $ARGUMENTS

Parse `$ARGUMENTS` as natural language. Flags are optional; all have defined defaults.

**`--simulated-manual <story-id|scenario-file>`**

Runs a simulated manual test against a single scenario instead of the full automated test swarm. The argument is either a story ID or a direct path to a scenario YAML.

**Argument resolution:**

1. **If the argument matches a story ID** (kebab-case, resolves to `.pHive/epics/{epic-id}/stories/{id}.yaml` under any epic):
   - Read the story YAML and extract `manual_verdict.scenario_ref`.
   - If `manual_verdict.scenario_ref` is absent or empty, fail immediately:
     ```
     Error: story '{id}' has no manual_verdict.scenario_ref. Add a scenario step
     or point manual_verdict.scenario_ref at a .pHive/test-scenarios/*.yaml file.
     ```
   - Resolve the scenario file from the `scenario_ref` path (repo-relative).

2. **If the argument is a file path** (contains `/` or ends in `.yaml`):
   - Load the file directly via `hive/lib/scenarios/load.mjs` (`loadScenario`).
   - The loader validates the simulated-manual scenario shape: `id` (kebab-case), `title`, `mode` (`spec-walk | implementation-walk`), and a non-empty `steps` array of `{ action, expected }` objects, plus optional `preconditions` / `postconditions` string arrays.

**Executor step wiring:**

After resolving the scenario, skip the standard swarm pipeline (steps 0–8) and run the simulated-manual executor instead (full contract in `hive/workflows/steps/test/simulated-manual.md`):

1. Evaluate `preconditions` — if any fail, record `inconclusive` and stop.
2. Walk `steps[]` in order, narrating each `action` against the spec (`spec-walk`) or the post-integrate implementation (`implementation-walk`); record per-step `outcome` from the declared `expected`.
3. Evaluate `postconditions`.
4. Compute overall verdict: `pass` (all steps + postconditions pass), `fail` (any step or postcondition failed), `inconclusive` (precondition failed → scenario skipped).

Write the verdict to the story YAML's `manual_verdict` block per [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §9. This story-YAML block is the canonical source of truth for simulated-manual verdicts; `.pHive/cycle-state/<epic-id>.yaml` is only a derived/index view if another tool mirrors it.

```yaml
manual_verdict:
  scenario_ref: <resolved path>
  verdict: pass | fail | inconclusive
  timestamp: <ISO 8601>
  agent: tester
```

The verdict block is merged into the story YAML in place — if a prior verdict exists it is overwritten; existing story fields are preserved.

**Example invocations:**

```bash
# By story ID — resolves scenario_ref from story YAML
/hive:test --simulated-manual c-2-test-simulated-manual-mode

# By direct path — loads and validates scenario file directly
/hive:test --simulated-manual .pHive/test-scenarios/plan-then-execute-trivial-epic.yaml
```

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If the kickoff checks pass, proceed silently. This skill is read-only-shaped. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Process

Load `hive/workflows/test-swarm.workflow.yaml` and execute the pipeline. Each step has a step file at `hive/workflows/steps/test-swarm/`.

## Pipeline

| Step | Agent | Step File | Purpose |
|------|-------|-----------|---------|
| 0. Rebuild | test-scout | `step-00-rebuild.md` | Rebuild from latest commit, deploy to devices |
| 1. Scout | test-scout | `step-01-scout.md` | Detect frameworks, scan tests, read baseline |
| 2. Architect | test-architect | `step-02-architect.md` | Map ACs to tests, author scripts, verify testId render |
| 3. Worker | worker persona | `step-03-worker.md` | Execute tests, capture artifacts to `.pHive/test-artifacts/` |
| 4. Inspector | test-inspector | `step-04-inspector.md` | Coverage analysis, gap detection |
| 5. Sentinel | test-sentinel | `step-05-sentinel.md` | Bug filing with AI hypothesis |
| 6. Triage | test-sentinel | `step-06-triage.md` | Categorize: transient, story issue, or human blocker |
| 7. Report | test-inspector | `step-07-report.md` | Consolidated test report |
| 8. Promote | test-architect | `step-08-promote.md` | Promote passing patterns to baseline |

## Artifact Paths

ALL test artifacts go to `.pHive/test-artifacts/{epic-id}/{story-id}/`:
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
- `hive/agents/test-scout.md`, `test-architect.md`, the worker persona, `test-inspector.md`, `test-sentinel.md` — agent personas
