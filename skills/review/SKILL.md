---
name: review
description: Run a structured code review on changes, a PR, or a branch.
---

# Hive Review

Run a structured code review workflow.

**Input:** `$ARGUMENTS` optionally contains a PR number, branch name, or file paths.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If the kickoff checks pass, proceed silently. This skill is read-only-shaped. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Argument Parsing

| Argument | Interpretation | Diff command |
|----------|---------------|--------------|
| *(none)* | Review staged changes (fall back to unstaged if nothing staged) | `git diff --cached` (or `git diff` if empty) |
| `feature-branch` | Review branch diff against main | `git diff main..feature-branch` |
| `#123` or PR URL | Review a pull request | `gh pr diff 123` |
| `src/foo.ts src/bar.ts` | Review only those files | `git diff -- src/foo.ts src/bar.ts` |

**Pre-flight:** If the argument starts with `#` or looks like a PR URL, verify `gh auth status` succeeds. If `gh` is not authenticated, report the error and suggest using a branch name instead.

### Review dimension flags (additive, opt-in)

The baseline code review always runs. These flags **add** specialist review dimensions on top of it. They are **opt-in (default-off)**: when none are passed, the baseline path runs exactly as before — no extra subagents, no behavior change.

| Flag | Adds | Persona | Reference workflow |
|------|------|---------|--------------------|
| `--security` | A security review dimension | `hive/agents/security-reviewer.md` | `hive/workflows/security-audit.workflow.yaml` |
| `--performance` | A performance review dimension | `hive/agents/performance-reviewer.md` | `hive/workflows/performance-audit.workflow.yaml` |
| `--all-dimensions` | Both of the above | — | — |

Flags are parsed out of `$ARGUMENTS` before resolving the diff target — strip them, then interpret the remaining argument per the table above (so `/review #123 --security` reviews PR 123 with the added security dimension). Each selected dimension produces its **own labeled feedback block** (see Phase 1, step 6b); dimensions never merge into or overwrite the baseline code-review verdict.

#### xhigh-effort escalation

After parsing explicit dimension flags, read `${HIVE_STATE_DIR}/session-effort.txt` (see `hive/references/configuration.md` — Effort & Context Adaptation). If effort == `xhigh`, force both `--security` and `--performance` on for this run exactly as if the operator had passed them — even if neither flag (nor `--all-dimensions`) was present. Emit:
```
[info] review: effort=xhigh — forcing --security --performance dimensions
```
At `medium` / `high` / `low`, or when the file is absent/unreadable, this is a no-op — only explicitly-passed flags select dimensions.

## Process

### Phase 0 — Resolve dispatch mode

Call `skills/hive/skills/review-dispatch/SKILL.md` once before doing any other work. Pass:

- `env` — current process environment (at minimum `HIVE_SESSIONS_ENABLED`, `HIVE_PARALLEL_TEAMS`, `HIVE_TERMINAL_MUX`, `HIVE_REVIEW_MODE`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`)
- `rootConfig` — parsed root `hive.config.yaml`
- `consumerConfig` — parsed `.pHive/hive.config.yaml` or `None`
- `graduationRegistry` — parsed graduation registry workflow list or `None`
- `workflow_name` — `"code-review"`
- `epic_id` — current epic ID when known, else omit
- `arguments` — parsed `$ARGUMENTS` (PR number / branch / `--sequential` flag state)
- `unblocked_stories[]` — depth-0 ready stories at this tick (may be empty for a direct `/review` invocation)

Capture the response as `{ mode_decision, mode_reason, runner_path, runner_reason, field_sources, gate_violations }`.

Branch on `mode_decision`:

- **`multica`** → route through the DAG front door (see **Phase 0b** below) and **stop**. Do not continue to Phase 1 below.
- **`cc-workflows`** → hand off to `skills/hive/skills/review-mode-cc-workflows/SKILL.md` (forward all arguments + `field_sources`) and **stop**. Do not continue to Phase 1 below.
- **any other value** (`sequential`, `team`, `team-cmux`, `sessions`, `sandcastle`) → continue inline with the steps below. The solo reviewer pattern (Steps 1–6) is the authoritative inline path.

> `review-mode-cc-workflows` is a forward declaration — its skill file ships in a later slice. A missing skill file is not an error at dispatch resolution time.

### Phase 0b — DAG Front Door (Multica)

When `mode_decision == multica`, route the review run through the DAG front door
instead of the local solo reviewer pipeline. This is the symmetric sibling of the
s9 (planning-routing), s11 (execute), and s12 (test) DAG front-door paths.

**DAG front-door invocation:**

```python
from hive.lib.dag_executor.run import run, resolve_spawn_binding

result = run(
    "hive/workflows/review.workflow.yaml",
    binding=resolve_spawn_binding(flow="execution")[0],
    context={
        "diff_target": diff_target,
        "pr_number": pr_number,
        "branch": branch,
        "review_artifact_path": f"{HIVE_STATE_DIR}/review-artifacts/{epic_id}/{story_id}/review.yaml",
    },
)
```

Emit one INFO log line at dispatch:

```
[info] review routing: graph=hive/workflows/review.workflow.yaml binding=multica reason=dag-multica
```

Graph completion is an **artifact-readiness signal only** — not a user sign-off. The
calling orchestrator retains all gate checks and the final verdict presentation.

**Fallback.** If the Multica binding fails:

- Daemon down (ECONNREFUSED, timeout during `binding=multica` init): emit `[warn] review routing: dag-multica daemon down — falling back to local` and route through the local solo reviewer pipeline below.
- Dispatch error (graph-step error, node timeout): emit `[warn] review routing: dag-multica dispatch failed: {error} — falling back to local` and apply the same local fallback.

**Local fallback (backend unset).** When `mode_decision != multica`, this step is skipped entirely. The existing local solo reviewer pipeline below is unchanged — no regression.

### Phase 1 — Inline solo reviewer (default path)

1. **Obtain the diff.** Run the appropriate diff command from the table above. If the diff is empty, report "No changes to review" and stop.

2. **Project review-entry status.** If the review target resolves to a Hive story, write `/review`'s entry transition from [`status-lifecycle.md`](../../hive/references/status-lifecycle.md): update that story YAML's `status:` projection from `in_progress` to `in_review`.

   This write is gated on the review actually starting. Do not write `in_review` when the diff is empty, PR authentication fails, the target cannot be resolved, or pre-flight checks stop the run. `/review` entry does not imply pass or completion.

3. **Load the review workflow.** Read `hive/workflows/code-review.workflow.yaml`. This defines the ordered steps for a code review. If the file does not exist, fall back to the two-step process below.

4. **Execute workflow steps sequentially.** For each step in the workflow:

   **a.** Read the agent persona referenced by the step's `agent` field from `hive/agents/{agent}.md`. The two primary agents are:
   - **Researcher** (`hive/agents/researcher.md`) — analyzes scope, complexity, and affected modules
   - **Reviewer** (`hive/agents/reviewer.md`) — evaluates correctness, security, conventions, and performance

   **a-i.** For the `review` step specifically: this file (`skills/review/SKILL.md`) is the skill bound to `hive/agents/reviewer.md`'s `skills:` frontmatter entry — resolve that binding via `hive.lib.skill_binding.resolve_skill_binding("hive/agents/reviewer.md", "running any code review")` and confirm it resolves here before spawning. The reviewer persona supplies identity/rubric/output-format; this Process is what governs the review. A missing or unreadable binding fails the step closed — do not spawn the reviewer against inline persona prose alone.

   **b.** Spawn a subagent with:
   - The agent persona as system context
   - The step's `task` description (or step file if available)
   - The diff content as input
   - Any `inputs` from previous steps

   **c.** Capture the step output for downstream steps.

5. **Write episode records.** After each step, write an episode to:
   ```
   .pHive/episodes/review/{timestamp}/{step-id}.yaml
   ```
   For the `review` step, include the skill-owned marker from step 4a-i as `skill_invoked: skills/review/SKILL.md` on that episode — this is the durable evidence that the bound skill, not persona prose, governed the run.

6. **Display structured findings:**

   ```
   ## Code Review Results

   ### Analysis (Researcher)
   - {N} files changed, {M} modules affected
   - Changes touch {summary of affected areas}

   ### Review (Reviewer)
   **Verdict: {passed | needs_optimization | needs_revision}**

   #### Critical
   - **[{category}]** `{file}:{line}` — {finding}

   #### Improvements
   - **[{category}]** `{file}:{line}` — {suggestion}

   #### Nits
   - **[{category}]** `{file}:{line}` — {minor suggestion}

   ### Summary
   {One-sentence overall assessment and recommended action.}
   ```

   Categories: `security`, `correctness`, `performance`, `convention`, `clarity`, `testing`.

   Verdicts:
   - **passed** — No critical findings, safe to merge
   - **needs_optimization** — No blockers, but improvements recommended
   - **needs_revision** — Critical issues that must be addressed before merge

6b. **Run additional review dimensions (opt-in).** This step executes **only** when a dimension flag from the Argument Parsing table was passed (`--security`, `--performance`, or `--all-dimensions`), OR when the xhigh-effort escalation above forced `--security`/`--performance` on. **When no dimension flag is present and effort is not `xhigh`, skip this step entirely — the baseline path above is unchanged.**

   For each selected dimension, spawn one subagent on the **same diff** already obtained in step 1, using the dimension's persona as system context and its reference workflow's `*-critique` + `synthesis` task description as the instruction:

   - **`--security`** → persona `hive/agents/security-reviewer.md`, tasks from `hive/workflows/security-audit.workflow.yaml`. The reviewer stays strictly in the security lane (auth, secrets, injection, input-validation, PII, misconfiguration).
   - **`--performance`** → persona `hive/agents/performance-reviewer.md`, tasks from `hive/workflows/performance-audit.workflow.yaml`. The reviewer stays strictly in the performance lane (complexity, allocation, I/O, caching, bundle size, lazy-loading) and quantifies every finding.

   Write each dimension's output to its own episode under `.pHive/episodes/review/{timestamp}/dimension-{security|performance}.yaml`.

   **Append** each dimension as a separate, attributed feedback block **below** the baseline `## Code Review Results` — do not interleave, merge, or overwrite the baseline verdict:

   ```
   ### Security Review (security-reviewer)  ← only when --security
   **Security Verdict: {passed | needs_revision}**
   #### Critical
   - **[{security category}]** `{file}:{line}` — {finding}
     Suggestion: {remediation}
   #### Informational
   - **[{security category}]** `{file}:{line}` — {hardening note}

   ### Performance Review (performance-reviewer)  ← only when --performance
   **Performance Verdict: {approved | needs_revision | needs_redesign}**
   #### Findings
   - `{file}:{line}` — {finding} [severity: major | moderate | minor] [impact: {quantified delta}]
   ```

   Each dimension carries its **own** verdict. These dimension verdicts are advisory and are **not** inputs to step 7's status projection or step 8's scope-drift verdict — only the baseline reviewer verdict from step 6 owns those. Security/performance findings are surfaced to the operator as labeled blocks, never folded into the baseline pass/fail.

7. **Project review verdict status.** After the review verdict is recorded successfully, write only the status transition owned by that verdict:

   - `passed`: update the resolved story YAML's `status:` projection from `in_review` to `complete`.
   - `needs_revision`: update the resolved story YAML's `status:` projection from `in_review` to `in_progress`, assign the story back to the appropriate implementation owner (`developer`, `frontend-developer`, or `backend-developer` based on the story/domain metadata and reviewed files), and re-trigger pickup through the same dispatch path `/execute` uses for normal in-progress work.
   - `needs_optimization`: keep the story in `in_review` unless the review explicitly classifies the optimization as required rework; required rework follows the `needs_revision` path above.

   These writes are gated on verdict success. Do not write `complete` or bounce to `in_progress` when the review workflow fails, the verdict is missing, or episode writing fails. `/review` must never write `shipped`.

8. **Emit scope_drift_score (review completion).** After the verdict is rendered, call `hive/lib/scope_drift.py::emit_scope_drift(...)` once. `expected_scope` = the file list the review was scoped to (PR diff or branch diff); `delivered_scope` = the file list the reviewer actually evaluated (divergence signals scope narrowing). `delta_reasons` carries enum values from [cycle-state-schema.md](../../hive/references/cycle-state-schema.md) when scope was narrowed (e.g. `['deferred']`).

   ```bash
   python3 -c "
   from hive.lib.scope_drift import emit_scope_drift
   emit_scope_drift(
       run_id='{review-run-id}',
       phase_label='review:complete',
       expected_scope={file paths in the diff},
       delivered_scope={file paths the reviewer actually evaluated},
       delta_reasons={[] when scope matched; else enum values},
       proposal_id='{pr-number-or-branch}',
       skill='review',
       extra_dimensions={'verdict': '<passed|needs_optimization|needs_revision>'},
   )
   "
   ```

   The maturity gate from story `ed-1-maturity-helper` skips emit on greenfield/early projects and logs once per run. Fire-and-forget — no new error handling.

## What this skill is NOT

- **Not the reviewer persona.** `hive/agents/reviewer.md` supplies identity, the review-dimension rubric, and output-format/verdict contracts. This skill is the procedure; the persona is not a substitute procedure and must not be spawned in its place without loading this file.
- **Not a security or performance audit by default.** `--security` / `--performance` add opt-in, additive dimensions (Phase 1 step 6b) on top of the baseline verdict — they never replace or merge into it.
- **Not the DAG executor, sequential-execution, or team-execution seam itself.** Those callers resolve and load this file via the shared `hive.lib.skill_binding.resolve_skill_binding` contract; this skill only defines what runs once loaded.

## See also

- [`hive/agents/reviewer.md`](../../hive/agents/reviewer.md) — bound persona (identity, rubric, output format)
- [`hive/workflows/step-files/review/reviewer.md`](../../hive/workflows/step-files/review/reviewer.md) — DAG review node that resolves this binding
- [`skills/execute/references/sequential-execution.md`](../execute/references/sequential-execution.md) — shared match-resolve-load-invoke seam (§b-0)
- [`skills/execute/references/team-execution.md`](../execute/references/team-execution.md) — team-execution parity note for the same seam
- [`hive/lib/skill_binding.py`](../../hive/lib/skill_binding.py) — the resolver both paths call

## Key References

- `hive/agents/reviewer.md` — reviewer persona and verdict format
- `hive/agents/security-reviewer.md` — security dimension persona (`--security`)
- `hive/agents/performance-reviewer.md` — performance dimension persona (`--performance`)
- `hive/workflows/security-audit.workflow.yaml` — security dimension task definition
- `hive/workflows/performance-audit.workflow.yaml` — performance dimension task definition
- [code-review-integration.md](../../hive/references/code-review-integration.md) — Hive verdict mapping and ACR coexistence guidance
- `hive/agents/researcher.md` — analysis persona
- `hive/references/episode-schema.md` — episode record format
- `hive/references/status-lifecycle.md` — Canonical command-owned story lifecycle; `/review` owns review entry, pass-to-`complete`, and fail-to-`in_progress` rework transitions.
- `hive/lib/scope_drift.py` — scope-drift scoring + emit helper called at review completion (see step 8 above)
