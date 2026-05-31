---
name: research-brief
description: Author a research brief — synthesize raw research findings into a structured brief for planners. Use when a researcher's raw output must become an actionable brief with key files, patterns, constraints, risks, and open questions.
---

# Hive Research Brief

Synthesize a researcher's raw findings into a **structured brief** that a planner
or architect can act on without re-reading the source material. Organize, don't
editorialize — the brief surfaces what was found and what it implies for the
work, not new conclusions.

**Input:** `$ARGUMENTS` plus upstream researcher raw findings (codebase
excerpts, external sources, observations).

## When to use

- A research phase has produced raw findings that need shaping for planning.
- A planner needs a single digest of "what exists, what constrains us, what's unknown".

This formalizes the research-brief pattern the technical-writer persona previously
carried only in memory.

## Sections (produce in this order)

1. **Summary** — 2-4 sentences: what was investigated and the headline finding.
2. **Key files & surfaces** — the files, modules, or endpoints that matter, each with a one-line note on its role. Path in backticks.
3. **Patterns & conventions** — how the relevant code/system already does things, that the work should follow or reckon with.
4. **Constraints** — hard limits the work must respect: APIs, invariants, compatibility, performance, policy.
5. **Risks** — what could make the work harder or go wrong, with severity if known.
6. **Open questions** — unresolved items needing a decision before or during planning.
7. **Recommendation (optional)** — a brief suggested direction, clearly marked as the writer's synthesis, only if the task asks for it.

## Tone & style

- Audience is a planner/architect. Dense, scannable, evidence-backed.
- Cite the surface (file/source) behind each non-obvious claim.
- Structure raw data; do not invent findings. Commentary beyond synthesis belongs in the insight-capture step, not the brief.

## Output

One brief per task. Default path: `.pHive/epics/{epic-id}/docs/research-brief.md`,
or as the task specifies.

## What this skill is NOT

- **Not raw research.** The researcher gathers; this brief structures. Do not re-run research.
- **Not a design.** Recommendations are brief and optional; full design is `architecture-doc`.
- **Not opinion.** Synthesize the findings; flag gaps rather than filling them with guesses.
