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
3. **Verification Plan** (~100 lines) — per-phase automated+manual verification, a coverage matrix, and what is NOT verified + why.
3b. **Cross-Cutting Concerns** (~80 lines) — error handling, migration, rollback, performance, documentation impact, security.
4. **File Change Manifest** (~150 lines) — every CREATE / MODIFY / DELETE / UNCHANGED-but-affected file, real paths only.
5. **Risk Registry** (~100 lines) — table (risk / severity / likelihood / mitigation / owner); detailed mitigation for high-severity risks.
6. **Dependency Map** (~50 lines) — internal + external dependencies + blocking questions.
7. **Elicitation — Stress-Testing the Plan** (~200 lines) — **the most important section.** The team answers adversarial questions about its own plan: Why won't this work? · What assumptions (VERIFIED/ASSUMED/RISKY)? · What's the simplest version? · What will we wish we'd thought of? · Where are we over-engineering?
8. **Decision Points for Sign-Off** (~50 lines) — numbered, actionable decisions the user affirms/changes.
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
Headers, bullets, short paragraphs. Short interface examples only; no full implementation
code. Every file reference is a real path from the research findings. Build on the design
discussion — don't repeat it.

## Output

Write to `.pHive/epics/{epic-id}/docs/structured-outline.md` (or as the task specifies).

## What this skill is NOT

- **Not the design discussion.** That decides direction; this operationalizes it in full detail.
- **Not story YAMLs.** Story decomposition (`story-writing`) consumes this; it does not happen here.
- **Not a stub.** A handful of story headers with acceptance criteria is NOT a structured outline.
