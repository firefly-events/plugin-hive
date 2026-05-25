# multica repo checkout — verification log

## CLI signature (from --help)

```text
Creates a git worktree from the daemon's bare clone cache. Used by agents to check out repos on demand.

USAGE
  multica repo checkout <url> [flags]

FLAGS
  -h, --help         help for checkout
      --ref string   branch, tag, or commit to check out instead of the remote default branch

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `multica <command> <subcommand> --help` for more information about a command.
```

## Probe invocation

Command: `multica repo checkout https://github.com/firefly-events/plugin-hive --ref feat/multica-integration-fixes`
Exit code: `1`
Output:

```text
Error: MULTICA_DAEMON_PORT not set (this command is intended to be run by an agent inside a daemon task)
```

## Resulting workdir state

No checkout workdir was created by the standalone invocation. `ls -la workdir` returned `ls: workdir: No such file or directory`, and `find . -maxdepth 3 -type d -name plugin-hive -path './workdir/*' -print` returned no matches.

## Skill patch implication

`multica repo checkout` should not be invoked as a standalone orchestrator-side pre-dispatch command. The command is daemon-task scoped and requires `MULTICA_DAEMON_PORT`, so the skill should put the explicit `multica repo checkout <url> --ref <branch>` requirement in the task brief/dispatch payload and make the assigned Multica task verify `workdir/plugin-hive` and the active branch before doing implementation work.
