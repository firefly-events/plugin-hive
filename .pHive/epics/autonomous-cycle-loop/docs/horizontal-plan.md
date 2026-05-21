# Horizontal Plan — autonomous-cycle-loop

Architectural layers touched by this epic. Cross-layer dependencies are explicit so the vertical slicer can cut clean increments.

## Layers

### L1 — Configuration surface (`hive.config.yaml` shipped baseline + consumer root override)

New knobs:

```yaml
standup:
  interactive_default: false       # /standup --interactive override default

planning:
  publish_in_sandcastle: false     # sandcastle /plan writes files only by default
  sandcastle_mode_auto_artifact: true  # auto-write artifacts where prose would prompt user

execution:
  terminal_handoff_default: none   # epic-level default; story override wins

test:
  simulated_manual:
    default_mode: spec-walk        # spec-walk | implementation-walk
    timeout_seconds: 1800
```

Each knob is opt-in additive — defaults preserve existing behavior. Documentation cross-cutting concern fires for all.

### L2 — Skill markdown (`skills/<name>/SKILL.md`)

Edits:

- `skills/standup/SKILL.md` — new Phase 1.5 (Interactive Routing) gated on `--interactive` or `standup.interactive_default: true`.
- `skills/plan/SKILL.md` — `sandcastle_mode:` detection (env var `HIVE_SANDCASTLE_MODE=1`); all "present to user" steps detect and write artifact + log instead of prompting.
- `skills/test/SKILL.md` — new section "Simulated Manual" + argument parsing for `--simulated-manual`.
- `skills/execute/SKILL.md` — new step at end of per-story loop reading `terminal_handoff.next` and dispatching to `/test` and/or `/review`.

### L3 — Workflow YAML + step files (`hive/workflows/`)

- `hive/workflows/daily-ceremony.workflow.yaml` — gain a `1.5 interactive-routing` phase (referenced when --interactive).
- `hive/workflows/steps/daily-ceremony/interactive-routing.md` — new step file.
- `hive/workflows/classic.workflow.yaml`, `tdd.workflow.yaml`, `bdd.workflow.yaml` — optional `scenario` step inserted by /plan when the simulated-manual concern applies.
- `hive/workflows/steps/test/simulated-manual.md` — new step file.

### L4 — Reference docs (`hive/references/`)

- `hive/references/story-yaml-schema.md` — add `terminal_handoff:`, `visibility:`, `manual_verdict:` sections.
- `hive/references/test-scenario-schema.md` — NEW.
- `hive/references/cross-cutting-concerns.md` — document the new `simulated-manual` concern (the concern itself is added in the project's `.pHive/cross-cutting-concerns.yaml`).
- `hive/references/sandcastle-mode.md` — NEW. Documents the env-var contract and the artifact-vs-prompt behavior switch.

### L5 — Sandcastle dispatch glue (`.github/workflows/hive-dispatch.yml` + bridge)

- Two-label trigger: `hive:ready` (execute, unchanged) | `hive:plan` (new).
- `derive` job emits `mode_decision: plan|execute` and rejects ambiguous label sets.
- `run` job branches: execute branch unchanged; plan branch sets `HIVE_SANDCASTLE_MODE=1` and invokes `/plan` against the issue body.
- Plan branch opens a draft PR titled `[plan] <epic-id>` carrying only the `.pHive/epics/<epic-id>/` tree + `.gitignore` allowlist edit.

### L6 — Adapter / library code (`hive/lib/`)

- `hive/lib/task-tracking-dispatch/index.ts` — already-shipped `createStory` is consumed by standup interactive flow (no new ABI).
- `hive/lib/external/github-issues-adapter.js` — already-shipped `publishStoriesToIssues` reused. NEW: a `labelExistingIssue({issue_number, labels[]})` helper for the "assign hive:ready to an existing GH issue" path. Minimal addition.
- `hive/lib/scenarios/load.mjs` — NEW. Loads + validates a scenario YAML.
- `hive/lib/handoff/dispatch.mjs` — NEW. Spawns `/test` or `/review` as a child invocation; enforces timeout; returns verdict summary.

### L7 — Cycle-state schema (`hive/references/cycle-state-schema.md` + `.pHive/cycle-state/<epic>.yaml`)

- Add `handoff_log:` entries `[ {story_id, target, started_at, finished_at, verdict, evidence_ref} ]`.
- Add `routing_decisions:` for the interactive standup output `[ {item_id, route, confidence, operator_override?, applied_at} ]`.

### L8 — Telemetry / KG (`hive/lib/kg_emit_cli`, JSONL events)

- New `phase_handoff` triple (subject=story, predicate=phase_handoff, object=`<target_skill>:<verdict>`).
- New `visibility_routing` JSONL event for retro analysis of heuristic accuracy.
- New `simulated_manual_verdict` triple (subject=story, predicate=manual_verdict, object=`pass|fail|inconclusive`).

## Cross-layer dependencies

| Slice | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|-------|----|----|----|----|----|----|----|----|
| A — Interactive standup | ✓ | standup | daily-ceremony | story schema | — | labelExistingIssue helper | routing_decisions | visibility_routing |
| B — Sandcastle planning | ✓ | plan | — | sandcastle-mode | dispatch + bridge | — | — | — |
| C — Simulated manual | ✓ | test, plan | test step + scenario | scenario schema, concerns | — | scenarios/load | — | simulated_manual_verdict |
| D — Execute handoff | ✓ | execute | (none) | story schema | — | handoff/dispatch | handoff_log | phase_handoff |

Critical-path observations:

- Slice A and Slice D both modify `story-yaml-schema.md` (L4) — schema edits should land in a single shared "schema bump" story before slice work starts, or the slices order themselves (A first, D adds the next field on top).
- Slice B's `sandcastle_mode` detection needs `HIVE_SANDCASTLE_MODE=1` to be set by the bridge — bridge edit + plan edit must ship in the same slice to avoid a half-wired state.
- Slice C is fully independent.
