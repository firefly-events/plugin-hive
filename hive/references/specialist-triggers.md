---
title: Specialist Triggers Catalog
type: reference
---

# Specialist Triggers Catalog

**Purpose:** Single source of truth for trigger IDs, placement rules, and response chains.

> **Forward-compatibility constraint:** The execute skill branches ONLY on `placement` and `responds_with.type` — never on specific trigger IDs. Adding a new trigger requires only a new catalog entry; no changes to execute routing logic.

---

## Catalog

```yaml
- trigger: security:plan-audit
  description: "Security team adversarial review of the architectural plan before execution begins"
  placement: pre-exec
  raised_by: [architect, tpm]
  responds_with:
    type: team
    id: security-team
  workflow: hive/workflows/security-audit.workflow.yaml
  skill: ~
  severity_guidance: |
    major → block execution until resolved
    moderate → execute but flag results
    minor → informational only
  conditions: |
    Raise when: auth model changes, new external API surfaces, privilege escalation risks,
    data schema changes touching PII, or any multi-system integration.

- trigger: security:impl-audit
  description: "Security reviewer sidecar appended to affected stories during main dev execution"
  placement: append
  raised_by: [architect, tpm]
  responds_with:
    type: agent
    id: security-reviewer
  workflow: ~
  skill: ~
  severity_guidance: |
    major → block story merge until reviewer signs off
    moderate → reviewer flags must be addressed before PR
    minor → informational; reviewer comments appended to story output
  conditions: |
    Raise when: implementation touches auth flows, secrets handling, input validation,
    or any surface flagged during security:plan-audit.

- trigger: performance:audit
  description: "Performance team review of implementation artifacts after dev execution completes"
  placement: post-exec
  raised_by: [architect, tpm]
  responds_with:
    type: team
    id: performance-team
  workflow: hive/workflows/performance-audit.workflow.yaml
  skill: ~
  severity_guidance: |
    major → findings block release; must be addressed before ship
    moderate → findings logged; addressable in follow-on epic
    minor → informational; benchmarks captured for baseline
  conditions: |
    Raise when: new data-intensive endpoints, client-side rendering of large datasets,
    database query patterns changed, or any feature with latency SLA implications.

- trigger: ui:major
  description: "Full UI specialist team phase for large-scope UI work requiring dedicated design execution. (v1 deferred — catalog-registered; execution of the pre-exec UI team phase ships with the ui-team-skills epic.)"
  placement: pre-exec
  raised_by: [ui-designer]
  responds_with:
    type: team
    id: ui-team
  workflow: ~
  skill: ~
  severity_guidance: |
    major → intent: full ui-team phase runs before dev execution; wireframes, design briefs,
            and brand system alignment produced before any story is coded. v1 behavior:
            execute logs "specialist phase not yet implemented — skipping" and proceeds
            directly to dev execution; design work continues in-planning until the ui-team
            workflow ships.
    moderate → not applicable; this trigger is major-scope only
    minor → not applicable; use ui:brand-redo or in-planning path instead
  conditions: |
    Raise when: 3+ new screens, cross-feature design system changes, or estimated
    design work exceeds one day. ui-designer makes this call at the collaborative
    review gate (plan step 4b); may revise at structured outline gate (step 9b).

- trigger: ui:brand-redo
  description: "Full UI specialist team phase when a brand system overhaul is required before dev. (v1 deferred — catalog-registered; execution of the pre-exec UI team phase ships with the ui-team-skills epic.)"
  placement: pre-exec
  raised_by: [ui-designer]
  responds_with:
    type: team
    id: ui-team
  workflow: ~
  skill: ~
  severity_guidance: |
    major → intent: brand-system.yaml must be produced and approved before any UI story
            executes. v1 behavior: execute logs "specialist phase not yet implemented —
            skipping" and proceeds directly to dev execution; brand work continues
            in-planning until the ui-team workflow ships.
    moderate → not applicable; brand redos are always major scope
    minor → not applicable
  conditions: |
    Raise when: brand identity is changing (new color system, typography overhaul, logo change)
    or when existing brand-system.yaml is absent and the epic ships user-facing UI.

- trigger: ui:animations
  description: "Animations specialist sidecar appended to affected stories during main dev execution"
  placement: append
  raised_by: [ui-designer]
  responds_with:
    type: agent
    id: animations-specialist
  workflow: ~
  skill: ~
  severity_guidance: |
    major → animation spec must be reviewed and approved before story closes
    moderate → specialist provides implementation guidance; dev team resolves
    minor → informational suggestions appended to story output
  conditions: |
    Raise when: any story involves transitions, micro-interactions, loading states,
    or motion design. animations-specialist reads hive/agents/animations-specialist.md.
```

---

## Notes

**Catalog review cadence:** Review on each specialist epic (when a new specialist agent or team is added). Every specialist-addition epic includes a full cross-reference check of this catalog.

**v1 note:** Execute routing handles workflow-based triggers for pre-exec/post-exec phases. Append-placement triggers route directly to single agents (no workflow needed). Skill-based catalog entries are an extension point for future implementation.

**v1 deferred triggers:** `ui:major` and `ui:brand-redo` are catalog-registered but their pre-exec UI team phase is not yet wired — execute step 4a case (iii) logs `specialist phase not yet implemented — skipping` for both. Until the ui-team-skills epic lands the UI team workflow, raising these triggers is equivalent to continuing UI design in-planning. Agent callers (ui-designer SCALE_CALL) may still emit the escalation — extraction, persistence, and de-dup all work end-to-end; only the pre-exec runtime handler is deferred.
