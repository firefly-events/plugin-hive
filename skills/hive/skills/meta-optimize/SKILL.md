---
name: meta-optimize
description: Use when a consumer wants to auto-improve their project, including when they say "meta optimize this project" or ask to run /meta-optimize against the attached target project.
---

# Meta Optimize

## Purpose

Provide the public scaffold for `/meta-optimize`, the consumer-facing skill for improving an attached target project while keeping the shipped surface separate from maintainer-only tools.

## Kickoff Prerequisites

- Metrics are opt-in at kickoff and default OFF until the consumer enables them.
- If metrics are unavailable or insufficient for a cycle, backlog evidence is the fallback input.
- Kickoff should make the opt-in choice explicit so the cycle can proceed with either metrics or backlog-backed evidence.

## Inputs

- `HIVE_TARGET_PROJECT` is the target input for this skill.
- Resolve `HIVE_TARGET_PROJECT` config-first from `paths.target_project` in the root `hive.config.yaml`.
- If that setting is unset, fall back to the invoking cwd captured at skill start.
- This public surface does not add a separate CLI path argument for target selection.

## Operating Model

- The public path promotes retained changes as a PR or pull request artifact only.
- This scaffold assumes reviewable artifact promotion rather than direct repo mutation.
- Any target-relative work should stay anchored to the resolved `HIVE_TARGET_PROJECT`.

## What This Skill Does Not Do

- It does not expose any maintainer-only command surface on the public path.
- It does not perform direct-commit promotion on the public path.
- It does not bypass the target-resolution contract above.

## Scaffold Notice

This is the BL3.1 scaffold only. Adapter wiring, orchestration, and deeper execution behavior land in BL3.2 through BL3.6.

## Cross-Reference

See `hive/references/meta-optimize-contract.md` for the authoritative public contract, target resolution rule, charter template binding, and public-versus-maintainer boundary.
