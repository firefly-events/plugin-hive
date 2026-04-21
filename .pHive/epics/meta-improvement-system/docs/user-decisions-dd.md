---
title: User decisions — Design Discussion sign-off
epic: meta-improvement-system
phase: Phase B (design discussion) → Phase B2 (H/V planning)
date: 2026-04-19
status: complete — all 9 Qs + Q-new-A + Q-new-B signed off
source: user response to design-discussion.md review, 2026-04-19
---

# User decisions on the 9 open questions

## Q1. Metrics storage — `Affirm`
Dual-schema carrier under `.pHive/metrics/` (append-only JSONL events + experiment envelopes). Architect's dual-schema pattern is confirmed.

## Q2. Experiment concurrency — `Affirm`
Serial by default across both swarms. Parallel mode gated on hardened isolation.

## Q3. Experiment envelope contract — `Affirm with don't-over-engineer signal`
- **Required fields:** approved as listed (baseline ref, candidate ref, commit/ref, metrics snapshot, policy ref, decision, `rollback_ref`, observation window, `regression_watch`).
- **Threshold policy:** lean — no per-metric asymmetric-tolerance class system unless a concrete use case forces it. Start simple; add complexity only on demand.
- **Delayed-regression handling:** `auto-revert`. If `regression_watch` flags a regression, the system reverts automatically. Do NOT build a three-class system (auto/human/narrow) — one behavior.
- **Closure invariant:** agreed. Cycle cannot close unless commit/ref + metrics snapshot + rollback target are present. Non-bypassable gate blocks ledger append.
- **Do-not-over-engineer signal applies across Q3:** keep the envelope field set minimal, keep the threshold simple, keep rollback behavior unconditional. Push back on any TPM/architect proposal that expands the envelope beyond what Q3 explicitly enumerates.

## Q4. `meta-meta-optimize` isolation — `Worktree default`
Git-worktree isolation required. File-copy sandbox is NOT acceptable for any self-modifying experiment class.

## Q5. `meta-optimize` promotion — `PR-only`
All retained changes leave the system as PR-style artifacts. No direct repo mutation.

## Q6. Operator surface — `Confirmed: one shipped + one local`
- Shipped plugin exposes `/meta-optimize` only. End users get one entrypoint.
- `/meta-meta-optimize` lives in this repo but is NOT in `.claude-plugin/plugin.json`'s public skill surface — maintainer-only local tool.
- Internal shared-lifecycle-library (Epic B-L1) may be used by both, but packaging excludes L2.

## Q7. First `meta-meta-optimize` cycle gating — `Affirm + extend`
No-op proving run affirmed. **User addition:** establish a backlog of candidate improvements that the meta-team can pull from when there isn't enough metrics data to measure improvement directly. This is a fallback mode for the experiment loop — when there's insufficient metric signal to drive optimization, pull from a curated backlog of known improvement candidates instead of idling.

This adds a design surface not previously captured:
- A `meta-backlog.yaml` or equivalent ledger of known-useful optimization targets
- Meta-team reads from backlog when metric-driven mode can't propose anything
- Backlog entries may be human-curated or auto-surfaced from qualitative signals (e.g., insight pipeline patterns)

## Q8. Epic C MVP metric set — `Deferred to orchestrator`
User trusts orchestrator call. Provisional MVP set (5 metrics, to be revised during H/V):
1. Tokens per story (input + output combined; best-effort given SDK visibility)
2. Wall-clock per story (already trivially available)
3. Fix-loop iteration count per story
4. First-attempt review-pass rate (aggregated from episode status)
5. Human escalation count per epic

Rationale: covers one cost, one speed, two quality, one friction — a balanced baseline. Defers cache-hit rate, CodeRabbit fix counts, memory wiki hit rate, trust score trajectory to follow-on work unless TPM/architect strongly object.

## Q9. Historical `.pHive/meta-team/` assets — `Partially migrated`
Selectively migrate useful historical assets into the new references/structure. Archive the rest with a manifest. Do NOT leave old schema assumptions co-existing with new ones in the active state tree.

---

# New directives (not among the original 9 questions)

## Q-new-A. `meta-meta-optimize` does NOT ship
**Decision:** the meta-meta-optimize system stays LOCAL to the plugin-hive repo. It is NOT part of the distributed plugin package. End-user plugin installs get `/meta-optimize` only.

**Implications:**
- Epic B-L2 (meta-meta-optimize) builds in this repo but is not in plugin.json's public surface
- Epic B-L1 (shared lifecycle library) is still useful for internal code reuse across L2 and L3, but L2 never gets bundled
- Plugin-hive maintainers invoke L2 locally; end users never see it
- The worktree-isolation + closure-invariant guarantees still apply for L2 — maintainer-only, not safety-discount

**Scope change magnitude:** meaningful. It simplifies the packaging concern but does NOT simplify the self-corruption risk — L2 still operates on the plugin-hive repo. Worktree isolation and closure gates remain required.

## Q-new-B. Metrics are kickoff-time opt-in
**Decision:** the metrics substrate (Epic C) is user-opt-in at `/hive:kickoff` time. Default OFF. User must explicitly enable during kickoff, with clear explanation that:
- Without metrics, the meta swarm has nothing objective to optimize against
- Meta-team features will fall back to qualitative / backlog-driven mode (per Q7 addition)
- The kickoff UI should present this as a clear choice, not a quiet default

**Implications for Epic C:**
- A new `metrics.enabled: bool` config field (default: false)
- Kickoff skill gets a new elicitation question: "Enable metrics tracking? [explanation]"
- All Epic C hook writes become conditional on `metrics.enabled: true`
- If disabled at kickoff, no-op hooks still run but write nothing — preserves the contract without the carrier cost
- Documentation touchpoints: kickoff UX, meta-optimize skill docs, meta-meta-optimize local docs

**Scope change magnitude:** meaningful but not scope-blowing. Adds ~1-2 stories to Epic C (kickoff integration + conditional-hook plumbing) and ~1 kickoff-skill story.

---

## Q-new-C. Execution split — Codex does the work, Opus 4.7 reviews

**User directive (2026-04-20 H/V gate sign-off):** all implementation work (developer, frontend-developer, backend-developer, tester, pair-programmer) runs on OpenAI Codex. All review work (reviewer, peer-validator) runs on Claude Opus 4.7. The orchestrator (this session) stays on Opus. Researcher stays on Claude Sonnet.

**Applied to `hive/hive.config.yaml`:**
- `agent_backends.developer: codex`
- `agent_backends.frontend-developer: codex`
- `agent_backends.backend-developer: codex`
- `agent_backends.tester: codex`
- `agent_backends.pair-programmer: codex`
- `agent_backends.reviewer: claude` (implicit — omitted from agent_backends, defaults to claude)
- `model_overrides.reviewer: opus`
- `model_overrides.peer-validator: opus`

**Implication for story step definitions (Phase C):** the classic-methodology `review` step agent field should resolve to a Claude Opus reviewer. All other executable steps should resolve to Codex. Haiku test-worker stays Claude for mechanical test execution.

**Cost/quality positioning:**
- Codex implements (cost-efficient, fast)
- Opus 4.7 reviews (highest-quality reasoning) — acts as second-model review to catch things Codex rationalizes
- Matches `feedback_codex_code_review` memory: complementary to CodeRabbit's mechanical coverage

## Q-new-D. H/V sign-off decisions (2026-04-20 user gate)

- NEW Q3 (github_forwarding migration): `(A)` — migrate into new `meta_optimize:` block as `meta_optimize.github_forwarding`. Clean rename fits the control-plane rewrite.
- NEW Q4 (backlog auto-surfacing): `(A)` — human-edit-only MVP. Auto-surfacing from insight pipeline is follow-on.
- NEW Q5 (commit: TBD historical ledger entry): `(A)` — add optional A1.6 MANIFEST audit-note story during archive (TPM's proposed story). Preserves history + flags the integrity break.

**H/V user gate sign-offs (all approve):**
- 10 slices + parallelism pairs: approved
- MVL/MVS split: approved ("we will just be drive all the way to 10" — intent is ship, not early-drop)
- Punt list: approved as-is
- Proceed to Phase B3 structured outline: approved

**B3 user gate sign-offs (2026-04-20):**
- D4 Stop-hook conflict: `Option A` (combined dispatcher in existing `.claude-plugin/plugin.json`). Guardrails required: handler isolation, ordering tests, idempotency, flag-off no-op verification.
- D7 token capture: `Option A reframed` — user intent: "we need to figure out a viable path for token spend.. there has to be a way." Token capture is REQUIRED, not contingent. MVP must not ship without it. S5 must include discovery work identifying the token-capture mechanism (candidates: Claude Code JSONL transcripts at `~/.claude/projects/*/`, PostToolUse hook env vars, SessionEnd hook context, background Agent task output JSONL usage fields). "Allow token metric to become follow-on" is no longer acceptable — Phase C story authoring must treat token discovery as blocking for S5's MVP acceptance.
- D1, D2, D3, D5, D6: restated `Affirm` (already signed off at prior gates).
- Proceed to Phase C: approved.

# Consolidated scope-shift summary for TPM / architect

Since the initial design discussion:
1. `meta-meta-optimize` is local-only — does NOT ship in the plugin package (Q-new-A)
2. Metrics are opt-in at kickoff, default OFF (Q-new-B)
3. Meta-team has a backlog fallback for low-metric periods (Q7 extension)
4. Auto-revert is the ONLY delayed-regression behavior — no class system (Q3 anti-over-engineering)
5. Q6 confirmed: one shipped entrypoint `/meta-optimize` + one local-only `/meta-meta-optimize` (not in plugin.json)

For H/V planning: treat #1 and #2 as scope directives that affect Epic C (kickoff integration slice, conditional hooks) and Epic B (L2 packaging, shared library necessity reassessment). #3 adds a new micro-slice: `meta-backlog.yaml` + meta-team backlog-mode branch. #4 simplifies the envelope. #5 — wait for user confirmation before finalizing B entrypoint structure.

# Authority

User has binding sign-off on Q1, Q2, Q3 (with over-engineering constraint), Q4, Q5, Q6, Q7 (with extension), Q9, Q-new-A, Q-new-B. Orchestrator has delegated authority on Q8.

TPM + architect should NOT propose changes that contradict these decisions during H/V planning without surfacing as an explicit escalation.
