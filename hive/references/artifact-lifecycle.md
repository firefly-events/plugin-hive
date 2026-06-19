# Artifact Lifecycle

Weekly sweep that evicts stale untracked runtime artifacts (DAG run-state,
metrics streams, interrupts, context snapshots, staged insights, Chroma
sidecars, scratch) by moving them to the OS temp directory.

## Architecture

All safety, dry-run/apply behavior, class filtering, hard exclusions, and
active guards live in the Python CLI (`hive.lib.artifact_lifecycle`).  The
scheduler only triggers the CLI; it never duplicates sweep logic in shell.

## CLI quick-reference

```sh
# Report candidates without evicting (default)
python -m hive.lib.artifact_lifecycle

# Dry-run: print what would be evicted
python -m hive.lib.artifact_lifecycle --dry-run

# Apply: move artifacts to OS temp
python -m hive.lib.artifact_lifecycle --apply

# Scope to one or more artifact classes
python -m hive.lib.artifact_lifecycle --class dag-run-state --dry-run
```

## Manual invocation (operator)

```sh
# From repo root — dry-run first, then apply if output looks correct
./hive/scripts/artifact-lifecycle-weekly.sh --dry-run
./hive/scripts/artifact-lifecycle-weekly.sh --apply
```

Arguments are passed through directly to the CLI, so all flags work.

## Weekly scheduler installation

The wrapper script is designed to be called by launchd (macOS) or cron
(Linux/CI).  It runs in **report mode** by default (no evictions); operators
add `--apply` to enable actual eviction.

### launchd (macOS)

Create `~/Library/LaunchAgents/com.firefly.artifact-lifecycle.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.firefly.artifact-lifecycle</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/path/to/plugin-hive/hive/scripts/artifact-lifecycle-weekly.sh</string>
    <string>--apply</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/artifact-lifecycle-weekly.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/artifact-lifecycle-weekly.log</string>
</dict>
</plist>
```

Load it:

```sh
launchctl load ~/Library/LaunchAgents/com.firefly.artifact-lifecycle.plist
```

### cron

```cron
# Every Monday at 03:00
0 3 * * 1 cd /path/to/plugin-hive && ./hive/scripts/artifact-lifecycle-weekly.sh --apply >> /tmp/artifact-lifecycle-weekly.log 2>&1
```

## Failure behaviour

If the CLI exits non-zero (e.g. a guard refuses an action or an unknown class
ID is passed), the wrapper logs the exit code and exits with the same code.
No fallback deletion logic runs.

## Logs

Default log location: `.pHive/logs/artifact-lifecycle-weekly.log`.
Override via `HIVE_ARTIFACT_LOG_DIR` environment variable.
