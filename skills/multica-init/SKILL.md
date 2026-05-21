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

Do not use it to manage repository allowlists. That step is deferred because
the current Multica API has no write endpoint for workspace repos.

## What This Skill Does

Run a six-step bootstrap flow:

1. Check Multica server health with `checkHealth`.

2. Ensure the `multica` CLI is installed with `ensureCli`.

3. Ensure authentication and a local PAT with `ensureAuth`.

4. Ensure the target workspace exists with `ensureWorkspace`.

5. Ensure the local daemon is running with `ensureDaemon`.

6. Reconcile configured agents with `reconcileAgents`.

Step 7, repo allowlist, is deferred.

The endpoint does not exist in Multica v0.3.4.

Do not stub this step.

Do not no-op this step.

Do not mention success for repo allowlisting.

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

6. `reconcileAgents({ serverUrl, token, workspaceId, agentsConfigPath, repoRoot, consent })`

   Load desired agents from `.pHive/multica/agents.yaml`.

   Resolve each agent runtime by provider.

   Resolve each `persona_ref` to markdown instructions.

   Create missing agents.

   Patch drifted agents.

   Skip unchanged agents.

   Leave extra Multica agents untouched.

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

Print a compact final report after all six steps succeed:

```text
Multica bootstrap complete.

  Server:    http://127.0.0.1:8080 (healthy)
  Workspace: plugin-hive (PLU) - id: 21c6d282-...
  Daemon:    running, PID 94821
  Agents:    3 reconciled (1 created, 1 patched, 1 skipped)

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
`custom_args`, `mcp_config`, `skills`, and `description`.

Agents present in Multica but absent from `.pHive/multica/agents.yaml` are
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

Multica adapter:

`hive/adapters/multica/index.ts`

Research findings:

`.pHive/episodes/multica-substrate-adoption/s3-multica-init-bootstrap/research.findings.md`

Developer brief:

`.pHive/episodes/multica-substrate-adoption/s3-multica-init-bootstrap/brief.md`
