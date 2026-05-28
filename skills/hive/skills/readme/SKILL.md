---
name: readme
description: Author a README for a project, package, or module — overview, install, usage, configuration. Use when a codebase or component needs an entry-point document for new readers.
---

# Hive Readme

Produce a **README** that gets a new reader from "what is this?" to "I can run
it" with minimal friction. Lead with purpose, then the shortest path to using
it, then the details.

**Input:** `$ARGUMENTS` (or upstream findings / the code itself) describing what
the project or module does, how it is installed, and how it is used.

## When to use

- A new project, package, or module needs an entry-point document.
- An existing README is stale, missing, or buries the quickstart.

Scope to the unit named in the task — a repo-root README differs from a
per-module README. Do not document internal design here (use `architecture-doc`).

## Sections (produce in this order)

1. **Title + one-liner** — the name, then a single sentence on what it does and for whom.
2. **Overview** — 2-4 sentences: the problem it solves and the core idea. Optional badges line.
3. **Install** — exact commands to install/add it. Name prerequisites (runtime, versions).
4. **Quickstart / usage** — the smallest working example that produces a visible result. Real, runnable code — not pseudocode.
5. **Configuration** — options, env vars, or flags, as a table: name, default, what it does. Omit if none.
6. **Examples** — 1-3 common tasks beyond the quickstart. Omit if quickstart suffices.
7. **Development** — how to build, test, and run locally (for a contributor).
8. **Contributing / License** — link the contributing guide and state the license. Brief.

## Tone & style

- Reader is new and impatient. Shortest path to value first; depth later.
- Every command and snippet must be copy-paste runnable as written.
- Prefer a working example over prose description of behaviour.

## Output

One README per task. Default path: `README.md` at the target's root (the
directory named in the task), or as the task specifies.

## What this skill is NOT

- **Not architecture.** Internal design and rationale belong in `architecture-doc`.
- **Not API reference.** Exhaustive API docs are a separate format; the README links to them.
- **Not a changelog.** Version history lives in `CHANGELOG.md`.
