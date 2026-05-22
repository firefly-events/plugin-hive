# Structured Outline — team-cell-execution-mode

**Phase B3 artifact.** Canonical pre-story decomposition. Phase C reads from
this file to write story YAMLs. Every claim cites its source section in the
canonical inputs (proposal, audit, research brief, design discussion,
grill record, hv-plan). No free-write.

**Inputs cited:**
- Proposal — `.pHive/proposals/team-cell-execution-mode.md`
- Audit — `.pHive/audits/multica-mode-audit-2026-05-22.md`
- Research brief — `.pHive/epics/team-cell-execution-mode/docs/research-brief.md`
- Design discussion — `.pHive/epics/team-cell-execution-mode/docs/design-discussion.md`
- Grill record — `.pHive/epics/team-cell-execution-mode/docs/grill-record.md`
- H/V plan — `.pHive/epics/team-cell-execution-mode/docs/hv-plan.md`

---

## 1. Executive summary

The current `execute-mode-multica` skill dispatches one Multica issue per
Hive story, assigned to a single `developer` agent that runs all five
workflow-phases (research → implement → test → review → integrate) inside
one Claude session (proposal §Problem). The 2026-05-22 audit (audit §Reality
vs intent) shows the consequences in production: persona split collapsed
("Single `developer` per whole story"), backend routing collapsed ("All
Sonnet, Codex idle"), push target drifted across runs ("Mixed: feat, orphan,
lost"), workspace bound to a stale Nova36 clone in one path, and zero
insight capture from the agents that did work. Five of six stories shipped
only via manual salvage — one story (s1-3, CI workflow file) was
unsalvageable due to an OAuth scope gap.

The target model (proposal §Target model §Core concept) reframes the unit
of work: a Multica **team cell** is one parent issue + N child issues, where
each child issue is one workflow-phase assigned to the role-correct persona.
Phases are composed declaratively from a roster YAML (proposal §Team
composition contract; design §2.2) — `core[]` always runs, `optional[]` is
gated by signal predicates over the story spec. The execute cell is in
scope for this epic; plan and review cells are deferred (design §7,
proposal §Out of scope). Multica primitive (a) — parent issue + child
issues per phase — is the host (design §2.1; research §1.6); options (b)
sequential reassignment and (c) Multica session/squad are ruled out by
research §1.6 and confirmed unviable by slice-0 spike per U1 (hv-plan §0,
design §10 U1).

The expected impact is a one-to-one preservation of session-mode fidelity
(persona split + backend routing + cross-LLM verification +
pre-shutdown insight capture) under the autonomous Multica substrate, with
the audit's six concrete deviations (audit §F1-F6) reconciled inline by
the same epic (design §2.5; hv-plan §1.8). After this epic ships, the
"Reality" column of audit §Reality vs intent should match the "Intent"
column on the next dogfood epic run (design §9; hv-plan slice 7
verification gate).

---

## 2. Goal & non-goals

**Goal (observable, per design §1):** A `/hive:execute` run under the
Multica adapter on a tiny dogfood epic produces, for each story: one parent
issue + N child issues (one per resolved workflow-phase); each child
assigned to the correct persona on the correct backend runtime (Codex for
researcher/developer/architect/technical-writer; Claude for
tester/reviewer/qa/ui-designer per proposal §Backend routing); per-phase
episode markers at `.pHive/episodes/{epic}/{story}/{phase}.yaml`; commits
pushed to `feat/{epic}` on the firefly-events origin with `hive-worker`
author identity; CI-touching changes succeed (no token-scope failure);
`/hive:status` aggregates per-phase markers into accurate story state
(design §9; hv-plan slice 7).

**Non-goals (per design §7, proposal §Out of scope, hv-plan §1):**

- **Plan cells.** Proposal §Team composition contract §`plan` cell defines
  a plan-cell roster, but design §7 cuts plan cells from scope ("session
  definition is only for execution"). Plan-cell roster spec remains as
  forward-link reference only.
- **Review cells.** Proposal §`review` cell defined; out of scope here
  (design §7). Forward link only.
- **Reverse-sync (Multica cancel → story YAML defer).** Already shipped as
  s2-1 in `story-loop-closure` (proposal §Out of scope; design §7).
- **Closer-on-merge.** Already shipped as s1-1 / s1-2 / s2-1 in
  `story-loop-closure` (proposal §Out of scope; design §7).
- **Hive Cloud runtime fork.** Separate project per design §7
  (`project_hive_cloud_runtime` memory).
- **Multi-cell concurrency tuning.** Deferred to slice-7+ work iff
  bottleneck emerges (design §7).
- **Atomic-skill extraction of cell-roster-resolver.** Per P2 resolution
  (design §10 P2), resolver ships as `hive/lib/cell-roster-resolver/`, not
  as `skills/cell-compose/SKILL.md`. Skill-shape evolution is flagged as
  candidate post-2.x cleanup alongside V1.
- **Refactor of planning-routing roster-builder onto the same lib.** Per
  V1 resolution (design §10 V1; hv-plan §0), this is post-2.x cleanup.
- **F5 token-scope fix bundled inline.** Per C1 resolution (design §10 C1;
  hv-plan §1.8) the OAuth `workflow` scope refresh is EXTRACTED into a
  prerequisite chore PR (`multica:auth-refresh-workflow-scope`); this
  epic's slice-0 assumes the scope exists.

The epic's gravity is in the execute cell. Anything else mentioned in the
proposal is forward-link only and must not pull story budget.

---

## 3. Context & substrate

### 3.1 Today's state (audit-cited evidence)

The six audit findings document the present condition of execute-mode-multica.
Each finding below is cited verbatim from `audit §Findings`.

- **F1 — Stale workspace repo binding** (audit §F1). The workspace was bound
  to the Nova36 clone in one dispatch path, pushing commits to the wrong
  remote. Severity high; blocks the audit's "Workspace clone" row in
  §Reality vs intent.
- **F2 — Single-developer dispatch bypasses persona split** (audit §F2).
  Every story dispatched as `developer`, running all five workflow-phases.
  Severity high; this is the central deviation the epic targets.
- **F3 — No `/hive:execute` orchestration ran** (audit §F3). Direct
  `multica issue create` invocations bypassed the orchestrator and the
  dispatch atom. Severity medium.
- **F4 — Inconsistent push behavior across agent tasks** (audit §F4).
  Mixed push targets (`feat`, orphan, lost). Severity high; flagged in
  audit §Reality vs intent "Push target" row.
- **F5 — Multica CLI's OAuth token lacks `workflow` scope** (audit §F5).
  Story s1-3 (CI workflow file) unsalvageable per audit §Salvage record.
  Severity high but EXTRACTED per C1 (design §10 C1).
- **F6 — Workspace agent commit identity drift** (audit §F6). Salvaged
  commit `9856fe5` (s1-2) authored as `Nova36 <don.matthews.iii@gmail.com>`
  not `hive-worker <hive-worker@noreply.github.com>`. Severity low
  (cosmetic but breaks contribution-graph attribution).

The audit's §Reality vs intent table gives the one-line collapse picture:
intended orchestration / persona / backend / push / workspace / insight
columns ALL show "wrong" in the Reality column.

### 3.2 Multica 0.3.4 primitive inventory verdict

The research brief (§1.6) probed Multica 0.3.4 directly. Only option (a) —
parent issue + child issues per phase — is viable.

- **Option (a)** — `multica issue create --parent` exists; parent/child
  topology is a first-class primitive (research §1.2). Verdict: VIABLE.
- **Option (b)** — Sequential reassignment via `multica issue update
  --assignee` exists, but research §1.3 flags "unconfirmed whether
  `--assignee` mutation automatically spawns a fresh task run, or only
  mutates metadata." Even if it does, every workflow-phase would share one
  issue's history, destroying the marker contract ("one phase = one marker
  = one persistent record" — design §2.1). Verdict: FRAGILE.
- **Option (c)** — Multica "session" command DOES NOT EXIST in 0.3.4
  (research §1.1: "No `session` or `sessions` command exists"). `squad`
  exists as a member-grouping container only; daemon evidence shows no
  parallel-multi-agent dispatch on a single task (research §1.4). Verdict:
  ABSENT.

The proposal's hoped-for option (c) "Multica sessions / squads" collapses
on contact (design §2.1). Slice-0 of this epic re-confirms via spike (per
U1) before committing in slice-2 (design §10 U1; hv-plan slice 0).

### 3.3 Persona gap

Research §3.2 found four bootstrapped Multica workspace agents at audit
time: `developer`, `tester`, `reviewer`, `qa-engineer`. The roster the cell
composer needs (design §2.6) requires nine more personas reconciled into
the workspace:

- researcher
- architect
- tpm
- technical-writer
- peer-validator
- backend-developer
- frontend-developer
- analyst
- ui-designer

Two name-mismatches need resolution in bootstrap config (research §3.2,
design §2.6, hv-plan §1.3): `security-reviewer.md` (source) ↔ `security`
(workspace agent name); `performance-reviewer.md` ↔ `performance`. The
`qa-engineer` workspace agent has no source persona file in `hive/agents/`
(research §3.1 lists 25 personas; qa-engineer absent) — either create
`hive/agents/qa-engineer.md` or alias to `tester` (design §2.6, design §3
R6, hv-plan §1.3).

### 3.4 Backend routing today vs target

Per proposal §Backend routing the target routing table is:

| Role | Backend | Model |
|---|---|---|
| researcher, developer, backend-developer, frontend-developer, technical-writer, architect | codex | gpt-5.4 |
| tester, qa-engineer, ui-designer | claude | sonnet 4.6 |
| reviewer, peer-validator, security | claude | opus 4.7 |

Per research §3.2 (cited via grill H2): all four bootstrapped Multica
agents currently share `runtime_id=0b8...` — there is no per-persona
runtime resolution in `hive/lib/multica-bootstrap/index.mjs` today.
"Routing lives in `hive.config.yaml.agent_backends`" (proposal) but the
bootstrap reconciliation does NOT consult `agent_backends` to pick a
runtime (grill H2: "That code does not exist"). Therefore backend-routing
claim is "theatre" until slice-1 lands (hv-plan §0 H2; design §10 H2).
This is the central reason hv-plan reorders slice-1 (bootstrap routing) to
PRECEDE slice-2 (cell-roster-resolver) — without H2 first, the resolver
returns roles that all bind to the wrong runtime (hv-plan §slice-ordering-rationale).

---

## 4. Proposed approach

The epic is decomposed by hv-plan §2 into eight vertical slices (Slice 0
through Slice 7), with one PREREQUISITE chore PR outside the epic. Each
sub-section below quotes the slice's stated goal, gap, dependency, and
verification gate.

### 4.1 F5 Chore PR (prerequisite, NOT in this epic)

**What.** A separate `chore:multica:auth-refresh-workflow-scope` PR that
refreshes the Multica daemon's GitHub OAuth credential to include the
`workflow` scope (hv-plan §2 Prerequisite; design §10 C1). Per audit
§Recommended follow-ons #3 and design §10 C1, this is a one-off,
user-interactive run.

**Why.** Audit §F5 documents that CI-touching story s1-3 was unsalvageable
because the daemon's GH OAuth token lacked `workflow` scope. Bundling F5
inline would create a slice-0 hard-block that pauses for human OAuth flow
inside an otherwise autonomous-execution epic (grill C1). Extraction
preserves slice-0's autonomous-spikeability.

**Dependency.** Hard-prerequisite for slice 4 (skill rewrite must operate
under a daemon that has the scope). Slice-0 detection task still verifies
the scope is live (hv-plan slice 0); if not, halts with runbook per R5.

**Verification.** PR merged + `multica setup` re-run + daemon log shows
new token has `workflow` scope. Slice-0 detection emits green.

### 4.2 Slice 0 — Primitive spike (all three options)

**What.** Spike Multica primitives (a), (b), (c) explicitly on throwaway
issues; document evidence per option (hv-plan slice 0). Outputs evidence
notes at `.pHive/spikes/team-cell-primitives/notes.md` covering: (a)
parent/child end-to-end on throwaway; (b) reassign-triggers-rerun
characterization (design §5 Q7); (c) re-confirmation that no `session`
command exists (research §1.1).

**Why.** Per U1 resolution (design §10 U1; grill U1), `feedback_test_offtheshelf_before_rewriting`
mandates spike-before-commit. The design committed to option (a) by
elimination BEFORE the spike; the spike's role is to confirm the
commitment is sound and characterize fallback paths (option b for failure
recovery, per design §5 Q7).

**Dependency.** F5 chore PR merged (audits scope assumption). No internal
dependency.

**Verification.** Spike notes show (a) parent/child works on throwaway;
(b) reassign behavior characterized as works-or-not; (c) confirmed absent.
Reviewer signs off on continuation. Slice-0 detection task also probes
daemon token scope; if `workflow` missing despite F5 chore, halts with
runbook line per R5 (hv-plan slice 0).

### 4.3 Slice 1 — multica-bootstrap runtime routing (H2)

**What.** Extend `hive/lib/multica-bootstrap/index.mjs` to read
`agent_backends` from `hive.config.yaml` and write the correct `runtime_id`
per persona at reconciliation. Inject `custom_env: {GIT_AUTHOR_NAME,
GIT_AUTHOR_EMAIL}` for git identity (F6) at the same call site (hv-plan
slice 1). Reconcile 9 new agents into the workspace (researcher,
architect, tpm, technical-writer, peer-validator, backend-developer,
frontend-developer, analyst, ui-designer) and resolve three name
mismatches (`security`, `performance`, `qa-engineer`).

**Why.** H2 (design §10 H2; hv-plan §0 H2) is "a real, missing piece" —
the bootstrap reconciles personas but does NOT consult `agent_backends`
to pick a runtime today. Without this slice, every persona binds to the
default runtime and backend-routing claim is theatre. This is the gate
that makes Codex-for-work / Opus-for-review real on Multica.

**Dependency.** Slice 0 confirms primitive (a). `hive.config.yaml.agent_backends`
is unchanged input data (already populated per
`feedback_codex_general_backend`).

**Verification.** After `multica-init`, `multica agent list` matches the
expected backend-routing table from design §2.4. A sample dispatch to a
Codex-routed persona lands on the Codex daemon. F6 identity injection
visible in `custom_env` per agent record. Estimated 2-3 stories: one for
runtime resolution, one for persona reconciliation + qa-engineer
disposition, one for git-identity injection.

### 4.4 Slice 2 — cell-roster-resolver lib (V1 rename, P2 confirmed)

**What.** New `hive/lib/cell-roster-resolver/` package resolves
`story-spec + cell-yaml + signal predicates` into a concrete roster
(`workflow-phase → role`) per design §2.2 + hv-plan slice 2. Ships
`hive/team-cells/execute-cell.yaml` (the execute cell roster spec —
design §2.2). Signal detection inline in YAML using keyword-list pattern
per design §2.2 (precedent: /plan step 16 UI detection — research §4.1).
Unit tests cover: `core[]` always present, `optional[]` applied iff signal
matches, `replaces:` swaps the slot.

**Why.** V1 (design §10 V1; hv-plan §0 V1) renamed the proposal's
`team-cell-composer` → `cell-roster-resolver` because "composer" collides
with planning-routing's roster-builder (grill V1). P2 (design §10 P2)
confirmed the resolver ships as code, not as atomic skill — composer is
pure resolution logic, not a user-callable composable surface; skill-layer
cost not justified (skill extraction is post-2.x candidate).

**Dependency.** Slice 1 (workspace agents reconciled — a roster needs
agents to bind to). No further internal dependency.

**Verification.** Calling the resolver with a backend-tagged story spec
returns `developer` + `backend-developer` substitution per the `replaces`
rule (design §2.2). UI-tagged story spec returns `frontend-developer`
variant. Cell YAML's vocabulary passes the V2 reviewer rule (no bare
"phase" outside §8 quotes — design §10 V2). Estimated 2-3 stories.

### 4.5 Slice 3 — writeMulticaRunEpisode `phase` param + marker shape (H1)

**What.** Extend `writeMulticaRunEpisode` to accept a `phase` parameter
defaulting to `null` for back-compat (hv-plan slice 3; design §10 H1).
When `phase != null`, marker basename is `{phase}.yaml`; when null,
basename stays `multica-run.yaml`. Episode marker schema documentation
updated to describe `artifacts:` list as file-path-only per R2 (design §3
R2).

**Why.** H1 (grill H1) flagged that today's `writeMulticaRunEpisode`
produces one `multica-run.yaml` per task; per-phase invocation needs
either a wrapper or a signature extension. The parameter route was picked
(design §10 H1) because it preserves the existing skill contract and
single-developer mode (if anyone still uses it during migration) keeps
the old filename via `phase: null` — this is the back-compat lever.

**Dependency.** Slice 2 (resolver lib in place, so phase names are
deterministic — slice-3 callers know which names to pass).

**Verification.** Two test calls — one without `phase`, one with
`phase: 'research'` — produce the expected files at the expected paths.
Old callers continue to work. Estimated 1-2 stories.

### 4.6 Slice 4 — execute-mode-multica skill rewrite (parent + child dispatch)

**What.** Replace `skills/hive/skills/execute-mode-multica/SKILL.md` with
the per-workflow-phase parent/child dispatch flow per design §2.3
(hv-plan slice 4). The five-step flow (design §2.3):

> 1. Resolve story → cell roster (composer reads story signals + cell YAML)
> 2. Create PARENT issue (one per story, holds brief, assigned to nobody)
> 3. For each phase in roster order:
>      3a. Create CHILD issue (--parent <parent_uuid> --assignee <role-agent>)
>      3b. Inject phase brief into child (subset of parent's brief + prior phase outputs)
>      3c. Wait for child to terminate (pollTaskUntilTerminal — reused as-is)
>      3d. writeMulticaRunEpisode → multica-run-{phase}.yaml
>      3e. If terminal != completed → fail-fast (no further phases dispatched)
> 4. Close parent (status: done) when all phases completed
> 5. Return roll-up summary to /execute

Wires F1 hard-block (P1-confirmed — design §10 P1; hv-plan §0 P1):
dispatch refuses to fan out if `project_id` on the parent issue is null.
Wires the U2 failure-policy table (design §10 U2): one explicit mapping
of `core_phase_fail`, `optional_phase_fail`, `repeated_phase_fail`,
`circuit_breaker_hit` to actions. Renames old content to
`execute-mode-multica-flat` for one release cycle (proposal §Migration).

**Why.** This is the central deliverable of the epic — the audit's F2
(single-developer dispatch) and F3 (no orchestration) both collapse here
because the new skill IS the orchestration the audit shows missing.

**Dependency.** Slices 1-3 (bootstrap routing, roster resolver, episode
shape all in place). Without all three the rewrite has no foundation.

**Verification.** A throwaway story dispatched under the new mode
produces: one parent issue, N child issues (one per workflow-phase in the
resolved roster), each assigned to the correct role agent on the correct
runtime, N episode markers at the correct paths. Estimated 3-4 stories
(parent/child flow, failure-policy table, F1 hard-block, renamed legacy
path).

### 4.7 Slice 5 — Post-workflow-phase push-target verifier (H3)

**What.** After each child terminates, orchestrator inspects the agent's
push target via `git ls-remote origin agent/developer/{task_id}` against
firefly origin (hv-plan slice 5; design §10 H3). Orphan-branch push fails
the phase (`failed`, not `escalated`) and retries per `max_step_retries`.
Brief footer text from §1.7 is kept as advisory belt-and-braces; the
verifier is the enforcement (design §10 H3).

**Why.** H3 (grill H3; design §10 H3) flagged that audit F4 shows agents
already disobeyed the footer constraint TWICE — footer alone is
insufficient. R3 (hv-plan §99) carries this as a HIGH risk requiring
enforcement, not advisory text.

**Dependency.** Slice 4 (new skill exists; verifier is a hook in the
per-phase termination handling).

**Verification.** Dogfood throwaway: force an agent to push to
`agent/developer/<task>`, observe phase marked `failed` and retried per
max_step_retries. Estimated 1-2 stories.

### 4.8 Slice 6 — Audit fixes F1/F4/F6 bundle (final reconciliation)

**What.** Confirm all bundled audit fixes are live and tested as a
cohesive set (hv-plan slice 6; design §2.5). Outputs: confirmation pass +
documentation snippet in `.pHive/audits/multica-mode-audit-2026-05-22.md`
noting F1/F4/F6 closed via this epic and F5 closed via the chore PR.
End-to-end integration test exercises a story with a CI-touching file
change to verify F4 + F5 + F6 all work together.

**Why.** Per `feedback_scope_class_changes` the audit fixes are bundled
inline with the new mode (a "bigger deal" = new mode, not piecemeal
patches — hv-plan §1.8). F1 lives inside the skill rewrite, F4/F6 inside
bootstrap + verifier; this slice is the reconciliation pass that
confirms the bundle is coherent rather than new construction
(hv-plan §slice-ordering-rationale).

**Dependency.** Slices 1 (F6), 4 (F1), 5 (F4).

**Verification.** Audit doc updated to show F1/F4/F6 closed; integration
test green. Estimated 1 story.

### 4.9 Slice 7 — Parallel-run gate + flag flip

**What.** Run both modes on a tiny dogfood epic (NOT story-loop-closure
per design §9), validate equivalence (or documented divergence), then
flip the default flag to the new cell mode (hv-plan slice 7). Feature
flag added to `/execute` (or to the dispatch-skill mode selection),
defaulting initially to flat; flipped at slice close. Removal-track
ticket created for `execute-mode-multica-flat` (next release, per
proposal §Migration).

**Why.** Per hv-plan §1.9 the migration layer carries the parallel-run
discipline. The dogfood acceptance gate (design §9 six checkpoints) is
the only place the whole epic's wiring is exercised end-to-end against a
real (small) epic.

**Dependency.** All prior slices.

**Verification.** Dogfood epic completes green under the new mode;
`/hive:status` aggregates phase markers into accurate story state
(design §9 #6). All six checkpoints from design §9 green. Estimated 2
stories.

### 4.10 Slice ordering rationale (verbatim from hv-plan)

Per `hv-plan §slice-ordering-rationale`:

> Sequencing reflects three forces:
> 1. **U1 (spike first)** — Slice 0 gates everything.
> 2. **H2 must precede H1, V1, skill rewrite** — backend-routing has to be
>    real before any dispatch is wired (design §10 H2).
> 3. **Audit-fix bundle (F1/F4/F6)** is intentionally not isolated; F1 lives
>    inside the skill rewrite, F4/F6 inside bootstrap + verifier, so the
>    bundle "slice" (slice 6) is a reconciliation pass, not new construction.
>
> Deviation from the team-lead's suggested 8-slice cut: kept ordering and
> count the same. The team-lead's "Slice 0 spike, Slice 1 resolver, Slice 2
> bootstrap routing" was reordered per H2 — bootstrap routing **precedes**
> the resolver, because the resolver returns roles and the bootstrap layer
> is what makes those roles route correctly. Without H2 first, the
> resolver returns roles that all bind to the wrong runtime.

---

## 5. Architecture details

### 5.1 Cell shape on Multica

Per design §2.1 and research §1.6, the cell is realized as **one parent
issue per story + N child issues per workflow-phase**. The parent holds
the brief and is assigned to nobody (pure container; design §2.3 step 2).
Each child is created with `--parent <parent_uuid> --assignee <role-agent>`
and inherits the phase brief subset.

`project_id` binding is mandatory: per F1 + design §2.5 + P1 resolution
(design §10 P1) the dispatcher hard-blocks if `project_id` on the parent
issue is null. Rationale per design §10 P1: parallel-dispatch-gate
precedent (ed-7) is a hard-block too; this is an enforcement gate, not a
kickoff gate. Warn-only is documented as the relax-path for a future
epic.

The parent acts as the roll-up handle for `/hive:status` aggregation and
for the closer (s1-1 from `story-loop-closure`, already shipped per
proposal §Out of scope).

Per-child episode marker preserves the marker contract ("one phase = one
marker = one persistent record" — design §2.1). Reusing one issue across
phases (option b) was rejected on this ground.

### 5.2 Roster resolution

Per P2 resolution (design §10 P2; hv-plan §0 P2), the cell-roster-resolver
ships as a **hive-lib code module** (`hive/lib/cell-roster-resolver/`),
called from the new `execute-mode-multica-cell` skill — NOT as an atomic
skill. Rationale per design §10 P2: "composer is pure resolution logic
(story-spec → roster), not a user-callable composable surface;
skill-layer cost not justified." Skill-layer extraction is flagged as
post-2.x candidate alongside V1.

Per V1 resolution (design §10 V1; grill V1) the package name is
`cell-roster-resolver`, NOT `team-cell-composer` (collides with
planning-routing's roster-builder).

**Inputs to the resolver:**
- Story spec (carries scope hints / metadata for signal detection)
- Cell YAML at `hive/team-cells/execute-cell.yaml`
- Signal predicates declared in the cell YAML

**Output:** ordered list `[(workflow-phase, role)]` — the roster.

**Signal detection** runs over the story spec at cell creation time, using
the keyword-list pattern from design §2.2 (precedent: `skills/plan/SKILL.md`
step 16 UI detection — research §4.1). Keywords inline in cell YAML;
predicates are simple `==`/boolean fields. Per design §2.2 explicitly:
"Don't compile to the predicate grammar yet — keep it dumb until we see a
real signal that needs OR / NOT."

**Cell YAML shape** (design §2.2 — quoted as schema, not as code):

- `cell: execute`
- `core: [researcher, developer, tester, reviewer]`
- `optional`: list of `{role, when: scope_signals.X, replaces|appends_after: Y}`

Optional slots use either `replaces:` (swap a core role — e.g.
`backend-developer` replaces `developer` when `scope_signals.backend`)
or `appends_after:` (append after a phase — e.g. `security-reviewer`
appends after `review` when `scope_signals.security`). The
`peer-validator` slot is conditioned on `planning.collaborative_review ==
true` (design §2.2).

### 5.3 Phase-marker shape

Per H1 resolution (design §10 H1; grill H1) the function signature of
`writeMulticaRunEpisode` extends with a `phase` parameter defaulting to
`null`. Filename rule:
- `phase == null` → `multica-run.yaml` (back-compat; single-developer
  mode if anyone still uses it during migration)
- `phase != null` → `{phase}.yaml` (e.g. `research.yaml`, `implement.yaml`,
  `test.yaml`, `review.yaml`, `integrate.yaml`)

Marker location: `.pHive/episodes/{epic}/{story}/{phase}.yaml` (design §9
#3).

`artifacts:` list per R2 (design §3 R2): **file-path-only** entries. NO
marker-embedded prose. The next workflow-phase's brief includes those
file references verbatim (design §3 R2 mitigation). This is the
inter-phase context channel — there is no persistent session memory
across child issues (design §5 Q3 / Q4 recommends).

Per H1 the back-compat lever is the parameter default — old callers
continue to work unchanged, including single-developer mode during the
parallel-run window.

---

## 6. Risk register & mitigations

The five risks below are the rollup from hv-plan §99 (which preserved
severity from design §3). For each: probability, impact, mitigation,
contingency.

### R1 — Cell startup latency

- **Severity:** High (hv-plan §99; design §3 R1).
- **Probability:** Likely. Primitive (a) means N+1 CLI roundtrips per
  story (one parent + N children). Each roundtrip carries its own
  poll-to-terminal cycle.
- **Impact:** 2-4x wall-clock vs single-agent flow per story; multiplied
  across an epic.
- **Mitigation:** Cap optional slots in cell YAML; measure baseline in
  slice-0 spike; circuit-break at `circuit_breakers.story_timeout_minutes`
  (45m per hv-plan §99).
- **Contingency:** If slice-0 baseline shows >3x regression, narrow the
  default `core[]` (e.g. fold researcher into developer for simple
  stories); flag as scope adjustment to the slice-4 design.

### R2 — Inter-phase context passing

- **Severity:** High (hv-plan §99; design §3 R2).
- **Probability:** Likely without explicit mitigation. Today's insight
  capture is in-conversation, not in markers (design §3 R2).
- **Impact:** Child N+1 starts cold without phase-N output; quality and
  retry-rate degrade.
- **Mitigation:** Phase output written to marker `artifacts:` as file
  paths only (slice 3); next phase's brief includes refs verbatim. NO
  marker-embedded prose.
- **Contingency:** If file-path-only proves too lean, add a brief
  one-paragraph "summary" field to the marker schema — but ONLY after
  observing concrete failure; not by default.

### R3 — Push-target enforcement gap

- **Severity:** High (hv-plan §99; design §10 H3; audit §F4).
- **Probability:** Confirmed already — audit §F4 records the failure mode
  in production.
- **Impact:** Commits land on orphan branches and are lost; epic ships
  partial; manual salvage required per audit §Salvage record.
- **Mitigation:** Post-workflow-phase verifier in slice 5 inspects push
  target and fails the phase on orphan-branch push (`failed`, not
  `escalated`, retry per `max_step_retries`). Footer kept as belt-and-braces
  (design §10 H3).
- **Contingency:** If verifier false-positives (e.g. legitimate
  agent/<role>/<task> push pattern emerges), add allow-list to the
  verifier config rather than weakening the rule.

### R4 — Primitive (a) is heavier than the proposal's hoped-for (c)

- **Severity:** Medium (hv-plan §99; design §2.1 + R1).
- **Probability:** Confirmed by topology — (a) means N+1 CLI roundtrips
  per story vs (c)'s single-session ideal that doesn't exist in 0.3.4.
- **Impact:** Same latency surface as R1, but framed as a primitive-choice
  consequence rather than a tunable parameter.
- **Mitigation:** Reuse `dispatchStoryToAgent` and `pollTaskUntilTerminal`
  as-is; minimize new wrapping cost. Measure in slice-0 spike.
- **Contingency:** If a future Multica release ships a real session/squad
  primitive, slice-0's option-(c) re-confirmation note becomes the entry
  point for a follow-on migration epic. Not in current scope.

### R5 — F5 prerequisite requires user-interactive OAuth

- **Severity:** Medium (hv-plan §99; design §3 R5; design §10 C1).
- **Probability:** Certain — the OAuth refresh flow IS user-interactive
  (no programmatic refresh path documented per research §6).
- **Impact:** If the chore PR doesn't run first, slice-0 detection halts
  with a runbook line and slice-1 cannot proceed.
- **Mitigation:** Slice-0 detection task probes daemon token scope;
  emits clear runbook line if `workflow` missing despite F5 chore.
  Chore PR (`multica:auth-refresh-workflow-scope`) is a separate,
  human-driven PR per design §10 C1 — bundled F5 was rejected to keep
  this epic's slice-0 autonomous-spikeable.
- **Contingency:** Reviewer acceptance gate: this epic does NOT enter
  Phase D dispatch until F5 chore PR is merged AND `multica setup`
  re-run AND daemon log shows `workflow` scope present.

**Note** (per hv-plan §99 closing): design §3 R3 (optional-reviewer
failure mode) and design §3 R4 (Opus 4.7 cost on short-tail stories) are
addressed inside U2's failure-policy table and the existing `complexity:
low → Sonnet` opt-down respectively. R6 (qa-engineer persona file) is a
slice-1 task, not a top risk.

---

## 7. Dependencies & sequencing

The dependency graph below is a topological view derived from hv-plan §2
slice-by-slice + the slice ordering rationale. F5 chore is hard-prerequisite
to slice 4 (and detected by slice 0).

| Slice | Depends on | Blocks | Justification (cite) |
|---|---|---|---|
| F5 chore PR | — (external chore) | slice 4 (skill rewrite), slice 0 (detection) | design §10 C1; hv-plan §2 Prerequisite — token scope must exist before any CI-touching dispatch |
| Slice 0 — Primitive spike | F5 chore merged | slice 1 | hv-plan slice-ordering-rationale #1: "U1 (spike first) — Slice 0 gates everything" |
| Slice 1 — Bootstrap runtime routing (H2) | slice 0 | slice 2, slice 6 (F6 piece) | hv-plan slice-ordering-rationale #2: "H2 must precede H1, V1, skill rewrite" |
| Slice 2 — cell-roster-resolver lib (V1 rename) | slice 1 | slice 3, slice 4 | hv-plan slice 2: "workspace agents reconciled, so a roster has agents to bind to" |
| Slice 3 — writeMulticaRunEpisode phase param (H1) | slice 2 | slice 4 | hv-plan slice 3: "resolver lib in place, so phase names are deterministic" |
| Slice 4 — execute-mode-multica skill rewrite | slices 1, 2, 3; F5 chore | slice 5, slice 6, slice 7 | hv-plan slice 4: "bootstrap routing, roster resolver, episode shape all in place" |
| Slice 5 — Push-target verifier (H3) | slice 4 | slice 6 (F4 piece), slice 7 | hv-plan slice 5: "new skill exists; this is a hook in the orchestration loop" |
| Slice 6 — Audit fixes F1/F4/F6 bundle | slices 1, 4, 5 | slice 7 | hv-plan slice 6: "Confirm all bundled audit fixes are live and tested as a cohesive set" |
| Slice 7 — Parallel-run gate + flag flip | all prior slices | (epic close) | hv-plan slice 7: "All prior slices" |

**Hard-prerequisite call-out:** F5 chore PR is NOT in this epic's scope
(per C1, design §10) but MUST merge before slice 4 dispatch. Slice 0
detects token-scope status and halts with runbook if missing (hv-plan
slice 0 + design §3 R5 mitigation).

**Reorder note** (hv-plan slice-ordering-rationale): team-lead's
suggested "Slice 0 spike → Slice 1 resolver → Slice 2 bootstrap routing"
was inverted to "Slice 0 → Slice 1 bootstrap routing → Slice 2 resolver"
because "without H2 first, the resolver returns roles that all bind to
the wrong runtime." Phase C MUST preserve this ordering when writing
story IDs.

---

## 8. Open questions & elicitation points

These eleven questions are the user-gate surface from design §5. The user
is in **no-stop mode** for this Phase C — outline NOTES the elicitation
but does NOT block. Each entry: Question, §10 resolution (if any),
residual elicitation, default if user does not respond.

### Q1 — Hosting primitive (proposal Q1)

- **Question (design §5 #1):** Confirm decision: Option (a) parent + child.
- **§10 resolution:** No explicit response; U1 restructured slice-0 to
  spike all three and contingent-commit on slice-0 evidence (design §10
  U1).
- **Residual elicitation:** None pre-spike. Post-spike: confirm option (a)
  remains the commitment OR replan.
- **Default:** Proceed with option (a); slice-0 spike characterizes
  fallbacks.

### Q2 — Skip-or-block on failed optional (proposal Q1 redux)

- **Question (design §5 #2):** Optional security-reviewer fails — skip or
  block?
- **§10 resolution:** Folded into U2 failure-policy table (design §10 U2).
  Optional workflow-phase fail → "Story blocked … Operator review
  required before continuation."
- **Residual elicitation:** None.
- **Default:** Block. (Already encoded; not user-pending.)

### Q3 — Signal detection ownership (proposal Q2)

- **Question (design §5 #3):** Composer (deterministic) or LLM-router?
- **§10 resolution:** Not explicitly resolved in §10; design §2.2 commits
  to deterministic keyword-list pattern (precedent: /plan step 16).
- **Residual elicitation:** Confirm at Phase C kickoff that deterministic
  is acceptable; LLM-router is a follow-on.
- **Default:** Deterministic. (design §5 #3 recommend.)

### Q4 — Inter-phase state (proposal Q3)

- **Question (design §5 #4):** Marker paths only, or persistent session
  memory?
- **§10 resolution:** R2 (design §3 R2) commits to marker `artifacts:`
  paths only.
- **Residual elicitation:** None.
- **Default:** Marker paths only.

### Q5 — Multica project scope (proposal Q4)

- **Question (design §5 #5):** Plan/review cells share execute project,
  or each its own?
- **§10 resolution:** Not pertinent — plan/review cells are out of scope
  for this epic (design §7).
- **Residual elicitation:** Defer to plan/review-cell follow-on epic.
- **Default:** Shared project per epic (design §5 #5 recommend).

### Q6 — /triage cell (proposal Q5)

- **Question (design §5 #6):** Own cell or operator-driven?
- **§10 resolution:** Not pertinent — triage cell out of scope.
- **Residual elicitation:** Defer to /triage epic.
- **Default:** Operator-driven (design §5 #6 recommend).

### Q7 — Reassign-triggers-rerun (research Q1)

- **Question (design §5 #7):** Does `multica issue update --assignee`
  spawn a fresh task run?
- **§10 resolution:** Slice-0 spike will characterize (design §10 U1).
- **Residual elicitation:** Post-spike: confirm whether option (b) is a
  viable fallback for failure recovery.
- **Default:** Treat option (b) as fragile until spike says otherwise.

### Q8 — Squad parallel/serial (research Q2)

- **Question (design §5 #8):** Squad-as-assignee with N members:
  parallel, serial, single-pick?
- **§10 resolution:** Slice-0 spike characterizes (option (c) is already
  ruled out per research §1.4; spike re-confirms).
- **Residual elicitation:** None expected — answer is "no parallel
  primitive."
- **Default:** Single-pick / absent.

### Q9 — Workspace default project (research Q3)

- **Question (design §5):** Daemon-side resolution path when issue has no
  `--project`?
- **§10 resolution:** P1 resolved to hard-block (design §10 P1) — issue
  with null `project_id` fails fast, NOT auto-create default.
- **Residual elicitation:** None.
- **Default:** Hard-block. Relaxed warning-with-default is documented as
  future-epic relax-path.

### Q10 — Git identity injection site (research Q4)

- **Question (design §5):** Where does daemon establish `user.name`/
  `user.email` for per-task worktree?
- **§10 resolution:** Folded into F6 fix in slice 1 — `custom_env:
  {GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL}` injected at bootstrap (design §2.5
  F6; hv-plan §1.3).
- **Residual elicitation:** None.
- **Default:** Bootstrap-time `custom_env` injection.

### Q11 — `multica setup` re-auth flow (research Q5)

- **Question (design §5):** Does re-running `multica setup` refresh GH
  OAuth with new scope, or is `auth refresh` a separate command?
- **§10 resolution:** Folded into F5 chore PR scope — operator runs
  `multica setup` manually (design §10 C1; design §3 R5).
- **Residual elicitation:** Confirm at chore-PR runtime.
- **Default:** Operator runs `multica setup` once; chore PR documents
  exact steps.

**Phase-C kickoff note:** Questions Q1, Q3, Q7 are the only ones where
slice-0 spike output could plausibly change the plan. Phase C may proceed
on defaults; replan if slice-0 surfaces a strong signal (per U1).

---

## 9. Acceptance & "done" definition

Per design §9 ("What done looks like"), the epic is done when
`/hive:execute <dogfood-epic>` under the Multica adapter produces the
behaviors below. Each bullet is a testable assertion grouped by the slice
that delivers it.

**Slice-1 assertions (bootstrap routing + persona reconciliation):**

- `multica agent list` lists all 13 expected agents (4 existing + 9 new
  per design §2.6).
- Each agent's `runtime_id` matches `hive.config.yaml.agent_backends`:
  researcher/developer/architect/technical-writer/backend-developer/
  frontend-developer → Codex; tester/qa-engineer/ui-designer → Claude
  Sonnet; reviewer/peer-validator/security → Claude Opus 4.7 (proposal
  §Backend routing).
- Each agent's `custom_env` carries `GIT_AUTHOR_NAME=hive-worker` and
  `GIT_AUTHOR_EMAIL=hive-worker@noreply.github.com` unless per-role
  overridden (F6 fix).

**Slice-2 assertions (resolver):**

- `hive/team-cells/execute-cell.yaml` exists and lint-passes the V2
  reviewer rule (no bare "phase" outside §8 quotes).
- Resolver returns `developer + backend-developer` substitution per
  `replaces:` rule on a backend-tagged story spec (design §2.2).

**Slice-3 assertions (marker shape):**

- `writeMulticaRunEpisode({phase: 'research'})` writes
  `.pHive/episodes/{epic}/{story}/research.yaml`.
- `writeMulticaRunEpisode({})` writes `multica-run.yaml` (back-compat).
- Marker `artifacts:` field contains file-path-only entries (no embedded
  prose) per R2.

**Slice-4 assertions (skill rewrite — design §9 numbered):**

- 1 — "Each story creates a parent issue + N child issues per phase,
  visible in Multica board."
- 2 — "Each phase agent is the correct role (researcher Codex, tester
  Claude Sonnet, reviewer Claude Opus 4.7)."
- 3 — "Episode markers exist per phase under
  `.pHive/episodes/{epic}/{story}/{phase}.yaml`."
- Dispatch hard-blocks if `project_id` on parent is null (F1 + P1).
- U2 failure-policy table is honored — core-phase-fail retries once;
  optional-phase-fail blocks story.

**Slice-5 assertions (verifier — design §9 numbered):**

- 4 — "Commits pushed to firefly `feat/{epic}` branch with `hive-worker`
  author" (F4 + F6 enforced).
- Orphan-branch push fails the phase and triggers retry per
  `max_step_retries`.

**Slice-6 assertions (audit reconciliation):**

- Audit doc `.pHive/audits/multica-mode-audit-2026-05-22.md` updated to
  show F1, F4, F6 closed in this epic; F5 closed in chore PR.
- End-to-end integration test exercises a story with a CI-touching file
  change and succeeds (F4 + F5 + F6 verified together — hv-plan slice 6).

**Slice-7 assertions (parallel-run gate + flip — design §9 numbered):**

- 5 — "CI-touching stories don't fail on token scope."
- 6 — "/hive:status renders accurate story state by aggregating per-phase
  markers."
- Dogfood epic (NOT story-loop-closure per design §9) completes green
  under the new mode end-to-end.
- Feature flag flipped to new mode as default; removal-track ticket
  filed for `execute-mode-multica-flat`.

The epic is NOT done until all six numbered assertions from design §9 +
the cross-slice ones above pass on the dogfood epic.

---

## 10. Inconsistency anchors

This section is GATING for Phase C. Story writers MUST read it before
drafting AC text. Reviewer rejects any spec that reintroduces vocabulary
collision (per design §8 closing: "non-negotiable for downstream stories").

The five vocabulary signals from research brief §8 + design §8 + grill V1/V2:

- **"session"** — DROP entirely. Use "team cell" everywhere. If a
  sentence wants the word "session," it MUST disambiguate: "Claude
  session" | "daemon task session". No bare "session" in code or docs
  (design §8 #1).
- **"team cell"** — defined explicitly (design §8 #2): "one Multica
  parent issue + N child issues representing one Hive workflow phase
  scope (plan | execute | review). Composed from a roster declared in
  `hive/team-cells/{cell}.yaml`." Distinct from "agent team" (TeamCreate)
  and "planning team" (planning-routing roster).
- **"phase"** — context-qualified (design §8 #3): cell-internal phases
  are *workflow-phases* (research/implement/test/review/integrate);
  /plan-skill Phase A/B/C/D are *plan-phases*; episode markers track
  *workflow-steps* (`step_id`). Three terms, three names.
- **"core team / `core[]`"** — (design §8 #4): `core[]` in cell YAML is
  per-cell-type roster. `Core team` (planning-routing) is the planning
  roster. Never reuse "core team" inside cell YAML prose.
- **"agent"** — qualified everywhere (design §8 #5): *Multica agent*
  (UUID + persona, long-lived), *Hive persona* (source file), *SDK
  Agent* (transient subagent spawn). Cell YAML uses "role" not "agent"
  for the roster slot.

Two grill rulings on naming:

- **V1 ruling** — `hive/lib/team-cell-composer/` → `hive/lib/cell-roster-resolver/`.
  Future refactor of planning-routing's roster-builder onto the same lib
  is OUT OF SCOPE; flag as post-2.x cleanup (design §10 V1; hv-plan §0).
- **V2 ruling** — Substitute "workflow-phase" everywhere inside design
  §2-7. Reviewer story checks the spec for bare "phase" outside §8
  quotes; rejects if found (design §10 V2; hv-plan §0).

These rules are NON-NEGOTIABLE. A Phase C story whose AC text uses bare
"session" or bare "phase" outside §8 quotes is malformed.

---

## 11. Story-decomposition prompts

The lines below are PROMPTS, not stories. Phase C may merge/split, may
add cross-cutting concerns, may add tester/reviewer stories per
`hive/references/cross-cutting-concerns.md`. Each prompt is one line in
the form `slice-N.M: <verb> <noun phrase>`. The numbering carries the
hv-plan §2 slice IDs.

### F5 chore (PREREQUISITE PR — outside this epic)

- f5-chore.1: refresh Multica daemon GH OAuth with `workflow` scope
- f5-chore.2: document `multica setup` re-auth runbook for operators

### Slice 0 — Primitive spike

- slice-0.1: spike Multica primitive (a) parent+child on throwaway issue
- slice-0.2: spike Multica primitive (b) reassign-triggers-rerun behavior
- slice-0.3: re-confirm absence of Multica `session` command (option c)
- slice-0.4: probe daemon token scope and halt-with-runbook on missing
  `workflow`
- slice-0.5: write `.pHive/spikes/team-cell-primitives/notes.md` evidence
  doc

### Slice 1 — Bootstrap runtime routing (H2)

- slice-1.1: extend `hive/lib/multica-bootstrap/index.mjs` to consult
  `agent_backends` and write per-persona `runtime_id`
- slice-1.2: reconcile 9 new personas into Multica workspace (researcher,
  architect, tpm, technical-writer, peer-validator, backend-developer,
  frontend-developer, analyst, ui-designer)
- slice-1.3: resolve persona-name mismatches (`security`, `performance`,
  `qa-engineer`)
- slice-1.4: inject `custom_env` git identity (`GIT_AUTHOR_NAME`,
  `GIT_AUTHOR_EMAIL`) at bootstrap (F6 piece)

### Slice 2 — cell-roster-resolver lib (V1, P2)

- slice-2.1: scaffold `hive/lib/cell-roster-resolver/` package skeleton
- slice-2.2: implement roster resolution from cell YAML + signal
  predicates
- slice-2.3: author `hive/team-cells/execute-cell.yaml` per design §2.2
- slice-2.4: unit-test `replaces` and `appends_after` slot rules

### Slice 3 — writeMulticaRunEpisode phase param (H1)

- slice-3.1: extend `writeMulticaRunEpisode` signature with `phase`
  parameter (default null)
- slice-3.2: update episode-marker schema doc — `artifacts:` is
  file-path-only per R2

### Slice 4 — execute-mode-multica skill rewrite

- slice-4.1: rewrite `skills/hive/skills/execute-mode-multica/SKILL.md`
  to parent+child dispatch flow per design §2.3
- slice-4.2: wire F1 hard-block on null `project_id` (P1 confirmed)
- slice-4.3: implement U2 failure-policy table (core / optional /
  repeated / circuit-breaker scenarios)
- slice-4.4: rename legacy single-developer path to
  `execute-mode-multica-flat` for back-compat release cycle

### Slice 5 — Push-target verifier (H3)

- slice-5.1: implement `git ls-remote` post-workflow-phase verifier in
  `hive/lib/multica-story-dispatch/` (or sibling)
- slice-5.2: wire verifier into new skill's per-phase termination
  handling; fail phase on orphan-branch push

### Slice 6 — Audit fixes F1/F4/F6 reconciliation

- slice-6.1: update audit `.pHive/audits/multica-mode-audit-2026-05-22.md`
  with F1/F4/F6 closure notes
- slice-6.2: end-to-end integration test exercising CI-touching story
  (verifies F4 + F5 + F6 together)

### Slice 7 — Parallel-run gate + flag flip

- slice-7.1: add feature flag to `/execute` (or dispatch-skill mode
  selection) defaulting to flat
- slice-7.2: run dogfood epic under both modes; validate equivalence
  against design §9 six-checkpoint gate; flip default; file removal-track
  ticket for `execute-mode-multica-flat`

---

**End of structured outline. 11 sections, ~960 lines (with whitespace).
Phase C: read §10 first, then §11 prompts, then §4 for context. Honor §7
sequencing — do NOT reorder slice IDs.**
