# Design Discussion — Modernize Hive model routing for the Claude 5 generation

> **§0 Prelude.** Author: architect (plan DAG `design` node). This node received only the
> `requirement` from context — the research brief is wired into the downstream author node, not
> here (see PLU-162 task contract). The "What I Found" section below is grounded in a direct
> repo survey of `feat/model-routing-claude5` performed at design time, not in a research brief.
> `git_flow` helper was not run from this node (out of scope for design); base-branch resolution is
> **deferred to the author/orchestrator node** (the task contract wires `git_flow` there), so this doc
> does not assume `main` — the orchestrator resolves `develop`-else-`main` per `feedback_git_flow_per_epic`
> at epic-index write time. No PRIOR DECISIONS section — no KG query was run from this node.
>
> **Grill consumption:** this is the revised (post-grill) draft. `grill-record.md` raised 7 findings
> (V1, H1, H2, U1, U2, C1, P1); each is folded into the section noted in the §9 consumption log at the
> end of this document. No finding was silently dropped.

## 1. What Are We Doing?

We're modernizing how Hive talks about — and routes to — Claude models, now that Claude Sonnet 5
(`claude-sonnet-5`) exists alongside the Fable 5 (`claude-fable-5`) guidance the maintainer has
been trialing. Right now Hive's shipped, consumer-facing docs still describe a three-tier world
(Opus / Sonnet 4.6 / Haiku) and never mention Fable at all. The newer models live only in the
maintainer's local `hive.config.yaml` and a few `.pHive/multica/agents.yaml` comments. That's a
coherence problem: the docs a consumer reads and the routing the maintainer actually runs have
drifted apart.

"Done" is five bite-sized, independently shippable stories that together: (1) classify Sonnet 5
into Hive's tier map, persona guidance, fallback-chain examples, and operator docs; (2) designate
Fable 5 as the preferred orchestrator/architect model and document its advertised 1M-context /
128K-output limits; (3) actually wire a configured fallback model chain through session dispatch
to Claude's `--fallback-model` capability; (4) document that org-level model restrictions override
every Hive-side preference; and (5) add `Tool(param:value)`-style model-routing permission
examples to governance docs. Four of the five are documentation changes; exactly one (the fallback
passthrough) touches runtime code. This is a planning task only — we produce the epic and story
artifacts, we do not implement.

## 2. What I Found

The model tier story is told in three different places that don't agree. `hive/agents/orchestrator.md`
carries `model: opus` in frontmatter (line 4) and a "Model tier routing" table (lines 167–184) that
names exactly three tiers with IDs `claude-opus-4-8`, `claude-sonnet-4-6`, and
`claude-haiku-4-5-20251001`. `hive/references/agent-config-schema.md` repeats the same three-row
table (lines 51–61) plus a precedence note (lines 188–211): `model_overrides` beats `model_tiers`
beats agent frontmatter. All 28 personas under `hive/agents/*.md` carry a frontmatter `model:` of
`opus` (orchestrator only), `haiku` (test-worker only), or `sonnet` (the other 26). The actual tier
*assignments* live in `hive/hive.config.yaml` (shipped baseline, lines ~150–173) and the maintainer
override `hive.config.yaml` (root, lines ~144–203).

The most important finding is a mismatch between the requirement's premise and the repo. The
requirement's PLAN-Q-012 validation claims "`configuration.md` documents `agent_backends.fallback_model`."
It does not. `grep -rn fallback_model` across the entire repo returns **zero hits**, and
`configuration.md:117` explicitly states that `agent_backends` is a maintainer-only key
*intentionally absent* from the shipped settings reference. So there is no existing fallback-model
config key to "extend" — PLAN-Q-012 must first *define* the config surface, then wire passthrough.
`--fallback-model` likewise appears nowhere. Session dispatch (`skills/hive/skills/execute-mode-session/SKILL.md`,
lines 12–21, 37–39) resolves a single model from `sessions.model` or `model_tiers` inheritance and
passes no fallback. `configuration.md` (lines 95–109) documents `sessions.{enabled,model,timeout_ms,
stuck_timeout_ms,max_retries}` — a single-model contract.

Fable is undocumented in shipped surfaces. It appears only in the maintainer-local root
`hive.config.yaml` (lines 179–188: a 2026-06-09 trial that was reverted 2026-06-12) and
`.pHive/multica/agents.yaml` comments. Nothing in `orchestrator.md`, `configuration.md`, or
`agent-config-schema.md` mentions Fable, its model ID, or its 1M/128K limits. Governance docs are
similarly bare: `permission-patterns.md` documents `Tool(param:value)` syntax (lines 99–155) with
Edit/Write/Bash deny-list examples but **no** `Agent(model:...)` examples, and
`hooks-conventions.md` (lines 108–116, "convention text only" posture) never says permission rules
are the preferred surface for model gating. `.pHive/CONTEXT.md` defines *Backend* and points at
`agent_backends` but has no Fable / context-window / output-limit vocabulary.

## 3. My Proposed Approach

Treat this as a vocabulary-first, runtime-last chain so the documentation that establishes terms
(tiers, model IDs, Fable defaults) lands before the code and permission examples that consume those
terms. Five stories:

**Story A — PLAN-Q-019 (classify Sonnet 5).** The foundation. Add `claude-sonnet-5` to the tier
map and the three-row tables in `orchestrator.md` (lines 167–184) and `agent-config-schema.md`
(lines 51–61), extend persona guidance to say which roles prefer Sonnet 5 versus Fable 5 versus a
lower-cost model, add a fallback-chain *example* (prose, not yet wired) to `configuration.md`, and
update operator docs (`hive/GUIDE.md` references the model IDs at lines ~211–213). `depends_on: []`.

**Story B — PLAN-Q-011 (Fable 5 as orchestrator/architect default).** Builds on A's vocabulary.
Flip `orchestrator.md` frontmatter `model:` and the routing table's top tier to designate
`claude-fable-5` as preferred top-tier, change `architect.md` frontmatter `model:` accordingly, and
add Fable 5's context/output limits to `configuration.md` for long-context planning steps. Two
guardrails from grill: (1) **Opus is not removed** — it stays as a documented fallback rung *below*
Fable, so the tier vocabulary is "Fable preferred, Opus fallback" not "Opus replaced" (resolves V1);
(2) the limits are written as **"advertised 1M-context / 128K-output (as published 2026-06)"**, not as
an absolute contract, and re-verified at implement time (resolves H2). `depends_on: [A]`.

**Story C — PLAN-Q-014 (org restrictions override defaults).** Adds an explicit precedence note to
`agent-config-schema.md` (extend the lines 188–211 precedence chain), `configuration.md`, and
`orchestrator.md` stating that Hive model values are *preferences* and org-level restrictions
override frontmatter, `hive.config.yaml`, env vars, and CLI selection. `depends_on: [B]` — it edits
the same `configuration.md` / `orchestrator.md` paragraphs B just rewrote, so serializing avoids a
merge conflict in the classic DAG.

**Story D — PLAN-Q-012 (fallback chain through session dispatch).** The only runtime story. Define
a config surface for an ordered fallback chain and extend `execute-mode-session/SKILL.md` + the
session-invoke path so resolution emits Claude's `--fallback-model`. Two grill guardrails: (1) prefer
a **new shipped-safe key `sessions.fallback_model`** over putting the chain under the deliberately
maintainer-only `agent_backends` namespace — `configuration.md:117` keeps `agent_backends` out of the
shipped reference, so a fallback key there would either contradict that policy or have to hide in a
maintainer-only section (resolves U1); (2) the requirement names *session* dispatch, but CONTEXT.md
says the Messages-API caller loop is the **default** substrate and sessions are opt-in — so Story D
must state whether passthrough covers the default substrate too or is explicitly session-only-for-v1
with a follow-on (see Open Question 6, resolves H1). `depends_on: [A, B]` — needs the documented chain
vocabulary and Fable defaults.

**Story E — PLAN-Q-007 (permission model-routing examples).** Add `Agent(model:...)` examples to
`permission-patterns.md` (deny Fable 5 for low-priority background agents, allow only Haiku for
test-worker-style roles, hard-deny restricted enterprise/government models) and a one-line note in
`hooks-conventions.md` that permission rules are preferred over hooks for model gating.
`depends_on: [A]`, and references C's org-restriction framing for the hard-deny case.

## 4. What Could Go Wrong

**`configuration.md` is a hot file (high).** Stories B, C, and D all edit it. The A→B→C serial
chain plus D's `depends_on: [B]` keeps the edits sequential, but if the author node ever marks B/C/D
`parallel_allowed: true` they will collide. Recommendation: keep these serial (omit the parallel
pair) and call the overlap out in each story's `files_to_modify`.

**Sonnet model-ID ambiguity (high).** The repo uses `claude-sonnet-4-6`; the new ID is
`claude-sonnet-5`. Story A must decide whether Sonnet 5 *replaces* 4.6 across all 26 sonnet-tier
agents or is *added* as a distinct option. A blanket find-replace could silently re-tier two dozen
personas — that's a behavior change disguised as a doc edit. See Open Question 1.

**PLAN-Q-012's premise is wrong (high).** As found in §2, there is no existing `fallback_model` key.
If the author node trusts the requirement's "extend the existing key" framing it will look for code
that isn't there. Story D must be scoped as *define then wire*, not *extend*.

**Fallback wired only into the opt-in substrate (high).** CONTEXT.md (line 30) says the Messages-API
caller loop is the *default* substrate and sessions are an *opt-in cloud adapter*. If Story D wires
`--fallback-model` into session dispatch only, the default substrate gets no fallback and the feature
silently doesn't apply to most runs. Story D must consciously choose: cover the default substrate too,
or ship session-only-for-v1 with an explicit follow-on. Surfaced as Open Question 6.

**Maintainer-vs-shipped config split (medium).** Fable currently lives only in the maintainer's root
`hive.config.yaml`, which `configuration.md:117` says is intentionally not shipped. Documenting Fable
as a *default* in shipped references (Story B) crosses that boundary. We should document Fable as the
*recommended* top-tier and a guidance default, while being explicit that tier *assignments* still
resolve from local config — not silently promote a maintainer-only key into the shipped contract.

**Model IDs drift again (medium).** These stories hard-code model-version strings. A `claude-sonnet-5.x`
bump later re-opens every file. Worth a note that IDs are centralized where possible, but not worth
blocking this epic on a refactor.

**Frontmatter/tier-map divergence (low).** Changing `orchestrator.md` frontmatter (B) without the
matching `model_tiers` entry, or vice versa, reintroduces exactly the drift this epic fixes. Each
doc story's acceptance criteria should grep both surfaces.

## 5. Dependencies and Constraints

This rests entirely on files already in the repo — no external libraries or services. The one
external-capability dependency is Claude Code's `--fallback-model` flag (Story D); we should confirm
the exact flag name and whether it accepts an ordered list or a single fallback before wiring. The
A→B→C→(D,E) dependency graph is the central internal constraint, driven by the `configuration.md`
hot-file overlap and the shared vocabulary. The DAG runs `development.classic`
(Research→Implement→Test→Review→Integrate); each story is sized for one classic pass. There is no
root `.gitignore` in this repo, so epic artifacts under `.pHive/epics/model-routing-claude5/` are
tracked by default — no allowlist step is needed (unlike the standard `/plan` step 0b path). The
public Sonnet 5 release is treated as user-provided current context; story acceptance criteria must
re-verify model IDs against the files at implement time, not against this doc.

## 6. Open Questions

Q1 and Q2 are **gating** — they should be answered at the design review gate *before* story
decomposition, not deferred into the stories, because they set Story A's edit shape and Story D's
config schema respectively (resolves grill U2). The rest can be answered during implementation.

1. **[GATING] Replace or add Sonnet 5?** Does `claude-sonnet-5` replace `claude-sonnet-4-6` for all 26
   sonnet-tier personas, or is it added as a higher-quality option some roles opt into? This decides
   whether Story A is a careful per-persona edit or a blanket swap.
2. **[GATING] Where does the fallback chain config live?** A new shipped-safe `sessions.fallback_model`
   (recommended), or a maintainer-only `agent_backends.fallback_model` (which per `configuration.md:117`
   must not appear in the shipped reference)? This sets Story D's schema and which doc sections it touches.
3. **Is `--fallback-model` a single value or an ordered list?** The requirement says "ordered fallback
   model chain." If the flag takes one model, "chain" means we pass the first resolvable; if it takes
   a list, we pass the whole chain. Affects D's resolution logic.
4. **How far does Fable-as-default go, and does Opus remain a rung?** Just orchestrator + architect
   (per PLAN-Q-011), or the whole top tier? The working assumption (per grill V1) is Fable becomes the
   *preferred* top-tier and Opus stays as a documented fallback rung below it — confirm that, and confirm
   scope, since the maintainer's reverted trial also touched tpm/tester/peer-validator.
5. **Do we name specific enterprise/government models to hard-deny in Story E**, or keep the example
   generic (`Agent(model:claude-*-gov)`)? Naming real restricted models may itself be sensitive.
6. **Does Story D's fallback passthrough cover the default Messages-API substrate**, or is it
   session-only for v1 with a follow-on for the default path? (grill H1 — the default substrate would
   otherwise get no fallback.)

## 7. Verification Strategy

Four of five stories are documentation; their verification is grep-based assertion, not test code.
Each doc story's acceptance criteria should pin a concrete `grep` proving the new text is present and
the old text is gone (e.g. `grep -n "claude-sonnet-5" hive/agents/orchestrator.md` returns a hit;
`grep -rn "claude-sonnet-4-6"` returns nothing if Q1 resolves to "replace"). Story D, the runtime
story, gets real tests: a unit test over the fallback-chain resolution helper (single model, ordered
list, empty/absent config) plus an assertion that `execute-mode-session` emits `--fallback-model`
when a chain is configured and omits it when not. Story B's grep check should also assert the Fable
limits are written with an "advertised / as published" qualifier and a date, not as a bare absolute
(grill H2).

```
VERIFICATION PLAN:
  Tools: grep/ripgrep assertions (doc stories); node test runner / existing lib test harness (Story D)
  Platforms: repo docs + Hive session-dispatch runtime
  Automated: Story D fallback-resolution unit tests; per-story grep acceptance checks
  Manual: visual read of orchestrator.md / agent-config-schema.md tier tables for coherence
  Not verifying: live Claude API calls with --fallback-model (out of scope — wiring + unit level only)
```

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~8-10 (orchestrator.md, architect.md, agent-config-schema.md, configuration.md,
    permission-patterns.md, hooks-conventions.md, execute-mode-session/SKILL.md, hive/GUIDE.md,
    a session-invoke lib file, possibly hive.config.yaml baseline)
  Subsystems: agent frontmatter, references docs, governance/permission docs, session-dispatch runtime
  Migration required: no (no data/schema migration; one new config key in Story D)
  Cross-team coordination: no
  Unknowns: 6 (the open questions above; Q1 and Q2 are gating, answered at the design gate)

  RECOMMENDATION: Proceed to stories (medium scope — H/V optional, structured outline not needed)
  RATIONALE: Bounded, well-understood surface dominated by doc edits with one small runtime story.
  The dependency graph is already clear (A→B→C→(D,E)); the risk is in execution coherence
  (hot-file serialization, the replace-vs-add decision), not in architectural uncertainty. A full
  structured outline would be ceremony. The requirement fixes "exactly five stories," so Story A keeps
  its four-surface scope as one story (grill P1) — but if Q1 resolves to "careful per-persona edit,"
  the story should be ordered into explicit sub-steps (tier-map/schema first, operator-docs/example
  second) within the single classic pass rather than split into a sixth story, to honor both the
  five-story constraint and the bite-sized intent.
  SCOPE_CLASS: single-epic
```

## 9. Grill-Record Consumption Log

Every `grill-record.md` finding resolved here (no silent drops):

- **V1** (vocabulary — "former Opus tier") → resolved in §3 Story B and §6 Q4: Fable becomes the
  *preferred* top-tier, Opus *remains a documented fallback rung*; "former Opus tier" language removed.
- **H1** (hidden assumption — session-only fallback) → resolved in §3 Story D, §4 (new high risk), and
  §6 Q6: Story D must state default-Messages-API-substrate coverage vs session-only-for-v1.
- **H2** (hidden assumption — Fable limits as fact) → resolved in §3 Story B and §7: limits written as
  "advertised / as published 2026-06," re-verified at implement time, grep-asserted.
- **U1** (tension — `agent_backends` shipped vs maintainer-only) → resolved in §3 Story D: prefer new
  shipped-safe `sessions.fallback_model`; §6 Q2 reframed accordingly.
- **U2** (tension — proceed-to-stories with load-bearing unknowns) → resolved in §6: Q1 and Q2 marked
  **[GATING]**, to be answered at the design review gate before decomposition.
- **C1** (convention — assumed `main` base branch) → resolved in §0 prelude: base-branch resolution
  explicitly *deferred to the author/orchestrator node*; no `main` assumption made here.
- **P1** (posture — Story A bundles four surfaces) → **accepted-and-justified deviation** in §8: the
  requirement fixes "exactly five stories," so Story A stays one story but is ordered into sub-steps if
  Q1 forces per-persona edits, rather than split into a sixth.
