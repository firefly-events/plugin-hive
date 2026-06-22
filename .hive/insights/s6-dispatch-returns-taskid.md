# s6 Insights — dispatch returns task_id

**Best-effort null-tolerance is load-bearing.** The Multica platform may not have
assigned a task_id at the instant dispatch returns (the agent queue hasn't processed
the assignment yet). A hard failure here would break the dispatch path entirely.
`task_id: null` on the success payload is the correct signal — the watchdog can
recover on a later tick via `cli.mjs status`.

**Two separate GET /api/issues calls before the assignment.** `cmdDispatch` calls
`httpJson(issueUrl(...))` for the already-dispatched check, then `moveOutOfBacklogIfNeeded`
calls it again. Mock servers for dispatch CLI tests must handle at least two GETs on
the same issue URL. Track call count or just respond identically to both.

**spawnSync blocks the event loop; use execFile + promisify for CLI dispatch tests.**
`spawnSync` can't share a mock HTTP server with the child process (event loop is frozen).
`execFileAsync` + async test callbacks lets the in-process server respond to child
requests normally.

**`js-yaml` must be installed for the hermes-reconciler/state.mjs tests.** The
`epic-status` CLI tests rely on `readHermesReconcilerState`, which soft-fails when
`js-yaml` is absent (returns null defaults instead of parsed YAML). The test failure
looks like `gate_state: null !== 'pre_approved'` — easy to miss. Run
`npm install js-yaml` from the plugin-hive root if these tests fail.
