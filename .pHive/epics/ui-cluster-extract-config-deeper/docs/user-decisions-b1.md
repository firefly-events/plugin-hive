# User decisions — Phase B1 (Design Discussion)

**Epic:** `ui-cluster-extract-config-deeper`
**Date:** 2026-05-12
**Source:** user response to design-discussion.md open questions

## Confirmed

**Scale:** medium. **Run H/V planning (Phase B2).** `--fast` NOT applied — Q4=YES expands scope to full D2 closure, which the writer's "--fast" caveat excluded.
**Methodology:** classic.
**Routing:** `agent_backends` per root `hive.config.yaml` — researcher / technical-writer / architect via Codex; tpm direct (Claude). No UI designer on team (meta-epic about the cluster, not consumer UI).

## Q1 — File-per-skill vs aggregate

**Answer:** writer rec accepted. **One file per skill** under `hive/references/ui-prompts/<skill-name>.md`.

Reasoning: W6 precedent (a-08 → `brand-system-schema.yaml`, a-09 → `design-token-spec.md`) extracted one canonical reference per concern. Aggregate file invites accidental cross-coupling.

## Q2 — Path convention (flagged tension)

**Answer:** writer rec accepted: **flat** path `hive/references/ui-prompts/<skill-name>.md`.

**User note:** nested setup (`<skill-name>/ui-prompt.md`) would be easier for humans to navigate per-skill, BUT existing `references/` convention is flat (W6 siblings). Not bucking convention arbitrarily.

**Re-evaluation trigger:** if a future story adds non-prompt artifacts per skill (e.g., `polish-audit/checklist.md`), revisit the flat vs nested convention then. Don't preemptively switch now.

## Q3 — Edit `hive/agents/ui-designer.md`?

**Answer:** writer rec accepted. **No.** Persona file's own boundary at `hive/agents/ui-designer.md:45` already separates persona from execution instructions; F doesn't change it.

## Q4 — Design-review workflow inclusion ⚠️ SCOPE EXPANSION

**Answer:** **YES — full D2 closure.**

Include extraction of the two ui-designer task blocks in `hive/workflows/design-review.workflow.yaml:54` and `:86`. Produce:
- `hive/references/ui-prompts/design-review-design-critique.md`
- `hive/references/ui-prompts/design-review-synthesis.md`

**Scope impact:**
- Files affected: ~10-12 (vs ~8-10 minimum)
- Story count: ~4 (still within audit's `<=4` cap)
- Files modified: 4 SKILLs + 1 workflow YAML
- Files created: 6 prompt files in `hive/references/ui-prompts/`
- H/V planning runs (no `--fast`)

**Why:** closes D2 dissent fully in one shot. Avoids tiny follow-on story for workflow extraction. Worth the H/V cycle.

## Q5 — Brand/design still need prompt-body extraction?

**Answer:** writer rec accepted. **Yes — still extract.**

W6 a-08/a-09 extracted **config/schemas** (`brand-system-schema.yaml`, `design-token-spec.md`), not task prompts. Task prompts still inline at `skills/brand-system/SKILL.md:32` + `skills/design-system/SKILL.md:42`. Audit explicitly says "extract ui-designer prompts" → these are in scope.

## Q6 — SKILL → prompt loading convention

**Answer:** writer rec accepted. **Direct SKILL load.** Each SKILL reads `hive/references/ui-prompts/<name>.md` and passes content to ui-designer spawn. No new routing layer; no agent-spawn convention extension in this epic.

Reasoning: W6 precedent. Agent-spawn convention extension = bigger surface = separate epic if needed later.

## Q7 — polish-audit conditional ui-designer?

**Answer:** writer rec accepted. **Always required.** Optional ui-designer mode is behavior change, not extraction. Epic F is extraction only.

## Q8 — Preserve text vs normalize formats

**Answer:** writer rec accepted. **Preserve current markdown/task text first.**

W6 acceptance criteria emphasized byte-equivalent behavior. Move now; normalize later (separate epic if needed).

## Open items routed into Phase B2

- TPM owns story-count cut: ~4 stories, likely 1 per Tier given homogeneous extraction work; could be:
  - S1: extract brand-system + design-system prompts (already partial W6)
  - S2: extract polish-audit + visual-qa prompts (the 2/5 unextracted)
  - S3: extract design-review workflow prompts (full D2 closure addition from Q4)
  - S4: verification + grep gates + line-count proof
- Architect re-validates: direct-SKILL-load pattern doesn't accidentally duplicate prompt-loading boilerplate across 4 SKILLs (Mattpocock-style atomicity check)
- Writer adds `Required placeholders` callout to each prompt file (per Risk #5 mitigation in DD)

## Routing for Phase B2

- **TPM** → direct/Claude (owns H/V cut)
- **technical-writer** → codex (produces horizontal-plan.md, vertical-plan.md)
- **architect** → codex (feasibility + Mattpocock atomicity check)
- **researcher** → codex on-call (only if H/V uncovers gaps)

Collaborative review gate runs on H/V output (default `collaborative_review: true`).
