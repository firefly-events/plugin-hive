# Design Discussion — team-cell-execution-mode

**Inputs:** `.pHive/proposals/team-cell-execution-mode.md`, `.pHive/audits/multica-mode-audit-2026-05-22.md`, `.pHive/epics/team-cell-execution-mode/docs/research-brief.md`
**Date:** 2026-05-22
**Status:** draft for grill + collaborative review

## 0. Prelude

The proposal calls for porting the Hive workflow AS-IS to Multica: each `/hive:execute` story is hosted in a Multica "team cell" with a dynamic team composition (core + optional slots), persona split, and backend routing (Codex for work, Claude Opus 4.7 for review). The current `execute-mode-multica` skill hard-codes a single `developer` Sonnet agent for every story — bypassing the cost-saving Codex split AND the cross-LLM review verification policy.

Research confirms the gap is real. It also resolves the proposal's biggest open question (Q1: which Multica primitive hosts a cell?) by elimination.

## 1. Goal

Replace the current single-developer Multica dispatch with a phase-aware multi-agent flow that:

1. Preserves the Hive workflow persona split (researcher → developer/[fe|be|sec] → tester/qa → reviewer/peer-validator) on a per-story basis.
2. Honors the existing `agent_backends` routing (Codex for work, Claude for verifiers).
3. Honors the model_overrides (`reviewer: opus`, `peer-validator: opus` — cross-LLM gate).
4. Captures one episode marker per phase (not one per story) so /hive:status can derive accurate phase-level state.
5. Resolves story-level outcome via aggregation of the per-phase markers — preserving the "trust git + markers over story YAML status" contract.
6. Closes the audit's six findings (F1 binding, F2 persona split, F3 orchestration, F4 push behavior, F5 token scope, F6 identity drift) in a single coherent change rather than piecemeal patches.

## 2. Proposed approach

### 2.1 Primitive choice — Option (a): Parent issue + child issues per phase

The research is unambiguous: Multica 0.3.4 has NO `session` command. The proposal's option (c) ("Multica sessions / squads") collapses on contact — `squad` exists, but it's a member-grouping container; daemon evidence shows no parallel-multi-agent dispatch on a single task. Option (b) (sequential reassignment of one issue) is *theoretically* available, but it depends on an unconfirmed assumption: that `--assignee` mutation alone triggers a fresh task run. Even if it does, every phase shares one issue's history, which destroys the marker contract (one phase = one marker = one persistent record).

**Decision: Option (a).** One parent issue per story + N child issues per phase. The parent holds the brief; each child is assigned to the phase's role (researcher | developer | tester | reviewer). Per-child episode marker. Parent acts as the roll-up handle for /hive:status and for the closer (s1-1 from story-loop-closure).

This trades CLI weight (more issues) for clarity (each phase is its own first-class artifact) and preserves the existing marker contract.

### 2.2 Cell composition — declarative core + optional with signal predicates

The proposal's `core[] + optional[] + signals{}` block is net-new structural ground (no declarative signal-detection lib at the hive layer today). The closest existing precedent is /plan step 16's UI keyword-list — a flat `.includes()` against a keyword union. The other precedent is the workflow predicate grammar (`when: "$analysis.output.findings_count > 0 || $analysis.output.metric_signal == true"`) used by meta-team workflows.

**Approach:** declarative composition in `hive/lib/team-cell-composer/`:

```yaml
# hive/team-cells/execute-cell.yaml
cell: execute
core:
  - researcher
  - developer
  - tester
  - reviewer
optional:
  - role: backend-developer
    when: scope_signals.backend
    replaces: developer
  - role: frontend-developer
    when: scope_signals.frontend
    replaces: developer
  - role: security-reviewer
    when: scope_signals.security
    appends_after: review
  - role: peer-validator
    when: planning.collaborative_review == true
    appends_after: review
```

Signal detection runs over the story spec at cell creation time. Keywords inline in the composer YAML; predicates are simple `==`/boolean fields. Don't compile to the predicate grammar yet — keep it dumb until we see a real signal that needs OR / NOT.

### 2.3 Per-phase dispatch flow

The new `execute-mode-multica-cell` skill replaces single-developer dispatch with:

```
1. Resolve story → cell roster (composer reads story signals + cell YAML)
2. Create PARENT issue (one per story, holds brief, assigned to nobody — pure container)
3. For each phase in roster order:
     3a. Create CHILD issue (--parent <parent_uuid> --assignee <role-agent>)
     3b. Inject phase brief into child (subset of parent's brief + prior phase outputs)
     3c. Wait for child to terminate (pollTaskUntilTerminal — reused as-is)
     3d. writeMulticaRunEpisode → multica-run-{phase}.yaml
     3e. If terminal != completed → fail-fast (no further phases dispatched)
4. Close parent (status: done) when all phases completed
5. Return roll-up summary to /execute
```

Pre-existing `dispatchStoryToAgent`, `pollTaskUntilTerminal`, `writeMulticaRunEpisode`, `serializeStoryBrief` all reused — only the orchestration layer is new.

### 2.4 Backend routing carryover

`agent_backends` in `hive.config.yaml` is consulted at child-issue creation: the `runtime_id` for that child is set from the agent's bootstrapped persona record. Researcher/developer/architect → Codex runtime; tester/reviewer/qa → Claude runtime. The bootstrap reconciliation (`hive/lib/multica-bootstrap/index.mjs`) writes the correct `runtime_id` per persona; no per-dispatch routing logic needed.

### 2.5 Audit fixes inline

Bundled with the new mode (NOT a separate epic per `feedback_scope_class_changes`):

- **F1 (workspace repo binding):** dispatch refuses to fan out if `project_id` on the parent issue is null. Reuse the project we created this session (`d23d0d43`).
- **F4 (push behavior):** brief footer constrains push target to `feat/{epic}` only; `agent/developer/<task>` orphan branches forbidden.
- **F5 (token scope):** add a slice-0 task to refresh the daemon's GH OAuth with `workflow` scope. Spike `multica setup` first.
- **F6 (identity drift):** workspace agents get `custom_env: {GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL}` injected at bootstrap. Default to `hive-worker <hive-worker@noreply.github.com>`; per-role override available.

### 2.6 Persona bootstrap gap

9 personas need adding to the Multica workspace (researcher, architect, tpm, technical-writer, peer-validator, backend-developer, frontend-developer, analyst, ui-designer). Three name mismatches need resolving in the bootstrap config (`security-reviewer.md` vs `security`; `performance-reviewer.md` vs `performance`; `qa-engineer` has NO source persona file — either create it or alias to `tester`).

## 3. Risks

| # | Severity | Risk | Mitigation |
|---|----------|------|------------|
| R1 | High | Cell startup latency — fan-out of N child issues per story could 2-4x wall-clock vs single-agent flow | Cap optional slots; measure baseline in slice-0 spike; circuit-break at `circuit_breakers.story_timeout_minutes` (45m) |
| R2 | High | Inter-phase context passing — child issue N+1 needs phase N's output (insight capture today is in-conversation, not in markers) | Phase-output written to marker `artifacts:` list AS file paths; next phase's brief includes those file refs verbatim. NO marker-embedded prose. |
| R3 | Medium | Optional `security-reviewer` failure mode — escalates a story, but how does the cell react? Skip / block / pause? | Reviewer-class agents are blocking by contract; failure = phase failed = story failed = retry per `max_step_retries` (2). |
| R4 | Medium | Cost — every story now invokes Opus 4.7 reviewer. Short-tail simple stories may not justify it. | Story YAML `complexity: low` opts the cell down to Sonnet reviewer. Default to Opus for medium/high. |
| R5 | Medium | Token scope refresh (F5) requires user interaction (OAuth flow) — can't be automated cleanly | Detect missing scope at slice-0 dispatch; halt with clear runbook line; require user to run `multica setup` and re-confirm before slice-1 proceeds. |
| R6 | Low | `qa-engineer` persona file doesn't exist — proposal's "simulated-manual testing" needs a home | Create `hive/agents/qa-engineer.md` in slice-1; align with `feedback_check_readme_first` for tone/scope. |
| R7 | Low | Multi-cell concurrency — two stories dispatching in parallel each create 4 child issues; daemon queue can saturate | Daemon's `max_concurrent_tasks=1` per agent already serializes per-role; OK at small scale, revisit at >4 concurrent stories. |

## 4. Dependencies

- `hive/lib/multica-bootstrap/index.mjs` — extended to inject git identity via `custom_env`
- `hive/lib/multica-story-dispatch/index.mjs` + `episode-sync.mjs` — reused as-is; new orchestration layer wraps them
- `skills/hive/skills/execute-mode-multica/SKILL.md` — REWRITTEN (new mode shape)
- `hive.config.yaml.agent_backends` — read by composer; no schema change
- `hive/agents/qa-engineer.md` — NEW persona file
- `hive/team-cells/*.yaml` — NEW directory of cell composition specs
- `hive/lib/team-cell-composer/` — NEW lib

## 5. Open questions (for the user gate)

These are PROPOSAL Qs from `.pHive/proposals/team-cell-execution-mode.md` §"Hand-off to /plan" + the 5 UNANSWERED Qs from the research brief. Numbered for easy reference.

1. **Hosting primitive (proposal Q1)** — Confirm decision: Option (a) parent + child. Research rules out (c); (b) is fragile.
2. **Cell skip-or-block on failed optional (proposal Q1 redux)** — Optional `security-reviewer` fails — cell skips that phase and continues, or blocks the whole story? **Recommend: block; failed optional is an escalation signal, not noise.**
3. **Signal detection ownership (proposal Q2)** — Hive composer (deterministic keyword scan) or LLM-router agent? **Recommend: composer — same precedent as /plan step 16.**
4. **Inter-phase state (proposal Q3)** — Marker `artifacts:` paths only, or persistent session memory? **Recommend: marker paths only; aligns with existing skill contract.**
5. **Multica project scope (proposal Q4)** — Plan / review cells share the execute project, or each gets its own Multica project? **Recommend: shared project per epic; one project per epic gives a clean issue-graph rollup.**
6. **`/triage` cell (proposal Q5)** — Own cell or always operator-driven? **Recommend: operator-driven, defer to a future epic.**
7. **Reassign-triggers-rerun (research Q1)** — Does `multica issue update --assignee` trigger a fresh task run? **Spike in slice-0** (option (b) viability — even though we're going with (a), this informs the fallback path for failure recovery).
8. **Squad parallel/serial (research Q2)** — Squad-as-assignee with N members: parallel, serial, or single-pick? **Spike in slice-0** — informs whether the proposal's "team-cell-as-squad" path becomes viable in a future Multica version.
9. **Workspace default project (research Q3)** — Daemon resolution path when issue has no `--project`? **Spike in slice-0** — informs F1 hardening (workspace-level binding fallback).
10. **Daemon git identity setup (research Q4)** — Where does the daemon establish user.name/email? **Spike in slice-0** — informs F6 fix location (custom_env vs daemon config vs post-checkout hook).
11. **`multica setup` GH OAuth refresh (research Q5)** — Does re-running with `workflow` scope refresh, or is there a separate `multica auth refresh`? **Spike in slice-0** — informs F5 fix.

## 6. Scale assessment

**LARGE.**

Signals:
- Multi-system: hive lib + new skill + new agents YAML + Multica workspace state
- Cross-stack: workflow orchestration + per-role bootstrap + git identity + OAuth scope
- Long-horizon: this is a Hive 2.x foundation change; subsequent epics will run on top
- 5+ slices likely: slice-0 spikes, slice-1 composer + cell YAMLs, slice-2 new skill shape, slice-3 audit-fix bundling (F1/F4/F5/F6), slice-4 migration + flag flip

Routing decision: Phase B2 (H/V planning) + Phase B3 (structured outline) before Phase C stories.

## 7. Out of scope (deferred)

- Reverse-sync (Multica cancel → story YAML defer) — shipped already as s2-1 in `story-loop-closure`
- Closer-on-merge — shipped already as s1-1/s1-2/s2-1 in `story-loop-closure`
- Hive Cloud runtime fork — separate project (`project_hive_cloud_runtime`)
- Plan / review cells — proposal scope is execute cell only ("session definition is only for execution"); plan / review cells are NEW cell types but their team comp + flow are out of scope here
- Multi-cell concurrency tuning — slice-7+ if it becomes a real bottleneck

## 8. Inconsistency-risk anchoring (from grill input)

Five vocabulary collisions surfaced by the research brief. Resolutions to bake into this doc + downstream story specs:

- **"session"** — drop entirely. Use "team cell" everywhere. If a sentence wants the word "session," it MUST disambiguate ("Claude session" | "daemon task session"). No bare "session" in code or docs.
- **"team cell"** — define explicitly: *"one Multica parent issue + N child issues representing one Hive workflow phase scope (plan | execute | review). Composed from a roster declared in `hive/team-cells/{cell}.yaml`."* Distinct from "agent team" (TeamCreate) and "planning team" (planning-routing roster).
- **"phase"** — context-qualified. Cell-internal phases are *workflow-phases* (research/implement/test/review/integrate). /plan-skill Phase A/B/C/D are *plan-phases*. Episode markers track *workflow-steps* (`step_id`). Three terms, three names.
- **"core team / `core[]`** — `core[]` in cell YAML is per-cell-type roster. `Core team` (planning-routing) is the planning roster. Pick one term per scope; never reuse "core team" inside cell YAML prose.
- **"agent"** — qualified everywhere: *Multica agent* (UUID + persona, long-lived), *Hive persona* (source file), *SDK Agent* (transient subagent spawn). Cell YAML uses "role" not "agent" for the roster slot.

These resolutions are non-negotiable for downstream stories. Reviewer should reject any spec that reintroduces collision.

## 9. What "done" looks like

`/hive:execute story-loop-closure` (or any epic) under Multica adapter:

1. Each story creates a parent issue + N child issues per phase, visible in Multica board
2. Each phase agent is the correct role (researcher Codex, tester Claude Sonnet, reviewer Claude Opus 4.7)
3. Episode markers exist per phase under `.pHive/episodes/{epic}/{story}/{phase}.yaml`
4. Commits pushed to firefly `feat/{epic}` branch with `hive-worker` author
5. CI-touching stories don't fail on token scope
6. /hive:status renders accurate story state by aggregating per-phase markers

A successful re-run of the equivalent of story-loop-closure under the new mode = proof of life. (Note: do NOT re-run the actual `story-loop-closure` epic; pick a tiny dogfood epic for the migration test.)

## 10. Grill responses

Grill pass produced 9 findings in `grill-record.md`. Responses below; bake into story specs.

- **V1 — `composer` name collision.** Rename `hive/lib/team-cell-composer/` → `hive/lib/cell-roster-resolver/`. Story spec for slice-1 picks up the new name. Future refactor of planning-routing's roster-builder onto the same lib is OUT OF SCOPE here — flag as candidate post-2.x cleanup.
- **V2 — "phase" usage drift.** Substitute "workflow-phase" everywhere inside §2-7. Reviewer story checks the spec for bare "phase" outside §8 quotes; rejects if found.
- **H1 — `writeMulticaRunEpisode` shape extension.** Slice-1 task: add a `phase` parameter to `writeMulticaRunEpisode` defaulting to `null` for back-compat. When `phase != null`, marker file is `{phase}.yaml` not `multica-run.yaml`. Existing single-developer mode (if anyone still uses it during migration) keeps the old filename via `phase: null`.
- **H2 — Bootstrap per-persona runtime routing.** This is a real, missing piece. Add a slice between slice-0 (spikes) and slice-1 (cell-roster-resolver) named `multica-bootstrap-runtime-routing`: extend `hive/lib/multica-bootstrap/index.mjs` to consult `agent_backends` → resolve to the right runtime_id (Codex vs Claude) per persona at reconciliation. Without this, the whole epic's backend-routing claim is theatre.
- **H3 — Push-target enforcement is not advisory.** Add a post-workflow-phase verifier in `execute-mode-multica-cell`: after each workflow-phase terminates, the orchestrator runs `git ls-remote origin agent/developer/{task_id}` against firefly. If the agent pushed to an orphan branch, the phase fails (`failed`, not `escalated`) and is retried per `max_step_retries`. This makes push behavior enforced, not advisory.
- **U1 — Spike-then-commit ordering.** Restructure slice-0 to "Spike all three primitive options (a/b/c) explicitly, document evidence." Slice-1 commitment to (a) is contingent on slice-0 evidence confirming. If slice-0 surfaces a strong (b) or (c) signal, replan before slice-1. This honors `feedback_test_offtheshelf_before_rewriting`.
- **U2 — Phase-failure policy.** Define table explicitly in §3 R3 expansion (will move to a §3.1 in the structured outline):
  | Scenario | Action |
  |----------|--------|
  | Core workflow-phase fails first time | Retry once (per `max_step_retries=2` minus the initial attempt) |
  | Core workflow-phase fails after retries | Story fails. Parent issue marked `failed`. No further workflow-phases dispatched. |
  | Optional workflow-phase fails (e.g., security-reviewer escalates) | Story blocked (per §5 Q2 recommend). Operator review required before continuation. |
  | Circuit-breaker hit (`story_timeout_minutes=45`) | Cell terminates; story fails; markers reflect final state. |
- **C1 — F5 token-scope refresh is split out.** Create a separate `chore:multica-auth-refresh-workflow-scope` PR that runs once, manually, with operator participation. This epic's slice-0 declares it as a prerequisite (hard precondition); does NOT bundle it inline. Eliminates the user-interactive blocker in autonomous execution.
- **P1 — Gate is warning-with-default, not hard-block.** Revise §2.5 F1: if `project_id` on the parent issue is null, the dispatcher *warns* (per `paths.gate_mode: warning` posture) and auto-creates a workspace-default project named `{workspace}-default` bound to the workspace's resolved repo URL. Hard-block only when `paths.gate_mode: hard` AND project is null.
- **P2 — Cell roster resolver: code first, skill later.** Defer skill-shape evolution. Slice-1 ships `hive/lib/cell-roster-resolver/` as code (faster, lower-risk). Story spec includes a §"Forward link" noting that resolver → atomic skill (`skills/cell-compose/SKILL.md`) is a candidate for a post-2.x epic. Move-fast-now, compose-later. Document the trade in the structured outline §8.

These responses are binding inputs for Phase B2 H/V planning and Phase B3 structured outline. The structured outline elicitation will surface any of these resolutions that turn out to be wrong on closer inspection.
