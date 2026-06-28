# Design Discussion — TeamCreate → Auto-Spawn Agent Teams Migration

## 1. What Are We Doing?

Claude Code v2.1.178 deleted the `TeamCreate` and `TeamDelete` tools outright. Teammates
now spawn implicitly: the lead writes a natural-language prompt describing the team and its
tasks, and the runtime materializes teammates from that prose — there is no explicit tool
call any more. `SendMessage` survives as the intra-team mailbox. The `team_name` field is
deprecated and silently ignored, and team config is auto-managed by the runtime at
`~/.claude/teams/{team-name}/`.

Hive still treats `TeamCreate` as a live primitive. It is woven through the codebase in two
distinct ways that this migration must keep separate: as a **literal tool string** that the
runtime will now reject (in agent `tools[]` arrays and in a hook's allow-list), and as a
**conceptual label** for "the direct/Claude parallel-execution backend" (in CONTEXT.md
vocabulary, the parallel-call-sites catalog, and a dozen skill narratives). Done looks like:
no agent declares a deleted tool, no skill instructs the model to "call `TeamCreate`", the
docs describe the auto-spawn model accurately, the tests assert the new behavior, and two
specific doc debts the planner flagged (PLAN-Q-001 stale env caveat, PLAN-Q-006 trust-boundary
gap) are paid down. This is a correctness-and-accuracy migration, not a feature.

## 2. What I Found

The requirement's "17+ files" undercounts the blast radius. `grep -rln TeamCreate` returns
**88 hits across ~40 files** (excluding `node_modules`). They sort into clear tiers.

**Runtime-breaking (tier A).** `hive/agents/orchestrator.md:14` and `hive/agents/team-lead.md:10`
both list `"TeamCreate"` inside their `tools:` arrays. Once the runtime stops recognizing the
tool name, an agent definition that declares it may fail validation or silently drop the
capability — this is the only tier that can break a live run, so it leads.

**Behavioral instructions (tier B).** `skills/execute/SKILL.md` invokes `TeamCreate(...)` as
the dispatch verb in at least six places (lines 34, 36, 135, 197, 205, 273), and the
specialist-phase loops literally say "Invoke `TeamCreate(team_config=…, workflow=…)`".
`skills/hive/skills/planning-routing/SKILL.md`, `codex-invoke/SKILL.md`, `backend-dispatch/`,
and `agent-spawn/SKILL.md` all reference it as the direct-route spawn path. These tell the
model to call a tool that no longer exists.

**Reference docs (tier C).** `hive/references/agent-teams-guide.md` is built end-to-end around
`TeamCreate` mechanics — yet it already documents (lines 40+) that "agent teams are created via
the `TeamCreate` tool with **natural language prompts**", and it already carries a full cmux
path (`surface.split`/`send_text`/`read_text`) that uses **no** `TeamCreate` at all. That cmux
section is *evidence that a non-TeamCreate dispatch already runs in-tree*, but it is a different
mechanism (an orchestrator poll-loop), not the auto-spawn default — I should derive the new
default-path prose from the v2.1.178 auto-spawn semantics directly and keep cmux as a clearly
separate variant (see grill H1).
`hive/references/parallel-call-sites.md` catalogs the call sites (`execute:team`,
`plan:design-discussion-team`, `planning-routing:mixed-team`, `execute:specialist-phases`).

**Tests (tier D).** `tests/execute-parallel-gate.test.js:254` asserts peers "fan out as
TeamCreates"; `tests/hive-hooks/check-agent-misuse.orchestrator-pattern.behavior.test.js`
asserts a `TeamCreate` tool call is **allowed** and that a block message reads "Use TeamCreate";
`hive/lib/dag_executor/tests/test_plan_wire.py:101-121` asserts the direct route preserves a
"TeamCreate" path. These encode the old contract and will fail-or-mislead post-migration.

**Vocabulary (tier E).** `CONTEXT.md:17` defines *Backend* as "Either direct (Claude via
TeamCreate) or `codex`", and `CONTEXT.md:63` warns that "Raw `Agent(team_name=)` bypasses Codex
routing". The glossary itself encodes the deleted tool as the definition of "direct backend".

**Two flagged debts.** PLAN-Q-001: the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` caveat is stale
(agent teams GA since v2.1.172) but is still wired as a hard gate across `execute-dispatch`,
`design-dispatch`, `review-dispatch`, `design-review-dispatch` (each ~line 29/153), the
`agent-teams-guide.md` detection section, two dispatch tests, and `step-07-kick-off.md`.
PLAN-Q-006: `hive/references/cross-swarm-handoff.md` defines filesystem handoffs but **never**
states the trust boundary the planner wants documented — that `SendMessage` is intra-team
(ephemeral, session-bound) while filesystem handoffs are cross-swarm (durable, auditable).

## 3. My Proposed Approach

I'd sequence this by tier, runtime-breaking first, because a broken `tools[]` array is the only
change that can take down a live run; everything else is accuracy.

First, **tier A**: drop `"TeamCreate"` from the `tools:` arrays in `orchestrator.md` and
`team-lead.md`. `SendMessage` stays — it still exists. The natural-language spawn needs no tool
grant, so nothing replaces `TeamCreate` in the array. I'd also revisit the orchestrator's
`use-when` knowledge note (line 13) that says "spawning roster agents … via TeamCreate".

Second, **tier B/C — the conceptual rewrite**. This is the substantive work, and it is *not* a
find-and-replace. Every "Invoke `TeamCreate(team_config=…, workflow=…)`" becomes a
natural-language team description. The canonical pattern should be authored from the v2.1.178
auto-spawn semantics directly — a prose team description (e.g. "Create a team to work on epic …;
Task 1: … no dependencies; …") whose teammates the runtime materializes and whose dependencies
the runtime tracks — *not* lifted from the guide's cmux section, which is a different,
poll-loop mechanism (grill H1). I'd rewrite `team-execution.md`, the execute specialist-phase
loops, and the planning-routing/codex-invoke/backend-dispatch narratives to that auto-spawn
pattern, and demote the cmux section to a clearly-labeled variant. The existing cmux path is
useful only as proof that a non-TeamCreate dispatch already works in-tree.

Third, **tier E — vocabulary**. Redefine *Backend* in CONTEXT.md so "direct" means "Claude via
auto-spawned agent teams (natural-language prompt)" rather than "via TeamCreate", and rewrite
the `Agent(team_name=)` warning since `team_name` is now ignored — the routing concern it
guards still matters, so I'd preserve the *intent* (spawn through agent-spawn, not raw `Agent`)
while dropping the dead field.

Fourth, **tier D — tests**, with an ordering caveat (grill U2). Two of the three test files are
unblocked cleanup: `execute-parallel-gate.test.js` (re-word "fan out as TeamCreates" to the
auto-spawn assertion) and `test_plan_wire.py` (re-word the direct-route assertion away from the
"TeamCreate" string). The third, `check-agent-misuse`, is *not* ordinary cleanup and must not be
edited until the hook-redesign decision (Q1) is made: its block message literally says "Use
TeamCreate" and its whole purpose is to stop the orchestrator using `Agent` for story-sized work.
In the new model the *replacement* for "use TeamCreate" is "describe the team in natural
language", which emits no tool call — so the hook loses the positive `TeamCreate` signal it used
to permit. I'd carve the hook (logic + its behavior test) into its own story gated on Q1, rather
than fold its test edit into this tier.

Fifth, **the two debts**. PLAN-Q-001 (env flag): my recommended resolution to the §4 [high]
risk is a **compat no-op** — keep `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` readable but ignored,
and make `execution.parallel_teams` (plus `--sequential`) the sole gate, so existing `.env`
files don't error and no project silently flips to parallel. The dispatch skills, the two
dispatch tests, the guide's detection section, and `step-07-kick-off.md` update to drop the
flag as a *required* condition. This is the recommendation; because it is a behavior change I
still surface it for confirmation at the gate (Q2/Q3), but the outline should carry it as a
decision, not an open coin-flip. PLAN-Q-006 (trust boundary): add a "Trust Boundary:
SendMessage vs Filesystem Handoff" section to `cross-swarm-handoff.md`. To resolve the
team/swarm vocabulary gap (grill V1), that section must first define the containment — a **team**
is an ephemeral, session-bound intra-session coordination unit; a **swarm** is the wider,
phase-level unit (planning → dev → test → security) whose artifacts are durable — and then
contrast `SendMessage` (intra-team, ephemeral, session-bound, not auditable) against filesystem
handoffs (cross-swarm, durable, auditable). I'd also add the missing *swarm* entry to
CONTEXT.md's glossary so the term is grounded before the handoff doc leans on it.

## 4. What Could Go Wrong

**[high] The env-flag removal is a behavior change, not a doc edit.** Today both
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` truthiness *and* `execution.parallel_teams` must be set
for parallel dispatch. If I remove the env gate, every project that relied on it being *unset*
to force sequential execution suddenly goes parallel. The dispatch skills and the two dispatch
tests (`execute-dispatch-sandcastle.test.js`, `execute-dispatch-multica.test.mjs`) encode this;
changing the gate without preserving a sequential fallback could surprise users mid-epic.

**[high] The `check-agent-misuse` hook has no obvious new keystone.** It currently allows
`TeamCreate` and blocks `Agent`-for-stories with "Use TeamCreate". Natural-language spawn emits
*no tool call*, so the hook loses the positive signal it used to permit. If I just delete the
allow, the hook may over-block legitimate inline `Agent` use inside teammates; if I loosen it,
it may stop catching the misuse it was built for.

**[medium] Conceptual vs literal conflation.** Mechanically replacing every "TeamCreate" string
risks rewriting parallel-call-sites catalog IDs (e.g. `execute:team`) or scope-gate semantics
that merely *named* TeamCreate as the mechanism. The catalog's rationale ("one team with N
personas in a single TeamCreate call") needs re-expression, not deletion.

**[medium] `~/.claude/teams/{team-name}/` is now runtime-owned.** If any Hive code writes or
reads team config under that path, it now races the runtime. I haven't found such a writer, but
it's an assumption to verify.

**[low] CHANGELOG and historical episode/cycle-state files** also contain "TeamCreate". Those
are historical records and should *not* be rewritten — only live, load-bearing surfaces.

## 5. Dependencies and Constraints

- **External:** Claude Code ≥ v2.1.178 runtime semantics (tools deleted, team_name ignored,
  auto-spawn, config at `~/.claude/teams/`). Agent teams GA since v2.1.172 — the floor for
  dropping the experimental flag.
- **Internal:** Language policy (CLAUDE.md) — `test_plan_wire.py` is canonical Python. The JS
  test edits modify *assertions in existing* `tests/` files (no new JS files), which reads as
  maintenance rather than new bridge code — but CLAUDE.md's policy gates "new Node/JS outside
  bridge surfaces", and tests are not a listed bridge, so the maintainer should confirm that
  editing existing JS test assertions is in-policy (grill C1, tracked as Q6) before the executor
  touches them. No new Node files either way.
- **Convention:** Project posture is composable-substrate / atomic-skills; rewrites must not
  collapse atomic skill boundaries (grill, design-discussion stay separate).
- **Process:** All commits land on `feat/teamcreate-migration` (epic branch) per the node
  contract; the DAG executor reconciles from there.
- **No data/schema migration** — this is documentation, agent config, and test surface only.

## 6. Open Questions

1. **Hook redesign (blocking):** Should `check-agent-misuse` block-message and allow-logic be
   rewritten to key on natural-language spawn intent, or is the hook now obsolete given there's
   no tool to permit? This is the one genuinely-undecided question and it gates the hook story
   and its test edit (grill U2). Everything else has a recommendation.
2. **Env-flag disposition (recommendation to confirm):** I recommend the **compat no-op** —
   `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` stays readable but ignored, `execution.parallel_teams`
   becomes the sole gate. Confirm this versus full removal; the no-op is safer for existing
   `.env` files, full removal is cleaner. (Resolves grill U1.)
3. **Sequential fallback trigger (recommendation to confirm):** With the env gate demoted,
   `execution.parallel_teams: false` (or `--sequential`) is the recommended single switch that
   forces sequential execution. Confirm there's no other path relying on the env flag for this.
4. **Catalog ID stability:** Do `parallel-call-sites.md` IDs like `execute:team` stay verbatim
   (they're referenced by gate code), or do they get renamed away from team semantics?
5. **Scope of vocabulary rewrite:** Should CONTEXT.md's *Backend* definition name the auto-spawn
   model explicitly, or stay mechanism-agnostic ("direct Claude execution") to avoid re-coupling
   the glossary to a runtime detail that may change again? (Related: CONTEXT.md also needs a new
   *swarm* glossary entry per grill V1.)
6. **JS-test edit policy:** Is editing assertions in existing JS test files in-policy as
   maintenance, or does it need the same explicit maintainer approval new JS would (grill C1)?
   A one-line maintainer ruling unblocks the tier-D JS edits.

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: node --test (JS hook/gate tests), pytest (test_plan_wire.py),
         markdownlint-cli2 + yamllint (doc/config lint), grep audit script
  Platforms: Hive plugin runtime (Claude Code v2.1.178+), CI lint stage
  Automated: check-agent-misuse behavior test (new contract), execute-parallel-gate
             fan-out assertion, test_plan_wire direct-route assertion, dispatch-mode
             tests for the env-flag change; a grep gate asserting zero live "TeamCreate"
             tool-call instructions remain in agents/ and skills/ (allowing historical
             CHANGELOG/episode mentions)
  Manual: read-through of rewritten agent-teams-guide.md and the new cross-swarm-handoff
          trust-boundary section for accuracy against the v2.1.178 model; a dry-run
          /execute to confirm orchestrator/team-lead load without the deleted tool
  Not verifying: live multi-teammate parallel run end-to-end (no CI harness spins real
                 teammates) — covered by manual dry-run and the dispatch unit tests instead;
                 historical doc accuracy (CHANGELOG entries left as-is by design)
```

## 8. Scale Assessment

This is bigger than a one-line tool rename. The literal-string fixes are trivial, but the
conceptual rewrites (execute, planning-routing, agent-teams-guide, CONTEXT vocabulary), the
hook redesign, and the env-flag behavior change each carry real decisions. The env flag alone
touches four dispatch skills, two tests, the guide, and a ceremony step. The hook redesign is
genuinely open. This wants a structured outline to sequence tiers and capture the hook/env-flag
decisions before stories are written — a straight-to-stories pass would bury the hook question.

```
SCALE ASSESSMENT:
  Files affected: ~25 live surfaces (of ~40 total TeamCreate mentions; historical files excluded)
  Subsystems: agent definitions, execute/plan/dispatch skills, reference docs,
              CONTEXT vocabulary, hooks, JS + Python tests, ceremony steps
  Migration required: yes (behavioral — deleted tool + deprecated field + stale env gate)
  Cross-team coordination: no (single-repo, single maintainer surface)
  Unknowns: 1 blocking (hook redesign) + 5 confirmations (env-flag disposition,
            sequential trigger, catalog IDs, vocab scope, JS-test edit policy)

  RECOMMENDATION: Needs structured outline
  RATIONALE: ~25 load-bearing surfaces across 7 subsystems, one genuinely-blocking design
             decision (hook redesign) plus a behavior-change risk (env-flag) that needs a
             confirmed disposition, and a literal-vs-conceptual split that punishes naive
             find-and-replace. The outline sequences tier A→E, carves the hook into its own
             Q1-gated story, and forces the open decisions to the gate.
```

SCOPE_CLASS: single-epic

## Grill-Record Consumption (revision pass)

Walking every finding in `grill-record.md` (point-in-time adversarial pass for this iteration):

- **V1 (vocabulary — team vs swarm):** Resolved. §3 now requires the new
  `cross-swarm-handoff.md` trust-boundary section to first define team⊂swarm containment, and
  adds a new *swarm* glossary entry to CONTEXT.md (also flagged in Q5).
- **H1 (hidden assumption — cmux as default model):** Resolved. §2 and §3 now derive the
  default-path prose from v2.1.178 auto-spawn semantics directly and demote cmux to a separate
  variant; cmux is cited only as evidence that non-TeamCreate dispatch already runs in-tree.
- **U1 (tension — env-flag fix vs behavior change):** Resolved. §3 and Q2/Q3 now carry a
  recommended **compat no-op** disposition (`parallel_teams` as sole gate) rather than an open
  coin-flip, with gate confirmation retained because it is a behavior change.
- **U2 (tension — test edits vs hook redesign order):** Resolved. §3 tier-D now splits the two
  unblocked test files from the `check-agent-misuse` hook, and carves the hook + its test into
  a separate story gated on Q1.
- **C1 (convention — JS test edits vs language policy):** Accepted-with-tracking. §5 records the
  policy question and Q6 surfaces it for a one-line maintainer ruling rather than asserting
  in-policy unilaterally.
- **Posture mismatches:** Clean — no change required.
