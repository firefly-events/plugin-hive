# Parallel Call-Sites Registry

**Status:** canonical reference
**Owner:** `/execute` parallel-dispatch gate (`ed-7-execute-enforces-gate`)
**Companion docs:**
- [`story-yaml-schema.md`](story-yaml-schema.md) §4 — schema for `parallel_allowed` + `parallel_rationale`
- [`agent-teams-guide.md`](agent-teams-guide.md) — `Agent(name:)` teammate mechanics and limitations
- [`../../skills/hive/skills/execute-dispatch/SKILL.md`](../../skills/hive/skills/execute-dispatch/SKILL.md) — gate enforcement lives here

## 1. Purpose

The default-serial parallel-dispatch contract (epic `exec-discipline-may2026`,
capability #132) requires every story dispatched concurrently with a peer to
carry an explicit `parallel_allowed: true` + `parallel_rationale ∈ {variation,
read-only, bounded-slice}` pair. `/execute` refuses to fan out otherwise.

The gate only inspects **story-level dispatch** — the moment `/execute` is
about to spawn multiple stories at the same dependency depth concurrently
(via `Agent(name:)` teammates, the cmux pane loop, the sessions API, or the
sandcastle provider). It does not police other forms of concurrency (intra-step
`Promise.all` in a helper library, multi-pane test workers serialized by an
external driver, planning teams composed from several `Agent(name:)` teammates,
etc.) — those have their own contracts.

This registry inventories every existing parallel call site so authors can
see, at a glance, which sites the gate applies to and what rationale each
in-scope site declares. New parallel call sites must add a row here in the
same change that introduces the dispatch.

## 2. In-scope sites — story-level fan-out (gated by ed-7)

These sites are the ones the `ed-7` gate inspects before dispatch. Each row
links to the dispatch point. Stories fanned out at these sites must each
carry the `parallel_allowed: true` + `parallel_rationale ∈ {variation,
read-only, bounded-slice}` pair emitted by `/plan` Phase C step 13. The
gate runs once at `execute-dispatch` Step 1.5 against the depth-0
`unblocked_stories[]` set; on any violation the dispatch is downgraded to
serial with `mode_reason: parallel-gate-refused` and the offending story
IDs are named in the warning.

| Site | File | Dispatch shape | Rationale source |
|---|---|---|---|
| `execute:team` | [`skills/execute/SKILL.md`](../../skills/execute/SKILL.md) step 6 → [`references/team-execution.md`](../../skills/execute/references/team-execution.md) | One `Agent(name:)` call per depth-0 unblocked story spawns each as a named teammate in the session's implicit team; concurrent only when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, otherwise sequential | per-story (planner-emitted) |
| `execute:team-cmux` | [`skills/execute/SKILL.md`](../../skills/execute/SKILL.md) step 6b → [`references/team-execution.md`](../../skills/execute/references/team-execution.md) cmux variant | Orchestrator loops over the topologically-sorted set and spawns one cmux pane per story via `agent-spawn`; concurrent panes | per-story (planner-emitted) |
| `execute:sessions` | [`skills/execute/SKILL.md`](../../skills/execute/SKILL.md) step 6c → [`skills/hive/skills/execute-mode-session/SKILL.md`](../../skills/hive/skills/execute-mode-session/SKILL.md) | Story-level fan-out through the Claude Agent SDK `/v1/sessions` API | per-story (planner-emitted) |
| `execute:sandcastle` | [`skills/execute/SKILL.md`](../../skills/execute/SKILL.md) step 6d → [`skills/hive/skills/execute-mode-sandcastle/SKILL.md`](../../skills/hive/skills/execute-mode-sandcastle/SKILL.md) | Story-level fan-out into one sandcastle container per story via the Codex auth-mounted provider | per-story (planner-emitted) |
| `design:dispatch` | [`skills/hive/skills/design-dispatch/SKILL.md`](../../skills/hive/skills/design-dispatch/SKILL.md) Step 1.5 | Parallel-dispatch gate for `/design` mode selection; same Step 1.5 gate logic as `execute-dispatch`; routes to `design-mode-multica` or `design-mode-cc-workflows` atoms (later slices) | per-story (planner-emitted) |

## 3. Out-of-scope sites — not story-level fan-out

These sites use parallel mechanisms but do not dispatch independent stories
through the workflow runner. The `ed-7` gate does NOT inspect them. They
are catalogued here so a reader auditing the codebase can confirm "this is
not what the gate is for" without re-deriving the distinction. Each row
carries a rationale annotation drawn from the schema enum vocabulary so
the in-skill documentation reads consistently with the in-scope sites.

| Site | File | What it does | Rationale annotation | Why out-of-scope |
|---|---|---|---|---|
| `plan:phase-c-story-write` | [`skills/plan/SKILL.md`](../../skills/plan/SKILL.md) step 13 (Parallel-dispatch flag emission) | `/plan` writes `parallel_allowed` / `parallel_rationale` on each story; this is the **producer** the gate reads | producer (emits the contract, not a dispatch) | The skill writes flag values; it never dispatches stories itself. |
| `plan:design-discussion-team` | [`skills/plan/SKILL.md`](../../skills/plan/SKILL.md) Phase B → [`skills/hive/skills/planning-routing/SKILL.md`](../../skills/hive/skills/planning-routing/SKILL.md) | Several `Agent(name:)` calls assemble design-discussion personas (analyst, architect, technical writer, etc.) as named teammates in the one implicit team; they participate collaboratively | `read-only` (the planning team produces docs under `.pHive/epics/{id}/docs/` — no production code writes) | Not a story-level fan-out — N personas spawned as named teammates in the session's implicit team, coordinated via `SendMessage`. The gate inspects N stories, not N personas in one team. |
| `session-end:compile-and-index` | [`skills/hive/skills/session-end/SKILL.md`](../../skills/hive/skills/session-end/SKILL.md) Phase C | Phase C fires `compile()` and `chromadb.index()` concurrently via `Promise.all` | `read-only` (both operations write to derived caches under `.pHive/`; no production code reach) | Code-level concurrency inside a helper library, not workflow-runner dispatch. |
| `test-swarm:platform-workers` | [`skills/test/SKILL.md`](../../skills/test/SKILL.md), [`hive/references/test-swarm-architecture.md`](test-swarm-architecture.md) | Multiple test platform workers (web/iOS/Android) run unit and integration suites in parallel; Maestro layer serializes iOS+Android (port 7001) | `variation` (one test spec, multiple platform targets) | Workflow-internal parallelism inside the test-swarm pipeline. Each platform-worker runs the same step against a different target, not a separate planned story. |
| `planning-routing:mixed-team` | [`skills/hive/skills/planning-routing/SKILL.md`](../../skills/hive/skills/planning-routing/SKILL.md) | Direct-routed personas are spawned as `Agent(name:)` teammates in the implicit team; Codex-routed personas land in separate `agent-spawn` → `codex-invoke` panes | `read-only` (planning team produces docs, not code) | The personas are one planning team, not N independent stories. |
| `execute:specialist-phases` | [`skills/execute/SKILL.md`](../../skills/execute/SKILL.md) steps 4a, 7a (pre-exec / post-exec loops) | Iterates `pre_exec[]` / `post_exec[]` escalations sequentially per-trigger; each trigger spawns one specialist team via `Agent(name:)` | `bounded-slice` (each specialist team writes to a declared phase output dir at `.pHive/specialist-phases/{trigger}/{epic-id}/`) | Specialist phases run a single team per trigger; the loop is sequential trigger-by-trigger, not story fan-out. |
| `agent-spawn:single-pane` | [`skills/hive/skills/agent-spawn/SKILL.md`](../../skills/hive/skills/agent-spawn/SKILL.md) | Spawns one agent in one pane (tmux or cmux); reused as the per-story spawn primitive by `execute:team-cmux` | primitive (not a fan-out itself) | A single-pane spawn primitive. The caller decides whether to spawn many; this skill spawns one. |

## 4. Schema / reference docs

These files document the parallel-dispatch contract but do not themselves
dispatch anything. Catalogued for cross-reference completeness.

| File | Role |
|---|---|
| [`hive/references/story-yaml-schema.md`](story-yaml-schema.md) §4 | Canonical schema for `parallel_allowed` + `parallel_rationale` fields |
| [`hive/references/agent-teams-guide.md`](agent-teams-guide.md) | `Agent(name:)` teammate mechanics + the rule that teammates cannot spawn nested teams |
| [`hive/references/test-swarm-architecture.md`](test-swarm-architecture.md) | Test-swarm parallel-worker architecture (platform serialization rules) |
| [`skills/hive/skills/execute-dispatch/SKILL.md`](../../skills/hive/skills/execute-dispatch/SKILL.md) | The gate itself + mode-resolution contract |

## 5. Adding a new parallel call site

Before introducing a new place where the workflow runner fans out stories
or specialist phases in parallel:

1. Decide whether the new call site is **story-level fan-out** (gated by
   `ed-7`) or **out-of-scope** (intra-skill concurrency, single-team
   composition, code-level `Promise.all`, etc.).
2. Add a row to §2 (in-scope) or §3 (out-of-scope), naming the dispatch
   point, what it does, and the rationale annotation. Out-of-scope rows
   carry a `Why out-of-scope` justification so the in/out distinction
   stays stable across future audits.
3. If in-scope: confirm `/plan` Phase C step 13 emits the right
   `parallel_rationale` for the story shape, and that
   `execute-dispatch` Step 1.5 (the gate) reads the dispatch point's
   `unblocked_stories[]` payload.
4. If out-of-scope: confirm the existing parallel mechanism is invisible
   to the gate (it does not go through `execute-dispatch`).

The registry is the single source of truth — adding a parallel mechanism
without a row here is the regression the audit pass closes.
