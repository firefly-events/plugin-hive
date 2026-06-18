# al-6-weekly-automation — Implementation Insights

## Shell wrapper must not shadow `python`

The test harness injects a mock `python` binary via `PATH`.  The wrapper
invokes `python -m hive.lib.artifact_lifecycle`, so the mock intercepts it
cleanly.  If the wrapper had used `python3` or an absolute interpreter path,
the test shim would not work without extra plumbing.  Keep the wrapper using
`python` and document that the environment must have the right interpreter on
PATH (the caller's venv/shim handles this in practice).

## `set -euo pipefail` plus manual exit-code capture

Using `set -e` means a bare `python ... "$@"` would exit the script on
non-zero without giving us a chance to log the failure code.  The fix is
capturing the exit with `if python ...; then ... else EXIT_CODE=$? ...; fi`.
This pattern lets the wrapper both propagate the non-zero code AND write a
human-readable log line before exiting.

## No launchd/cron required for tests

The acceptance criterion ("verify command target and arguments without
requiring launchd or cron") is satisfied by running the shell script directly
in a subprocess with a mock `python` on PATH.  The scheduler is purely an
external trigger; its configuration is documentation-only from the test's
perspective.

## Argument pass-through is the simplest contract

Rather than parsing flags in the shell wrapper, `"$@"` forwards everything.
This means operators get full CLI power (--dry-run, --apply, --class) without
the wrapper ever needing updating when the CLI gains new flags.
