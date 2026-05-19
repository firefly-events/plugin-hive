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
and `--secret-mode claude-oauth|anthropic-api|openai`. Both have safe
defaults (`ubuntu-latest` + `claude-oauth` — subscription OAuth via
`claude setup-token`, no per-token billing).

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

1. **Sandcastle is initialized.** Either `.sandcastle/Dockerfile` or
   `.sandcastle/Containerfile` must exist (sandcastle 0.5.x ships a
   Podman-style `Containerfile` by default; older / Docker-native installs
   ship `Dockerfile`). Sandcastle init is out of scope here — run
   `npx sandcastle init` first to pick provider, template, and backlog
   manager. Failure exits `2` with the verbatim remediation message
   naming `npx sandcastle init`.
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
| `--secret-mode` | `claude-oauth` | `claude-oauth`, `anthropic-api`, `openai` | Selects which auth secret the workflow + bridge reference. `claude-oauth` → `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth via `claude setup-token`, no per-token billing — the new default). `anthropic-api` → `ANTHROPIC_API_KEY` (legacy pay-per-token API path). `openai` → `OPENAI_API_KEY`. The deprecated alias `anthropic` is still accepted and maps to `anthropic-api`. |
| `--force-recover` | off | — | Overwrite managed files when manifest is absent. Only set after inspecting the conflicts. |

There is intentionally **no `--label` flag** (the trigger label
`hive:ready` is a fixed Hive convention with a full state machine) and
**no `--template` flag** (template choice belongs upstream in
`npx sandcastle init`).

## Process

The slash command invokes `scaffold.mjs`:

```bash
node skills/sandcastle-gh-init/scaffold.mjs \
  [--runner ubuntu-latest|self-hosted] \
  [--secret-mode claude-oauth|anthropic-api|openai] \
  [--force-recover]
```

`scaffold.mjs` executes the prereq checks above, then:

1. Renders `assets/hive-dispatch.yml.tpl` -> `.github/workflows/hive-dispatch.yml`
   with the chosen `RUNNER` and `SECRET_KEY` substituted.
   The rendered workflow follows the per-epic-branch-pr-flow model
   (story pe-3):
   - **Two-job graph.** A tiny `derive` job extracts `EPIC_ID` from the
     issue labels via `jq` (no shell interpolation — labels arrive as
     `toJSON()` env) and emits a `concurrency_key` output. The heavy
     `run` job declares `needs: derive` and sets its
     `concurrency.group` to `${{ needs.derive.outputs.concurrency_key }}`,
     which is `hive-epic-<id>` when an epic label is present and
     `hive-issue-<n>` otherwise. The split into two jobs is required
     because GitHub Actions evaluates `concurrency.group` before any
     step in the consuming job runs, so step env or step outputs of the
     same job are not available.
   - **`Resolve base branch` step.** A Node one-liner inside the `run`
     job dynamically imports `hive/lib/git_flow.mjs` (vendored from
     plugin-hive's pe-1 helper) and prints the resolved `base_branch`,
     stored as `steps.base.outputs.base_branch`. Falls back to
     `github.event.repository.default_branch` when the helper module is
     absent so non-Hive consumers see no behavior change.
   - **PR open-or-update.** After a successful bridge run, the workflow
     queries for an existing open draft PR with `head: feat/<epic-id>`
     and `base: <resolved-base>`. When absent it opens a fresh
     `--draft` PR seeded with the first story line; when present it
     edits the existing PR body to append the new story line. Both
     paths use `jq -nr --arg` for body composition so the user-
     controlled issue title is JSON-encoded and never reaches a shell
     word. The body is capped at 25 story entries with a "see commits"
     pointer to bound growth (pe-3 risks mitigation).
   - **Failure path unchanged.** `if: failure()` still flips the issue
     to `hive:failed` so a crashed bridge can never leave an issue
     stuck in `hive:in-flight`.
   - **Promote-to-ready on last story (pe-4).** A dedicated
     `Promote PR to ready if last story` step runs after the shipped
     flip. It counts story-issues for the epic (`--label hive:story:*`
     filter excludes any epic-tracker issue) and compares against the
     shipped count; on parity it calls `gh pr ready "feat/<epic-id>"`,
     otherwise it logs the in-progress count. A 0/0 result is treated
     as a label-propagation anomaly and does NOT promote — no
     false-positive ready flips.
2. Renders `assets/sandcastle-hive-bridge.mts.tpl` -> `.github/scripts/sandcastle-hive-bridge.mts`
   with the same `SECRET_KEY` substituted.
   The rendered bridge derives its sandcastle branch name at run time:
   - Fetches the issue's labels via the GitHub REST API (uses `GH_TOKEN`
     and `GITHUB_REPOSITORY` — never shells out, preserving the AC-7
     no-child_process invariant).
   - Looks for a `hive:epic:<epic-id>` label and dynamically imports
     `hive/lib/git_flow.mjs` (when vendored) to read the resolved
     `branch_strategy`.
   - When `branch_strategy: per-epic` (default per pe-1) and an epic
     label is present, the branch is `feat/<epic-id>`. Otherwise — no
     epic label, or `branch_strategy: per-story` configured — it falls
     back to the legacy `agent/issue-<n>` form.
   - When the helper module is absent (consumer has not vendored
     plugin-hive's `hive/lib/`), the bridge defaults to `per-epic`
     semantics so epic-labeled issues still consolidate onto
     `feat/<epic-id>`.
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

**Runtime artifacts (created by the rendered workflow, not by this skill):**

| Artifact | Created when | Update behavior |
|---|---|---|
| Branch `feat/<epic-id>` | First story of an epic ships | Subsequent stories of the same epic push to the same branch (per pe-2 bridge). |
| Branch `agent/issue-<n>` | Story ships with no `hive:epic:*` label | Legacy one-branch-per-issue fallback. |
| Draft PR titled `[epic] <epic-id>` | First story of the epic completes | Second-and-later stories of the same epic *update* the existing PR's body in place rather than opening a new PR (per pe-3 stack-PR rule). The body is capped at 25 story entries. |
| Anything else | User | **Never touched.** |

The single resulting git commit lists exactly the three managed paths.

## Failure modes

| Symptom | Exit | Cause / fix |
|---|---|---|
| `Sandcastle is not initialized in this repo. Run 'npx sandcastle init'...` | `2` | Neither `.sandcastle/Dockerfile` nor `.sandcastle/Containerfile` is present. Run `npx sandcastle init` first. |
| `gh CLI is required but was not found on PATH` | `1` | Install GitHub CLI from <https://cli.github.com/>. |
| `gh auth status failed` | `1` | Run `gh auth login` and re-run. |
| `WARN: the following canonical Hive labels are missing...` | `0` (warn-only) | Copy-paste the printed `gh label create` commands; not blocking. |
| `partial scaffold detected — managed files already exist but manifest is absent` | `3` | Inspect the listed paths, then either delete them or re-run with `--force-recover`. |
| `git add` / `git commit` failure | `1` | Run inside a git worktree; resolve the underlying git error and re-run. |

## See also

- `assets/hive-dispatch.yml.tpl` — workflow template scaffolded by this skill.
- `assets/sandcastle-hive-bridge.mts.tpl` — bridge template scaffolded by this skill.
- `tests/sandcastle-gh-init/scaffold.test.mjs` — fixture-based test suite for the helper.
