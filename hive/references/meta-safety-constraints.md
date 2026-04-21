# Meta Safety Constraints

## Purpose

This reference defines the shared safety constraints that meta-swarm charters inherit. Individual swarm charters should cite this file by path instead of copying the constraint language into each charter.

## Hard Constraints

- **No destructive operations.** No file deletions and no more than 50% content removal from any one file.
- **No breaking changes.** Schema changes must be additive, with new optional fields only.
- **5-hour budget window maximum.** A meta-swarm must abort and close the cycle gracefully if the limit is reached.
- **No secrets or credentials.** Memory and reference artifacts must remain safe to store as plain text and export.
- **Human confirmation required for:** changes to `hive/hive.config.yaml`, changes to agent tool lists, and adding external service integrations.
- **Commit messages use a per-swarm prefix.** Each swarm chooses and documents its own prefix; this reference does not pin one.

## Quality Bar - Ship criteria

A change ships when:
1. It addresses a specific, named issue rather than a speculative improvement.
2. It does not break existing cross-references.
3. It does not remove existing functionality.
4. The reviewer verdict is `passed` or `needs_optimization`.

## Quality Bar - Block criteria

A change is blocked when:
1. It would require more than 50% content removal from any file.
2. It modifies config or agent tool lists without human confirmation.
3. The reviewer verdict is `needs_revision`.

## How to use this reference

Swarm charters should cite `hive/references/meta-safety-constraints.md` for shared constraint language. If a new cross-swarm safety rule is needed, add it here first so later charter updates inherit the same rule instead of drifting.

## What this reference does NOT commit to

- Swarm-specific mission statements, scope tables, or output artifacts
- Specific commit-message prefixes
- Promotion adapter choice such as direct commit or PR artifact
- Any legacy nightly cadence

Extracted 2026-04-20 from `.pHive/meta-team/charter.md` lines 37-44 and 70-82 per A1.2 in the meta-improvement-system epic.
