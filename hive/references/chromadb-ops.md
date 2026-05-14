# ChromaDB Sidecar Operations

Hive's L3 semantic recall uses an optional local ChromaDB sidecar. The sidecar
is best-effort: if it is missing or still cold-starting, consumers fall back to
L1+L0 memory paths.

## Scripts

Lifecycle scripts live in `hive/scripts/`:

```sh
bash hive/scripts/chromadb-start.sh
bash hive/scripts/chromadb-status.sh
bash hive/scripts/chromadb-stop.sh
```

State files are written under `~/.claude/hive/`:

| File | Purpose |
|------|---------|
| `chromadb.lock` | Single-instance lock sentinel |
| `chromadb.pid` | Sidecar process id used by `chromadb-stop.sh` |
| `chromadb.port` | Ephemeral HTTP port for the JS wrapper consumer |
| `chromadb.log` | ChromaDB startup output used to capture the port |

The start script uses a non-blocking lock (`flock -n` when available) and exits
without polling `/heartbeat`. It captures the port from `chroma run --port 0`
output, writes `chromadb.port`, and returns within the startup budget. Readiness
is intentionally left to the first consumer probe.

## SessionStart Hook

The shipped plugin manifest registers a fire-and-forget `SessionStart` hook in
`.claude-plugin/plugin.json`:

```sh
bash -lc 'bash "${CLAUDE_PLUGIN_ROOT}/hive/scripts/chromadb-start.sh" >/dev/null 2>&1 & disown || true'
```

If a consumer does not install hooks from the plugin manifest, add the same
command to the project-level Claude hook config at `.claude/settings.json` under
`SessionStart`. Keep the background `& disown` shape so session startup never
waits for ChromaDB readiness.

## Dependency

Install the ChromaDB CLI with one of:

```sh
pip install chromadb
pipx install chromadb
```

If `chroma` is absent, `chromadb-start.sh` exits 0 with a warning and Hive keeps
using L1+L0 memory retrieval.

## Troubleshooting

Check current lifecycle state:

```sh
bash hive/scripts/chromadb-status.sh
```

Status meanings:

| Status | Exit | Meaning |
|--------|------|---------|
| `running` | 0 | PID is alive and `chromadb.port` exists |
| `stopped` | 1 | No lockfile state exists |
| `stale-lockfile` | 2 | Lockfile exists but the recorded PID is not alive |

Recover stale state:

```sh
rm -f ~/.claude/hive/chromadb.lock ~/.claude/hive/chromadb.pid ~/.claude/hive/chromadb.port
rm -rf ~/.claude/hive/chromadb.lockdir
bash hive/scripts/chromadb-start.sh
```

Port collisions are avoided by launching ChromaDB on an ephemeral port via
`--port 0`. The chosen port is stored in `~/.claude/hive/chromadb.port` for the
S3.2 consumer, `hive/lib/chromadb-wrapper.js`.
