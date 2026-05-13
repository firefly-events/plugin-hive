# TPM Sequencing Memo — Epic F Phase B2

> **Epic:** ui-cluster-extract-config-deeper
> **Phase:** B2 (TPM sequencing)
> **Persona:** tpm
> **Inputs:** design-discussion.md, user-decisions-b1.md (Q4=YES), research-brief.md, research-findings.md, Epic B W6 stories (a-08, a-09, a-11)
> **Audience:** writer (next phase) — produces horizontal-plan.md + vertical-plan.md from this memo
> **Story cap:** `<=4` (per audit recommendation §395)

---

## Horizontal layers

Four layers cover the cluster surface. They are not strict architectural tiers (this is a markdown/YAML refactor) but they cleanly partition the changes the writer must sequence.

### L1 — Prompt reference directory convention (new)

**Description.** Establishes `hive/references/ui-prompts/` as the canonical home for ui-designer task prompts loaded by procedural SKILLs and workflow steps. Per Q1/Q6, one file per skill, direct SKILL load (no new routing layer). Per Risk #5 mitigation, every prompt file gets a `Required placeholders` header.

**Touched paths (new files only):**
- `hive/references/ui-prompts/brand-system.md`
- `hive/references/ui-prompts/design-system.md`
- `hive/references/ui-prompts/polish-audit.md`
- `hive/references/ui-prompts/visual-qa.md`
- `hive/references/ui-prompts/design-review-design-critique.md`
- `hive/references/ui-prompts/design-review-synthesis.md`

**Cross-layer deps.** L2, L3 cite L1 paths; L1 must exist before any SKILL/workflow citation can resolve.

### L2 — SKILL body reduction (load → cite → inject → spawn → capture)

**Description.** Replace the inline `Spawn a subagent with the full ui-designer persona and this task:` blocks in the four direct SKILLs with the W6 substrate pattern: load the extracted prompt file, cite it, inject placeholders, spawn ui-designer, capture insights. Per Q8, prompt body text moves byte-equivalent on first extraction.

**Touched paths:**
- `skills/hive/skills/brand-system/SKILL.md` (block at `:32-67`)
- `skills/hive/skills/design-system/SKILL.md` (block at `:42-58`)
- `skills/hive/skills/polish-audit/SKILL.md` (block at `:85-115`)
- `skills/hive/skills/visual-qa/SKILL.md` (block at `:49-97`)

**Cross-layer deps.** Requires L1 destination files to exist. Independent of L3 (workflow path uses the same convention but via a different invoker — `skills/hive/skills/design-review/SKILL.md`).

### L3 — Workflow file extraction (D2 full closure, Q4=YES)

**Description.** Extract the two `task:` blocks in `hive/workflows/design-review.workflow.yaml` (`:54-84` design-critique step, `:86-117` synthesis step) to prompt files and replace inline task content with citation. Same convention as L2 but the invoker is the workflow YAML consumed by `design-review/SKILL.md:95`.

**Touched paths:**
- `hive/workflows/design-review.workflow.yaml` (two task blocks)

**Cross-layer deps.** Requires L1 destination files (`design-review-*.md`) to exist. Otherwise independent of L2 — different file class, no shared lines.

### L4 — Verification + grep gates

**Description.** Codify the DD §8 verification plan as concrete grep gates plus line-count deltas (per W6 a-08/a-09 `Net line delta >= -85 lines` / `>= -50 lines` precedent). Provides regression-catching CI signal so future SKILL edits that re-inline prompts get caught.

**Touched paths:**
- Verification commands documented in story `acceptance_criteria`
- Optional: a small `scripts/verify-ui-prompts-extraction.sh` if writer + architect agree it pays off (DD §8 specified `rg` checks only — keep it simple)

**Cross-layer deps.** Runs against L1/L2/L3 outputs; must come last.

---

## Vertical slices

Four thin slices, each leaves the repo in a working state. Matches audit's `<=4` cap exactly. Each slice's "working state" means: the SKILL still spawns ui-designer correctly, the workflow still executes, and any extracted prompts are loadable. Byte-equivalent moves (Q8) ensure no behavior change.

### S1 — Convention establishment on W6-precedent pair (Tier 1)

**Goal.** Prove the `hive/references/ui-prompts/` convention end-to-end on the two SKILLs that already have partial W6 extraction (schema/spec), so the new pattern is grounded in established W6 substrate before extending it.

**Working state at end of slice.**
- `hive/references/ui-prompts/` directory exists with `brand-system.md` and `design-system.md`.
- `skills/hive/skills/brand-system/SKILL.md` and `skills/hive/skills/design-system/SKILL.md` cite the new prompt files via the load → cite → inject pattern.
- Both SKILLs still spawn ui-designer and still produce their existing artifacts (`.pHive/brand/brand-system.yaml`, W3C token JSON).
- Net SKILL line delta is negative (delta target: ~-30 to -45 lines per SKILL — smaller than W6 a-08's `-85` because prompt blocks here are shorter than the full schema).

**Stories included.** 1 story covering both SKILLs together. Rationale: identical extraction pattern, both already share W6 sibling-story precedent (a-08 + a-09 are split because schema vs token-spec are different config classes; here the work is the same prompt-extraction motion twice). Folding them keeps the slice count at 4.

**Topic-area name (canonical ID at plan step 11).** `f-01-prompt-convention-brand-design`

**depends_on (slice-level).** None — this slice introduces the convention.

**Tier.** Tier 1 — MVP slice. Establishes the substrate convention; if this fails (e.g., direct SKILL load doesn't work cleanly), every subsequent slice is at risk.

**Notes for writer.**
- Cite W6 a-08/a-09 precedent in story `context.precedent` field.
- Story description should call out the `Required placeholders` header convention so the writer's prompt files are uniform.
- This is the slice where the convention is "born" — give it the most detail in `acceptance_criteria` (file existence, citation text, placeholder header presence, line delta, ui-designer still spawned).

---

### S2 — Full SKILL cluster coverage (Tier 2)

**Goal.** Apply the proven convention to the two SKILLs that haven't yet had any W6 work (polish-audit + visual-qa — these are the "2 of 5" the research-findings called out, with inline report formats still present per DD §3). Closes D2 dissent for direct SKILLs.

**Working state at end of slice.**
- All four direct SKILLs now thin-invocation: brand-system, design-system, polish-audit, visual-qa cite `hive/references/ui-prompts/*.md`.
- `hive/references/ui-prompts/polish-audit.md` and `visual-qa.md` exist.
- polish-audit still always invokes ui-designer (Q7 — no conditional behavior change in this epic).
- Each SKILL still spawns ui-designer with intact placeholder injection (`{animation_opportunities}`, `{prior_verdict}`, `{brief_path}`, `{story_id}`, etc.).
- Larger line deltas here (polish-audit block is ~30 lines, visual-qa is ~48 lines per research-findings F).

**Stories included.** 1 story covering both SKILLs. Same rationale as S1 — homogeneous motion, fits in one developer execution.

**Topic-area name.** `f-02-prompt-convention-polish-visual-qa`

**depends_on (slice-level).** S1 — must consume the established convention.

**Tier.** Tier 2 — extends Tier-1 substrate to the remaining direct-SKILL surface. Same risk profile as S1 but with proven convention.

**Notes for writer.**
- visual-qa block is the largest (`:49-97` = ~49 lines) — flag this to developer as the highest line-count payoff.
- polish-audit's ui-designer block at `:85-115` lives inside a procedural flow with conditional skip-on-gate logic; the SKILL invocation flow must be preserved (W6 pattern: extract the *prompt*, not the *flow*).
- Q7 reaffirmed: polish-audit always invokes ui-designer. No conditional invocation change.

---

### S3 — Workflow extraction (D2 full closure, Q4=YES) (Tier 2)

**Goal.** Extract the two ui-designer task blocks from `hive/workflows/design-review.workflow.yaml` to prompt files. This is the addition from Q4=YES — without it, D2 dissent is only partially closed (the workflow-mediated path still contains inline prompts).

**Working state at end of slice.**
- `hive/references/ui-prompts/design-review-design-critique.md` and `design-review-synthesis.md` exist.
- `hive/workflows/design-review.workflow.yaml` `:54` and `:86` task blocks replaced with prompt-file references using the same convention as L2 SKILLs (verbatim text preservation per Q8).
- `skills/hive/skills/design-review/SKILL.md:95` — the substrate that "passes workflow `task` content to spawned agents" — continues to work; it reads task content from workflow YAML, which now reads from the prompt file.
- Implementation note: writer should call out that the workflow YAML loader either (a) inlines a `task_file:` field that the runtime resolves, or (b) keeps the `task:` field with citation-only content. Architect should validate which form preserves byte-equivalent behavior; W6 precedent suggests (b) — citation in YAML scalar with the prompt content held in markdown — but the workflow runtime may demand (a). **Flag for writer to surface to architect at H/V review.**

**Stories included.** 1 story.

**Topic-area name.** `f-03-workflow-prompt-extraction-design-review`

**depends_on (slice-level).** S1 — uses the established convention. Independent of S2.

**Tier.** Tier 2 — same convention applied to a different invoker class (workflow YAML vs procedural SKILL). Slight runtime nuance (see implementation note above) makes this riskier than S2 by a hair.

**Notes for writer.**
- Cite the research-findings Section F observation about cross-cutting substrate: `skills/hive/skills/design-review/SKILL.md:95` is what makes the workflow path work.
- Acceptance criteria must include: design-review skill end-to-end still executes for both `--artifact-target design` and `--artifact-target implementation` (the a-11 collapse mode).
- Flag the YAML `task:` vs `task_file:` runtime question to architect during H/V review.

---

### S4 — Verification + grep gates (Tier 2)

**Goal.** Codify the DD §8 verification plan as enforceable acceptance criteria. Prove no inline prompt blocks remain anywhere in the D2 cluster surface, assert SKILL line-count drops, and document grep commands future contributors can run to catch regressions.

**Working state at end of slice.**
- Grep gate 1 (no inline blocks): `rg "Task for ui-designer|Spawn a subagent with the full ui-designer persona" skills/hive/skills/{brand-system,design-system,polish-audit,visual-qa}/SKILL.md` returns zero matches.
- Grep gate 2 (citation present): `rg "hive/references/ui-prompts/" skills/hive/skills/{brand-system,design-system,polish-audit,visual-qa}/SKILL.md` returns 1 match per SKILL (4 total).
- Grep gate 3 (workflow citations): `rg "hive/references/ui-prompts/design-review-" hive/workflows/design-review.workflow.yaml` returns 2 matches.
- Aggregate SKILL line delta documented in story (sum of S1+S2 reductions).

**Stories included.** 1 story.

**Topic-area name.** `f-04-prompt-extraction-verification-gates`

**depends_on (slice-level).** S2, S3 — both substantive extraction slices must be done before verification runs.

**Tier.** Tier 2 — quality gate, not a new behavior. Could in principle fold into S3's acceptance criteria, but separating it gives a clean "verification only" story that documents the grep commands as a regression-catching artifact future Hive contributors can grep for.

**Notes for writer.**
- Concrete grep commands (per scope-locked verification protocol in user prompt) must be embedded in `acceptance_criteria`.
- This story is the only place where "did the refactor actually happen" gets enforced — if S4 is dropped or stub-implemented, future SKILL edits can silently re-inline prompts and no one notices.
- Architect should validate that `skills/hive/skills/` path prefix is correct (research-findings used both `skills/brand-system/` and `skills/hive/skills/brand-system/` interchangeably — confirm absolute path on disk).

---

### Justification for not cutting differently

- **Fold S4 into S2/S3?** Considered. Rejected because a dedicated verification story is the single point future contributors will grep for when asking "did we already do this?" — folding loses that signal. Also, S4 is the natural place for the line-delta aggregate assertion that spans S1+S2 outputs.
- **Split S2 into two stories (polish-audit vs visual-qa)?** Considered. Rejected because the audit cap is `<=4` and the work is homogeneous; splitting consumes a story slot that S3+S4 actually need.
- **Fold S1+S2 into one "all four SKILLs at once"?** Considered. Rejected because S1 establishes the convention on the W6-precedent pair; if convention design has a flaw, it surfaces on smaller-surface SKILLs first. Two slices = debuggability (per TPM persona: "If a bug appears, it was introduced in the current slice, not some unknown prior one").

---

## Cross-cutting concerns

Per-story map. None of these escalate; all are minor or N/A.

| Story (topic-area) | documentation | observability | security:plan-audit | dependency:version-gate | performance:audit |
|---|---|---|---|---|---|
| f-01-prompt-convention-brand-design | YES — refactor + new convention | N/A | N/A | N/A | N/A |
| f-02-prompt-convention-polish-visual-qa | YES — refactor | N/A | N/A | N/A | N/A |
| f-03-workflow-prompt-extraction-design-review | YES — refactor | N/A | N/A | N/A | N/A |
| f-04-prompt-extraction-verification-gates | YES — documents grep commands as durable regression signal | minor — adds CI-style grep signal | N/A | N/A | N/A |

**No ESCALATION_FLAGS block raised.** This is a clean markdown/YAML refactor with W6 precedent. No auth/secrets, no external dependencies, no runtime perf impact, no library version gates.

**`backward-compatibility` (W6 a-11 precedent).** Not formally flagged but worth a callout in every story's `cross_cutting` block: ui-designer must still be spawned and still produce the same artifacts. Byte-equivalent text move (Q8) handles this by construction; acceptance criteria should assert it.

---

## Open items for writer

The writer should amplify these in horizontal-plan.md and vertical-plan.md:

1. **YAML `task:` vs `task_file:` runtime nuance (S3).** Architect must validate which form the workflow runtime accepts. Writer should leave a placeholder in S3's `acceptance_criteria` and flag it as an open architectural question for H/V review.
2. **`Required placeholders` header convention (per Risk #5).** Writer must spec the exact header format (e.g., `## Required placeholders\n\n- {animation_opportunities}\n- {prior_verdict}\n...`) so all six prompt files are uniform.
3. **SKILL path prefix verification.** Research-findings used `skills/brand-system/` and `skills/hive/skills/brand-system/` interchangeably. Writer should confirm the on-disk path and use it consistently across all four stories.
4. **Line-delta targets.** S1 ~-30 to -45 lines/SKILL; S2 ~-30 (polish-audit) and ~-49 (visual-qa); writer should refine these with `wc -l` of the actual blocks during plan step 11.
5. **Slice dependency overlay.** S1 → {S2, S3} → S4. Linear-ish; S2 and S3 are parallelizable but the audit cap and developer-attention budget suggest serial execution.
6. **Mattpocock-style atomicity note (DD §10).** Architect's Phase B2 task is to verify direct-SKILL-load doesn't duplicate prompt-loading boilerplate across 4 SKILLs. If it does, S1's convention should factor the load step into a shared helper before S2 inherits it. Writer should leave this hook open in S1's plan.

---

## Story count refinement

**Locked at 4 stories.** Matches audit's `<=4` cap exactly. DD estimated 3-4; Q4=YES pushes to 4 (the workflow extraction would otherwise live as a tiny follow-on story). Tier roll-up: 1 Tier-1 (S1) + 3 Tier-2 (S2, S3, S4).

Confirms DD §9 "Scale assessment" (small epic, single specialist) and respects the audit's `<=4` cap.

---

## Risk re-check vs DD §5

| DD risk | Slice that addresses it | Notes |
|---|---|---|
| Medium: prompt drift between SKILLs | S1, S2, S3 | Q8 byte-equivalent text move; acceptance criteria assert text preservation |
| Medium: conditional invocation breaks polish-audit | S2 | Q7 reaffirms always-invoke; acceptance criteria assert ui-designer still spawned unconditionally |
| Medium: reader confusion on persona-vs-prompt split | S1 | `Required placeholders` header + short "task prompt content, not agent persona" header per DD §5 mitigation |
| Low: workflow scope expands story count | S3 | Q4=YES locked at 1 story; matches audit cap |
| Low: extracted files hide required variables | S1 | `Required placeholders` header convention established in the first slice; inherited by S2, S3 |

No new risks surface from slice cuts. The S3 YAML `task:` vs `task_file:` runtime nuance is the closest thing to a fresh risk; it's flagged for architect review, not raised as a planning escalation.
