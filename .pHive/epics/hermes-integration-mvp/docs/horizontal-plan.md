# Horizontal Planning Scan — hermes-integration-mvp

Scope: Hive-side contract surface for Hermes-as-supervisor integration. Same-system runtime; cross-machine concerns deferred. Three target capabilities: context-snapshot read surface, standup Slack format, triage JSON output.

## 1. Layer Inventory

Plugin-hive is a Claude Code plugin (skills + agents + workflows + references), not a traditional service stack. Mapping the work onto Hive's architectural layers:

| Layer | What it does today | How this epic affects it |
|---|---|---|
| **Skills** | User-invocable surfaces (`/hive:plan`, `/hive:standup`, `/hive:triage`, etc.) at `skills/{name}/SKILL.md` | Adds 1 new skill (`context-snapshot`); modifies 2 (`standup`, `triage`) for new output flags |
| **References** | Canonical docs at `hive/references/` cited by skills | Adds JSON schema doc for context-snapshot; documents new flags on standup/triage; updates Routines bridge note to mention Hermes-equivalence |
| **Workflows + step files** | YAML workflow defs at `hive/workflows/` + step procedures | No changes — context-snapshot is read-only standalone skill, not a workflow |
| **Library (`hive/lib/`)** | Shared TS/JS helpers (story-status, kg-emit, etc.) | Adds context-snapshot composer (reads cycle-state, episodes, triage queue, story metric blocks → JSON) |
| **Tests** | bun test under `tests/` + per-feature fixtures | Adds JSON schema validation tests, snapshot tests for new output flags |
| **Cycle state / episodes** | Per-epic runtime state under `.pHive/` | Read-only consumer — no schema changes |
| **Triage queue** | `.pHive/triage/queue.yaml` (single-writer = triage skill) | Read-only consumer in context-snapshot; triage gains `--json` output flag, no state-machine changes |
| **External contract surface** | Stable CLI signatures + JSON output shapes consumed by external tools | Net-new — context-snapshot JSON schema becomes a versioned contract; standup `--format slack` + triage `--json` extend existing CLI contracts |

## 2. Per-Layer Requirements

### Layer: Skills

**NEW skill: `context-snapshot`**
- Path: `skills/context-snapshot/SKILL.md` (or `skills/hive/skills/context-snapshot/SKILL.md` for namespaced — decide in story design)
- Surface: `/hive:context-snapshot` (read-only)
- Flags: `--write` (write to `.pHive/context-snapshot.json` in addition to stdout); `--epic <id>` (filter to one epic); `--schema-version` (print schema version)
- Output: single JSON blob conforming to versioned schema (see References layer)
- Composition: invokes library composer; does NOT mutate any state
- Skill prelude: full kickoff-gate preamble; warning-only mode (read-only skill convention)

**MODIFIED skill: `standup`**
- File: `skills/standup/SKILL.md`
- Change: add `--format` flag with values `default` (current human-readable prose) and `slack` (markdown, thread-aware, code blocks for tables)
- Change: under `--format slack`, suppress interactive prompts; emit Phase 1 standup report only and exit (no Phase 2/3 advance)
- Behavior preservation: `--format default` (or no flag) preserves current behavior byte-equivalently

**MODIFIED skill: `triage`**
- File: `skills/triage/SKILL.md`
- Change: add `--json` flag applicable to read-shaped sub-commands (`--list`, inspect by ID)
- Change: state-mutation sub-commands (`<description>`, `--advance`, `--hand-off`, `--close`) emit machine-parseable confirmation JSON when `--json` is passed
- State machine: NO changes — five states + transitions unchanged

### Layer: References

**NEW doc: context-snapshot JSON schema**
- Path: `hive/references/context-snapshot-schema.md`
- Content: full JSON schema with `schema_version`, top-level keys (`branch`, `epics[]`, `stories[]`, `episodes_recent[]`, `triage_open[]`, `metrics_health[]`), per-key shapes, examples
- Versioning: `schema_version: 1` at top of payload; future-compat via additive-only changes

**NEW doc: slack-format spec for standup**
- Path: `hive/references/standup-slack-format.md` (or inline in skill)
- Content: markdown conventions used (thread message boundary, code-block tables, emoji-free or emoji-permitted)

**MODIFIED doc: Routines integration**
- Path: `hive/references/routines-integration.md`
- Change: add §"External coordinators (Hermes equivalence)" noting that any cron/webhook-capable coordinator (Routines, Hermes, custom) plugs in via the same scheduler-as-trigger contract

### Layer: Library (`hive/lib/`)

**NEW module: context-snapshot composer**
- Path: `hive/lib/context-snapshot.mjs` (or .ts if existing pattern; check)
- Exports: `composeContextSnapshot({ epic?, stateDir })` → object matching schema
- Reads: `git branch --show-current`, `.pHive/epics/*/epic.yaml`, `.pHive/epics/*/stories/*.yaml`, `.pHive/cycle-state/*.yaml`, `.pHive/episodes/`, `.pHive/triage/queue.yaml`, story `metric:` blocks
- Uses: existing `hive/lib/story-status.mjs` (`deriveStoryStatus`) for current story state per `feedback_story_status_stale` rule
- No writes (pure read)

### Layer: Tests

**NEW tests**
- `tests/lib/context-snapshot.test.ts` — composer returns valid schema; handles missing fixtures gracefully (empty epics, no triage queue, no metrics blocks)
- `tests/skills/context-snapshot.test.ts` — CLI invocation produces stdout JSON; `--write` produces identical file content
- `tests/skills/standup-format-slack.test.ts` — snapshot test for slack-format output
- `tests/skills/triage-json.test.ts` — snapshot test for triage `--json` output across each sub-command

### Layer: Cycle state / episodes / triage queue

Read-only consumers. No schema changes.

### Layer: External contract surface

- **Context-snapshot JSON schema** — versioned contract; downstream consumers (Hermes, future tools) pin to a schema version
- **Standup `--format slack`** — markdown shape stability becomes contract
- **Triage `--json`** — JSON shape becomes contract

## 3. Cross-Layer Dependencies

```
DEPENDENCIES:

Skills/context-snapshot SKILL.md
  → Library context-snapshot.mjs (composer)
  → References context-snapshot-schema.md (output contract)

Library context-snapshot.mjs
  → Cycle state files (.pHive/cycle-state/*.yaml) — read
  → Story files (.pHive/epics/*/stories/*.yaml) — read
  → Episodes (.pHive/episodes/) — read
  → Triage queue (.pHive/triage/queue.yaml) — read (optional, gracefully absent)
  → hive/lib/story-status.mjs — call deriveStoryStatus
  → git CLI — read current branch

Skills/standup SKILL.md (--format slack mod)
  → Existing standup Phase 1 output composer
  → References standup-slack-format.md (spec)

Skills/triage SKILL.md (--json mod)
  → Existing triage queue read/write logic (no state machine change)

Tests/all
  → All of above (fixtures + invocations)
```

**Critical dependency cut:** Slice 1 (context-snapshot) is library-first. Compose the JSON in `hive/lib/context-snapshot.mjs` with unit tests against fixtures, THEN wrap with the skill. This makes the composer reusable by future external consumers without going through the skill surface.

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP
────────────────────────────────────────────────────────────────────────────────

Skills      │ /hive:context-snapshot  │ /hive:standup       │ /hive:triage       │
            │ (NEW skill)             │ (--format slack)    │ (--json)           │
────────────┼─────────────────────────┼─────────────────────┼────────────────────┤
References  │ context-snapshot-       │ standup-slack-      │ triage --json docs │
            │ schema.md (NEW)         │ format.md (NEW)     │ (inline in SKILL)  │
            │ + routines-integration  │                     │                    │
            │ Hermes-equivalence note │                     │                    │
────────────┼─────────────────────────┼─────────────────────┼────────────────────┤
Library     │ context-snapshot.mjs    │ (no changes)        │ (no changes)       │
(hive/lib)  │ (NEW composer)          │                     │                    │
────────────┼─────────────────────────┼─────────────────────┼────────────────────┤
Tests       │ composer unit + CLI     │ slack format        │ --json per         │
            │ integration tests       │ snapshot test       │ sub-command        │
────────────┼─────────────────────────┼─────────────────────┼────────────────────┤
State       │ READ: cycle-state,      │ READ: existing      │ READ: queue.yaml   │
(read-only) │ stories, episodes,      │ standup state       │ (no schema change) │
            │ triage queue, metrics   │                     │                    │
────────────────────────────────────────────────────────────────────────────────
```

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected: 5 (Skills, References, Library, Tests, State-read-only)
  Total items: ~13
    - 1 new skill, 2 modified skills
    - 2 new reference docs, 1 modified
    - 1 new library module
    - 4-6 new test files
  New vs modified: ~7 new files, ~3-4 modified
  Estimated total effort: medium

  LARGEST LAYER: Library + Skills (context-snapshot is the novel surface)
  RISKIEST LAYER: References — JSON schema versioning shape sets long-term contract
    (mitigated by additive-only versioning rule)
```
