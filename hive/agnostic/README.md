# hive/agnostic — runner-agnostic PLAN

Port of the `/plugin-hive:plan` **DECOMPOSE** flow so planning can run on ANY CLI
runtime (gemini/codex via opencode, or claude), not only Claude Code.

## Why

`/plugin-hive:plan` is a Claude-Code *skill* (a slash command). Non-Claude runners
never load that skill, so when they are handed the requirement they **implement** it
instead of **decomposing** it, and write zero `.pHive` YAML. Minerva files stories to
Multica by reading `.pHive/epics/<id>/epic.yaml` + `stories/*.yaml` off disk — so a
runner that writes no YAML produces no plan. That coupled planning to a Claude balance.

plugin-hive is our own open-source code, so the skill is fully portable. This directory
carries the identical output contract with the Claude-Code-only ceremony stripped
(design-grill sub-skill, HTML sidecars, MCP concept illustration, `--output-format
json`/`--resume` specifics).

## Files

| File | Role |
|------|------|
| `plan-decompose.prompt.md` | The self-contained DECOMPOSE contract + exact `epic.yaml` / `stories/*.yaml` schema. Placeholders `__IDEA__`, `__EPIC_ID__`, `__TARGET_CODEBASE__`. |
| `adapters.mjs` | `buildRunArgs()` (per-runtime ARG adapter: claude `-p --model` vs opencode `run --model`) and `parseRunOutput()` (OUTPUT adapter → `{session_id, result}`; claude JSON object vs opencode NDJSON). |
| `plan-agnostic.mjs` | CLI entrypoint. Given an idea, builds the decompose prompt, spawns the runtime via the adapters, and prints `{session_id, result}`. First turn wraps `--idea`; continuation turns pass `--prompt --session` verbatim. |
| `test/adapters.test.mjs` | `node --test` unit suite for the adapters + prompt builder. |

## Usage

```bash
# Decompose an idea on gemini (writes .pHive/epics/<id>/... under --cwd):
node hive/agnostic/plan-agnostic.mjs \
  --runtime gemini --model google/gemini-3.1-pro-preview \
  --cwd /path/to/workspace \
  --idea "Add CSV export to the reports page"

# Inspect the built prompt without spawning a model:
node hive/agnostic/plan-agnostic.mjs --print-prompt --idea "Add CSV export" --epic-id add-csv-export

# Run the unit tests:
node --test hive/agnostic/test/adapters.test.mjs
```

## Minerva wiring

Minerva's driver (`minerva/src/agnostic-plan-driver.ts`) asks Heimdall
`/available-route?task-type=planning` for the planning runtime. When the route is a
non-claude runtime AND this CLI + opencode are present, Minerva spawns this entrypoint
per turn; otherwise it falls back to the built-in claude `SpawnDriver` — planning never
breaks on an unavailable route/port. The runtime + model are persisted on the run record
so every turn (initial decompose, auto-answered gates, human-answered resumes) uses the
same runtime and opencode session.
