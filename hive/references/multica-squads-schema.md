# Multica Squads Schema

See the canonical workspace config at [.pHive/multica/squads.yaml](../../.pHive/multica/squads.yaml).

## Purpose

`.pHive/multica/squads.yaml` declares the named agent squads that can be bootstrapped from tracked repo state. A squad groups related agents under a leader for coordinated task delegation and routing.

## Schema reference

Top-level fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `schema_version` | string | yes | none | Semantic version string. Current value is `"1.0.0"`. |
| `squads` | array | yes | none | Ordered list of squad definitions. |

Per-squad fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `name` | string | yes | none | Stable squad identifier. |
| `leader` | string | yes | none | Persona name of the squad leader. Must be present in `members`. |
| `members` | array | yes | none | Array of persona names belonging to this squad. |
| `description` | string | no | `""` | Human-readable purpose of the squad. |
| `visibility` | string | no | `workspace` | Visibility scope for the declaration. |

## Required fields

Every squad entry must define `name`, `leader`, and `members`.

## Optional fields with defaults

When omitted, optional fields default to `description=""` and `visibility='workspace'`.

## schema_version semantics

`schema_version: "1.0.0"` is the current schema. Bootstrap rejects unknown future versions instead of guessing how to interpret them.

## Validation rules

- `leader` must be present in the squad's own `members` array.
- Every name in `members` must exist as an agent `name` in `.pHive/multica/agents.yaml`.
- Squad `name` values must be unique within the file.

## Resolution rules

`leader` and each entry in `members` resolve to agent entries in `.pHive/multica/agents.yaml` by matching the `name` field. Resolution is case-sensitive. Bootstrap fails fast if any name does not resolve.

## Concrete example

```yaml
schema_version: "1.0.0"
squads:
  - name: planning-team-squad
    leader: tpm
    members:
      - researcher
      - architect
      - technical-writer
      - tpm
    description: Planning and discovery squad responsible for research, architecture, and documentation.
    visibility: workspace
  - name: dev-team-squad
    leader: reviewer
    members:
      - developer
      - backend-developer
      - frontend-developer
      - reviewer
    description: Development squad covering implementation and code review across the stack.
    visibility: workspace
  - name: verify-team-squad
    leader: peer-validator
    members:
      - tester
      - test-architect
      - test-scout
      - peer-validator
      - security-reviewer
    description: Verification squad responsible for testing, validation, and security review.
    visibility: workspace
```

## Drift contract

The config is re-runnable. Disk wins when generated or checked again. Updates should patch existing entries and fields, not delete unrelated state. Adding a new squad does not affect existing squad entries. Renaming a persona in `agents.yaml` requires a matching update here.

## Relationship to multica-agents-schema

`multica-agents-schema.md` is the authoritative reference for valid persona names. All `leader` and `members` values in this file must resolve against that set. Squad declarations are additive metadata on top of the agent layer — they do not modify agent definitions.

## Forward link

Future S3 initialization details for squad bootstrap belong in [skills/multica-init/SKILL.md](../../skills/multica-init/SKILL.md).

How a squad-leader run must terminate (children-terminal check, summary comment, self status flip) is defined in [squad-leader-terminal-contract.md](squad-leader-terminal-contract.md).
