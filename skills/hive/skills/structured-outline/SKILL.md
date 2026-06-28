---
name: structured-outline
description: Author a structured outline — expand an approved design discussion + H/V plans into the detailed ~1000-line blueprint that makes story decomposition mechanical. Use when a large-scope plan needs its full structured outline (executive summary, detailed approach, verification, risk registry, and adversarial elicitation) before stories are written.
---

# Hive Structured Outline

Produce the **detailed implementation blueprint** — specific enough that story
decomposition becomes mechanical rather than creative. The canonical structure is
[`hive/references/document-templates/structured-outline.md`](../../../hive/references/document-templates/structured-outline.md);
this skill makes that structure **mandatory**, not optional. A structured outline
that drops sections is not a shorter outline — it is an incomplete one.

**Input:** the approved design-discussion document, the horizontal + vertical plans,
user feedback/sign-off on the design, and the original research findings. `$ARGUMENTS`
carries the epic id and any scope notes.

## When to use

- A large-scope `/plan` run has passed the design gate and H/V review and needs the
  full outline before story YAMLs are written.
- Any time the writer is asked to produce a `structured-outline.md`.

## Mandatory sections (produce in this order — see template for the detail of each)

1. **Executive Summary** (~50 lines) — what/why, how feedback changed the approach, locked decisions, strategy in 3-5 sentences.
2. **Detailed Approach** (~300 lines) — per phase: Changes (per file), Interfaces, Validation.
3. **Verification Plan** (~100 lines) — per-phase automated+manual verification, a coverage matrix, and what is NOT verified + why. Each per-phase entry may include an optional `<figure>` slot for a wireframe thumbnail; follow the wireframe discovery protocol in `hive/references/planning-format-contract.md §5` (use `<figure data-placeholder="...">` when no approved wireframe exists).
3b. **Cross-Cutting Concerns** (~80 lines) — error handling, migration, rollback, performance, documentation impact, security.
4. **File Change Manifest** (~150 lines) — every CREATE / MODIFY / DELETE / UNCHANGED-but-affected file, real paths only.
5. **Risk Registry** (~100 lines) — table (risk / severity / likelihood / mitigation / owner); detailed mitigation for high-severity risks.
6. **Dependency Map** (~50 lines) — internal + external dependencies + blocking questions. Render as a fenced `mermaid` block using `graph TD` per `hive/references/planning-format-contract.md §3`; do not use ASCII art or plain-text dependency lists. Include `accTitle` and `accDescr` directives at the top of the block (e.g. `accTitle: Dependency Map\naccDescr: Internal and external dependencies for this plan`).
7. **Elicitation — Stress-Testing the Plan** (~200 lines) — **the most important section.** The team answers adversarial questions about its own plan: Why won't this work? · What assumptions (VERIFIED/ASSUMED/RISKY)? · What's the simplest version? · What will we wish we'd thought of? · Where are we over-engineering? **For "Why won't this work?", each failure mode is a reasoned paragraph with explicit `Failure:` / `Trigger:` / `Impact:` / `Signal:` / `Our answer:` — not a flat bullet list of one-liners.**
8. **Decision Points for Sign-Off** (~50 lines) — split into **two groups, not one flat numbered list:** (a) **Decisions already locked** — settled at the design gate or standing policy (storage choice, audits, hard-bail, isolation policies); affirmed as a group, never re-asked. (b) **Open decisions** — each leads with a **recommended default + one-line rationale + an override** ("Default: X (why). Override for Y."), and **★-flag only the few that genuinely need a fresh judgment call.** Do NOT cast process commitments or already-approved design-gate forks as open decisions, and do not enumerate every implementation micro-choice — a 20-item cold-decision list is a defect. End with a one-line "affirm the locked group, accept the defaults, weigh in on the ★ items" net.
9. **Multi-Epic Coordination** — OPTIONAL; include only when the plan crosses epic boundaries.

## Completeness gate (do not skip)

Before handing off, self-check: **every mandatory section (1–8, plus 3b) is present and
non-empty.** Part 7 (Elicitation) and Part 5 (Risk Registry) are the sections most often
dropped and are explicitly required — an outline without adversarial elicitation or a
risk registry is **incomplete and must not be handed off.** Target **~1000 lines
(800–1200)**. If the upstream inputs genuinely don't cover a section, write
`[data not provided: <what's missing>]` under that heading rather than omitting it — a
visible gap is a signal; a missing section is a defect.

## Tone & style

Precise and structured but readable — an engineer's blueprint, not a legal contract.

**Prose discipline (do not skip).** Write analysis and reasoning as **short paragraphs**,
like a senior engineer explaining the plan. Reserve bullet points for genuine enumerations
(file lists, option lists, criteria) — **do not render analysis, mitigations, or
elicitation answers as flat bullet fragments.** A structured outline that is wall-to-wall
bullets is a defect even if every section is present: it reads as a checklist, not a plan.
Detailed mitigations (Part 5) and "Our answer" (Part 7) are multi-sentence paragraphs, not
one-liners. (Codex/code-model writers tend to bullet-dump — this section exists to counter
that; prose-heavy planning docs are best authored by a Claude model.)

Short interface examples only; no full implementation code. **Preserve every `file:line`
citation from the inputs** — they make downstream story decomposition mechanical; dropping
them to "simplify" is a regression. Every file reference is a real path from the research
findings. Build on the design discussion — don't repeat it.

## Output

Write to `.pHive/epics/{epic-id}/docs/structured-outline.md` (or as the task specifies).

After writing the markdown file, invoke the sidecar HTML generator to produce a `.html` sibling for browser preview:

```
python -m hive.lib.html_sidecar_gen ".pHive/epics/{epic-id}/docs/structured-outline.md"
```

The generator is non-blocking — if it fails, log a warning and continue. The `.html` file is not committed to git by default (generated on-demand).

After writing the markdown file, record token metrics:

```
lib/doc-token-telemetry recordDocWrite({ docPath: ".pHive/epics/{epic-id}/docs/structured-outline.md", epicId: "{epic-id}", docType: "structured-outline", format: "md" })
```

The probe is non-blocking — if it fails, log a warning and continue.

## What this skill is NOT

- **Not the design discussion.** That decides direction; this operationalizes it in full detail.
- **Not story YAMLs.** Story decomposition (`story-writing`) consumes this; it does not happen here.
- **Not a stub.** A handful of story headers with acceptance criteria is NOT a structured outline.
