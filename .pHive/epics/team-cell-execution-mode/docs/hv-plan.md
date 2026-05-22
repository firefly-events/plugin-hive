# H/V Plan — team-cell-execution-mode

## 0. Prelude

**Scale: LARGE** (design §6). Multi-system change spanning skill layer, hive
lib layer, persona layer, config layer, tracker primitive layer, episode
marker layer, plus audit fixes. User-approved.

**Git flow resolution** (per `epic.yaml` written in Phase A):
- `base_branch: develop`
- `branch_strategy: per-epic`
- working branch: `feat/team-cell-execution-mode`

**Grill resolutions (binding for Phase C story decomposition).** All nine
listed verbatim by id; each must be honored in slice/story specs:

- **V1** — Rename `hive/lib/team-cell-composer/` → `hive/lib/cell-roster-resolver/`. Future refactor of planning-routing's roster-builder onto the same lib is OUT OF SCOPE; flag as post-2.x cleanup candidate (design §10).
- **V2** — Substitute "workflow-phase" everywhere inside design §2-7. Reviewer story checks the spec for bare "phase" outside §8 quotes; rejects if found (design §10, §8).
- **H1** — Add a `phase` parameter to `writeMulticaRunEpisode`, defaulting to `null` for back-compat. When `phase != null`, marker file is `{phase}.yaml` not `multica-run.yaml`; single-developer mode keeps the old filename via `phase: null` (design §10, §2.3).
- **H2** — A real, missing slice: extend `hive/lib/multica-bootstrap/index.mjs` to consult `agent_backends` → resolve to the right `runtime_id` (Codex vs Claude) per persona at reconciliation. Sits BETWEEN slice-0 spikes and slice-1 (cell-roster-resolver). Without this, backend-routing claim is theatre (design §10, §2.4).
- **H3** — Push-target enforcement is NOT advisory. After each workflow-phase terminates, orchestrator runs `git ls-remote origin agent/developer/{task_id}` against firefly; orphan-branch push = phase fails (`failed`, not `escalated`) and retries per `max_step_retries`. Footer alone is insufficient (design §10, §2.5 F4).
- **U1** — Restructure slice-0 to "spike all three primitive options (a/b/c) explicitly, document evidence." Slice-1 commitment to (a) is contingent on slice-0 evidence confirming (design §10, §2.1).
- **U2** — Define one failure-policy table — `core_phase_fail`, `optional_phase_fail`, `repeated_phase_fail`, `circuit_breaker_hit` — with explicit action for each (design §10, design §2.3 step 3e, §3 R3, §5 Q2).
- **C1** — F5 (token scope) is EXTRACTED from this epic into a separate prerequisite chore PR (`multica:auth-refresh-workflow-scope`). This epic's slice-0 assumes the scope exists. Slice-0 still detects missing scope and halts with runbook line per R5 (design §10, §2.5 F5, audit §Recommended-follow-ons #3).
- **P1** — Resolved: hard-block on null `project_id` stands. Rationale per design §10: parallel-dispatch-gate precedent (ed-7) is a hard-block too; this is an enforcement gate, not a kickoff gate. Warn-only is documented as the relax-path for a future epic (design §10, §2.5 F1).
- **P2** — Cell composer remains a hive-lib code module (`hive/lib/cell-roster-resolver/`) called from the new skill — NOT an atomic skill. Rationale per design §10: composer is pure resolution logic (story-spec → roster), not a user-callable composable surface; skill-layer cost not justified. Skill-layer extraction flagged as post-2.x candidate alongside V1 (design §10, §2.2).

---

## 1. Horizontal layer scan

Architectural layers the epic touches. For each: files/dirs changed and why.

### 1.1 Skill layer

`skills/hive/skills/execute-mode-multica/SKILL.md` — REWRITTEN (design §4). The
new shape is per-workflow-phase parent/child dispatch (design §2.3). Old
single-developer code path is renamed `execute-mode-multica-flat` and kept for
one release cycle per Hand-off Migration line in the proposal.

No new atomic skill is created for cell composition (P2 resolution). Composer
remains a hive-lib import called from the skill.

### 1.2 Hive lib layer

Three packages change:

- `hive/lib/cell-roster-resolver/` — NEW directory (V1 rename of design §4's
  `team-cell-composer`). Resolves story spec + cell-yaml + signal predicates
  → resolved roster (design §2.2).
- `hive/lib/multica-bootstrap/index.mjs` — EXTENDED to (a) inject git identity
  via `custom_env` per F6, (b) consult `agent_backends` → resolve `runtime_id`
  per persona at reconciliation (H2; design §10, §2.4).
- `hive/lib/multica-story-dispatch/index.mjs` + `episode-sync.mjs` — reused
  as-is for primitive operations; only the calling orchestration layer in the
  skill changes (design §4). One signature extension lands here: H1 adds the
  optional `phase` parameter to `writeMulticaRunEpisode`.

### 1.3 Persona layer

`hive/agents/` gains one new persona file: `qa-engineer.md` (design §4, R6).
The remaining 8 personas in the gap (researcher, architect, tpm,
technical-writer, peer-validator, backend-developer, frontend-developer,
analyst, ui-designer) already exist as source files (design §2.6); the gap is
in the Multica workspace, addressed by the bootstrap layer (§1.5).

Two name mismatches resolved by the bootstrap config, not by renaming
sources: `security-reviewer.md` (source) ↔ `security` (Multica agent name),
`performance-reviewer.md` ↔ `performance` (design §2.6).

### 1.4 Config layer

`hive.config.yaml.agent_backends` — read by H2 bootstrap routing logic; **no
schema change** (design §10 H2, §2.4). Existing map is the input; the new
behavior is downstream of it. Cell YAMLs live at `hive/team-cells/*.yaml`
(NEW directory, design §4) and are loaded by the cell-roster-resolver — these
are config in the data sense but not part of `hive.config.yaml`.

### 1.5 Tracker layer (Multica)

Three concerns at this layer:

- **Workspace agent roster** — bootstrap reconciles 9 missing personas into
  the Multica workspace via existing `multica agent create/update` (design
  §2.6). H2 extends reconciliation to write the correct `runtime_id` per
  persona based on `agent_backends`.
- **Parent/child issue shape** — primitive (a). One parent per story holds
  the brief; N child issues per workflow-phase, each `--parent` and
  `--assignee` to the phase's role agent (design §2.1, §2.3).
- **Project_id resolution** — F1 hard-block (per P1): dispatch refuses to fan
  out if `project_id` on the parent issue is null. Reuse the project created
  this session (`d23d0d43`, design §2.5).
- **OAuth scope sidecar** — F5 is extracted out of this epic (C1). This epic
  detects-and-halts on missing `workflow` scope; the chore PR runs the user
  through `multica setup` once.

### 1.6 Episode marker layer

`.pHive/episodes/{epic}/{story}/{phase}.yaml` — one marker per workflow-phase
inside the cell (proposal §"Episode markers", design §2.3 step 3d). H1 lands
the shape change. Existing schema constraints on `multica-run.yaml` carry
over; new file basename is the only delta.

Per R2: marker `artifacts:` list contains file paths only — no marker-embedded
prose. Next-phase brief includes those file refs verbatim.

### 1.7 Brief footer layer

The story brief written into each child issue includes a footer with three
constraints (design §2.5 F4, §10 H3):

- push target must be `feat/{epic}` on the firefly origin
- `agent/developer/<task>` orphan branches are forbidden
- commit author must be `hive-worker <hive-worker@noreply.github.com>` (per
  F6; injected as `custom_env` at bootstrap, not via footer alone)

H3 makes this enforced, not advisory: a post-workflow-phase verifier runs
after each child terminates and fails the phase if the agent pushed to an
orphan branch.

### 1.8 Audit fix layer

F1, F4, F6 bundled inline with the new mode per `feedback_scope_class_changes`
("bigger deal" = a new mode, not piecemeal patches). F5 EXTRACTED per C1 into
a prerequisite chore PR. Mapping:

- **F1 (workspace repo binding):** dispatch refuses if `project_id` null
  (§1.5; lives in skill layer §1.1 + tracker layer §1.5).
- **F4 (push behavior):** brief footer + post-task verifier (§1.7).
- **F5 (token scope):** OUT — separate `multica:auth-refresh-workflow-scope`
  chore PR (§1.5).
- **F6 (identity drift):** `custom_env: {GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL}`
  injected at bootstrap (§1.2). Default `hive-worker`; per-role override.

### 1.9 Migration / parallel-run layer

Per proposal Hand-off "Migration": feature-flag the new mode, parallel-run for
one epic, then flip. Two carriers:

- a feature flag on `/execute` selecting `execute-mode-multica-cell` (new) vs
  `execute-mode-multica-flat` (renamed legacy)
- the dogfood-epic acceptance gate (§9 of design) — pick a tiny epic, NOT
  story-loop-closure itself, run both modes, compare outputs

The renamed `execute-mode-multica-flat` is deleted one release cycle after
flip.

---

## 2. Vertical slice plan

Eight slices, ordered. Estimates are story counts (Phase C will refine).
Outside-of-epic: F5 chore PR (C1) — listed as prerequisite, not a slice.

### Prerequisite (NOT in this epic)

**F5 chore PR — `multica:auth-refresh-workflow-scope`**
- Goal: refresh daemon GH OAuth with `workflow` scope so CI-touching stories
  can push (audit §Recommended-follow-ons #3; design §10 C1).
- Why outside: user-interactive OAuth flow (research §6.2) — would hard-block
  any autonomous slice (C1).
- Acceptance: `multica setup` flow run; daemon token includes `workflow`
  scope. One-shot chore, separate PR.

### Slice 0 — Primitive spike (all three options)

- **Goal:** Spike Multica primitives (a), (b), (c) and document evidence
  before commitment per U1.
- **Inputs:** F5 chore PR merged (prerequisite); research brief §1 (Multica
  0.3.4 CLI inventory).
- **Outputs:**
  - `.pHive/spikes/team-cell-primitives/notes.md` — evidence per option,
    including (b)'s reassign-triggers-rerun behavior (design §5 Q7) and (c)
    re-confirmation that no `session` command exists.
  - Recommendation: confirm (a) or pivot. Spike result is the gate for
    slice-1's commitment.
  - Slice-0 detection task: probe daemon token scope; if `workflow` scope
    missing despite F5 chore, halt with runbook line per R5.
- **Verification:** Spike notes show: (a) parent/child works end-to-end on a
  throwaway issue; (b) reassign behavior characterized (works as fallback or
  not); (c) confirmed absent. Reviewer signs off on continuation.
- **Estimated stories:** 1-2 (one per spike strand, or one bundle).

### Slice 1 — multica-bootstrap runtime routing (H2)

- **Goal:** Extend `hive/lib/multica-bootstrap/index.mjs` to read
  `agent_backends` and write the correct `runtime_id` per persona at
  reconciliation. Inject `custom_env` for git identity (F6) at the same call
  site.
- **Inputs:** Slice 0 (primitive (a) confirmed); `hive.config.yaml.agent_backends`
  unchanged.
- **Outputs:**
  - `hive/lib/multica-bootstrap/index.mjs` updated: per-persona `runtime_id`
    resolution + `custom_env: {GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL}` injection.
  - 9 new agents reconciled into the workspace: researcher, architect, tpm,
    technical-writer, peer-validator, backend-developer, frontend-developer,
    analyst, ui-designer (design §2.6).
  - Three name-mismatch resolutions: `security-reviewer.md` → `security`,
    `performance-reviewer.md` → `performance`, `qa-engineer` aliased to
    `tester` OR new `hive/agents/qa-engineer.md` created (design §2.6, R6).
  - `multica agent list` shows all 13 agents with correct `runtime_id` (Codex
    for researcher/developer/technical-writer/architect; Claude for
    tester/reviewer/qa/ui-designer/etc.) and correct `custom_env`.
- **Verification:** After `multica-init`, `multica agent list` matches the
  expected backend-routing table from design §2.4; a sample dispatch to a
  Codex-routed persona lands on the Codex daemon.
- **Estimated stories:** 2-3 (one routing logic, one persona reconciliation +
  qa-engineer resolution, one git-identity injection — these may fold).

### Slice 2 — cell-roster-resolver lib (V1 rename, P2 confirmed)

- **Goal:** New `hive/lib/cell-roster-resolver/` package that resolves a
  story-spec + cell-yaml + signal predicates into a concrete roster
  (workflow-phase → role) per design §2.2.
- **Inputs:** Slice 1 (workspace agents reconciled, so a roster has agents
  to bind to).
- **Outputs:**
  - `hive/lib/cell-roster-resolver/index.mjs` (and adjacent helpers).
  - `hive/team-cells/execute-cell.yaml` — the execute cell roster spec
    (design §2.2). Plan/review cells are OUT of scope (design §7).
  - Signal-detection inline in the YAML (keyword-list pattern per design
    §2.2; no predicate-grammar compilation yet).
  - Unit tests for resolver: core[] always present, optional[] applied iff
    signal matches, `replaces:` swaps the slot.
- **Verification:** Calling the resolver with a backend-tagged story spec
  returns `developer` + `backend-developer` substitution per the `replaces`
  rule; with a UI-tagged story spec returns the `frontend-developer` variant.
  Cell YAML's vocabulary passes the V2 reviewer rule (no bare "phase").
- **Estimated stories:** 2-3.

### Slice 3 — writeMulticaRunEpisode `phase` param + marker shape (H1)

- **Goal:** Extend `writeMulticaRunEpisode` to accept a `phase` parameter
  (default `null` for back-compat). When `phase != null`, marker basename is
  `{phase}.yaml`; when null, basename stays `multica-run.yaml` (design §10
  H1, §2.3 step 3d).
- **Inputs:** Slice 2 (resolver lib in place, so phase names are
  deterministic).
- **Outputs:**
  - `hive/lib/multica-story-dispatch/index.mjs` (or wherever the function
    lives) signature extended.
  - `multica-run.yaml` callers unchanged (pass nothing → null → existing
    basename).
  - Episode marker schema documentation updated to describe `artifacts:`
    list as file-path-only per R2.
- **Verification:** Two test calls — one without `phase`, one with
  `phase: 'research'` — produce the expected files at the expected paths.
  Old callers continue to work.
- **Estimated stories:** 1-2.

### Slice 4 — execute-mode-multica skill rewrite (parent + child dispatch)

- **Goal:** Replace `skills/hive/skills/execute-mode-multica/SKILL.md` with
  the per-workflow-phase parent/child dispatch flow per design §2.3.
- **Inputs:** Slices 1-3 (bootstrap routing, roster resolver, episode shape
  all in place).
- **Outputs:**
  - New skill: parent-issue create → child-issue per workflow-phase, each
    `--parent` + `--assignee`. Per-phase brief injection (subset of parent
    brief + prior phase outputs as marker artifact file refs).
  - Parent-`project_id`-null hard-block (F1, P1 confirmed).
  - Fail-fast on terminal != completed (design §2.3 step 3e), with the
    failure-policy table from U2 wired in.
  - Old `execute-mode-multica` content renamed to
    `execute-mode-multica-flat` for one release cycle (proposal Migration
    line).
- **Verification:** A throwaway story dispatched under the new mode produces:
  one parent issue, N child issues (one per workflow-phase in the resolved
  roster), each assigned to the correct role agent on the correct runtime,
  N episode markers at the correct paths.
- **Estimated stories:** 3-4 (parent/child flow, failure-policy table, F1
  hard-block, renamed legacy path).

### Slice 5 — Post-workflow-phase push-target verifier (H3)

- **Goal:** After each child terminates, orchestrator inspects the agent's
  push target; orphan-branch push fails the phase (`failed`, not
  `escalated`) and retries per `max_step_retries` (design §10 H3).
- **Inputs:** Slice 4 (new skill exists; this is a hook in the orchestration
  loop).
- **Outputs:**
  - Verifier function (probably in `hive/lib/multica-story-dispatch/` or a
    sibling lib) that runs `git ls-remote origin agent/developer/{task_id}`
    against the firefly origin.
  - Wired into the new skill's per-phase termination handling.
  - Brief footer text (§1.7) kept as advisory belt-and-braces; verifier is
    the enforcement.
- **Verification:** Dogfood throwaway: force an agent to push to
  `agent/developer/<task>`, observe phase marked `failed` and retried.
- **Estimated stories:** 1-2.

### Slice 6 — Audit fixes F1/F4/F6 bundle (final reconciliation)

- **Goal:** Confirm all bundled audit fixes are live and tested as a
  cohesive set (design §2.5).
- **Inputs:** Slices 1, 4, 5 (which deliver the constituent pieces).
- **Outputs:**
  - Confirmation pass + documentation snippet (probably in
    `.pHive/audits/multica-mode-audit-2026-05-22.md` resolved-section
    update) noting F1/F4/F6 closed via this epic, F5 closed via the chore
    PR.
  - End-to-end integration test that exercises a story with a CI-touching
    file change to verify F4 + F5 + F6 all work together.
- **Verification:** Audit doc updated; integration test green.
- **Estimated stories:** 1.

### Slice 7 — Parallel-run gate + flag flip

- **Goal:** Run both modes on a tiny dogfood epic, validate equivalence (or
  documented divergence), then flip the default flag to the new cell mode.
  Plan `execute-mode-multica-flat` for removal one release later (proposal
  Migration line).
- **Inputs:** All prior slices.
- **Outputs:**
  - Feature flag added to `/execute` (or to the dispatch-skill mode
    selection) defaulting initially to flat; flipped at slice close.
  - A dogfood epic (NOT story-loop-closure; pick a tiny one per design §9)
    run end-to-end under the new mode. Acceptance per design §9: 6
    checkpoints (parent+child visible, correct role+runtime per phase,
    markers at correct paths, commits pushed to `feat/{epic}` as
    `hive-worker`, CI-touching push succeeds, /hive:status renders
    aggregate correctly).
  - Removal-track ticket created for `execute-mode-multica-flat` (next
    release).
- **Verification:** Dogfood epic completes green under the new mode;
  `/hive:status` aggregates phase markers into accurate story state.
- **Estimated stories:** 2.

### Slice ordering rationale

Sequencing reflects three forces:

1. **U1 (spike first)** — Slice 0 gates everything.
2. **H2 must precede H1, V1, skill rewrite** — backend-routing has to be
   real before any dispatch is wired (design §10 H2).
3. **Audit-fix bundle (F1/F4/F6)** is intentionally not isolated; F1 lives
   inside the skill rewrite, F4/F6 inside bootstrap + verifier, so the
   bundle "slice" (slice 6) is a reconciliation pass, not new construction.

Deviation from the team-lead's suggested 8-slice cut: kept ordering and count
the same. The team-lead's "Slice 0 spike, Slice 1 resolver, Slice 2 bootstrap
routing" was reordered per H2 — bootstrap routing **precedes** the resolver,
because the resolver returns roles and the bootstrap layer is what makes
those roles route correctly. Without H2 first, the resolver returns roles
that all bind to the wrong runtime.

---

## 99. Risk rollup (top 5 across slices)

Drawn from design §3 + this slice plan; severity preserved from design where
possible.

| # | Severity | Risk | Primary slice | Mitigation |
|---|----------|------|---------------|------------|
| R1 | High | Cell startup latency — fan-out of N child issues per story could 2-4x wall-clock vs single-agent flow (design §3 R1) | Slice 4 | Cap optional slots in cell YAML; measure baseline in slice-0 spike; circuit-break at `circuit_breakers.story_timeout_minutes` (45m) |
| R2 | High | Inter-phase context passing — child N+1 needs N's outputs (today's insight capture is in-conversation, not in markers) (design §3 R2) | Slice 3 + Slice 4 | Phase output written to marker `artifacts:` as file paths only; next phase's brief includes refs verbatim. NO marker-embedded prose. |
| R3 | High | Push-target enforcement gap (F4 audit history) — agents disobeyed footer constraint twice already (design §10 H3, audit F4) | Slice 5 | Post-task verifier fails the phase on orphan-branch push. Footer kept as belt-and-braces. |
| R4 | Medium | Primitive (a) is heavier than the proposal's hoped-for (c). N+1 issues per story means N+1 CLI roundtrips per story (design §2.1, R1) | Slice 4 | Reuse `dispatchStoryToAgent` and `pollTaskUntilTerminal` as-is; minimize new wrapping cost. Measure in slice-0 spike. |
| R5 | Medium | F5 prerequisite (token scope) requires user-interactive OAuth — if user doesn't run the chore PR first, slice-0 halts (design §3 R5, §10 C1) | Slice 0 (detection); F5 chore PR (resolution) | Slice-0 includes scope detection with clear runbook line; user runs `multica setup` once before slice-0 proceeds. |

Note: design §3 R3 (optional-reviewer failure mode) and R4 (Opus 4.7 cost on
short-tail stories) are addressed inside U2's failure-policy table and the
existing `complexity: low → Sonnet` opt-down respectively. R6 (qa-engineer
persona file) is a slice-1 task, not a top risk.
