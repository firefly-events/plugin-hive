# Multica Skills-Export Schema

See the canonical workspace config at [.pHive/multica/skills-export.yaml](../../.pHive/multica/skills-export.yaml).

## Purpose

`.pHive/multica/skills-export.yaml` declares the plugin-hive skills that are exported into Multica's `skill` table as runtime copies. This schema implements **Mode D-a (read-only export)**: the authoritative source remains at `skill_ref` in the plugin-hive repo; exported copies materialized into Multica are drift-checked by the W4.4 CI guard.

Plugin consumers who do not adopt Multica are unaffected — the in-repo `skills/{name}/SKILL.md` files remain the install-time surface.

## Schema reference

Top-level fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `schema_version` | integer | yes | none | Current value is `1`. |
| `exports` | array | yes | none | Ordered list of skill export entries. |

Per-export entry fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `skill_ref` | string | yes | none | Repo-relative path to the skill's `SKILL.md`. |
| `multica_name` | string | yes | none | Canonical skill name registered in Multica's skill table. |
| `substrate_deps` | array | no | `[]` | Repo-relative paths to reference docs bundled alongside the skill. |
| `visibility` | string | no | `workspace` | Visibility scope in Multica. Allowed values: `private`, `workspace`. See §Visibility below. |

## Required fields

Every export entry must define `skill_ref` and `multica_name`.

## Optional fields with defaults

When omitted, optional fields default to `substrate_deps=[]` and `visibility='workspace'`.

## schema_version semantics

`schema_version: 1` is the current schema, covering Mode D-a only. Reconcile tooling rejects unknown future versions instead of guessing how to interpret them. Future modes (D-b dual-source, D-c migrate) would increment `schema_version`.

## Validation rules

Both rules are enforced at reconcile time before any import is attempted:

1. `skill_ref` must point to a file that exists in the repo (non-zero byte, parseable markdown with a valid SKILL.md frontmatter `name:` field).
2. Every path listed in `substrate_deps` must exist in the repo.

A validation failure aborts the full reconcile run and reports which entries failed. Partial imports are not attempted.

## Resolution rules

Both `skill_ref` and each entry in `substrate_deps` are resolved **relative to the repo root** at reconcile time. Absolute paths and `~/`-prefixed paths are rejected.

Example: `hive/references/skill-prelude.md` resolves to `<repo-root>/hive/references/skill-prelude.md`.

## Visibility

The `visibility` field controls whether the exported skill is visible to all workspace members (`workspace`) or scoped to the importing agent/pipeline only (`private`).

**W0.3 finding dependency.** The safe default for pilot imports is determined by the S0.3 spike (`w0-3-skill-import-spike`). Until the finding doc is written at `.pHive/epics/multica-substrate-deepen/docs/spike-findings/s0-3-skill-import.md`, set `visibility: private` on all pilot entries to avoid unintended workspace-level exposure. Promote to `workspace` only after the spike confirms the promotion path is clean.

Allowed values:
- `private` — skill visible only within the import session / agent context. Recommended for initial pilots.
- `workspace` — skill visible to all workspace members. Default when `visibility` is omitted (matches Multica platform default).

## Mode D-a posture (read-only export)

Under Mode D-a:
- `skill_ref` remains the source of truth. Never edit the exported copy in Multica's UI; edits there will be overwritten on the next reconcile run.
- `substrate_deps` lists the reference documents the skill loads at runtime via its preamble. These files are materialized alongside the skill during import; the importer resolves them from the repo root and uploads them as dependency attachments.
- The W4.4 CI guard compares the live Multica skill content against `skill_ref` and fails the build on drift.

## Concrete example

Pilot manifest for `/metrics-check` — the lowest-dependency single-persona skill (selected per design-discussion §3 R3 mitigation):

```yaml
schema_version: 1
exports:
  - skill_ref: skills/metrics-check/SKILL.md
    multica_name: metrics-check
    substrate_deps:
      - hive/references/skill-prelude.md
      - hive/references/story-yaml-schema.md
      - hive/references/cross-cutting-concerns.md
    visibility: private
```

`substrate_deps` reflects the reference docs loaded by `metrics-check` at runtime. The `.pHive/metrics/` schema files (`metrics-event.schema.md`, `experiment-envelope.schema.md`) are workspace-local runtime data, not bundleable substrate; they are excluded from `substrate_deps` and must be present in the target workspace independently.

## Drift contract

The config is re-runnable. On re-import, reconcileSkills upserts existing entries rather than re-creating them. Removing an entry from `exports` does NOT delete the corresponding skill from Multica; deletion is a manual operator action. This is intentional under Mode D-a to avoid accidental data loss.

## Relationship to other Multica manifests

`.pHive/multica/skills-export.yaml` is a sibling of `agents.yaml` and any future `squads.yaml` / `autopilots.yaml`. All files share `schema_version` semantics and repo-root-relative path resolution. Skills declared here are distinct from the `skills:` array on individual agent entries in `agents.yaml` — that array names skills already registered in Multica; this file is what registers them.

## Forward links

- [W4.2 story](../../.pHive/epics/multica-substrate-deepen/stories/w4-2-skills-export-yaml.yaml) — authors `.pHive/multica/skills-export.yaml` with the pilot entry.
- [W4.3 story](../../.pHive/epics/multica-substrate-deepen/stories/w4-3-bootstrap-reconcile-skills.yaml) — implements `reconcileSkills` that consumes this schema.
- [W4.4 story](../../.pHive/epics/multica-substrate-deepen/stories/w4-4-ci-drift-guard.yaml) — CI guard that enforces Mode D-a drift detection.
- [W4.5 story](../../.pHive/epics/multica-substrate-deepen/stories/w4-5-pilot-roundtrip-validation.yaml) — end-to-end pilot validation against this schema.
- [S0.3 spike finding](../../.pHive/epics/multica-substrate-deepen/docs/spike-findings/s0-3-skill-import.md) — visibility flag investigation (written by W0.3 story).
