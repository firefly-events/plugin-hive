# UI Skill Gates Reference

Centralized gate specification for UI skills. Each skill's `SKILL.md` references this document rather than re-specifying gate logic inline.

## Gate mechanism

Follow the plan skill pattern exactly: **file existence checks** on predictable state paths. No runtime queries, no agent spawning, no directory scans. Each skill checks specific files before proceeding. If a check fails, display the user message below and stop — do not proceed.

## Gate table

| Skill | Gate files to check | Fails when | User message |
|-------|-------------------|------------|--------------|
| **brand-system** | none | — | — |
| **design-system** | `.pHive/brand/brand-system.yaml` | file missing | "No brand system found. Run `/hive:brand-system` first to establish colors, typography, and spacing before generating design tokens." |
| **visual-qa** | `.pHive/design/index.yaml` AND `.pHive/project-profile.yaml` | either file missing | `index.yaml` missing: "No design briefs found. Run `/hive:ui-design` on a story first — visual-qa needs design briefs and wireframe exports to compare against the implementation." / `project-profile.yaml` missing: "Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — visual-qa needs the tech stack profile to locate implementation files." |
| **design-review** (`--artifact-target design`) | any one of: `.pHive/design/index.yaml` OR `.pHive/brand/brand-system.yaml` | both missing | "Nothing to review yet. Design-review needs at least wireframes (run `/hive:ui-design`) or a brand system (run `/hive:brand-system`) before it can run a critique." |
| **design-review** (`--artifact-target implementation`) | `.pHive/project-profile.yaml` (with `tech_stack` key present and non-empty) | never hard-stops; file missing or `tech_stack` empty warns | "Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults." |
| **polish-audit** | `.pHive/audits/ui-audit/latest.yaml` | file missing | "No implementation audit found. Run `/hive:design-review --artifact-target implementation` first — polish-audit builds on audit findings to identify refinement opportunities." |

## Notes

- **brand-system**: No gate — always runnable.
- **design-system**: Gates on `.pHive/brand/brand-system.yaml`. Run brand-system first.
- **visual-qa**: Gates on both `.pHive/design/index.yaml` (design brief manifest) AND `.pHive/project-profile.yaml` (tech stack for locating implementation files). Run kickoff first, then ui-design on a story.
- **design-review**: Default design target uses the OR condition — either `.pHive/design/index.yaml` OR `.pHive/brand/brand-system.yaml` must exist. Both missing → stop.
- **design-review --artifact-target implementation**: Checks `.pHive/project-profile.yaml` with `tech_stack` present and non-empty, but warning-lifts missing context and proceeds with defaults. Writes `.pHive/audits/ui-audit/latest.yaml`.
- **polish-audit**: Gates on `.pHive/audits/ui-audit/latest.yaml` existence only — not on the `verdict` field. Even a clean implementation audit (verdict: passed) justifies a polish pass.

## Dependency chain implied by gates

```
brand-system (no gate — always runnable)
    └── design-system (gates on brand-system.yaml)

kickoff (produces project-profile)
    └── design-review --artifact-target implementation (warns on missing project-profile)
            └── polish-audit (gates on ui-audit/latest.yaml)

ui-design workflow (produces design/index.yaml)
    └── visual-qa (gates on design/index.yaml)
    └── design-review (gates on design/index.yaml OR brand-system.yaml)
```

## State path reference

| Path | Written by | Read by |
|------|-----------|--------|
| `.pHive/brand/brand-system.yaml` | brand-system skill | design-system, design-review |
| `.pHive/project-profile.yaml` | kickoff workflow | design-review implementation target, visual-qa |
| `.pHive/audits/ui-audit/latest.yaml` | design-review implementation target | polish-audit |
| `.pHive/design/index.yaml` | ui-design workflow (design-brief step) | visual-qa, design-review |
| `.pHive/design/briefs/{story-id}.md` | ui-design workflow (design-brief step) | visual-qa, design-review |
