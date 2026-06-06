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

- **`multica`** → hand off to `skills/hive/skills/review-mode-multica/SKILL.md` (forward all arguments + `field_sources`) and **stop**. Do not continue to Phase 1 below.
- **`cc-workflows`** → hand off to `skills/hive/skills/review-mode-cc-workflows/SKILL.md` (forward all arguments + `field_sources`) and **stop**. Do not continue to Phase 1 below.
- **any other value** (`sequential`, `team`, `team-cmux`, `sessions`, `sandcastle`) → continue inline with the steps below. The solo reviewer pattern (Steps 1–6) is the authoritative inline path.

> `review-mode-multica` and `review-mode-cc-workflows` are forward declarations — their skill files ship in later slices. A missing skill file is not an error at dispatch resolution time; the dispatch skill itself is what this story delivers.

### Phase 1 — Inline solo reviewer (default path)

1. **Obtain the diff.** Run the appropriate diff command from the table above. If the diff is empty, report "No changes to review" and stop.

2. **Load the review workflow.** Read `hive/workflows/code-review.workflow.yaml`. This defines the ordered steps for a code review. If the file does not exist, fall back to the two-step process below.

3. **Execute workflow steps sequentially.** For each step in the workflow:

   **a.** Read the agent persona referenced by the step's `agent` field from `hive/agents/{agent}.md`. The two primary agents are:
   - **Researcher** (`hive/agents/researcher.md`) — analyzes scope, complexity, and affected modules
   - **Reviewer** (`hive/agents/reviewer.md`) — evaluates correctness, security, conventions, and performance

   **b.** Spawn a subagent with:
   - The agent persona as system context
   - The step's `task` description (or step file if available)
   - The diff content as input
   - Any `inputs` from previous steps

   **c.** Capture the step output for downstream steps.

4. **Write episode records.** After each step, write an episode to:
   ```
   .pHive/episodes/review/{timestamp}/{step-id}.yaml
   ```

5. **Display structured findings:**

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

6. **Emit scope_drift_score (review completion).** After the verdict is rendered, call `hive/lib/scope_drift.py::emit_scope_drift(...)` once. `expected_scope` = the file list the review was scoped to (PR diff or branch diff); `delivered_scope` = the file list the reviewer actually evaluated (divergence signals scope narrowing). `delta_reasons` carries enum values from [cycle-state-schema.md](../../hive/references/cycle-state-schema.md) when scope was narrowed (e.g. `['deferred']`).

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

## Key References

- `hive/agents/reviewer.md` — reviewer persona and verdict format
- [code-review-integration.md](../../hive/references/code-review-integration.md) — Hive verdict mapping and ACR coexistence guidance
- `hive/agents/researcher.md` — analysis persona
- `hive/references/episode-schema.md` — episode record format
- `hive/lib/scope_drift.py` — scope-drift scoring + emit helper called at review completion (see step 6 above)
