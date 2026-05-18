---
name: sandcastle-gh-init
description: Scaffold the GitHub Actions glue that fires /hive:execute inside a Sandcastle container when an issue is labeled `hive:ready`.
---

# Hive sandcastle-gh-init Skill

Layers GitHub-event-trigger glue on top of an already-initialized Sandcastle
setup. Drops a workflow, a bridge script, and a manifest into the consumer
repo so that labeling an issue `hive:ready` immediately launches an
autonomous `/hive:execute` run, ships a PR against the default branch, and
flips the canonical label state machine
(`hive:ready` -> `hive:in-flight` -> `hive:shipped` | `hive:failed`).

**Input:** `$ARGUMENTS` may contain `--runner ubuntu-latest|self-hosted`
and `--secret-mode anthropic|openai`. Both have safe defaults
(`ubuntu-latest` + `anthropic`).

## Purpose

Hive owns the GitHub-side dispatch glue. Sandcastle owns the container, the
provider choice, and the inner agent runtime. This skill writes the glue —
nothing about sandcastle's own scaffold — so that:

- Consumers can opt into event-driven Hive dispatch with one slash command.
- The workflow YAML owns label transitions atomically with the job
  lifecycle, so a crashed bridge cannot leave an issue stuck in
  `hive:in-flight`.
- Re-runs are bounded: only files listed in `.hive-dispatch/manifest.yaml`
  are ever rewritten. Anything under `.sandcastle/` (sandcastle's domain)
  or anywhere else in the repo is untouched.

## Prereqs

The skill performs four prereq checks before writing anything. The first
that fails stops the run with zero files written:

1. **Sandcastle is initialized.** `.sandcastle/Dockerfile` must exist.
   Sandcastle init is out of scope here — run `npx sandcastle init` first
   to pick provider, template, and backlog manager. Failure exits `2` with
   the verbatim remediation message naming `npx sandcastle init`.
2. **`gh` CLI is installed and authenticated.** The skill runs
   `gh auth status`; if `gh` is missing or auth fails, the skill exits
   non-zero before any writes.
3. **Canonical labels are present (warning-only).** The four canonical
   labels (`hive:ready`, `hive:in-flight`, `hive:shipped`, `hive:failed`)
   are probed with `gh label list --json name`. Missing labels emit a
   warning + copy-pasteable `gh label create` commands but do not block —
   consumers may add labels later.
4. **No partial scaffold.** If `.hive-dispatch/manifest.yaml` is absent but
   any managed file already exists from a prior hand-edit, the skill
   refuses with the conflicting paths listed. Pass `--force-recover` to
   overwrite.

## Args

| Flag | Default | Allowed values | Notes |
|---|---|---|---|
| `--runner` | `ubuntu-latest` | `ubuntu-latest`, `self-hosted` | Substituted into `runs-on:` in the workflow. |
| `--secret-mode` | `anthropic` | `anthropic`, `openai` | Selects which API-key secret name (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) the workflow + bridge reference. |
| `--force-recover` | off | — | Overwrite managed files when manifest is absent. Only set after inspecting the conflicts. |

There is intentionally **no `--label` flag** (the trigger label
`hive:ready` is a fixed Hive convention with a full state machine) and
**no `--template` flag** (template choice belongs upstream in
`npx sandcastle init`).

## Process

The slash command invokes `scaffold.mjs`:

```bash
node skills/hive/skills/sandcastle-gh-init/scaffold.mjs \
  [--runner ubuntu-latest|self-hosted] \
  [--secret-mode anthropic|openai] \
  [--force-recover]
```

`scaffold.mjs` executes the prereq checks above, then:

1. Renders `assets/hive-dispatch.yml.tpl` -> `.github/workflows/hive-dispatch.yml`
   with the chosen `RUNNER` and `SECRET_KEY` substituted.
2. Renders `assets/sandcastle-hive-bridge.mts.tpl` -> `.github/scripts/sandcastle-hive-bridge.mts`
   with the same `SECRET_KEY` substituted.
3. Reads the sandcastle version pin from
   `node_modules/@ai-hero/sandcastle/package.json`, with `npm ls
   @ai-hero/sandcastle --json --depth=0` as a fallback for hoisted layouts.
   If both miss, records `"unknown"` with a warning.
4. Writes `.hive-dispatch/manifest.yaml` recording the pin, scaffold
   timestamp, chosen args, and the canonical `managed_files` list for
   idempotent re-runs.
5. Stages the three managed files and creates a single git commit on the
   current branch with subject
   `chore(hive): wire github-issue dispatch via sandcastle` and a body
   listing each file.

All `gh` and `git` invocations use `child_process.execFile` with the
array-form arg list — no shell interpolation, so user-supplied args
cannot smuggle shell metacharacters into the command line.

## Outputs

| Path | Owner | Re-run behavior |
|---|---|---|
| `.github/workflows/hive-dispatch.yml` | Hive-managed | Rewritten on every successful run. |
| `.github/scripts/sandcastle-hive-bridge.mts` | Hive-managed | Rewritten on every successful run. |
| `.hive-dispatch/manifest.yaml` | Hive-managed | Rewritten on every successful run. |
| `.sandcastle/**` | Sandcastle-managed | **Never touched.** |
| Anything else | User | **Never touched.** |

The single resulting git commit lists exactly the three managed paths.

## Failure modes

| Symptom | Exit | Cause / fix |
|---|---|---|
| `Sandcastle is not initialized in this repo. Run 'npx sandcastle init'...` | `2` | `.sandcastle/Dockerfile` is missing. Run `npx sandcastle init` first. |
| `gh CLI is required but was not found on PATH` | `1` | Install GitHub CLI from <https://cli.github.com/>. |
| `gh auth status failed` | `1` | Run `gh auth login` and re-run. |
| `WARN: the following canonical Hive labels are missing...` | `0` (warn-only) | Copy-paste the printed `gh label create` commands; not blocking. |
| `partial scaffold detected — managed files already exist but manifest is absent` | `3` | Inspect the listed paths, then either delete them or re-run with `--force-recover`. |
| `git add` / `git commit` failure | `1` | Run inside a git worktree; resolve the underlying git error and re-run. |

## See also

- `assets/hive-dispatch.yml.tpl` — workflow template scaffolded by this skill.
- `assets/sandcastle-hive-bridge.mts.tpl` — bridge template scaffolded by this skill.
- `tests/sandcastle-gh-init/scaffold.test.mjs` — fixture-based test suite for the helper.
