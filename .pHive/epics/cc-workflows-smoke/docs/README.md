# cc-workflows-smoke — throwaway substrate validation

**Disposition:** keep-as-zeroth-party (throwaway). NEVER merges to `develop`.

This epic exists to dogfood the `cc-workflows` execution substrate added in
PR #241 (`feat/cc-workflows-first-party`). Three trivial depth-0 stories
exercise the full chain so substrate bugs surface against a known-trivial
workload before real epics route through `execution.runtime: cc-workflows`.

## Substrate chain under test

```
/hive:execute cc-workflows-smoke
  → skills/execute/SKILL.md step 6f
    → skills/hive/skills/execute-dispatch/SKILL.md          # mode + runtime resolution
      → skills/hive/skills/execute-mode-cc-workflows/SKILL.md  # per-story dispatch
        → Workflow tool invocation
        → per-story polling + terminal-status normalization
        → episode marker + .messages.jsonl sidecar writes
        → orchestrator-attributed serial reconcile + commit on feat/cc-workflows-smoke
```

## Trigger

The substrate's env trigger is `HIVE_EXECUTION_RUNTIME=workflows`; the root
config equivalent is `execution.runtime: cc-workflows`. To run:

```
HIVE_EXECUTION_RUNTIME=workflows /hive:execute cc-workflows-smoke
```

## Stories

| ID | Touch set | Notes |
|---|---|---|
| `smoke-1-append-note` | `.pHive/smoke/cc-workflows/NOTES-1.md` | Bounded-slice; depth-0 |
| `smoke-2-append-note` | `.pHive/smoke/cc-workflows/NOTES-2.md` | Bounded-slice; depth-0 |
| `smoke-3-append-note` | `.pHive/smoke/cc-workflows/NOTES-3.md` | Bounded-slice; depth-0 |

All three are `parallel_allowed: true` with `parallel_rationale: bounded-slice`
and disjoint `files_to_modify`. They form a single depth-0 fan-out so the
substrate is forced to dispatch all three concurrently, poll independently, and
reconcile them as three distinct commits on the epic branch.

## Pass criteria (in order)

1. /execute resolves `mode_decision=cc-workflows` with source `env` (or `config`
   if you flipped `hive.config.yaml execution.runtime: cc-workflows` instead of
   setting the env var). Telemetry line shows `execution_mode={source}`.
2. All three stories dispatch through the Workflow tool — no fall-through to
   sandcastle, multica, sessions, team, or sequential modes.
3. Three episode markers + three `.messages.jsonl` sidecars exist after the
   run, one per story ID; no marker is empty or missing.
4. Each `NOTES-N.md` gains exactly one appended line in the documented format.
5. Exactly three commits land on `feat/cc-workflows-smoke`, one per story, each
   subject starting with `chore(smoke): smoke-N-append-note`. The
   orchestrator-attributed reconcile is what produces these — agents do not
   commit directly.

If ANY criterion fails, the substrate is wrong (not the smoke epic). Capture
the failure mode + run artifacts into `.pHive/audits/post-run/` and file the
finding against PR #241 before the throwaway branch is deleted.

## Teardown

When the test run is complete and findings are captured:

```
git branch -D feat/cc-workflows-smoke
git push origin --delete feat/cc-workflows-smoke
rm -rf .pHive/epics/cc-workflows-smoke .pHive/smoke
```

Remove the `.gitignore` allowlist lines for `cc-workflows-smoke` as part of the
same cleanup.
