# Insights — sls-2 apply squad instructions

- `multica squad update --instructions` takes a plain string flag only — no
  `--instructions-file`/stdin variant. Shell `"$(cat file)"` works fine for a
  ~6.5 KB doc; no length limit hit. Append-safety must be hand-rolled by
  reading the existing field first (`squad get --output json | jq -r
  .instructions`) — the API replaces, never merges.

- The squad's `instructions` field was EMPTY at apply time, despite the
  PLU-293 spike having injected a DOCTRINE-ACK marker there earlier. Squad
  instructions are evidently volatile across reconfigs — exactly the failure
  mode the "Applying to a squad" re-apply section guards against. Do not
  assume a previously-applied carrier survived; verify with `squad get`
  before relying on it.

- Applying the *entire canonical doc* as the instructions (rather than an
  excerpt) makes the "instructions match the doc" acceptance check a trivial
  string equality and keeps one source of truth. The doc embeds its own
  acknowledgment marker (`TERMINAL-ACK::squad-leader-terminal-contract::v1`)
  so probes never need a side-channel secret.

- Probe design gotcha: a leader with zero children passes the
  children-terminal check vacuously — the probe brief must say "do NOT
  delegate" explicitly, otherwise the leader may spawn a child issue just to
  have something to summarize, which adds noise and latency.

- Daemon worktree clash: the epic branch `feat/squad-leader-status-flip` was
  already checked out in a sibling agent worktree, so `git checkout <branch>`
  fails with "already used by worktree". Workaround: `git checkout --detach
  FETCH_HEAD`, commit detached, then `git push origin
  HEAD:feat/squad-leader-status-flip`. Peer stories on shared epic branches
  should expect this.
