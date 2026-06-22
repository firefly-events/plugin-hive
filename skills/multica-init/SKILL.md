---
name: multica-init
description: Bootstrap Multica for Hive by checking the server, CLI, auth, workspace, daemon, and agents.
---

# Hive Multica Init

Bootstrap Multica for this Hive repository.

**Input:** `$ARGUMENTS` may include flags:

- `--yes`
- `--server-url <url>`
- `--workspace-slug <slug>`

## When To Use

Use this skill when a repository is adopting the Multica task-tracking substrate
and needs a local developer environment prepared end to end.

Use it for a first bootstrap on a new machine.

Use it after switching to a new Multica server.

Use it after `.pHive/multica/agents.yaml` changes and agents need to be
reconciled.

Use it when the Multica adapter reports missing credentials, missing workspace
configuration, or missing agents.

Do not use it for general task-tracking operations.

Use it to bind the project repository to the workspace (Step 10, `ensureRepos`)
so each task workdir is a real checkout. The `PUT /api/workspaces {repos}`
endpoint is available as of Multica 0.3.26.

> **One repo per workspace.** Bootstrap a *dedicated* workspace per project
> (the default — `ensureWorkspace` keys on the project `--workspace-slug`). The
> DAG agent-spawn binding does not pass a per-task repo selector, so the daemon
> cannot reliably pick a target when a workspace has more than one bound repo:
> a planning/execution task may check out the wrong repo and write its `.pHive`
> output into it. Do **not** share one workspace across multiple project repos.
> (True multi-repo targeting is a Multica daemon feature, tracked separately.)
>
> **Plugin-shipped assets.** The agent personas and exported skills referenced
> by `agents.yaml` / `skills-export.yaml` live in the **plugin install**, not in
> a consumer project's repo. `reconcileSkills` / `reconcileAgents` resolve those
> `skill_ref` / `persona_ref` / `substrate_dep` paths against the plugin root by
> default (`pluginRoot`), so a consumer project can bootstrap the Hive roster
> without copying the plugin's source into the project tree.

## What This Skill Does

Run the bootstrap flow:

1. Check Multica server health with `checkHealth`.

2. Ensure the `multica` CLI is installed with `ensureCli`.

3. Ensure authentication and a local PAT with `ensureAuth`.

4. Ensure the target workspace exists with `ensureWorkspace`.

5. Ensure the local daemon is running with `ensureDaemon`.

6. Reconcile exported skills with `reconcileSkills`. This MUST precede agents — `reconcileAgents` resolves the skill names declared in `agents.yaml` to workspace skill IDs, so the skills must already exist.

7. Reconcile configured agents with `reconcileAgents` (also attaches each agent's declared skills by resolving names to IDs).

8. Reconcile configured squads with `reconcileSquads` (squads depend on agents existing).

9. Reconcile configured autopilots with `reconcileAutopilots`.

10. Bind the project repository to the workspace with `ensureRepos` (consent-gated;
    defaults to the `origin` remote, override with an explicit `repoUrl`). Without a
    bound repo, the daemon hands agents a bare scaffold and file output cannot be
    committed. Idempotent — a no-op when the repo URL is already bound. Report the
    bound URL (or the idempotent skip) in the status summary.

## Plugin discovery

Claude-provider agents pick up Claude Code plugins via `custom_env.CLAUDE_PLUGIN_PATH` (default `${HOME}/.claude/plugins`). `reconcileAgents` expands `${HOME}`, `$HOME`, and leading `~` to the bootstrap user's home directory before sending the value to Multica — Claude Code does not perform tilde expansion on env values, so the stored value must be absolute. The agent runtime then resolves slash commands like `/hive:status` from that path. Override per-agent in `.pHive/multica/agents.yaml` if the daemon runs as a different user than the plugin install location implies. This convention follows the source-backed rationale in `.pHive/upstream-watch/multica-plugin-loading.md`, and preserves the single-writer invariant: only `multica-init` mutates Multica-side agent state.

## Process

Parse `$ARGUMENTS` before calling helpers.

Default `serverUrl` to `http://127.0.0.1:8080`.

Default `workspaceSlug` to `plugin-hive`.

Default `agentsConfigPath` to `.pHive/multica/agents.yaml`.

Default `configPath` to `~/.multica/config.json`.

Default `consent` to `false`.

Set `consent` to `true` only when `--yes` is present or the user explicitly
approves the individual state-changing action.

Call helpers in this exact order:

1. `checkHealth({ serverUrl })`

   Confirm the server responds to `GET /healthz` with `status: "ok"`.

   If this fails, stop before touching CLI, auth, workspace, daemon, or agents.

2. `ensureCli({ consent })`

   Confirm `multica --version` works.

   If the CLI is absent, ask for consent before installation unless `--yes`
   was supplied.

3. `ensureAuth({ serverUrl, configPath, consent, promptFn })`

   Read the Multica config first.

   If a PAT already exists, continue without minting a new PAT.

   If no PAT exists, ask before sending the verification code unless `--yes`
   was supplied.

   Ask for the Multica account email if `MULTICA_EMAIL` is not set.

   Ask for the six-digit verification code if
   `MULTICA_DEV_VERIFICATION_CODE` is not set.

   Ask before minting the PAT unless `--yes` was supplied.

4. `ensureWorkspace({ serverUrl, token, slug: workspaceSlug, consent })`

   Read the token from the config written or found by `ensureAuth`.

   Find the workspace by slug.

   If it already exists, continue.

   If absent, ask before creating it unless `--yes` was supplied.

5. `ensureDaemon({ consent })`

   Check `multica daemon status`.

   If it is not running, ask before starting it unless `--yes` was supplied.

   Continue only after the daemon is running.

6. `reconcileSkills({ serverUrl, token, workspaceId, skillsConfigPath, repoRoot, consent })`

   Run this BEFORE `reconcileAgents`: agents reference skills by name in
   `agents.yaml`, and those names must resolve to existing workspace skill IDs.

   Default `skillsConfigPath` to `.pHive/multica/skills-export.yaml`.

   If the file does not exist, skip this step silently.

   For each entry, read `skill_ref` content and bundle `substrate_deps` into a single payload.

   Compute `content_hash` (SHA-256) of the normalised bundle.

   Create missing skills.

   Update skills whose `content_hash` or `visibility` differs from the live copy.

   Skip skills whose hash matches.

   Leave Multica skills not listed in `skills-export.yaml` untouched (warn but never delete).

7. `reconcileAgents({ serverUrl, token, workspaceId, agentsConfigPath, repoRoot, consent })`

   Load desired agents from `.pHive/multica/agents.yaml`.

   Resolve each agent runtime by provider.

   Resolve each `persona_ref` to markdown instructions.

   Create missing agents.

   Patch drifted agents.

   Skip unchanged agents.

   Attach each agent's declared `skills` by resolving the names to workspace skill
   IDs via `PUT /api/agents/{id}/skills`. The `skills` list in `agents.yaml` is
   authoritative for the attachment. An unknown skill name fails with
   `SKILL_NOT_FOUND` — run `reconcileSkills` first.

   Leave extra Multica agents untouched.

8. `reconcileSquads({ serverUrl, token, workspaceId, squadsConfigPath, consent })`

   Load desired squads from `.pHive/multica/squads.yaml`.

   Default `squadsConfigPath` to `.pHive/multica/squads.yaml`.

   Resolve leader and member names to agent IDs.

   Create missing squads (with leader).

   Add and remove non-leader members to match YAML.

   Update drifted squad metadata (leader change, description change).

   Skip unchanged squads.

   Leave extra Multica squads untouched (warn, never delete).

9. `reconcileAutopilots({ serverUrl, token, workspaceId, autopilotsConfigPath, consent })`

   Load desired autopilots from `.pHive/multica/autopilots.yaml`.

   Resolve agent names to agent IDs.

   Create missing autopilots with their triggers.

   Patch drifted autopilot metadata.

   Reconcile triggers (add/update/delete).

   Capture webhook URLs from webhook triggers and emit them in the run output. They are NOT written back to `autopilots.yaml` (server-assigned runtime values stay out of the tracked manifest).

   Skip unchanged autopilots.

   Leave extra Multica autopilots untouched (warn, never delete).

## Flags

`--yes`

Skips consent prompts for state-changing operations.

Default: off.

`--server-url <url>`

Multica server URL.

Default: `http://127.0.0.1:8080`.

`--workspace-slug <slug>`

Workspace slug to find or create.

Default: `plugin-hive`.

The slug must contain only lowercase letters, numbers, and hyphens.

## Status Report Sample

Print a compact final report after all seven steps succeed:

```text
Multica bootstrap complete.

  Server:    http://127.0.0.1:8080 (healthy)
  Workspace: plugin-hive (PLU) - id: 21c6d282-...
  Daemon:    running, PID 94821
  Agents:    3 reconciled (1 created, 1 patched, 1 skipped)
  Squads:    2 reconciled (1 created, 0 patched, 1 skipped)
  Autopilots: 2 reconciled (1 created, 0 patched, 1 skipped)
  Skills:    1 reconciled (1 created, 0 patched, 0 skipped)

Run `multica daemon status` to monitor agent activity.
```

If the user declines a prompt, stop cleanly.

Do not print a stack trace for `CONSENT_REQUIRED`.

For structured helper failures, print the error message and hint.

Never print the full PAT.

Never print `Authorization` headers.

## Idempotency

This skill is safe to re-run.

Health is checked every time.

CLI installation is skipped when `multica --version` succeeds.

Auth is skipped when the config already contains a token.

Workspace creation is skipped when a matching slug exists.

Daemon start is skipped when `multica daemon status` succeeds.

Agent creation is skipped when an agent with the desired name exists.

Agent update is skipped when desired fields match Multica state.

Desired agent fields include `runtime_id`, `instructions`, `model`,
`max_concurrent_tasks`, `visibility`, `thinking_level`, `custom_env`,
`custom_args`, `mcp_config`, and `description`.

Skill attachment is reconciled separately from the agent body (the `/api/agents`
body ignores `skills`). The skill names declared in `agents.yaml` are resolved to
workspace skill IDs and set via the agent skills association, but only when the
resolved ID set differs from the live attachment (order-insensitive) — so a warm
re-run issues no skill change.

Agents present in Multica but absent from `.pHive/multica/agents.yaml` are
extras and must be left untouched.

Squad creation is skipped when a squad with the desired name exists.

Squad update is skipped when leader and description match Multica state.

Member add is skipped when the member already belongs to the squad.

Member remove fires only for members no longer in the desired YAML list.

Squads present in Multica but absent from `.pHive/multica/squads.yaml` are
extras and must be left untouched.

## References

Helper module:

`hive/lib/multica-bootstrap/index.mjs`

Helper README:

`hive/lib/multica-bootstrap/README.md`

Agent config helper:

`hive/lib/multica-agents-config/index.mjs`

Agent config:

`.pHive/multica/agents.yaml`

Squad config:

`.pHive/multica/squads.yaml`

Multica adapter:

`hive/adapters/multica/index.ts`

Research findings:

`.pHive/episodes/multica-substrate-adoption/s3-multica-init-bootstrap/research.findings.md`

Developer brief:

`.pHive/episodes/multica-substrate-adoption/s3-multica-init-bootstrap/brief.md`
