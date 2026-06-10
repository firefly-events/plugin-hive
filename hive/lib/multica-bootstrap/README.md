# Multica Bootstrap Helper
`hive/lib/multica-bootstrap/index.mjs` contains the stateful helper layer for
`/hive:multica-init`.
The module is pure ESM and intentionally independent of the skill runtime.
Callers provide flags, paths, credentials, and consent; the helpers perform the
smallest possible Multica operation and return compact result records.
See the orchestration skill at `skills/multica-init/SKILL.md`.
## Public API
### `checkHealth({ serverUrl })`
Calls `GET /healthz` on the Multica server.
Returns `{ ok, checks, latencyMs }`.
Throws `SERVER_UNHEALTHY` when the server responds but does not report
`status: "ok"`, and `TRANSPORT` when the server cannot be reached.
### `ensureCli({ consent })`
Runs `multica --version`.
If the CLI is missing, this helper requires consent before shelling out to
`brew install multica`.
Returns `{ installed, version }`.
### `ensureAuth({ serverUrl, configPath, consent, promptFn })`
Reads the Multica config path first. If it already contains a token, returns
`{ tokenSource: "existing" }` without touching the server.
When no token exists, it sends an auth code, verifies the code, mints a PAT,
and writes the PAT to `configPath`.
Returns `{ tokenSource: "minted" }`.
The helper never logs or returns the full PAT.
### `ensureWorkspace({ serverUrl, token, slug, consent })`
Lists workspaces and finds an existing workspace by slug.
If absent, it requires consent before `POST /api/workspaces`.
Returns `{ workspaceId, issuePrefix, created }`.
Slug is the uniqueness key.
### `ensureDaemon({ consent })`
Runs `multica daemon status`.
If the daemon is not running, it requires consent before
`multica daemon start`.
Returns `{ running, pid }`.
### `reconcileAgents({ serverUrl, token, workspaceId, agentsConfigPath, repoRoot, consent })`
Loads desired agents from `agentsConfigPath`, fetches current agents, resolves
runtime ids from `GET /api/runtimes`, resolves persona instructions via
`hive/lib/multica-agents-config`, then creates or updates only what differs.
Returns `{ created, patched, skipped, removed }`.
Existing agents not listed in the config are left untouched (logged as warnings).
### `reconcileSkills({ serverUrl, token, workspaceId, skillsConfigPath, repoRoot, consent })`
Loads desired skill exports from `skillsConfigPath` (`.pHive/multica/skills-export.yaml`).
For each export entry reads `skill_ref` + all `substrate_deps` from the filesystem,
bundles them into a single content string, computes a SHA-256 `content_hash`, and
creates or updates the skill in Multica only when the hash or visibility differs.
Returns `{ created, patched, skipped, removed }`.
Skills not listed in the config are left untouched (logged as warnings, never deleted).
Path validation runs before any network call — a missing `skill_ref` or `substrate_dep`
aborts the full reconcile with a `VALIDATION_ERROR` rather than performing a partial import.
## Consent Contract
Every state-changing operation must receive `consent: true`.
Without consent, helpers throw:
`{ code: "CONSENT_REQUIRED", message, hint }`
This includes CLI install, auth send-code, PAT mint, workspace create, daemon
start, agent create, and agent update.
## Idempotency Notes
Helpers always check current state first and skip completed work.
HTTP calls use direct `fetch`; shell commands are used only for CLI install and
daemon operations.
Runtime lookup is cached per process after the first successful runtimes fetch.
Agent reconciliation compares desired payload fields only.
Extra Multica agents are preserved.
Repo allowlist handling is intentionally deferred.
## Manual Smoke Test
Run the skill with `--server-url`, `--workspace-slug`, and `--yes` only against
a disposable local Multica server.
Do not use this helper against production credentials unless the workspace and
agents are intended to be created or updated.
