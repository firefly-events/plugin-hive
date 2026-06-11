---
name: greenfield-discovery-brief
description: Author a greenfield discovery brief — capture a new-product discovery conversation into a structured product brief (problem, users, value, MVP scope, constraints, decisions, open questions). Use when the analyst's greenfield-discovery facilitation needs its brief written.
---

# Hive Greenfield Discovery Brief

Capture a **greenfield product-discovery conversation** into a structured brief. The
analyst facilitates the conversation (see `hive/agents/analyst.md` "Greenfield Discovery
Facilitation"); this skill writes the populated brief. Canonical schema:
[`hive/references/document-templates/greenfield-discovery-brief.md`](../../../hive/references/document-templates/greenfield-discovery-brief.md).
This skill makes its fields mandatory.

**Input:** the discovery conversation transcript / analyst notes. `$ARGUMENTS` carries
any product/session context.

## When to use

- A greenfield (new-product) discovery session has produced raw conversation material that must become a structured product brief before planning.

## Mandatory sections (produce in this order — see schema for field requirements)

1. **Problem Statement** — the core problem being solved.
2. **Target Users** — who they are, their context, their need.
3. **Competitive Landscape** — what exists today, how this differs.
4. **Value Proposition** — why this is worth building.
5. **Success Metrics** — measurable outcomes that define success.
6. **MVP Scope** — what the first cut includes (and the line against scope creep).
7. **Technical Constraints** — platform, stack, integration, or policy limits.
8. **Key Decisions Made** — decisions locked during the session, with rationale.
9. **Open Questions** — unresolved items needing a decision before/during planning.
10. **Session Notes** — relevant context, quotes, or signals from the conversation.

## Completeness gate (do not skip)

All 10 sections present. **MVP Scope**, **Success Metrics**, and **Open Questions** are
load-bearing for downstream planning — never omit them. Capture only what the session
produced; mark gaps as `[not covered in session: <what>]` rather than inventing answers.

## Tone & style

Faithful capture, not invention. The analyst facilitated; this structures what was said.
Distinguish decisions made from open questions clearly.

## Output

Write to `.pHive/planning/product-discovery-brief.md` (or as the task specifies).

## What this skill is NOT

- **Not the facilitation.** The analyst runs the conversation; this writes its output.
- **Not a design.** It captures product intent; design and decomposition come later.
- **Not invention.** Do not fill gaps with assumed product decisions — flag them as open.
