# Insights — al-1 lifecycle library and registry schema

## retire must be caught before classification checks

Validate `archive_action` membership first, then immediately reject `retire` before any
classification cross-field check. If you defer the retire check until the action/classification
matrix, a tracked+retire entry would trip D5 (wrong age_source) before hitting the deferred-verb
error, and the user sees a confusing message about mtime vs git-last-commit instead of the
clear "retire is deferred" message.

## Frozen dataclass + separate validate_entry is the right split

The `RegistryEntry` frozen dataclass carries `__post_init__` only for cheap self-consistency
(non-empty string, non-negative int). All semantic cross-field rules live in `validate_entry`.
This keeps the dataclass usable as a plain value type without re-running cross-field logic on
every construction, and keeps test setup simple (tests call `validate_entry`, not the constructor).

## age_source × classification is a hard constraint, not a hint

D5 is a binding constraint, not a default. The registry schema encodes it as a validation error
rather than silently coercing a wrong age_source. This prevents future entries from accidentally
declaring `mtime` for a tracked class and silently getting wrong eligibility dates on clone/checkout.

## CLI subprocess in tests is the right call for --help coverage

The `--help` acceptance criterion tests the CLI as an installed module entry point. Using
`subprocess.run([sys.executable, "-m", "hive.lib.artifact_lifecycle.cli", "--help"])` is
the correct approach — it validates the `__main__` path, argparse wiring, and zero-crash exit.
Mocking argparse or importing `main()` directly would miss the entry-point surface.
