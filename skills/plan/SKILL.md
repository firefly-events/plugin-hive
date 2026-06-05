---
name: plan
description: Decompose a requirement into an epic with dependency-tracked stories.
---

# Hive Plan

Decompose a requirement into an epic with dependency-tracked stories.

**Input:** `$ARGUMENTS` contains the requirement or feature description. Optionally a target codebase path. Supports optional flags (see `$ARGUMENTS` section below).

## $ARGUMENTS

Parse `$ARGUMENTS` as natural language. Flags are optional; all have defined defaults.

**`--fast`**
Skips H/V planning entirely at medium scope — proceeds from design discussion directly to stories. No effect at small scope (H/V is not run anyway). No effect at large scope (H/V is required regardless of this flag).

**`--validate`**
Forces approach validation (context7 + web research) regardless of scope size or context7 confidence level. Use when the tech stack is known to be in flux and explicit full validation is needed even for small-scope changes. Without this flag, web escalation is uncertainty-triggered.

**`--gate-hv`**
Retains the H/V user-facing review gate at medium scope (opt-in conservative path). Default at medium scope is to auto-proceed after collaborative review (no user gate). This flag restores the gate. No effect at large scope — the gate is always present at large scope regardless of this flag.

**`--from-triage <id>`**
Reads `.pHive/triage/queue.yaml` and decomposes one item (the triage entry whose `id` matches `<id>`) into a normal planning flow. Triage is the upstream input source — this flag does NOT replace plan phases or absorb triage's intake responsibilities. Workflow:

1. Open the queue at `.pHive/triage/queue.yaml`. If the file is missing or malformed, emit an error naming the path and stop — `--from-triage` requires a valid queue.
2. Locate the entry with the requested `id`. If it does not exist, error out with the available IDs (limit 20) for the operator to disambiguate.
3. Verify the entry's `state` is `prioritized`. If not, error out — only `prioritized` entries can hand off to plan (`inbox` / `clarified` need more triage work; `plan-ready` / `closed` are already in or past planning). The triage skill is the right tool to advance state.
4. Use the entry's `title` + `description` + `priority` + `severity` as the input for normal plan decomposition. Plan continues with its standard phases (research, design discussion, H/V or stories, etc.) as if those fields had been the original `$ARGUMENTS`.
5. On planning success — when an epic + stories have been written — call back into triage with the produced epic/story IDs. Triage advances the entry from `prioritized → plan-ready` and writes `linked_epic` / `linked_story` per the queue schema. Plan does NOT write to `queue.yaml` directly — triage owns persistence (single-writer invariant).

**Single-item rule.** Each `--from-triage` invocation handles exactly one queue item. To plan multiple triage items, run plan once per item. This keeps decomposition coherent: plan output (one epic) maps to one triage source.

**Triage stays atomic.** This flag is a hand-off surface only — do NOT inline triage's clarification or prioritization steps into plan. If an operator runs `--from-triage` against an entry that should still be in triage (wrong state above), the right response is the error in step 3 above, not a fallback that does both jobs.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — state-directory note, kickoff gate, persona / config / memory loading. This skill consults routing keys (`agent_backends`, `model_overrides`, `planning.collaborative_review`) so also follow the **Root-first config precedence** subsection of the prelude.

**Kickoff gate override — gate_mode aware.** If the kickoff checks pass, proceed silently. Read `paths.gate_mode` from the root `hive.config.yaml` (consumer override layer; falls back to `hive/hive.config.yaml`; default `warning`). When `gate_mode: hard`, the prelude's hard-stop applies byte-equivalently. When `gate_mode: warning`, the hard-stop is replaced by warn-and-proceed with sane defaults:

1. Emit the warning below (verbatim) when `.pHive/project-profile.yaml` is missing or its `tech_stack` field is empty/null:

   > Warning: Hive not initialized for this project. Running `/plan` with sane defaults — methodology auto-detected per story a-32, placeholder project-profile written to disk. Run `/hive:kickoff` for full context, or set `paths.gate_mode: hard` to restore blocking behavior.

2. If `.pHive/project-profile.yaml` is absent, generate a placeholder at that path before proceeding. Placeholder content (YAML):

   ```yaml
   tech_stack: []
   languages: []
   frameworks: []
   placeholder: true
   created_by: /plan-gate-lift
   created_at: "<ISO 8601 timestamp>"
   ```

   This placeholder unblocks future invocations without re-warning every run. Hive treats `placeholder: true` as "needs kickoff" but does not re-block.

3. Methodology resolution: defer to the auto-detect path introduced by story `a-32-plan-methodology-auto-detect` (already merged on this branch). If auto-detect cannot determine a methodology, fall back to `classic`.

4. Telemetry: append one JSONL record to `.pHive/metrics/events/gate-lift-<ISO 8601 timestamp>.jsonl` with shape:

   ```json
   {"event":"gate_lift_fired","skill":"plan","gate_mode":"warning","epic_id":"<from $ARGUMENTS or generated>","timestamp":"<ISO 8601>","project_profile_present":<true|false>,"tech_stack_present":<true|false>}
   ```

   Create the `.pHive/metrics/events/` directory if absent. This event feeds the story `a-36-post-run-audit-telemetry` audit.

5. Proceed with the rest of `/plan` after these defaults are in place.

## Process

### Phase 0: Assemble Planning Team

0. **Resolve the epic branch before any planning docs are written.** After the skill preamble has run and `{epic-id}` has been resolved from the user input, ensure planning happens on `feat/{epic-id}` before continuing:

   - Check the working tree first. If there are uncommitted changes, stop immediately with guidance to commit or stash before re-running `/hive:plan`. Do not create, switch, or write anything while the tree is dirty.
   - Read the current branch name.
   - If already on `feat/{epic-id}`, do nothing and continue.
   - If on a different `feat/*` branch, prompt the user for confirmation before switching to `feat/{epic-id}`.
   - If `feat/{epic-id}` already exists locally, check it out. Otherwise create it from the current HEAD and switch to it.
   - Only after `feat/{epic-id}` is active may the skill write planning artifacts such as the research brief, design discussion, H/V plans, structured outline, or story YAMLs.

0a. **Working-tree must match the configured tracker repo.** Before any planning artifact is written, verify that the current working directory is a checkout of the same repo configured in `task_tracking.repo`. The hive worker contract ("Trust the YAML, not the issue body") requires story YAMLs to land on disk in the repo where the issues will be filed. Planning in a sibling clone and filing issues against a different repo's URL is the failure mode that orphaned epic `sandcastle-gh-issue-dispatch` (issues #157-#159 in firefly-events/plugin-hive, files in `plugin-hive-ui-f`; worker failed with "epic dir does not exist").

    Check:

    ```bash
    if [ -n "$(jq -r '.task_tracking.repo // empty' hive.config.yaml 2>/dev/null)" ]; then
      configured_repo=$(jq -r '.task_tracking.repo' hive.config.yaml)
      cwd_remote=$(git config --get remote.origin.url | sed -E 's|.*[:/]([^/]+/[^/.]+)(\.git)?$|\1|')
      if [ "$cwd_remote" != "$configured_repo" ]; then
        echo "WARN: cwd=$cwd_remote but task_tracking.repo=$configured_repo"
        echo "Planning here will write story YAMLs to the wrong repo. Stop and re-run from the right checkout, or update task_tracking.repo."
        exit 1
      fi
    fi
    ```

    Hard-stop on mismatch (no warn-and-proceed). The blast radius of a wrong-repo plan run is high (orphaned issues, drift between tracker and disk) and the fix is cheap (switch cwd).

0b. **Allowlist the new epic dir in `.gitignore` before writing into it.** The repo blanket-ignores `.pHive/epics/*` with explicit per-epic allowlist entries (see lines following `!.pHive/epics/`). New epic dirs written without an allowlist entry are silently untracked — the worker checkout on `main` then can't see them, even though the local working tree shows them as present. This is the same root cause as orphaned `sandcastle-gh-issue-dispatch`.

    Before the first write under `.pHive/epics/{epic-id}/`, append (idempotent — skip if already present):

    ```
    !.pHive/epics/{epic-id}/
    !.pHive/epics/{epic-id}/**
    ```

    Place the new entries immediately after the last existing `!.pHive/epics/<name>/**` line in `.gitignore`. Commit `.gitignore` together with the first epic artifact so the dir is tracked from inception.

0c. **Resolve planning dispatch mode before teammate spawn.** Read the plan dispatch
mode with env-over-config precedence and store it as `${planning_mode_decision}`
on the planning context. CC Workflows and Multica are sibling overrides; env wins
over config within each, and CC Workflows wins over Multica when both are set
(env-over-env, config-over-config) so the maintainer can flip a single knob
without re-reading the older setting:

   1. If `HIVE_PLANNING_MODE=cc-workflows`, set
      `{ mode_decision: "cc-workflows", field_sources: { planning_mode: "env" } }`.
   2. Else if `HIVE_PLANNING_MODE=multica`, set
      `{ mode_decision: "multica", field_sources: { planning_mode: "env" } }`.
   3. Else if the root-first resolved `hive.config.yaml` has
      `planning.mode: cc-workflows`, set
      `{ mode_decision: "cc-workflows", field_sources: { planning_mode: "config" } }`.
   4. Else if the root-first resolved `hive.config.yaml` has
      `planning.mode: multica`, set
      `{ mode_decision: "multica", field_sources: { planning_mode: "config" } }`.
   5. Otherwise set
      `{ mode_decision: "default", field_sources: { planning_mode: "default" } }`.

   This is a thin selector only. It does not dispatch personas directly and it
   does not bypass user-facing review gates. When the decision is `cc-workflows`,
   Phase 0 routes teammate spawn through `planning-routing` ->
   `plan-mode-cc-workflows`, which owns the Workflow tool persona dispatch,
   polling, and episode markers. When the decision is `multica`, Phase 0 routes
   teammate spawn through `planning-routing` -> `plan-mode-multica`, which owns
   the Multica persona dispatch, polling, and episode markers.

1. **Assemble and route the planning team.** Invoke the **planning-routing** skill (atomic; `skills/hive/skills/planning-routing/SKILL.md`) — this is an **external call**, NOT inline prose copied from the routing skill.

Pass four inputs: `assembled_personas` (core planning personas plus conditional architect/ui-designer selected from the requirement), the root-first `agent_backends` map (empty map if absent per [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md)), `${planning_mode_decision}` from step 0c, and `requirement_summary`.

The skill builds final `routing_decisions`, spawns CC Workflows, Multica, direct, and/or Codex-backed teammates, emits exactly one structured routing INFO log per persona, and handles CC-Workflows→Codex→direct fallback, Multica→Codex→direct fallback, and Codex runtime fallback/circuit breaker behavior. When `${planning_mode_decision}.mode_decision == "cc-workflows"`, `planning-routing` invokes `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` for CC-Workflows-dispatched personas. When `${planning_mode_decision}.mode_decision == "multica"`, `planning-routing` invokes `skills/hive/skills/plan-mode-multica/SKILL.md` for Multica-dispatched personas. Otherwise it preserves the existing direct/Codex routing behavior.

Continue Phase A using the returned active planning team handles and `routing_decisions`.

See [`skills/hive/skills/planning-routing/SKILL.md`](../hive/skills/planning-routing/SKILL.md).

**Gate ownership invariant.** CC-Workflows-dispatched and Multica-dispatched
planning may produce or revise planning artifacts, but neither ever advances
user review/sign-off gates. The orchestrator still presents and waits locally at
the design-discussion review gate, the conditional H/V review gate, and the
structured-outline sign-off gate. Workflow tool completion and Multica issue
completion are artifact-readiness signals, not user review approvals.

### Phase A: Research

0a. **Pre-flight: resolve git_flow (pe-5).** Immediately after the kickoff gate passes (and before any researcher / writer dispatch), call `resolveGitFlow({ cwd })` from `hive/lib/git_flow.mjs` (pe-1) and store the result on the planning context as `${git_flow_resolution}`. The two fields you persist downstream are `base_branch` and `branch_strategy`:

   ```bash
   node --input-type=module -e "
     import('./hive/lib/git_flow.mjs').then(m => {
       const r = m.resolveGitFlow({ cwd: process.cwd() });
       process.stdout.write(JSON.stringify(r));
     });
   "
   ```

   The resolution is pinned at plan time — even if `hive.config.yaml` drifts later, every downstream sandcastle dispatch for this epic uses the value captured here (see step 15 below). On import failure (helper not vendored), fall back to `{ base_branch: 'main', branch_strategy: 'per-epic' }` and add a one-line note to the design discussion §0 prelude so reviewers know the helper was unavailable.

0. **Pre-flight: query prior decisions (S6.2).** Before dispatching the researcher, invoke `/hive:why` in free-form mode against the requirement topic to surface any prior KG decisions that should inform this plan. Treat this as audit-trail discovery, not blocking input:

   ```bash
   python3 -m hive.lib.kg_why "<requirement topic words>" --limit 10
   ```

   Three outcomes:
   - **≥1 result returned:** capture the merged triples and add a `PRIOR DECISIONS` section to the design-discussion §0 prelude (rendered alongside the research brief in Phase B). The section lists each prior decision with subject, predicate, object, and provenance (`source_epic`, `source_agent`, `valid_from`). The design-discussion team reads these as constraints — prior commitments that the new plan should honor or explicitly supersede.
   - **Zero results:** omit the PRIOR DECISIONS section entirely. No noise — silence means clean slate.
   - **Helper failure (kg_why error, missing sqlite, etc.):** treat as zero results. Do NOT block planning. Continue to step 1.

   This is the consumer side of the audit-trail north-star (north-star 2 in design-discussion §1). /hive:why is the precision query surface; this pre-flight is the planning-skill side that pulls retrospection into design-time.

1. **Research the codebase.** `SendMessage` to the researcher to explore the target codebase — tech stack, architecture, existing patterns, relevant files. The researcher delivers raw findings (not a formatted brief). Use the researcher agent mindset — you need concrete file paths, not guesses.

   The researcher runs **context7 validation always-on** for any library/SDK/API in the requirement. Web research escalation is uncertainty-triggered (stale docs, missing coverage, conflicting info) — not scope-gated. Findings include a validation note with confidence level. If context7 is unavailable, the researcher proceeds codebase-only and notes the gap.

2. **Produce research brief.** `SendMessage` to the technical writer with the research-brief skill to transform raw findings into a formatted brief. This brief feeds into the design discussion. Write to `.pHive/epics/{epic-id}/docs/research-brief.md`.

3. **Load cross-cutting concerns.** Check for `.pHive/cross-cutting-concerns.yaml`. If found, load the concerns — they will be evaluated per-story later. See `hive/references/cross-cutting-concerns.md`.

### Phase B: Design Discussion (always runs)

> **Parallel-call-site annotation (audit pass):** `parallel_rationale: read-only` — the design-discussion team produces docs under `.pHive/epics/{id}/docs/`; no production code writes. Out-of-scope for the `ed-7` story-level fan-out gate (one team with N personas dispatched through [`planning-routing/SKILL.md`](../../skills/hive/skills/planning-routing/SKILL.md), not N independent stories); catalogued in [`hive/references/parallel-call-sites.md`](../../hive/references/parallel-call-sites.md) §3 (`plan:design-discussion-team`).

4. **Produce design discussion (draft).** `SendMessage` to the technical writer with the `design-discussion` skill (`hive/references/document-templates/design-discussion.md`). Input: the research brief + the original user request. Output: a ~200-line design discussion document covering goal, proposed approach, risks, dependencies, open questions, and a scale assessment. Write the **draft** to `.pHive/epics/{epic-id}/docs/design-discussion.md` — Phase A2 (next step) grills it before the collaborative review gate.

### Phase A2: Adversarial Alignment (Grill)

4a. **Run grill against the draft design-discussion.** Invoke the **grill** skill (atomic; `skills/grill/SKILL.md`) — this is an **external call**, NOT inline prose copied from the grill skill. Pass the draft path from step 4 plus the research brief (so grill can read its `inconsistency_risk_signals` field, emitted by the researcher). Grill produces `.pHive/epics/{epic-id}/docs/grill-record.md` per [`hive/references/grill-record-template.md`](../../hive/references/grill-record-template.md).

The grill-record surfaces five categories of finding (vocabulary mismatches, hidden assumptions, unresolved tensions, convention violations, posture mismatches) — descriptive only, no prescriptions, no quality scoring. Each finding ends with a question for the planner to answer.

If `.pHive/CONTEXT.md` is absent, grill still runs but with reduced fidelity (silent-on-absence per skill-prelude contract). If the research brief is missing `inconsistency_risk_signals`, grill runs heuristically against the draft alone.

**Atomic boundary:** if grill ever appears as inline prose inside this skill, that is a regression. Phase A2 is a single skill invocation that returns a grill-record path; this skill does not duplicate grill's pass.

4b. **Collaborative review gate (if enabled).** Check `hive.config.yaml → planning.collaborative_review`. If `true` (default), run the collaborative review gate (see Collaborative Review Gate section below). `SendMessage` the design discussion AND the grill-record from Phase A2 to all active team agents for review. The technical writer revises the draft to address each grill-record finding (or annotates explicitly-accepted-and-justified deviations) and incorporate team feedback. If `false`, skip the review gate; the writer still revises against the grill-record, then the document is presented directly to the user.

5. **Present design discussion to user.** Show the full document, including a summary of what the team flagged and resolved during collaborative review. The user reads it and provides feedback:
   - Affirm or correct the understanding of the goal
   - Answer open questions (numbered for easy reference)
   - Flag any risks or approaches they disagree with
   - Confirm or override the scale assessment recommendation

   This gate is always local to the orchestrator, including when Phase 0 used
   `planning.mode: cc-workflows` or `planning.mode: multica`. CC-Workflows or
   Multica planning output may feed the document, but neither must auto-advance
   user feedback, scale selection, or routing.

   After collecting user feedback, evaluate the scale and **announce the routing decision inline** — no separate confirmation step:

   ```
   SCALE DECISION: [Small | Medium | Large]

   Small  → Proceeding directly to stories (Phase C)
   Medium → Running H/V planning, then stories (Phase B2 → C)
   Medium + --fast → Skipping H/V entirely, proceeding to stories (Phase C)
   Large  → Running H/V planning + structured outline, then stories (Phase B2 → B3 → C)
   ```

   **Routing rules:**
   - **Small** (~5-15 min, 1-3 files, single layer): design discussion is sufficient context → Phase C
   - **Medium** (multi-file, multiple layers, cross-stack): needs H/V planning to slice correctly → Phase B2 (unless `--fast`, which skips H/V entirely)
   - **Large** (multi-system, migration, long-horizon): needs full H/V + structured outline with elicitation → Phase B2 + B3

### Phase B2: Horizontal + Vertical Planning (medium and large scope)

6. **TPM plans the delivery.** `SendMessage` to the TPM with the design discussion, user feedback, research brief, and any architect outputs. The TPM:
   a. Maps all architectural layers and cross-layer dependencies (horizontal thinking)
   b. Cuts vertical slices — minimum cross-stack increments that each produce a working state
   c. Directs the technical writer to produce both documents using the horizontal-plan and vertical-plan skills

   The TPM is the owner of this step. The architect (if present) has already contributed their perspective in earlier phases — the TPM now sequences their inputs into an executable delivery plan.

7. **Collaborative review gate (if enabled).** If `hive.config.yaml → planning.collaborative_review` is `true` (default), run the collaborative review gate on the H/V outputs. `SendMessage` both documents to all active team agents. The researcher verifies findings are accurately reflected, the architect (if present) validates technical soundness, and the UI designer (if present) flags any UI layer gaps. Collect feedback, have the writer revise if needed. If `false`, skip and proceed directly.

8. **H/V gate (conditional).** Behavior depends on scope and flags:

   - **Large scope:** Always present both documents to the user for review. Collect feedback, incorporate, then proceed to Phase B3.
   - **Medium scope + `--gate-hv`:** Present both documents to the user for review. Collect feedback, incorporate, then proceed to Phase C.
   - **Medium scope (default, no `--gate-hv`):** Auto-proceed to Phase C without presenting a gate — the collaborative review in step 7 is sufficient.
   - **Medium scope + `--fast`:** H/V planning was skipped entirely at step 5 — this step is never reached.

   When this gate runs, it is local to the orchestrator even if the H/V docs
   were produced or revised by CC-Workflows-dispatched or Multica-dispatched
   planning personas. Workflow tool completion and Multica completion are
   artifact-readiness signals, not user review approvals.

   **When the gate runs (large or medium + `--gate-hv`), the user reviews:**
   - Are the layers correctly identified? (horizontal)
   - Are the slice boundaries logical? (vertical)
   - Is the first slice thin enough to be a real proof of concept?
   - Does each slice produce a genuinely working state?
   - Are deferred items acceptable?

### Phase B3: Structured Outline (large scope only)

9. **Produce structured outline.** `SendMessage` to the technical writer with the `structured-outline` skill (`hive/references/document-templates/structured-outline.md`). Input: H/V plans + design discussion + user feedback + research brief. Output: a ~1000-line structured outline with detailed approach, file manifest, risk registry, and elicitation questions. The outline now builds ON the vertical slice plan — each phase in the outline maps to a vertical slice.

9b. **Collaborative review gate (if enabled).** If `hive.config.yaml → planning.collaborative_review` is `true` (default), run the collaborative review gate on the structured outline. This is the most critical review — all active team agents review the full outline. The TPM validates sequencing, the researcher confirms technical accuracy, the architect (if present) stress-tests feasibility, and the UI designer (if present) validates UI approach. Collect feedback, have the writer revise if needed. If `false`, skip and proceed directly.

   **UI Designer SCALE_CALL revision (step 9b only) — two-gate precedence rule:** If ui-designer emits a `SCALE_CALL` field in their step 9b review response, apply **last gate wins**:
   - **Revised to `pre-exec`:** delete any existing ui-designer escalation entry in cycle state, then write the step 9b `ESCALATION:` block as a fresh entry. Log: `"ui-designer scale call revised at step 9b to pre-exec — writing fresh escalation"`
   - **Revised to `in-planning`:** delete any existing ui-designer escalation entry in cycle state (step 4b pre-exec call is superseded). Log: `"ui-designer scale call revised at step 9b to in-planning — escalation removed"`
   - **No step 9b revision:** step 4b value stands unchanged; no action needed

10. **Present structured outline to user.** Show the full document, including a summary of team review findings. The elicitation section (Part 7) contains the agent team's own stress-test of the plan — the user reads the team's answers to evaluate whether the thinking is sound. The user then:
    - Flags any elicitation answers that seem weak or wrong
    - Responds to the decision points (Part 8) — numbered affirm/change items
    - Provides final sign-off or requests revisions

    This sign-off gate is always local to the orchestrator, including when the
    structured outline was produced by CC-Workflows-dispatched or
    Multica-dispatched planning personas. Do not let Workflow tool completion,
    Multica issue completion, or episode markers imply sign-off.

    Incorporate feedback into the planning context before proceeding.

    **S2.1 seam 3 — waiting-on-user `phase_blocked` emission.** Before presenting the document and pausing for input, emit one `phase_blocked` triple keyed to this gate. The emit is fire-and-forget (CLI swallows knob==off + missing-sqlite; do NOT branch on its exit code):

    ```bash
    python3 -m hive.lib.kg_emit_cli \
      --subject "{epic_id}" \
      --predicate "phase_blocked" \
      --object "waiting-user-input-structured-outline-sign-off" \
      --source-epic "{epic_id}" \
      --source-agent "orchestrator"
    ```

    Apply the same pattern at the two other waiting-on-user pauses in /plan: design-discussion review (Phase B) gate uses `--object "waiting-user-input-design-discussion"`, and H/V plan review gate uses `--object "waiting-user-input-hv-plan-review"`. Gate-name slugs are kebab-stable so /meta-optimize can group by gate. Add no new error handling — the CLI is silent on failure by design.

### Phase C: Story Decomposition

10c. **Resolve methodology.** Before decomposing stories, determine the development methodology with strict 4-tier precedence:

   1. **Flag override:** If `$ARGUMENTS` contains `--methodology=<value>`, use that value. This always wins; do not auto-detect and do not warn. Emit telemetry with `source=flag`.
   2. **Epic override:** Else, if `epic.yaml` contains a `methodology` field, use that value. It wins over auto-detect. Emit telemetry with `source=epic-yaml`.
   3. **Project default:** Else, if `hive.config.yaml` contains a `methodology` field, use that value. It wins over auto-detect. Emit telemetry with `source=hive-config`.
   4. **Auto-detect:** Else, inspect the codebase and emit telemetry with `source=auto-detect`:
      - Gherkin path: scan for `.feature` files, excluding `node_modules/`, `.history/`, `.pHive/spikes/`, `dist/`, and `build/`. If at least one `.feature` file is found, resolve `bdd`.
      - Test path: scan common locations (`./`, `src/`, `lib/`, `packages/*`) for directories named `tests/`, `test/`, `__tests__/`, or `spec/`. Require at least one actual test file inside: files matching `.test.*`, `.spec.*`, `_test.*`, or any file inside `__tests__/`. If found, resolve `tdd`.
      - Tiebreaker: `.feature` files win over tests because they are the more specific signal. If both signals are detected, resolve `bdd` and warn that both BDD and TDD signals were found.
      - If neither signal is detected, resolve `classic`.

   False-positive guards for auto-detect:
   - Empty `tests/`, `test/`, `__tests__/`, or `spec/` directories do not trigger `tdd`; require at least one actual test file matching the rules above.
   - `.feature` files under excluded paths (`node_modules/`, `.history/`, `.pHive/spikes/`, `dist/`, `build/`) are ignored.

   When auto-detect fires (Tier 4 only), emit a loud warning:
   `WARNING: Auto-detected methodology: {value} ({rationale, e.g. "found 47 test files under tests/"}). Override with --methodology=classic|tdd|bdd or set in hive.config.yaml.`

   Emit one printable inline telemetry line for every resolution:
   `[telemetry] methodology_resolution source={flag|epic-yaml|hive-config|auto-detect} value={value}`

   Available methodologies (must match a workflow YAML in `hive/workflows/`):
   - `classic` — Research → Implement → Test → Review → Integrate
   - `tdd` — Research → Test Spec → Implement → Review → Integrate
   - `bdd` — Research → Behavior Spec → Implement → Test → Review → Integrate

   The resolved methodology determines what steps each story gets (see step 14).

11. **Decompose into stories.** Break the requirement into an **epic** containing multiple **stories**. Use all available planning context (design discussion, H/V plans if produced, structured outline if produced).

    **If vertical slice plan exists:** Stories map to vertical slices. Each slice becomes one or more stories. Stories within a slice can run in parallel, but slices execute sequentially (each depends_on the prior slice's stories). Every story's completion leaves the product in a working state — this is the vertical planning invariant.

    **If no vertical slice plan:** Decompose as before — independently implementable stories with dependency tracking.

    **Escalation stories[] backfill (always runs after story IDs are determined):**
    Invoke `skills/hive/skills/escalation-backfill/SKILL.md` after canonical story YAML IDs are finalized.
    Pass inputs:
    - `epic_id`: current epic ID
    - `story_ids[]`: decomposed canonical story YAML IDs from this step
    - `cycle_state_path`: `.pHive/cycle-state/{epic_id}.yaml`
    Use its outputs before continuing to requirements traceability.

12. **Requirements traceability check.** Before finalizing stories, verify every aspect of the original requirement is covered by at least one story:
    - Re-read the original requirement/PRD
    - List every distinct capability, feature, or behavior mentioned
    - Map each to at least one story
    - Flag any unmapped capabilities as **GAPS**
    - Present gaps to the user before proceeding

    ```
    TRACEABILITY:
      Mapped: 8 of 10 capabilities covered
      GAPS:
      - SMS/email invites to non-users — not covered by any story
      - Contact permission flow — not covered by any story
    ```

13. **Write detailed story files.** For each story, produce an individual YAML file in `.pHive/epics/{epic-id}/stories/{story-id}.yaml`. Stories are the primary artifact — they're what agents read when executing. They must contain enough context for an agent to work autonomously without reading the full epic or other stories.

    **New-write vs overwrite rule:** Before writing each story YAML, check whether `.pHive/epics/{epic-id}/stories/{story-id}.yaml` already exists.

    - If it does not exist, write the new story normally.
    - If it exists, treat the write as a supersession. Compute a short content hash for the existing file and for the replacement content, emit `superseded`, then overwrite the file. The emit is fire-and-forget (CLI swallows knob==off + missing-sqlite; do NOT branch on its exit code):

      ```bash
      old_hash="$(git hash-object ".pHive/epics/{epic-id}/stories/{story-id}.yaml" | cut -c1-12)"
      new_hash="$(printf '%s' "$replacement_story_yaml" | git hash-object --stdin | cut -c1-12)"
      python3 -m hive.lib.kg_emit_cli \
        --mode supersede \
        --subject "{story-id}" \
        --predicate "story-spec" \
        --prior-object "$old_hash" \
        --object "$new_hash" \
        --source-epic "{epic-id}" \
        --source-agent "plan"
      ```

      The supersession edge is `old story id/hash -> new story id/hash` at the `story-spec` predicate; the helper also sets `valid_until` on the prior `story-spec` triple when present.

    **Self-containment rule:** Stories must work identically whether read from local disk or pulled from an external tracker (e.g., Linear). To achieve this, **inline relevant context snippets** alongside file references:

    - For `code_examples`: extract the relevant lines (~10 max) into a `snippet` field. The agent gets the pattern without needing the source file on disk.
    - For `references`: change from a flat path list to objects with a `relevant_excerpt` field containing the 3-5 most relevant lines from that document.
    - For `key_files`: add a `purpose` field explaining why each file matters to this story.

    Snippets are optional but strongly encouraged. Skip only when the reference is an entire file that would be read in full anyway. The file path always stays for traceability — humans can look up the full document. The snippet is what makes the story portable.

    **Methodology-aware steps:** Generate story steps that match the resolved methodology (from step 10c). Add a `methodology` field to each story YAML. Use these step templates:

    **Classic** (default):
    ```yaml
    methodology: classic
    steps:
      - id: research
        description: Explore the codebase for relevant patterns, files, and constraints
        agent: researcher
      - id: implement
        description: Implement the story according to spec and research findings
        agent: developer
        depends_on: [research]
      - id: test
        description: Write tests covering acceptance criteria and verify they pass
        agent: tester
        depends_on: [implement]
      - id: review
        description: Review implementation and tests for correctness and convention compliance
        agent: reviewer
        depends_on: [test]
      - id: integrate
        description: Commit and push to feature branch
        agent: developer
        depends_on: [review]
    ```

    **TDD:**
    ```yaml
    methodology: tdd
    steps:
      - id: research
        description: Explore the codebase for relevant patterns, files, and constraints
        agent: researcher
      - id: test-spec
        description: |
          Write failing tests from the story spec and acceptance criteria.
          Do NOT read implementation code — tests define expected behavior independently.
        agent: tester
        depends_on: [research]
      - id: implement
        description: Write code to make the failing tests pass. Do not modify the tests.
        agent: developer
        depends_on: [test-spec]
      - id: review
        description: Review implementation and tests for correctness and convention compliance
        agent: reviewer
        depends_on: [implement]
      - id: integrate
        description: Commit and push to feature branch
        agent: developer
        depends_on: [review]
    ```

    **BDD:**
    ```yaml
    methodology: bdd
    steps:
      - id: research
        description: Explore the codebase for relevant patterns, files, and constraints
        agent: researcher
      - id: behavior-spec
        description: |
          Write Gherkin/Given-When-Then behavior specifications from the story's
          acceptance criteria. These specs define the contract before implementation.
        agent: tester
        depends_on: [research]
      - id: implement
        description: Implement the story to satisfy the behavior specifications
        agent: developer
        depends_on: [behavior-spec]
      - id: test
        description: Derive test cases from behavior specs and verify they pass
        agent: tester
        depends_on: [implement]
      - id: review
        description: Review implementation, behavior specs, and tests for correctness
        agent: reviewer
        depends_on: [test]
      - id: integrate
        description: Commit and push to feature branch
        agent: developer
        depends_on: [review]
    ```

    Customize step descriptions per story as needed — these templates provide the ordering and agent assignments. For low-complexity stories, the `research` step may be skipped regardless of methodology.

    **Parallel-dispatch flag emission.** Stories default to serial dispatch — **omit both fields = serial**. When you intend a story to run concurrently with its dependency-graph peers, emit the two top-level fields documented at [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §4: `parallel_allowed: true` plus a bounded `parallel_rationale`. Pick the rationale by what the story does, not by author preference:

    | Story shape | Rationale to emit | Additional fields required |
    |---|---|---|
    | Research, audit, validation, or any other read-only work that writes only reports/analysis under `.pHive/` and does not touch production code, runtime config, or another story's outputs | `read-only` | — |
    | One of N near-identical stories applying the same template to disjoint targets (UI A/B variants, sibling-module refactors, approach alternates) | `variation` | — |
    | A story that writes to a narrow, explicitly declared slice of the codebase that does not overlap any concurrent story's slice | `bounded-slice` | non-empty `files_to_modify:` whose entries name the touch-set the `/execute` lint will check for disjointness |

    Rules:
    - **Default is omit.** When in doubt, emit neither field — serial is always safe; the parallel gate (`ed-7`) refuses to dispatch a story concurrently when the pair is absent. Do not pad serial stories with `parallel_allowed: false` — the omitted form is canonical.
    - **`parallel_allowed: true` requires `parallel_rationale`** set to exactly one of `variation`, `read-only`, `bounded-slice`. Any other value (or missing rationale) is malformed and will be rejected by the validator.
    - **`bounded-slice` is the only rationale that constrains the file set.** Stories emitting `parallel_rationale: bounded-slice` MUST carry a non-empty top-level `files_to_modify:` list whose entries name the slice — the disjointness lint in `ed-7-execute-enforces-gate` can only check the slice boundary against a declared touch-set. A `bounded-slice` story with empty or absent `files_to_modify:` is malformed.
    - **Free-text justifications do not satisfy the gate.** Prose like "should be safe to run in parallel" in description/notes is invisible to the validator. The bounded enum is the contract; `/execute` consumes the pair and refuses dispatch when either is malformed.

    **Worked example — three stories from a hypothetical epic of five.** The three independent stories below ship with the pair; two implicitly-serial siblings (a design-discussion follow-on and a final integration) carry neither field:

    ```yaml
    # 1. Read-only audit — analysis report only, touches no production code
    id: audit-skill-prompt-token-budgets
    depends_on: []
    parallel_allowed: true
    parallel_rationale: read-only
    files_to_modify:
      - file: .pHive/audits/skill-token-budgets/report.md
        change: write the audit report
    # ---
    # 2. Variation refactor — one of seven sibling-module extractions
    id: ui-cluster-extract-config-header
    depends_on: [ui-cluster-extract-config-base]
    parallel_allowed: true
    parallel_rationale: variation
    files_to_modify:
      - file: src/components/ClusterHeader.tsx
        change: extract ClusterHeaderConfig
    # ---
    # 3. Bounded-slice — narrow declared write surface, disjoint from peers
    id: cmux-add-logging-hook
    depends_on: [cmux-pane-spawn-base]
    parallel_allowed: true
    parallel_rationale: bounded-slice
    files_to_modify:
      - file: hive/lib/cmux/pane_hooks.mjs
        change: register new "log" hook
    ```

    The fields slot in after `depends_on:` and before `description:` per schema §4. `files_to_modify:` keeps its conventional position alongside other context fields. Downstream, `/execute`'s parallel-dispatch gate (`ed-7-execute-enforces-gate`) reads the pair to decide concurrent-dispatch eligibility, and feeds `bounded-slice` stories' `files_to_modify:` touch-sets into the disjointness lint.

14. **Evaluate cross-cutting concerns per story.** For each story, evaluate each concern's `applies_when` condition. For applicable concerns, determine the specific action needed and add a `cross_cutting` section to the story YAML. See `hive/references/cross-cutting-concerns.md` for format and examples.

    **Concern routing.** Most concerns emit their per-story output into the generic `cross_cutting:` section as `{concern, action}` entries. A small number of concerns instead emit into a dedicated top-level field on the story YAML; the loop must route those concerns to their target field rather than to `cross_cutting:`. Currently dedicated-field concerns are:

    | Concern `id` | Target field | Schema ref |
    |---|---|---|
    | `metrics` | top-level `metric:` block | [`story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §3 |
    | `simulated-manual` | `scenario` step injection + top-level `manual_verdict.scenario_ref` | [`story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §9 |

    To add a new dedicated-field concern later, extend this routing table; do not hardcode concern-specific logic elsewhere in the skill.

    **Metrics concern (`id: metrics`) — per-story handling.** When the metrics concern is present in `.pHive/cross-cutting-concerns.yaml` (loaded at step 3), evaluate it for each story as follows:

    1. Apply the concern's `applies_when` clause to the story. If it does NOT apply (e.g., pure-substrate story like a schema doc or planner-prompt edit), set the story's `metric:` block to `{applies: false, justification: "<one-line reason that references the story content>"}`. The justification must name the substrate kind or explain why the story has no observable surface; one-word answers (`N/A`, `none`, `-`, empty) are rejected at step 14a.
    2. If it DOES apply, surface the concern's `planning_prompt` verbatim to the planning persona and require an answer covering the four trend/claim questions:
       - what number moves (`metric.name` + `metric.direction`)
       - by how much (`metric.baseline` + `metric.target`)
       - in what window (`metric.window`)
       - measured how (`metric.source.kind` + `metric.source.ref`, plus `metric.envelope_id` when `source.kind: envelope`)
    3. Emit a `metric:` block on the story YAML conforming to [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §3.1, including `verify_at` (a concrete step id, epic milestone, or ISO-8601 timestamp — `"eventually"` is rejected) and `owner` (the agent role that performs the verification read).
    4. The metrics concern's `implementation_checklist` still flows through to execute via the generic concern-loop — its bullets reach the developer/reviewer alongside other concerns.

    **Simulated-manual concern (`id: simulated-manual`) — per-story handling.** When the `simulated-manual` concern is present in `.pHive/cross-cutting-concerns.yaml` (loaded at step 3) and applies to a story, perform the following routing actions in addition to adding the generic `cross_cutting:` entry:

    1. Apply the concern's `applies_when` clause to the story. Skip all actions below if it does not apply.
    2. **Inject a `scenario` step** into the story's `steps:` list at the methodology-appropriate position:
       - **BDD:** insert after the `behavior-spec` step (before `implement`)
       - **Classic:** insert after the `implement` step (before `test`)
       - **TDD:** insert after the `test-spec` step (before `implement`)

       Step shape to inject:

       ```yaml
       - id: scenario
         description: |
           Author a simulated-manual test scenario YAML at
           .pHive/test-scenarios/<scenario-id>.yaml per hive/references/test-scenario-schema.md.
           Set manual_verdict.scenario_ref on this story YAML to the scenario path.
           The scenario is replayed by /test --simulated-manual to produce the verdict.
         agent: tester
         depends_on: [<step-id of the immediately preceding step>]
       ```

       The `implement` step's `depends_on` must be updated to reference `scenario` (BDD/TDD) or the `test` step must reference `scenario` (classic) so execution order is preserved.

    3. **Seed `manual_verdict.scenario_ref`** on the story YAML as a placeholder:

       ```yaml
       manual_verdict:
         scenario_ref: .pHive/test-scenarios/<story-id>-manual.yaml
         verdict: null       # written by /test --simulated-manual at execution time
         timestamp: null
         agent: null
       ```

       The tester who executes the `scenario` step replaces the placeholder path with the real scenario file they author.

    4. The concern's `implementation_checklist` flows through to execute via the generic concern-loop — its bullets reach the developer/reviewer alongside other concerns.

14a. **Metric review gate.** After step 14 has populated every story's `metric:` block, validate each block before proceeding:

    - Every story has exactly one of `metric.applies: true` or `metric.applies: false` (no missing blocks, no both-set).
    - When `applies: true`: `name`, `direction`, `unit`, `target`, `window`, `source.kind`, `source.ref`, `verify_at`, `owner` are all present and non-empty; `direction` is `up` or `down`; `source.kind` is one of `events|sql|envelope|manual`; `verify_at` is not `"eventually"`/`"someday"`/empty; if `source.kind: envelope` then either `source.ref` or `envelope_id` resolves to an envelope file under `.pHive/metrics/experiments/`.
    - When `applies: false`: `justification` is a full sentence that references story content. Reject (gate fails) when the justification is one word, a single token, or generic (`N/A`, `none`, `-`, `pending`, `TBD`, `not applicable`).

    Stories that fail the gate are flagged in the step 18 confirmation output alongside `agent-ready-checklist` failures; the user can approve with known gaps or ask to fix them before proceeding.

15. **Write the epic index.** Produce `.pHive/epics/{epic-id}/epic.yaml` as a lightweight index referencing the stories. The emitted YAML MUST include the `git_flow:` block populated from the `${git_flow_resolution}` value captured in Phase A step 0a (pe-5):

    ```yaml
    name: <epic-id>
    title: <epic title>
    target_codebase: <abs path>
    methodology: <classic|tdd|bdd>

    git_flow:
      base_branch: <resolved>          # from Phase A 0a — `develop` if origin/develop existed at plan time, else `main`, else the explicit override
      branch_strategy: <resolved>      # per-epic (default) | per-story (back-compat)

    stories:
      - id: <story-id>
        title: <story title>
        complexity: <low|medium|high>
        depends_on: [<story-ids>]
    ```

    **Idempotency on re-plan.** If `epic.yaml` already exists for this epic:
      - if it already has a `git_flow:` block, update the two field values in place (do NOT duplicate the block);
      - if it does not, insert a fresh `git_flow:` block immediately after `methodology:` (the canonical position above).
      - all other fields not owned by /plan (e.g. `source_issue`, `description`, free-form notes) are preserved untouched.

    Schema reference: `hive/references/story-yaml-schema.md` §6 "Epic index (`epic.yaml`)" documents the canonical block shape.

16. **Detect UI stories — delegate to `/design` (atomic external call).** After generating stories and before presenting for confirmation, scan each story for UI work indicators. When a story matches, invoke the **design** skill (atomic; `skills/design/SKILL.md`) — this is an **external Skill call**, NOT inline wireframe-ceremony prose copied into this skill. See the UI Step Detection section below for the detection keywords, the delegation invocation shape, and the blocking-gate contract.

17. **Run agent-ready checklist.** Validate each story against the 9-point checklist in `hive/references/agent-ready-checklist.md` (including check #9: cross-cutting concerns). Flag stories that fail checks in the confirmation output.

18. **Present for confirmation.** Show the dependency graph (using Mermaid format — see Diagram Format section below), story summaries, traceability results, cross-cutting concerns applied, UI detection results, checklist results, and the **metric summary** (described below). Ask for final confirmation before saving.

    **Metric summary section.** After the per-story summaries, render a `METRICS:` block that lists every story along with its `metric:` decision. For stories with `metric.applies: true`, show one line per story: `<story-id> — <name> (<direction>): <baseline> → <target> over <window>; verify_at=<verify_at>`. For stories with `metric.applies: false`, group them under an `UN-FALSIFIABLE:` subsection and quote each story's full `justification` verbatim so the user can challenge thin opt-outs before approving the plan. Any story flagged by step 14a's metric review gate appears in a third `GATE_FAILURES:` subsection with the specific failing field named.

    Example:
    ```
    METRICS:
      a-04-plan-skill-split-routing — plan.first_attempt_pass_rate (up): 0.64 → 0.80 over next-3-cycles; verify_at=2026-06-01T00:00:00Z
      a-25-skill-prelude-extraction — skill.line_count (down): 600 → 72 over story-integrate; verify_at=integrate

    UN-FALSIFIABLE:
      m-01-add-metrics-concern — "Process-substrate; M-07 retro backfill measures whether the gate works."
      m-02-story-schema-metric-fields — "Schema-doc story; tested by M-03/M-04 consuming the schema in planner prompts."

    GATE_FAILURES:
      x-99-thin-opt-out — metric.justification is one word ("N/A")
    ```

    **Parallel annotation on the dependency graph.** Stories that emitted `parallel_allowed: true` (per step 13) MUST be visually annotated on the rendered graph so the user can audit the parallel decisions alongside the dependency edges. Annotate using Mermaid node labels of the form `node-id["story-id ‖ <rationale>"]`, where `<rationale>` is the bounded enum value (`variation` | `read-only` | `bounded-slice`). The `‖` glyph (double vertical bar) is the visual marker for "parallel-eligible" and reads as "parallel to its peers." Serial stories (no `parallel_allowed: true`) render as plain node IDs — do not annotate them. The annotation is rendered output only; it does not change the underlying YAML.

    Example dependency graph (mixing serial and parallel-eligible stories):
    ````
    ```mermaid
    graph LR
      cache-layer --> api-integration
      cache-layer --> event-detail["event-detail ‖ variation"]
      cache-layer --> mobile-detail["mobile-detail ‖ variation"]
      audit-token-budgets["audit-token-budgets ‖ read-only"]
      api-integration --> e2e-tests
      event-detail --> e2e-tests
      mobile-detail --> e2e-tests
    ```
    ````

    In the example above, `event-detail` and `mobile-detail` are `variation` siblings of the same refactor template, `audit-token-budgets` is a standalone `read-only` story with no dependents, and the remaining nodes are serial.

18z. **Emit scope_drift_score (Phase C boundary).** After the user confirms the plan in step 18 (or the silent-confirm path resolves), call `emit_scope_drift(...)` with `phase_label='plan:phase-c'` before publishing to the tracker. The Phase C scope record covers story IDs / cross-cutting evaluation / metric blocks — see the **Scope-drift emit** section below.

### Phase D: Publishing stories to the task tracker

19. **Publish each story to the configured tracker.** Only run after the user
    confirms the plan in step 18. If `task_tracking.adapter` is unset, this
    phase is a no-op — local story YAMLs remain the source of truth.

    Use the task-tracking dispatch module rather than vendor-specific calls.
    The dispatch surface handles `gate_mode`, telemetry, and error mapping;
    do not branch on the adapter vendor (`github`, `linear`, or `multica`)
    here. The Multica adapter follows the same `createStory` ABI and writes
    `tracker_id` / `tracker_url` from `result.result.id` and
    `result.result.url`, matching the existing GitHub and Linear flow.
    For Multica `AUTH_FAILURE`, surface the adapter message and direct the
    user to `/hive:multica-init` before retrying Phase D.

    ```typescript
    import { TaskTrackingDispatch } from "hive/lib/task-tracking-dispatch/index.ts";

    const dispatch = new TaskTrackingDispatch();
    await dispatch.load(config.task_tracking);

    for (const story of stories) {
      const result = await dispatch.invoke(
        "createStory",
        {
          title: story.title,
          body: story.description,
          labels: story.labels,
          parent_id: story.parent_id,
        },
        { skill_context: "plan" },
      );

      if (result.ok) {
        story.tracker_id = result.result.id;
        story.tracker_url = result.result.url;
      } else if (result.code === "NO_ADAPTER") {
        // gate_mode=warning -> skip publish silently (dispatch already
        //                      emitted the no-adapter telemetry event).
        // gate_mode=hard    -> dispatch returned terminal; halt publishing.
        break;
      } else if (result.recoverable) {
        // RATE_LIMIT — pause for result.retry_after_ms and retry.
      } else {
        // Terminal failure (auth, timeout, internal error). Dispatch wrote a
        // prose-runbook-fallback event under gate_mode=warning. Surface to
        // the user; planning can continue without tracker IDs.
      }
    }
    ```

    After the loop, write `tracker_id` and `tracker_url` back into each
    story YAML when populated so downstream skills (execute, review) can
    correlate runs to tracker records.

19a. **Sandcastle-ops label pass (opt-in, additive).** Only runs when
    `task_tracking.adapter === "github"`. For any other value (null, "linear",
    unset, etc.) this step is a strict no-op — no GH calls, no logging beyond
    a single skip line, no errors. This is the OUTBOUND half of the sandcastle
    ops loop (epic `sandcastle-ops-layer`, story `s1-github-issues-adapter`)
    — issues already created in step 19 receive the hive:* label namespace
    so an autonomous worker can pick them up via
    `gh issue list --label hive:ready --state open`.

    **Label-existing only — does NOT create issues.** Step 19 (Epic C ABI
    `createStory`) is the single creation point for GitHub issues. This step
    reads each story's `tracker_id` (format `<owner>/<repo>#<number>`, set by
    step 19) and calls `gh issue edit <n> --add-label <hive:*>` to add the
    sandcastle namespace (`hive:ready`, `hive:epic:<epic-id>`,
    `hive:story:<story-id>`, `hive:blocked-by:<dep>`). Stories that lack
    `tracker_id` (because step 19 errored or was a no-op for that story) are
    skipped with reason `no_tracker_id` — the adapter never falls back to
    creating issues. Idempotent on re-run via `external_id` in the story YAML.

    After labeling, the adapter writes `external_id: <issue-number>` (bare
    integer) back into the story YAML alongside the existing slash-encoded
    `tracker_id`. The worker queries by label and round-trips via
    `hive:story:<id>` → story YAML, where `external_id` is the cross-reference.

    ```javascript
    const { publishStoriesToIssues } = require('hive/lib/external/github-issues-adapter.js');

    if (config.task_tracking && config.task_tracking.adapter === 'github') {
      const { labeled, skipped, errors } = await publishStoriesToIssues({
        epicId,
        storyIds: stories.map((s) => s.id),
        config: config.task_tracking,
      });
      for (const c of labeled) console.log(`[sandcastle-ops] labeled ${c.id} → #${c.issue_number}`);
      for (const s of skipped) console.log(`[sandcastle-ops] skipped ${s.id} (${s.reason})`);
      for (const e of errors)  console.error(`[sandcastle-ops] FAILED ${e.id}: ${e.error}`);
    }
    ```

    Failure handling: a mid-batch gh CLI failure (auth, rate limit, network)
    surfaces in the `errors` array. Stories labeled before the failure have
    their `external_id` already written to disk, so a re-run picks up where
    it left off. Planning continues either way — sandcastle adoption is
    optional, and a failed label pass is not a failed plan.

20. **Post-run audit.** After step 19 completes (whether user confirmed or aborted in step 18, and whether Phase D published or was a no-op), run the in-process audit per `hive/references/gate-lift-telemetry.md`:

    1. Collect this run's resolved state:
       - methodology (resolved value + source from a-32 auto-detect)
       - gate_lift_fired (true if the `gate_mode: warning` branch fired during the kickoff override at the top of this skill)
       - story specs produced (count of YAML files written under `${HIVE_STATE_DIR}/epics/<id>/stories/`)

    2. Evaluate the nonsensical-default heuristics from `hive/references/gate-lift-telemetry.md`:
       - **TDD without tests**: resolved methodology is `tdd` AND zero story specs reference test artifacts.
       - **Lifted gate + empty plan**: `gate_lift_fired` AND zero story specs produced.

    3. If ANY heuristic fires, emit ONE consolidated warning to stdout listing every triggered field plus its override path. Example shape:

       > Audit: nonsensical defaults detected this run:
       > - methodology=tdd auto-detected but no test artifacts referenced → run `/hive:kickoff` to set explicit methodology
       > - gate_lift_fired with zero story specs → run `/plan` after `/hive:kickoff` for a properly decomposed plan
       >
       > Override: set `paths.gate_mode: hard` in `hive.config.yaml` to restore blocking behavior.

    4. Always write the audit record to `${HIVE_STATE_DIR}/audits/post-run/<run-id>.yaml` (create the directory if absent). Schema:

       ```yaml
       run_id: <run-id>
       skill: plan
       timestamp: <ISO 8601>
       gate_lift_fired: <bool>
       methodology: <resolved value>
       methodology_source: <source>
       story_specs_produced: <count>
       nonsensical_defaults:
         - <heuristic id, e.g. tdd-without-tests>
       warnings_emitted: <count>
       ```

       Silent runs (zero heuristics fire) still write a record with `nonsensical_defaults: []` for cross-run aggregation by `hive/scripts/gate-mode-audit.mjs`.

### Flow Summary

```
Small:   branch setup → team assembly → research → brief → design discussion → team review → feedback → stories → confirm
Medium:  branch setup → team assembly → research → brief → design discussion → team review → feedback → H scan → V slice plan → team review → feedback → stories → confirm
Large:   branch setup → team assembly → research → brief → design discussion → team review → feedback → H scan → V slice plan → team review → feedback → structured outline → team review → sign-off → stories → confirm
```

## Collaborative Review Gate

A collaborative review gate runs before every user-facing document presentation. This ensures all team agents align on the content and catch gaps before the user sees it.

**Opt-out:** Set `hive.config.yaml → planning.collaborative_review: false` to skip all collaborative review gates. When disabled, documents are presented directly to the user without team review. This saves time on smaller projects or when the user prefers to be the sole reviewer.

**When to run (if enabled):** After steps 4, 7, and 9b — i.e., after each major document is produced and before it's presented to the user.

**Protocol:**

1. **Distribute.** The orchestrator `SendMessage`s the document to all active team agents.
2. **Review.** Each agent reviews through their specific lens:
   - **Researcher**: "Are findings accurately represented? Is anything missing from the codebase analysis?"
   - **TPM**: "Is this sequenceable? Are dependencies realistic? Are there delivery risks?"
   - **Architect** (if present): "Is this technically sound? Any feasibility concerns or architectural gaps?"
   - **UI Designer** (if present): "Are UI implications identified? Does the proposed UX align with existing design language?"
3. **Respond.** Each agent returns structured feedback via `SendMessage`:
   ```
   REVIEW: {agent-name}
   VERDICT: approve | flag | approve-with-escalation
   COMMENTS: {specific issues or confirmation}
   ```

3b. **Extract escalations from agent review responses (orchestrator only).** After collecting all agent review responses for a gate, check each response for escalation signals. Only the orchestrator writes to cycle state — planning agents signal via their review gate responses.

   **Generic extraction pattern:** For each agent response in the review gate, check for an `ESCALATION_FLAGS` signal. Apply dedup-on-write for every flag found. This pattern is intentionally extensible — future emitters add their signal format here; the dedup-on-write rule handles all collisions automatically.

   **Active emitters:**

   **Architect** — look for an `## Escalation Flags` section with line entries in the format:
   ```
   - [severity] trigger-id — reason
   ```
   For each line: parse `trigger`, `severity`, `reason`. Look up `placement` from the specialist-triggers catalog. Set `raised_by: architect` (orchestrator adds this — architect does not emit it).

   **TPM** — look for an `ESCALATION_FLAGS:` block with YAML list entries in the format:
   ```
   ESCALATION_FLAGS:
     - trigger: performance:audit
       placement: post-exec
       severity: major
       stories: [topic-area-1, ...]
       reason: "explanation"
       raised_by: tpm
   ```
   For each entry: read all fields directly. `placement` is provided by the TPM (taken from catalog). Set `raised_by: tpm`.

   **UI Designer** — look for a `SCALE_CALL:` field in the review response:
   - **`SCALE_CALL: in-planning`** → no write to cycle state; wireframes proceed during planning as normal
   - **`SCALE_CALL: pre-exec`** → extract the `ESCALATION:` block that follows the field; write to cycle state using the same dedup-on-write logic as architect/TPM extraction. Set `raised_by: ui-designer`
   - **No `SCALE_CALL` field** → ui-designer not on planning team or didn't emit; skip — no write to cycle state

   **For all emitters:**
   - Set `raised_at` to the current ISO 8601 timestamp (orchestrator sets this at extraction time)
   - Set `stories` to topic areas from the agent's response context if not provided (canonical IDs backfilled at step 11)
   - `placement` source precedence: if the agent provides `placement` in their response (TPM, ui-designer), use the agent-provided value. If not (architect), look up `placement` from the specialist-triggers catalog

   **Dedup-on-write:** Before writing any extracted flag to `.pHive/cycle-state/{epic-id}.yaml`, check whether an entry with the same `trigger` ID already exists:
   - **If exists:** merge into the existing entry — do NOT append a second entry:
     - `stories`: union of existing and new stories[] lists (deduplicated, existing entries first, then new entries)
     - `reason`: concatenate existing and new reason with `" | "` separator
     - `raised_at`: keep the **earliest** timestamp (preserves when the concern was first raised)
     - `raised_by`: if different agents, concatenate with `", "` separator (e.g. `"architect, tpm"`)
     - `severity`: keep the **maximum** severity using ordering `major > moderate > minor`. Example: existing `moderate` + incoming `major` → merged value is `major`. Ties keep the existing value.
   - **If not exists:** write the new 7-field entry as normal

   ```yaml
   # Example entry written to cycle state (architect raises first)
   escalations:
     - trigger: security:plan-audit
       placement: pre-exec
       severity: major
       stories: [auth-flow]  # topic areas at raise time; backfilled to canonical story IDs at step 11
       reason: "human-readable explanation from architect flag"
       raised_by: architect
       raised_at: "2026-04-12T09:15:00Z"

   # Example after dedup merge (TPM also raised security:plan-audit later in same gate)
   escalations:
     - trigger: security:plan-audit
       placement: pre-exec
       severity: major
       stories: [auth-flow, data-layer]   # unioned topic areas
       reason: "architect: token storage risk | tpm: compliance deadline requires audit"
       raised_by: "architect, tpm"
       raised_at: "2026-04-12T09:15:00Z"  # earliest timestamp kept (architect raised first)
   ```

   **If no escalation signal is found in a response:** skip — do not write an empty `escalations:` block or modify cycle state.

4. **Revise if needed.** If any agent flags issues, the orchestrator `SendMessage`s the feedback to the technical writer for revision. Max 1 revision cycle to avoid loops.
5. **Proceed.** Once all agents approve (or after 1 revision cycle), present the document to the user. Include a brief summary of what the team flagged and resolved:
   ```
   TEAM REVIEW SUMMARY:
   - TPM flagged dependency gap between auth and data layers → resolved by adding explicit sequencing
   - Architect approved with no concerns
   - Researcher confirmed all file paths verified
   ```

**Key constraint:** The review gate adds quality but must not spiral. One revision cycle maximum. If fundamental disagreements remain after revision, surface them to the user as open questions rather than continuing to iterate.

## UI Step Detection

Scan each story's description and acceptance criteria for UI keywords (case-insensitive): screen | view | page | modal | dialog | sheet | drawer | button | form | input | component | widget | card | list item | redesign | layout | visual | UI | UX | mockup | wireframe | marketing | landing page | banner | app store. When a story matches, delegate the wireframe ceremony to `/design` via an atomic Skill call — `/plan` does NOT inline the wireframe protocol, the touchpoints, or the persona dispatch.

**Delegation (atomic external call to `/design`).** Invoke the **design** skill (`skills/design/SKILL.md`) once per matched story. Pass the story's brief plus `--from-plan` and the story ID; `/design` runs the wireframe-protocol touchpoints (see `hive/references/wireframe-protocol.md`), emits a `.pHive/design/<topic>/` directory, and registers a handoff entry in `.pHive/design/index.yaml`. The blocking-gate contract still holds: stories with a `/design` delegation MUST NOT proceed to execution until the design handoff entry exists.

For each matched story, write a `ui-design` step that records the `/design` delegation (the executor reads this to confirm the wireframes were produced before dispatching `implement`):

```yaml
- id: ui-design
  description: Delegate to /design for wireframes (atomic external call; see skills/design/SKILL.md).
  agent: ui-designer
  delegates_to: design       # atomic Skill call, not inline prose
  depends_on: [research]
- id: implement
  depends_on: [ui-design]
  inputs:
    - source: step_output
      step: ui-design
      key: wireframe_brief
```

Mark UI stories in the plan confirmation output (e.g., `event-detail — Redesign Event Detail View [4 steps, /design delegated]`). Edge cases — false positives on backend "button" usage and purely-visual stories that skip implement/test — are user-resolved at the confirmation gate, same as before.

**Atomic boundary.** If the wireframe ceremony, the wireframe-protocol touchpoints, or the ui-designer dispatch ever appears as inline prose inside this skill, that is a regression. `/plan`'s job at step 16 is to detect UI work and delegate; `/design` owns the ceremony end-to-end.

## Story File Format

See `hive/references/story-schema.md` if available, or use this template:

```yaml
id: story-id
epic: epic-id
title: One-line description
status: pending
complexity: low | medium | high
methodology: classic | tdd | bdd
depends_on: []

description: |
  Detailed description of what needs to be built and why.

acceptance_criteria:
  - "Given [context], when [action], then [expected result]"

steps:
  - id: step-1
    description: What to do
    agent: researcher | developer | tester | reviewer

context:
  codebase: /path/to/target/codebase
  tech_stack: {}
  key_files:
    - path: path/to/relevant/file
      purpose: Why this file matters to this story

files_to_modify:
  - file: path/to/file
    change: What to change

code_examples:
  - title: Pattern to follow
    file: path/to/example
    snippet: |
      # Optional but strongly encouraged (~10 lines max)
      # The relevant code pattern extracted from the file
      def example_function():
          pass

design_decisions:
  - decision: What was decided
    rationale: Why

cross_cutting:
  - concern: caching
    action: "Cache event list, 5min TTL, invalidate on mutation"

risks:
  - severity: high | medium | low
    description: What could go wrong
    mitigation: How to avoid it

references:
  - path: path/to/relevant/file
    relevant_excerpt: |
      Optional but encouraged — the 3-5 most relevant lines from this document.
      Provides self-containment so the story works without the source file on disk.
```

## Epic Index Format

```yaml
name: epic-id
title: Epic Title
description: What this epic accomplishes
target_codebase: /path/to/codebase
methodology: classic | tdd | bdd  # optional, overrides project config for this epic

stories:
  - id: story-id
    title: Story Title
    complexity: medium
    depends_on: []
```

## Diagram Format

All diagrams in Hive output (dependency graphs, flow diagrams) use **Mermaid** syntax. Mermaid renders natively in GitHub, Linear, and most markdown viewers.

- Use `graph LR` (left-to-right) for dependency graphs
- Use `graph TD` (top-down) for hierarchical or flow diagrams
- Arrow syntax: `story-a --> story-b` means story-b depends on story-a
- Keep node IDs matching story IDs for consistency
- For parallel-eligible stories (those that emit `parallel_allowed: true` in step 13), annotate the node label as `story-id["story-id ‖ <rationale>"]` where `<rationale>` is the bounded enum value (`variation` | `read-only` | `bounded-slice`). The `‖` glyph signals "parallel to its peers." Serial stories render with plain node IDs.

## Planning Document Paths

All planning documents are written to `.pHive/epics/{epic-id}/docs/{document-type}.md`.

| Document type | Sub-skill | Output path |
|---------------|-----------|-------------|
| research-brief | None (no sub-skill — see note) | `.pHive/epics/{epic-id}/docs/research-brief.md` |
| design-discussion | `hive/references/document-templates/design-discussion.md` | `.pHive/epics/{epic-id}/docs/design-discussion.md` |
| horizontal-plan | `hive/references/document-templates/horizontal-plan.md` | `.pHive/epics/{epic-id}/docs/horizontal-plan.md` |
| vertical-plan | `hive/references/document-templates/vertical-plan.md` | `.pHive/epics/{epic-id}/docs/vertical-plan.md` |
| structured-outline | `hive/references/document-templates/structured-outline.md` | `.pHive/epics/{epic-id}/docs/structured-outline.md` |

**Note on research-brief:** No sub-skill file exists for the research brief format. The technical writer produces it using the research-brief pattern from memory, based on raw findings from the researcher. Output path: `.pHive/epics/{epic-id}/docs/research-brief.md`. See `hive/agents/technical-writer.md`.

Existing planning documents at the `.pHive/` root are not moved — this convention applies to new planning sessions going forward.

## Scope-drift emit (decomposition boundary)

Emit a single `scope_drift_score` event at the close of Phase C — the
moment story decomposition is signed off. Earlier phase boundaries
(A, B, B2, B3) intentionally do **not** emit: the upstream artifacts
they produce (concern lists, design-discussion drafts, deep-dive
expansions) are *expected* to churn during planning, and bucketing
that churn as drift produces noise that buries the one signal that
matters — did story decomposition preserve the agreed scope?

The helper applies the maturity gate from story `ed-1-maturity-helper`
— emits are skipped on greenfield/early projects and logged once per
run.

Use the Python module surface (no new CLI):

```bash
python3 -c "
from hive.lib.scope_drift import emit_scope_drift
emit_scope_drift(
    run_id='{run-id}',                   # this /plan run identifier
    phase_label='plan:phase-c',
    expected_scope={list of items the design phase committed to},
    delivered_scope={list of story IDs / cross-cutting items / metric blocks the decomposition actually produced},
    delta_reasons={zero or more enum values from cycle-state-schema.md},
    proposal_id='{epic-id}',             # planning is epic-scoped, not story-scoped
    skill='plan',
)
"
```

`expected_scope` / `delivered_scope` / `delta_reasons` follow the
schema documented in
[`hive/references/cycle-state-schema.md`](../../hive/references/cycle-state-schema.md)
§ Phase records — pull them from the Phase C `phase_records[]` entry
on the cycle state. The helper buckets to one of `{none, minor, major,
divergent}` (string label in `dimensions.bucket`; ordinal `0..3` in
`value`). See
[`.pHive/metrics/metrics-event.schema.md`](../../.pHive/metrics/metrics-event.schema.md)
§4 for the registry entry.

Emit point: **after step 14** (stories decomposed + validated, before
Phase D publishes to the tracker).

The emit is fire-and-forget — the helper raises only on
`MetricsValidationError` (programming error), never on missing
`project-profile.yaml` or absent ed-1 helper. Do not wrap with
additional error handling.

## Key References

- `hive/references/agent-ready-checklist.md` — 9-point story validation
- `hive/references/cross-cutting-concerns.md` — per-project concern evaluation
- `hive/references/wireframe-protocol.md` — UI wireframe approval touchpoints
- `hive/references/agent-teams-guide.md` — TeamCreate mechanics and coordination patterns
- `hive/agents/researcher.md` — raw data gathering (core team)
- `hive/agents/technical-writer.md` — document production (core team)
- `hive/agents/tpm.md` — delivery sequencing (core team)
- `hive/agents/architect.md` — system design (conditional)
- `hive/agents/ui-designer.md` — wireframes and UI review (conditional)
- `hive/agents/analyst.md` — requirements analysis persona
- `skills/hive/skills/agent-spawn/SKILL.md` — persona injection, memory loading, path resolution
- `hive/references/document-templates/design-discussion.md` — ~200-line brain dump format
- `hive/references/document-templates/structured-outline.md` — ~1000-line detailed plan with elicitation
- `hive/lib/scope_drift.py` — scope-drift scoring + emit helper called at the Phase C (decomposition) boundary (see Scope-drift emit section above)
