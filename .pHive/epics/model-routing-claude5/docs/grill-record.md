# Grill Record — model-routing-claude5

**Source draft:** `.pHive/epics/model-routing-claude5/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** absent (heuristic pass — research-brief is wired into the author node, not the design node)
**Generated:** 2026-06-30

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 2 findings
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — "former Opus tier" shifts meaning vs the rest of the draft and the repo. The draft treats
  Opus both as a still-present tier (the tier tables in §2/§3 keep Opus rows) and as a "former" tier
  that Fable replaces (§6 Q4).
  - Draft location: §6 Q4 ("the whole former Opus tier") vs §3 Story B ("designate `claude-fable-5`
    as preferred top-tier") and §2 (Opus tier rows retained).
  - Reference: `hive/agents/orchestrator.md` lines 167–184 (Opus tier still defined); `.pHive/CONTEXT.md`
    has no "former tier" notion.
  - Question for planner: After Fable 5 is preferred, does the Opus tier *disappear*, get *renamed*,
    or *remain as a fallback rung*? Pick one term and use it consistently so Story A/B don't encode
    contradictory tier vocabularies.

## Hidden assumptions

- **H1** — The draft assumes wiring `--fallback-model` through **session dispatch only** is sufficient,
  but CONTEXT.md states the Messages-API caller-side loop is the *default* substrate and sessions are
  an *opt-in cloud adapter*.
  - Draft location: §3 Story D ("extend `execute-mode-session/SKILL.md` + the session-invoke path");
    §7 ("execute-mode-session emits --fallback-model").
  - Reference: `.pHive/CONTEXT.md` line 30 ("Substrate (Messages-API) — the default execution
    substrate … Sessions API stays as opt-in cloud adapter").
  - Why this matters: a fallback chain wired only into the opt-in path leaves the *default* substrate
    with no fallback — the feature would silently not apply to most runs.
  - Question for planner: Does Story D scope fallback-model passthrough to the default Messages-API
    substrate too, or is session-only acceptable for v1 (with a follow-on for the default path)?

- **H2** — The draft accepts Fable 5's "1M-context / 128K-output" limits as fact to be written into
  shipped docs, but cites no source beyond the requirement's user-provided claim.
  - Draft location: §3 Story B ("add the advertised 1M-context / 128K-output limits to `configuration.md`").
  - Why this matters: shipping a hard numeric limit into `configuration.md` makes it a contract; if the
    advertised number is wrong or version-specific, the doc misleads operators sizing long-context steps.
  - Question for planner: Should Story B's acceptance criteria require the limits be labeled
    "advertised / as published" and dated, rather than stated as an absolute, until verified at
    implement time?

## Unresolved tensions

- **U1** — The draft surfaces that `agent_backends` is intentionally *not shipped* (`configuration.md:117`)
  yet proposes Story D may put `agent_backends.fallback_model` into shipped `configuration.md`.
  - Draft location: §2 (cites `configuration.md:117`) and §3 Story D / §6 Q2 (candidate key
    `agent_backends.fallback_model`, documented "in `configuration.md`").
  - Tension: documenting a key under the deliberately-maintainer-only `agent_backends` namespace in the
    shipped settings reference contradicts the line-117 policy that keeps that namespace out of shipped docs.
  - Question for planner: If the fallback key lives under `agent_backends`, does Story D document it in a
    maintainer-only section (not the shipped reference), or does the chain get a *new* shipped-safe key
    (e.g. `sessions.fallback_model`) so the shipped/maintainer boundary is preserved?

- **U2** — The draft recommends "Proceed to stories" (medium scope) while flagging two of its five open
  questions as "load-bearing" (Q1 replace-vs-add, Q2 fallback key location).
  - Draft location: §8 RECOMMENDATION ("Proceed to stories") vs §6 (Q1/Q2 unresolved) and §8 RATIONALE
    ("Q1 and Q2 are the load-bearing ones").
  - Tension: handing the author node stories built on two unresolved load-bearing decisions risks
    encoding the wrong foundation; but the design gate is exactly where Q1/Q2 are meant to be answered.
  - Question for planner: Should Q1 and Q2 be marked as *gating* — answered at the design review gate
    before story decomposition — rather than deferred into the stories themselves?

## Convention violations

- **C1** — The §0 prelude assumes `base_branch: main` without running the `git_flow` resolver, but the
  project convention resolves base branch dynamically (`develop` if present, else `main`).
  - Draft location: §0 Prelude ("base branch assumed `main`, per-epic strategy") and §5 (same).
  - Convention: `.pHive/CONTEXT.md` line 58 ("One branch per epic"); `feedback_git_flow_per_epic`;
    `/plan` Phase A step 0a `resolveGitFlow`.
  - Question for planner: Is the assumed-`main` note acceptable given the design node doesn't own
    git_flow (the task contract wires it into the author node), or should the epic explicitly defer
    base-branch resolution to the author/orchestrator with a one-line marker so it isn't silently `main`?

## Posture mismatches

- **P1** — Story A bundles four surfaces (tier map + persona guidance + fallback-chain example +
  operator docs across `orchestrator.md`, `agent-config-schema.md`, `configuration.md`, `GUIDE.md`),
  which is in tension with the requirement's "keep execution stories bite-sized" instruction and the
  project's atomic/composable posture.
  - Draft location: §3 Story A; §8 RATIONALE ("unless Q1 forces splitting Story A's per-persona edits").
  - Posture reference: `.pHive/CONTEXT.md` ("composable substrate"); requirement Planning constraint
    "Keep execution stories bite-sized and implementable independently."
  - Question for planner: Is Story A's four-file scope still "bite-sized" for one classic DAG pass, or
    should the tier-map/schema edits be split from the operator-docs/example edits — and does the
    requirement's "exactly five stories" constraint forbid that split?

## Notes

The draft is internally coherent and well-grounded — its strongest move is catching the requirement's
false premise (no existing `fallback_model` key; `agent_backends` deliberately unshipped) at design
time rather than letting the author node trust it. Most findings here are sharpenings of tensions the
draft already surfaces (U1, U2, P1 build on §2/§4/§6) rather than blind spots; H1 (default-substrate
coverage) is the one genuinely new risk.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends
with a question for the planner; the planner's job is to revise the draft (or document accepted
deviations) before stories are written.
