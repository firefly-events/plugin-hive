# Archive Audit Note — commit: TBD Historical Integrity Break

## Summary

The archived ledger at `.pHive/meta-team/archive/2026-04-19/ledger.yaml` contains a cycle-state entry at `cycle_id: meta-2026-04-13` with `commit: TBD`. This entry is preserved as-is per user decision Q-new-D; it is not a newly introduced issue and must not be rewritten.

## What the defect is

In `.pHive/meta-team/archive/2026-04-19/ledger.yaml`, the archived entry for `cycle_id: meta-2026-04-13` records a completed cycle with `verdict: passed` but leaves the `commit` field as `TBD`.

In plain terms, the cycle closed successfully, but the ledger failed to capture the commit hash that should have been recorded at close.

The operational consequence is narrow but real: the archive preserves evidence that the cycle happened, but the exact "what did this cycle change" evidence cannot be reconstructed from the ledger alone.

To recover that linkage, a future operator would need to correlate the recorded cycle window against git history for 2026-04-13 rather than relying on the ledger entry itself.

## Why it's preserved

User decision Q-new-D in `.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md` explicitly chose preservation plus audit note over retroactive normalization:

`NEW Q5 (commit: TBD historical ledger entry): (A) — add optional A1.6 MANIFEST audit-note story during archive. Preserves history + flags the integrity break.`

The rejected alternative was to backfill a commit hash after the fact. That would rewrite historical evidence and could misrepresent which commit the cycle actually affected.

Preservation plus audit note is the safer archival discipline because it keeps the original defect visible, bounded, and interpretable without inventing new historical certainty.

## Rules for future readers

- Treat the `commit` field of the `meta-2026-04-13` entry as UNRELIABLE.
- DO NOT edit the archived ledger to "fix" this entry; the archive is immutable evidence.
- If you need the actual commit for that cycle, correlate via `git log --since="2026-04-13" --until="2026-04-14" --all`.
- If a similar defect occurs in a future cycle, write another `AUDIT-NOTE.md` rather than retroactively modifying history.

## Scope

This note applies only to the single `meta-2026-04-13` entry in the archived ledger.

All other ledger entries in `.pHive/meta-team/archive/2026-04-19/ledger.yaml` have correct `commit` fields.

## Cross-refs

- [MANIFEST.md](./MANIFEST.md)
- [ledger.yaml](./ledger.yaml)

indexed-for-meta-meta-optimize proving run: meta-2026-04-22-r2
