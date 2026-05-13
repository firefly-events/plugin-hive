# User decisions — Phase B1 (Design Discussion)

**Epic:** `sandcastle-adoption-followon`
**Date:** 2026-05-12
**Source:** user response to design-discussion.md open questions

## Confirmed

**Scale:** medium-large (Phase B2 H/V runs; B3 structured outline skipped).
**Methodology:** classic.
**Routing:** `agent_backends` per root `hive.config.yaml` — researcher / technical-writer / architect via Codex; tpm direct (Claude). UI designer not on team (no UI surface).
**Pre-story decisions (R-A, R-B) locked from architect review:** dedicated `/hive:sandbox-setup` skill + in-Hive logger redaction wrapper. Both Tier-1 hard prereqs.

## Q1 — Mode enum spelling

**Answer:** `sandcastle`.
**Lock:** `execute-dispatch.mode_decision` gains 5th value `sandcastle` (architect-corrected; existing 4 are `sessions | team | team-cmux | sequential`). Provider-neutral renaming (`sandbox`) revisited only when a second sandbox provider lands; not deferred-deferral, just YAGNI.

## Q4 — Hook scope (elaborated)

**Answer:** minimal `host.onWorktreeReady` only for first slice.

**Elaboration:**
- **Wired in V1:** exactly one hook point — `host.onWorktreeReady`. Used to invoke `copyToWorktree` for: persona files, memory directory paths, in-worktree config snapshot. Single command list, no per-story overrides, no `sudo`, no `cwd` (per Sandcastle `HostHookCmd` contract).
- **Deferred until a real consumer story emerges:** `host.onSandboxReady` and `sandbox.onSandboxReady`. No speculative YAML template work, no pre-canned hook lists. Story authors that need the deferred points author them then.
- **Why:** prevents shipping config surface area with no consumers. The auth-setup skill (R-A) handles `auth.json` mount semantics independently — does NOT need `sandbox.onSandboxReady` wired in V1.
- **Doc story implication:** hooks reference doc covers only the one wired point; a "minimal hooks scope" section explains the deferral rationale.

## Q5 — #191 tracking shape (elaborated)

**Answer:** explicit defer-marker story, TPM Tier-3.

**Elaboration:**
- **Story scope (small but distinct):**
  1. Create `.pHive/upstream-watch/sandcastle-191.md` — link to upstream issue, current behavior, what unblocks when upstream merges, owner.
  2. Add audit check (extend existing `hive/scripts/gate-mode-audit.mjs` pattern or new lightweight script) that fails if any Hive code path wires `claudeCode()` lane via Sandcastle while #191 is open.
  3. Add project memory entry pointing at the watch file.
- **Why this beats "watch-only via memory":** memory entries decay; rediscovery during a future Claude-code execution story would cost more than the small upfront story. Audit check makes the constraint enforceable, not aspirational.
- **Status flip plan:** when upstream resolves, dedicated cleanup story removes the audit gate, updates memory, archives the watch file.

## Q6 — Sidecar bundle interaction (elaborated)

**Answer:** Sandcastle execution mode does NOT consume or produce sidecar bundles in V1. Neutral — neither dependency nor blocker.

**Elaboration:**
- **No grounded consumer use case yet.** Epic A W5 sidecar bundle work is still consolidating shape; binding Sandcastle to a moving contract would force re-cuts.
- **Forward-compat seam (zero code, contract only):** `field_sources` extension keeps `execution_mode` tracked field cleanly attributable. A future story (post-Epic A W5 ship) can add `sidecar_bundle_path` as a separate tracked field without re-touching `execute-mode-sandcastle/SKILL.md`. Architect-confirmed `field_sources` is extension-friendly.
- **Logger redaction wrapper (R-B) is local to the mode** — does not flow into sidecar bundle stream. If sidecar bundles later need redaction-tagged log spans, that's a sidecar-side feature, not a Sandcastle obligation.
- **Phase B2 implication:** no horizontal layer for sidecar integration; no vertical slice depends on Epic A W5 landing. Re-evaluation tag in audit/cycle-state, not in this epic.

## Q7 — Placement (elaborated)

**Answer:** **post-2.0.** This epic ships AFTER `dev/hive-2.0` integration branch merges.

**Elaboration:**
- **2.0 milestone unchanged:** Epic A (catalog hygiene + borrows), Epic B (structural refactor + gate lift, MERGED via PR #62), Epic C (Adapter ABI). Sandcastle = Epic D.
- **Cost of folding into 2.0 (rejected):**
  - Epic A gate extended by 8-10 unrelated stories (substrate work doesn't belong to catalog hygiene).
  - Epic C Adapter ABI start coupled — adapter contracts would need to absorb Sandcastle `branchStrategy.branch` semantics before Epic C scoped them independently.
  - Branch lifetime stretches, rebase debt grows on `dev/hive-2.0`.
- **Cost of planning now / shipping later (accepted):**
  - Plan + author stories now while research is fresh, while spike findings are in working memory.
  - Branch `feat/sandcastle-adoption-followon` stays alive on top of `dev/hive-2.0`; rebases as Epic A / C land.
  - Stories can land incrementally after 2.0 ship — Tier-1 (auth + redaction) first, mode SKILL next, hooks + docs + warm-pool defer markers in order.
- **Soft Epic C synergy:** if `branchStrategy.branch` gets wired into Adapter ABI as a tracked surface, that's a follow-on adapter story, not coupled into this epic. Sandcastle stays mode-layer; Epic C stays adapter-layer. Bridge story authored only on demand.

## Open items routed into Phase B2

- TPM owns story-count refinement (current estimate 8-10 + 1 defer-marker = 9-11).
- Hooks reference doc scope confirmed minimal; doc-story split (likely 2 docs stories) re-validated against actual content volume in vertical-plan.
- Architect re-runs feasibility on `wt.close()` ownership rule against post-PR-#62 worktree paths to ensure no double-ownership with `.claude/worktrees/{story-id}`.

## Routing for Phase B2

Per root `hive.config.yaml`:
- **researcher** → codex (raw findings if H/V uncovers gaps)
- **technical-writer** → codex (produces horizontal-plan.md, vertical-plan.md)
- **architect** → codex (technical feasibility on slice boundaries)
- **tpm** → direct/Claude (owns the H/V cut)

Collaborative review gate runs on H/V output (planning.collaborative_review = true by default — confirm before dispatch). Medium-large scope; **no --fast, no --gate-hv** received — default rules apply: H/V gate present at large; medium-large defaults to gate-present per scope.
