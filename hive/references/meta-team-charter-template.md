# Meta-Team Charter — {{target_project}}

> **Rendered from template:** hive/references/meta-team-charter-template.md
> **Rendered at:** {{render_timestamp}}
> **Charter version:** {{charter_version}}
> **Target project:** {{target_project}} ({{target_project_path}})

This shipped template is the template-source for the public `/meta-optimize`
surface. At render time, the boot step resolves the target project using the
locked Q3 semantics: config-first via `paths.target_project`, cwd fallback when
unset, and no CLI argument form.

---

## Mission

Self-optimize {{target_project}}. Find real gaps, fix them, document what
changed, and leave the system in a better state than it started. The meta-team
is not a change-management committee — it ships.

This charter is rendered for the resolved target project at
`{{target_project_path}}`. When `paths.target_project` is set, that configured
path is authoritative. When it is unset, rendering falls back to the invoking
cwd. The render path and the target path are separate concerns: the rendered
output lands in runtime state, while this template remains the shipped source.

## Scope

| Field | Value |
|---|---|
| Scope | Files and directories under {{target_project_path}} |
| Allowed mutation types | code changes, documentation, config, test additions, refactors |
| Forbidden mutations | charter edits, marketplace.json edits that expand shipping surface, changes to other projects |
| Observation window | default 48 hours post-promotion |

The scope is intentionally target-project-relative. Rendering this template for
`plugin-hive` preserves current maintainer behavior; rendering it for a
consumer repository gives the public `/meta-optimize` surface the same contract
shape without hardcoding `hive/` or `skills/`.

## Taxonomy

```yaml
taxonomy:
  finding_categories:
    - code-quality
    - test-coverage
    - documentation
    - performance
    - security
    # Project-specific example:
    # - workflow-correctness
```

Categories are charter-defined. The step files `step-02-analysis`,
`step-03-proposal`, and `step-06-evaluation` read taxonomy from the rendered
charter and do NOT hardcode category lists. To add or remove categories, edit
the taxonomy block in the charter rather than changing step logic.

The default set above is intentionally generic for the public
`/meta-optimize` surface. Maintainers can render project-specific variants by
editing the taxonomy block in the template source or the relevant maintainer
reference, but the contract boundary stays the same: the charter owns category
semantics.

## Operating rules

The rendered charter applies to the resolved target project only. It does not
authorize edits outside `{{target_project_path}}`, and it does not broaden the
shipping surface. In particular, rendering this charter does not authorize
changes to other repositories, to marketplace packaging rules that expand what
ships, or to the shipped template itself during a runtime optimization pass.

All target resolution statements in this template assume the locked Q3
contract:

- Primary source: `paths.target_project`
- Fallback: invoking cwd
- Unsupported form: CLI target-project argument

These rules are repeated here because later step files consume the rendered
charter as the contract source. The charter must therefore be explicit about
how `{{target_project}}` and `{{target_project_path}}` were chosen.

## Template and runtime split

This file is the shipped template. The rendered charter is runtime state and is
written to `{resolved_state_dir}/meta-team/charter.md` during boot. Do not edit
runtime state as if it were the source template, and do not treat this shipped
template as a per-run log.

The render metadata is part of the operating contract:

- `{{charter_version}}` tracks the charter instance used for a given cycle
- `{{render_timestamp}}` records when the render occurred
- `{{target_project}}` names the resolved project
- `{{target_project_path}}` records the resolved absolute path

## /meta-meta-optimize locality (DO NOT CHANGE)

This template is the foundation for the PUBLIC `/meta-optimize` surface. The
existing `/meta-meta-optimize` workflow remains local-only to `plugin-hive`
maintainers. It is NOT exposed via the shipped template/render flow. Any
changes to `/meta-meta-optimize` stay in `maintainer-skills/` (excluded from
marketplace).

Do not use this public template to redefine maintainer-only behavior. The
maintainer path keeps its hive-targeting and maintainer-local conventions until
an explicit maintainer-only change says otherwise.

## Example render for plugin-hive (for maintainer reference)

```markdown
# Meta-Team Charter — plugin-hive

> **Rendered from template:** hive/references/meta-team-charter-template.md
> **Rendered at:** 2026-04-22T16:20:00-05:00
> **Charter version:** 2026-04-22-1
> **Target project:** plugin-hive (/Users/don/Documents/plugin-hive)

## Mission

Self-optimize plugin-hive. Find real gaps, fix them, document what changed,
and leave the system in a better state than it started. The meta-team is not a
change-management committee — it ships.

## Scope

| Field | Value |
|---|---|
| Scope | Files and directories under /Users/don/Documents/plugin-hive |
| Allowed mutation types | code changes, documentation, config, test additions, refactors |
| Forbidden mutations | charter edits, marketplace.json edits that expand shipping surface, changes to other projects |
| Observation window | default 48 hours post-promotion |

## Taxonomy

```yaml
taxonomy:
  finding_categories:
    - code-quality
    - test-coverage
    - documentation
    - performance
    - security
```
```
