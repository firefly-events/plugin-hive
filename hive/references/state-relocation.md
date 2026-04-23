# Relocating the State Directory

By default, Hive stores per-project state under `.pHive/` at your project
root. You can move it elsewhere via the `paths.state_dir` key in your root
`hive.config.yaml`.

## When you'd want this

- You want project state to live outside the Git-tracked tree (e.g., under
  `~/.hive-state/<project>`)
- You run multiple worktrees and want each to keep its own state
- CI needs a writable scratch directory that isn't the repo root

## How to configure

In `hive.config.yaml` at your project root, add (or edit) the `paths` block.
Pick an absolute or relative value for `state_dir` to suit your setup — relative
paths resolve against the project root (the directory where `hive.config.yaml`
lives); absolute paths are used as-is.

```yaml
paths:
  # Absolute example — state lives outside the Git-tracked tree:
  state_dir: /Users/alice/.hive-state/my-project
  # Relative example (comment out the line above and uncomment this one):
  # state_dir: ../.hive-state
  target_project: null  # leave null to use the invoking cwd
```

## What honors `paths.state_dir` today

As of the hive-release-readiness release, these runtime consumers read the
resolved state dir:

- All 5 metrics hooks (`hooks/metrics-*.sh`) — events write under
  `<state_dir>/metrics/events/`
- The Stop hook (`hooks/stop-interrupt-capture.sh`) — interrupts write under
  `<state_dir>/interrupts/`
- The 3 Tier-1 runtime step files (meta-team-cycle/step-01-boot,
  meta-team-cycle/step-02-analysis, daily-ceremony/step-01-load-state) — use
  `$HIVE_STATE_DIR/...` placeholders that agents resolve at use-site

## What does NOT yet honor it

A broader runtime sweep is tracked under the `project_state_dir_resolver`
follow-up. Until that completes, some skills and workflows still reference
`.pHive/` directly. If you relocate the state dir and encounter a hook,
skill, or workflow that writes to a hard-coded path, that's expected — flag
it for the follow-up work rather than treating it as a bug.

## Migration

If you already have state at `.pHive/` and want to move it:

1. Stop any running Hive session.
2. Move the state. Pick ONE of these depending on what you want:

   **Option A — `.pHive` contents become the new state root** (typical).
   The new directory must NOT exist beforehand, or use `rsync` if it already does:
   ```bash
   # Fresh destination (must not exist):
   mv .pHive /new/state/dir
   # OR destination already exists (merge contents):
   rsync -a .pHive/ /new/state/dir/ && rm -rf .pHive
   ```
   Then set `paths.state_dir: /new/state/dir` in root `hive.config.yaml`.

   **Option B — keep `.pHive` as a sub-directory under a parent.**
   Move the whole `.pHive/` directory under a parent you already use:
   ```bash
   mv .pHive /parent/of/state/
   ```
   Then set `paths.state_dir: /parent/of/state/.pHive` (include the `.pHive`
   basename so the resolver points at the moved directory).

3. Resume work.

No data transformation is needed — the directory shape is identical in both
locations; only the resolver's base changes.

## See also

- `hive/references/state-boundary.md` — what ships vs what stays local
- `hive/references/configuration.md` — full config reference
- `hooks/common.sh` — the unified resolver that honors this key
