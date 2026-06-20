---
name: planning-classification
description: Classify an incoming requirement into work-type tags, resolve the planning roster from the composition catalog, and apply the project gate. Invoked by /plan at step 1. Returns assembled_personas (handed to planning-routing) and a classification object (handed to the provenance writer).
---

# Hive Planning Classification

Atomic skill. Invoked by `/plan` at step 1 — before `planning-routing` assembles the team.
It classifies the requirement into work-type tags, reads `planning_composition` from
`hive/references/specialist-triggers.md`, applies the project gate from the profile, and
returns the resolved planning roster plus classification provenance.

This skill is a **pure function** of (requirement, catalog, profile). It does not spawn
agents, write files, or mutate state. All side-effects live in the caller (`/plan`).

## Invocation contract

Call once per `/plan` invocation, before `planning-routing`.

**Inputs:**
- `requirement_summary` — concise (1–3 sentence) description of what is being planned.
- `project_profile_path` — path to the project's `.pHive/project-profile.yaml`
  (used to evaluate `project_gate`). Pass `null` when profile is unavailable; the skill
  uses the conservative default (see Step 3).

**Outputs:**
- `assembled_personas` — ordered list of persona slugs: spine members first, then
  specialists in tag-match order, deduped. Pass this list unchanged to `planning-routing`.
- `classification` — structured provenance object:
  ```yaml
  tags: [<matched work-type tags>]
  per_tag_reasoning:
    <tag>: "<one sentence: why this tag was matched>"
  confidence: matched | low
  gate_decisions:
    <tag>: included | suppressed-no-ui | suppressed-unknown-ui
  ```

Pass `assembled_personas` to `planning-routing` as the pre-assembled team list.
Pass `classification` to the provenance writer (D4 — `epic.yaml` `planning_team:` block).

---

## Process

### Step 1: Read the catalog

Read `hive/references/specialist-triggers.md`. Extract the `planning_composition` section:

```yaml
planning_composition:
  spine: [researcher, technical-writer, tpm]
  work_types:
    - tag: architecture
      specialists: [architect]
      project_gate: ~
    - tag: ui
      specialists: [ui-designer]
      project_gate: requires_ui
    - tag: security
      specialists: [security-reviewer]
      project_gate: ~
    - tag: performance
      specialists: [performance-reviewer]
      project_gate: ~
    - tag: accessibility
      specialists: [accessibility-specialist]
      project_gate: requires_ui
    - tag: data
      specialists: [architect]
      project_gate: ~
```

The **tag vocabulary** is exactly the set of `tag:` values in this section. Do not invent
tags outside this vocabulary. Do not use tags from the escalation `Catalog` section.

### Step 2: Classify the requirement

Analyze `requirement_summary` against the tag vocabulary. For each tag, decide:
**match** (the requirement meaningfully involves this work type) or **no-match**.

Classification rules:
- Match `architecture` when: new service, new module, API design, cross-system integration,
  significant structural change, or the word "architecture" / "infra" / "system design" appears.
- Match `ui` when: new screens, UI components, visual design, frontend flows, wireframes,
  layout, user-facing interactions, or design review is mentioned.
- Match `security` when: auth, secrets, permissions, authorization, encryption, PII, input
  validation, session handling, or audit/compliance concerns appear.
- Match `performance` when: latency, throughput, caching, query optimization, scalability,
  load testing, or "performance" / "perf" appears.
- Match `accessibility` when: a11y, WCAG, screen reader, keyboard navigation, color contrast,
  or "accessibility" appears.
- Match `data` when: database schema changes, new data model, migration, data pipeline,
  storage decisions, or "data model" / "schema" / "migration" appears. Note: data routes to
  `architect` in planning, same specialist as `architecture` — if both match, `architect`
  appears once in the deduped roster.

**Confidence:**
- `matched` — at least one tag matched with clear textual evidence.
- `low` — no tag matched, or evidence is weak/ambiguous. Use `low` when uncertain; the
  spine is self-sufficient and specialists only augment.

If `confidence = low`, emit an empty `tags: []` and return the spine as `assembled_personas`.
Do not force a tag match when the evidence is weak.

Emit `per_tag_reasoning` for every matched tag (one sentence each, citing the specific
evidence in the requirement). For unmatched tags, omit the entry.

### Step 3: Apply the project gate

Read `project_profile_path` (if not null). Extract `has_ui` (boolean). Also check
`tech_stack` as a fallback heuristic (presence of `react`, `vue`, `svelte`, `angular`,
`html`, `css`, `frontend` → infer `has_ui = true`).

For each matched tag, look up its `project_gate`:

| `project_gate` | `has_ui` known true | `has_ui` known false | `has_ui` unknown / profile absent |
|---|---|---|---|
| `~` (no gate) | `included` | `included` | `included` |
| `requires_ui` | `included` | `suppressed-no-ui` | `suppressed-unknown-ui` (conservative: empty) |

Record the gate decision for every matched tag in `classification.gate_decisions`, keyed
by tag. Tags that were not matched need no gate entry.

**Conservative default:** when `has_ui` is absent, unknown, or the profile is unavailable,
`requires_ui` slots resolve **empty** (do not include `ui-designer` or
`accessibility-specialist`). The spine is self-sufficient; do not guess at UI presence.

### Step 4: Assemble the roster

```
resolved_roster = spine ∪ { specialists[tag] | tag matched AND gate_decision[tag] == "included" }
```

Roster ordering (stable):
1. Spine members first, in catalog order: `researcher`, `technical-writer`, `tpm`.
2. Specialists appended in tag-match order (the order tags appear in the `work_types` list),
   not in order of match strength.
3. Dedupe: if the same persona appears from multiple tags (e.g. `architect` from both
   `architecture` and `data`), include it once at its first occurrence position.

**Roster-only invariant (HARD):** every persona in `assembled_personas` must correspond to
an existing `hive/agents/<persona>.md`. The catalog already ensures this for declared
specialists, but verify before returning. If a catalog entry references a non-existent
agent file, treat it as suppressed and record the anomaly in `per_tag_reasoning` for
that tag. Do not invent personas; do not include a persona not in the catalog or spine.

**Spine self-sufficiency invariant (HARD):** even if every matched specialist is gated
out, return the spine. `assembled_personas` is never empty.

### Step 5: Return output

Return:

```yaml
assembled_personas:
  - researcher
  - technical-writer
  - tpm
  - <specialists in stable order>

classification:
  tags: [<matched tags>]
  per_tag_reasoning:
    <tag>: "<evidence sentence>"
  confidence: matched | low
  gate_decisions:
    <tag>: included | suppressed-no-ui | suppressed-unknown-ui
```

This output is the complete contract. The caller (`/plan`) passes `assembled_personas`
directly to `planning-routing` and writes `classification` into `epic.yaml` as
`planning_team:`.

---

## Acceptance criteria verification (self-check before returning)

Before returning, verify:

1. **Security tag:** if `requirement_summary` mentions auth or secrets → `tags` includes
   `security` and `assembled_personas` includes `security-reviewer`.
2. **UI gate on no-ui project:** if `ui` matched and `has_ui = false` → gate_decision for
   `ui` is `suppressed-no-ui` and `ui-designer` is absent from `assembled_personas`.
3. **Low confidence:** if no tag matched → `confidence = low` and `assembled_personas`
   equals the spine exactly.
4. **Multi-tag:** if multiple tags match → roster is deduped union of spine + all included
   specialists.
5. **Roster-only:** every persona in `assembled_personas` resolves to `hive/agents/<p>.md`.
6. **Both outputs present:** both `assembled_personas` and `classification` (with `tags`,
   `per_tag_reasoning`, `confidence`, `gate_decisions`) are returned.

---

## What this skill is NOT

- **Not `planning-routing`.** It does not spawn agents, resolve backends, or emit INFO logs.
  It returns a persona list that planning-routing consumes.
- **Not the escalation catalog.** The escalation `Catalog` in `specialist-triggers.md`
  governs raise-at-review-gate triggers (pre-exec / post-exec / append). This skill reads
  only the `planning_composition` section.
- **Not a blocking gate.** Classification failure or low confidence → spine-only fallback.
  Planning never blocks on a bad classification.
