---
name: write-skill
description: Scaffold a new top-level skill — given a brief (name + problem + trigger phrases + scope hint), emit `skills/<kebab-name>/SKILL.md` from the canonical template. Asks clarifying questions inline for missing fields. Scaffold only — no auto-indexing, no auto-commit.
---

# Hive Write-Skill

Scaffold a new top-level Hive skill from a one-shot brief. The brief carries the skill's `name`, problem statement, two-plus trigger phrases, and a scope hint; this skill resolves those into a populated `skills/<kebab-name>/SKILL.md` against the canonical template at [`template.md`](./template.md). Fields the brief omits are filled in by asking the operator targeted, numbered, inline questions before the file is written.

**Scope cap — scaffold only.** This skill writes ONE file (`skills/<kebab-name>/SKILL.md`). It does NOT index the new skill into any catalog, README, or registry; it does NOT commit, stage, or push; it does NOT run the new skill. The output is a starting point the operator iterates on.

**Input:** `$ARGUMENTS` carries a brief in free-form natural language. The brief SHOULD include — but is not required to include — the following fields:

- `name:` — kebab-case name of the new skill (e.g., `find-skills`, `replay-incident`)
- `problem:` — one sentence describing what the skill solves
- `triggers:` — 2+ phrases that should route to this skill (e.g., "when an operator asks X", "as part of the Y workflow")
- `scope:` — single-shot vs multi-turn, atomic-skill vs orchestrator
- `tools:` — what tools the skill needs (Read, Write, Bash, etc.) — optional

The skill consumes whatever the brief supplies and asks for the rest.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** This skill is meta (it scaffolds skills, not project work) and should be runnable in fresh repos. If the kickoff checks fail, emit the warning below and proceed.

> Warning: Hive not initialized for this project. `/write-skill` is running with defaults — the scaffolded skill will reference the standard template at `skills/write-skill/template.md`.

## Process

1. **Parse the brief.** Read `$ARGUMENTS` and extract whichever of `name`, `problem`, `triggers`, `scope`, `tools` are present. Treat any missing field as `unspecified` — do not guess. If `name` is present, normalize it to kebab-case (lowercase, hyphens, no spaces or underscores).

2. **Ask for missing fields inline.** For each field still `unspecified` after step 1, ask exactly one numbered, focused question. Wait for the operator's response before continuing. Combine related questions when natural — e.g., one numbered list covering `triggers`, `scope`, `tools` — so the operator answers in a single reply. Do NOT proceed to step 3 until `name`, `problem`, and `triggers` (at least 2) are populated; `scope` and `tools` MAY remain unspecified (they have sensible defaults in the template).

   Example numbered prompt when triggers are missing:

   > I need a couple more details before I scaffold `find-skills`:
   >
   > 1. What 2-3 trigger phrases should route an operator to this skill? (e.g., "when looking for an existing skill", "as part of skill discovery")
   > 2. Is this a single-shot atomic skill, or a multi-turn orchestrator?
   > 3. Any specific tools the skill needs beyond Read / Write / Bash?

3. **Check for name collision.** Resolve the target path `skills/<kebab-name>/SKILL.md`. If `skills/<kebab-name>/` already exists, warn the operator and offer two options:

   > Skill `<kebab-name>` already exists at `skills/<kebab-name>/`. Options:
   >
   > 1. **Rename** — pick a different kebab-name and re-run (recommended, default)
   > 2. **Overwrite** — clobber the existing `SKILL.md`
   >
   > Which? (default: rename)

   On rename, ask for the new name and re-check (loop until a free name is found). On overwrite, proceed with the original name. On no response or explicit default, treat as rename and stop with a one-line note ("`/write-skill` paused — re-run with a free name").

4. **Render the template.** Read [`template.md`](./template.md). Substitute the placeholders:

   - `{{kebab-name}}` → resolved name
   - `{{Title Case Name}}` → kebab-name with hyphens to spaces, words title-cased
   - `{{one-line description ...}}` → composed from `problem` + scope hint
   - `{{describe expected arguments}}` → seeded from `triggers` + scope
   - The three `{{Step N ...}}` placeholders → seeded from the problem statement as plausible verb-phrase steps the operator will refine
   - The `{{Not role-X}}` lines → seeded from common exclusions for the chosen scope (atomic vs orchestrator)
   - The `{{Other reference paths ...}}` line → left as a TODO placeholder for the operator

   Keep the rendered output minimal — the goal is a starting scaffold the operator iterates on, not a finished skill. When in doubt, leave a clearly-marked `TODO` rather than inventing detail.

5. **Write the file.** Create `skills/<kebab-name>/` and write the rendered SKILL.md to `skills/<kebab-name>/SKILL.md`. Do NOT create sibling files (no `template.md`, no `README.md`, no test scaffold) — those are out of scope.

6. **Report.** Echo the path of the new SKILL.md and a one-line next-step hint:

   > Scaffolded `skills/<kebab-name>/SKILL.md`. Open it and iterate on the Process section, then add this skill to your catalog (README + plugin manifest) when ready.

   Stop. Do NOT commit, stage, push, index, or invoke the new skill.

## What this skill is NOT

- **Not an indexer.** Adding the scaffolded skill to README, plugin manifest, or any catalog is the operator's job — `/write-skill` writes one file and stops.
- **Not a committer.** No `git add`, no `git commit`, no `git push`. The operator decides when (and whether) to land the scaffold.
- **Not a runner.** `/write-skill` does not invoke the scaffolded skill or test it. The acceptance gate is "loads cleanly under the skill-registry pattern" — anything beyond that is iteration the operator drives.
- **Not a generator of full skill prose.** The Process section is seeded with verb-phrase placeholders, not finished steps. The operator owns the design work; the scaffold owns the shape.

## Atomic-skill invariants

- **Top-level skill** at `skills/write-skill/SKILL.md` (auto-discovered).
- **Single artifact** — one new `skills/<kebab-name>/SKILL.md` per invocation; no other files touched.
- **Idempotent on free names** — re-running with a never-used name always produces the same output for the same brief.
- **Collision-safe** — never silently clobbers; always warns and offers rename.
- **Conversational** — clarifying questions are inline, numbered, and combined when natural (matches the hive skill catalog's invocation style — see `/plan`, `/triage`, `/grill`).

## Hand-off

`/write-skill` is the upstream tool for the `skill-candidate-detect` skill (story `se-5`). When `se-5` lands, it will surface candidate skill briefs from operator transcripts and recommend `/write-skill` as the next step; the operator runs `/write-skill` against the surfaced brief.

This skill does not call back into any caller — it produces a file and exits.

## See also

- [`template.md`](./template.md) — canonical scaffold template this skill renders
- [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — preamble cited by all top-level skills
- [`skills/plan/SKILL.md`](../plan/SKILL.md) — top-level orchestrator skill (reference shape)
- [`skills/standup/SKILL.md`](../standup/SKILL.md) — compact top-level skill (reference shape)
- [`skills/grill/SKILL.md`](../grill/SKILL.md) — atomic-skill pattern (reference shape)
