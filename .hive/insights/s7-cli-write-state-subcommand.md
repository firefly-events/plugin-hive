# s7-cli-write-state-subcommand — Implementation Insights

## Key decisions

**Validation before write.** Unknown top-level keys are rejected before calling
`writeHermesReconcilerState`. The AC says "no partial write" on invalid patch — so
validate first, fail early, never let the write happen.

**VALID_PATCH_KEYS mirrors DEFAULTS.** The set of accepted keys is derived from the
`DEFAULTS` constant in `state.mjs`. If fields are ever added to `DEFAULTS`, they must
also be added to `VALID_PATCH_KEYS` in `cli.mjs`. These two places need to stay in sync.

**`cmdWriteState` takes no `cfg` param.** Unlike most subcommands, it's local-only and
never touches the network. The switch in `main()` passes `await cmdWriteState(args)` with
no `cfg` argument — matching the same pattern `cmdEpicStatus` uses.

**Rollup echo reuses `cmdEpicStatus` shape.** After writing, the command reads back the
state and emits the same JSON shape `epic-status` emits. This lets callers use one
schema for both read (epic-status) and write-then-read (write-state) flows.

**stories[] in rollup is filtered to known fields.** Only `phase_position`, `attempt`,
`verdict` are projected in the rollup — same as `epic-status`. Unknown per-story fields
written via patch are persisted in the YAML but not surfaced in the JSON echo.

## Gotchas

**The branch-checked-out-in-another-worktree error.** `git checkout feat/hermes-core-loop-mvp`
fails if that branch is already open in another worktree. Work in the existing worktree at
its resolved path instead of trying to re-check it out.

**hermes-multica Python plugin files not present.** The issue references
`plugins/hermes-multica/tools.py` and `client.py` to drop stale TODO comments, but those
files are not in the `plugin-hive` repo. They live in a separate `hermes-agent` repo that
was not available in this workspace. The TODO cleanup was skipped and flagged in the result
comment.
