# Research Brief — c-6 Migration Guide + Prose-Runbook Deprecation

**Story:** c-6-migration-guide-and-prose-runbook-deprecation
**Epic:** task-tracking-adapter-abi
**Wave:** W5 — final story of Epic C
**Working dir:** `/Users/don/Documents/plugin-hive-adapter-abi`
**Date:** 2026-05-12

---

## SCOPE CORRECTION (vs. story YAML implement steps)

The story YAML `implement` step still lists five sub-steps. **Three are already shipped.** Net work for c-6:

| Story step | Status | Adaptation |
|---|---|---|
| 1. Write migration guide `task-tracking-adapter-migration.md` | TODO | Primary deliverable. |
| 2. Add deprecation note to each prose-runbook file | TODO | Apply to 3 files (see Section A). |
| 3. Update c-5 dispatch to emit `prose-runbook-fallback` telemetry | **SHIPPED in c-5b** | Skip. Verified at `hive/lib/task-tracking-dispatch/index.ts:381` + test at `dispatch.test.ts:327-347` + on-disk fixture events under `.pHive-test/metrics/events/prose-runbook-fallback-*.jsonl`. |
| 4. Document the new event in `gate-lift-telemetry.md` | **GAP — doc does not exist** | Self-document the shape inline in the migration guide (one section). See Section C. |
| 5. Extend `gate-mode-audit.mjs` for optional aggregation | **GAP — script does not exist** | Describe what an audit *would* count in the migration guide's "Removal timeline" section; defer implementation. See Section D. |

Result: c-6 collapses to migration guide + 3 deprecation headers. The "informational telemetry aggregation" pillar becomes a forward-looking note, not a code change.

---

## SECTION A — PROSE-RUNBOOK FILES NEEDING DEPRECATION MARKERS

`find` results from `hive/references/` excluding `*abi*`, `*migration*`, `*sketch*`:

1. **`hive/references/task-tracking-adapter.md`** (6.0 KB)
   - Title: "Task Tracking Adapter — Full Lifecycle"
   - Documents: Linear-shaped board design (Backlog → Todo → In Progress → In Review → Done/Canceled), labels (`epic-parent`, `story`), and the prose-runbook adapter operations (`createEpicParent`, `createStoryIssue`, etc.) as `linearis` CLI invocations.
   - This is the canonical "full lifecycle adapter interface" reference cited by `hive/agents/orchestrator.md:308`.

2. **`hive/references/linear-integration.md`** (~1 KB by indication)
   - Title: "Linear Integration — Per-Phase Operations"
   - Documents: how the orchestrator and agents interact with Linear during each daily-ceremony phase. Cross-references `task-tracking-adapter.md` and `linear-commands.md`. Cited by `orchestrator.md:306, 323` and `workflows/daily-ceremony.workflow.yaml:17, 121, 141`.

3. **`hive/references/linear-commands.md`**
   - "Copy-paste linearis CLI commands" reference cited by `orchestrator.md:307, 323`.

**No `github-*.md` prose-runbook references exist** in `hive/references/` — Linear was the only built-in tracker before Epic C; GitHub support arrives via the c-3 ABI adapter.

**Recommended deprecation header (per story YAML, slightly adapted):**

```markdown
> **DEPRECATED — superseded by executable adapter ABI.**
> This prose-runbook adapter pattern is replaced by the executable adapter ABI
> specified in [`task-tracking-adapter-abi.md`](task-tracking-adapter-abi.md).
> See [`task-tracking-adapter-migration.md`](task-tracking-adapter-migration.md)
> for the migration path.
>
> **Removal target:** the release immediately after Hive 2.0 ships
> (i.e. 2.1 if semver continues, or the next dated release after 2.0).
> Fallback usage is tracked via the `prose-runbook-fallback` JSONL event;
> deletion is data-driven on the aggregated event count over the deprecation window.
```

**Identical wording across all three files** is an explicit acceptance criterion (review step #2 in the story YAML).

**Note:** the deprecation header is *only* a banner. The body of each file stays intact during the deprecation window — `orchestrator.md`, `daily-ceremony.workflow.yaml`, and other consumers still cite them while users on `gate_mode: hard` without an adapter rely on the prose runbook.

---

## SECTION B — MIGRATION GUIDE OUTLINE

**Target path:** `hive/references/task-tracking-adapter-migration.md` (~200 lines per story YAML).

### Recommended structure

```
# Task-Tracking Adapter — Migration Guide

> Companion to [task-tracking-adapter-abi.md](task-tracking-adapter-abi.md).
> Migration window: Hive 2.0 → 2.1 (one release).

## 1. For most users — nothing changes (default experience)
- Hive ships built-in `github` and `linear` adapters; pick one in `hive.config.yaml`.
- No adapter? Hive falls back to `gate_mode` behavior (see §6 Rollback).
- Default `paths.gate_mode` is `warning`; users with no tracker proceed with a one-time warning.

## 2. Configuration reference (`task_tracking.*`)
Minimal — both built-in adapters are one-block:

```yaml
task_tracking:
  adapter: github                  # 'github' | 'linear' | '/abs/path/to/adapter' | null
  team_value: firefly-events       # GitHub owner/org OR Linear team key
  project_value: plugin-hive       # GitHub repo OR Linear project (optional for Linear)
  adapter_timeout_ms: 30000        # default 30s
  github:                          # adapter sub-block — passed verbatim as env vars
    token: null                    # falls through to GITHUB_TOKEN / `gh auth token`
  linear:
    api_key: null                  # falls through to LINEAR_API_KEY
    team: ACME                     # falls through to LINEAR_TEAM
```

Full schema commentary lives in `hive/hive.config.yaml` (verbatim copy is fine).

## 3. Porting a custom prose-runbook adapter to the ABI
Five concrete steps:

1. **Read the ABI.** `hive/references/task-tracking-adapter-abi.md` defines the
   contract: stdio JSON request/response, 7 required methods, optional `init`/
   `capabilities` probes.
2. **Pick a form factor.** CLI subprocess (recommended; matches the c-1 decision)
   *or* in-tree TS module exposing `dispatch(req)`. Both are supported by the
   dispatch loader; see c-3 GitHub at `hive/adapters/github/index.ts` and c-4
   Linear at `hive/adapters/linear/index.ts` as templates.
3. **Implement the 7 required methods.** From the ABI spec Step 4:
   parse JSON-from-stdin → call tracker API → write JSON-to-stdout → exit 0/1.
   Method names appear in the c-3/c-4 adapters' `dispatch()` switch
   (`createStory`, `updateStatus`, `listOpen`, `getStory`, `addComment`,
   `linkStories`, `setAssignee`).
4. **Map errors.** 401/403→`AUTH_FAILURE`, 404→`NOT_FOUND`,
   429→`RATE_LIMIT` (include `retry_after_ms`), unknown method→
   `UNKNOWN_METHOD`, hierarchy-incompatible→`OPERATION_UNSUPPORTED`.
5. **Test against the c-3/c-4 canonical pattern.** Both adapters ship a
   `test/` directory with the standard 7-method suite — copy that shape.

Then:
```yaml
task_tracking:
  adapter: /absolute/path/to/your-adapter
```

## 4. Reference implementations (study these)
- **GitHub:** `hive/adapters/github/` — REST-based; uses `gh auth token`
  fallback; flat hierarchy (issues only, no native sub-issues).
- **Linear:** `hive/adapters/linear/` — GraphQL-based; team-key auth;
  parent/child hierarchy via `parent_id`.
- Both ship `index.ts`, `package.json`, `test/`, `README.md`, and
  `friction-notes.md` (real-world gotchas discovered during c-3/c-4 builds —
  read these before writing your own adapter).

## 5. What happens to `hive.config.yaml` during migration
- Before: no `task_tracking` block (or prose-runbook-only documentation in
  CLAUDE.md / project memory).
- After: explicit `task_tracking.adapter` value. The dispatch module loads
  the adapter at first invocation; the prose-runbook pattern is no longer
  consulted at runtime.

## 6. Rollback plan
- Revert `task_tracking.adapter` to `null`.
- Choose `paths.gate_mode`:
  - `warning` (default): kickoff/plan/execute proceed with a one-time warning;
    a `task-tracking-no-adapter` JSONL event is written at first invocation.
  - `hard`: kickoff blocks until an adapter is configured. Pre-ABI behavior
    is preserved byte-for-byte under hard mode.
- No state migration required — adapter handles are per-process and the
  dispatch cache is rebuilt on next run.

## 7. Two-event-family telemetry (deprecation window observability)
Inline-documents the two JSONL events (see Section C below).

## 8. Removal timeline
- **Hive 2.0:** ABI shipped; built-in `github` + `linear` adapters live;
  prose-runbook references carry deprecation banner; `prose-runbook-fallback`
  events written every time a configured adapter terminally fails under
  `gate_mode: warning`.
- **Hive 2.1 (one release after 2.0):** prose-runbook references removed if
  aggregate `prose-runbook-fallback` event volume is below a maintainer-
  judgment threshold; otherwise extend deprecation by one release and revisit.
- **No fixed calendar date** — removal is data-driven on the event count.
```

### Length & tone

The story YAML targets ~200 lines. The above outline at full prose width
lands in that range. Tone matches `task-tracking-adapter-abi.md`: declarative,
no marketing.

---

## SECTION C — GAP: `gate-lift-telemetry.md` DOES NOT EXIST

**Confirmed absent** (per c-5b research brief and re-verified): there is no
`hive/references/gate-lift-telemetry.md`. The story YAML implement step #4
("append to the event-shapes section") cannot execute as written.

**Recommended adaptation:** the migration guide inlines a "Telemetry events"
subsection documenting both event families, then a future Epic B / observability
story can extract a canonical `gate-lift-telemetry.md` that supersedes the inline
copy. This is consistent with c-5b's approach (they inferred the shape from
`.pHive/metrics/metrics-event.schema.md` and shipped anyway).

### Two events to document

**1. `task-tracking-no-adapter`** (c-5a, already shipping):
- **Trigger:** `dispatch.invoke()` called when `task_tracking.adapter` is `null`
  AND `gate_mode: warning`. Emitted at most once per process.
- **Path:** `<state_dir>/metrics/events/task-tracking-no-adapter-<ISO-sanitized>.jsonl`
- **Shape:**
  ```json
  {
    "event_id": "<uuid>",
    "timestamp": "<ISO 8601>",
    "run_id": "<HIVE_RUN_ID or 'unknown'>",
    "metric_type": "task-tracking-no-adapter",
    "method": "<createStory|updateStatus|...>",
    "gate_mode": "warning"
  }
  ```

**2. `prose-runbook-fallback`** (c-5b, already shipping):
- **Trigger:** `dispatch.invoke()` against a *loaded* adapter that returns a
  terminal (non-recoverable) error AND `gate_mode: warning`. One event per
  terminal occurrence (not deduplicated).
- **Path:** `<state_dir>/metrics/events/prose-runbook-fallback-<ISO-sanitized>.jsonl`
- **Shape** (from `hive/lib/task-tracking-dispatch/index.ts:381` and on-disk
  fixtures at `.pHive-test/metrics/events/prose-runbook-fallback-*.jsonl`):
  ```json
  {
    "event_id": "<uuid>",
    "timestamp": "<ISO 8601>",
    "run_id": "<HIVE_RUN_ID or 'unknown'>",
    "metric_type": "prose-runbook-fallback",
    "skill": "<kickoff|plan|execute|null>",
    "method": "<createStory|updateStatus|...>",
    "adapter": "<github|linear|/abs/path|null>",
    "gate_mode": "warning",
    "error_code": "<AUTH_FAILURE|RATE_LIMIT|TIMEOUT|INTERNAL_ERROR|OPERATION_UNSUPPORTED|NOT_FOUND>"
  }
  ```
  Both events follow the canonical row shape from
  `.pHive/metrics/metrics-event.schema.md`.

### Why two families, not one

`task-tracking-no-adapter` signals "**no adapter configured at all**" — the
user hasn't migrated yet. `prose-runbook-fallback` signals "**adapter
configured but failed terminally**" — adapter loaded, dispatched, and the
operation hit an unrecoverable error. Different remediation: the first is a
config gap, the second is an adapter bug or external API outage.

The migration guide should flag this distinction explicitly (per c-5b review
notes) so users grep for the right event family when debugging.

---

## SECTION D — GAP: `gate-mode-audit.mjs` DOES NOT EXIST

`hive/scripts/` contains only `session-invoke.mjs` (13 KB). `find … -name '*audit*'` returns nothing.

**Recommended adaptation:** the migration guide's "Removal timeline" section
describes what an audit *would* count when it lands — aggregate
`prose-runbook-fallback-*.jsonl` and `task-tracking-no-adapter-*.jsonl`
files under `<state_dir>/metrics/events/` over a rolling window, group by
`adapter`, `error_code`, and `skill`, surface threshold breaches as
informational signals. The implementation defers to a future Epic B story
(the original story spec already labels this aggregation "informational,
not threshold-driven for v1," so deferring code is consistent with the
design decision).

The story YAML test step #4 ("Run `hive/scripts/gate-mode-audit.mjs`
against fixture event log") **cannot execute**. Recommend updating the test
phase to:
- Verify the migration guide enumerates both event families correctly.
- Verify deprecation banner wording is identical across all three prose-
  runbook files.
- Verify cross-links resolve (markdown link check).
- Skip the audit-script test step; note as deferred.

---

## SECTION E — REMOVAL TARGET (release identification)

- `package.json` has no version field at the repo root (file is empty/absent
  for the `cat` probe — likely no top-level npm package; per-adapter
  `package.json` files exist under `hive/adapters/{github,linear}/`).
- `.claude-plugin/plugin.json` is the canonical Hive version source (per
  prior project memory, not re-fetched here — recommend grabbing version
  during implement).
- `git tag` returns only `meta-team/baseline-2026-04-08` (no semver tags).
- Project memory: **Hive 2.0 milestone** is the explicit shipping target for
  Epic C (per `project_hive_2_0_milestone.md`).

**Removal target string for the deprecation banner:** "the release immediately
after Hive 2.0 ships" — semver-agnostic. If the writer wants a concrete
identifier, "Hive 2.1" is the documented convention from project memory.
The migration guide §8 should keep both formulations: the conventional
"2.1" plus the data-driven "subject to `prose-runbook-fallback` event
volume."

---

## SECTION F — FILES NEEDING DEPRECATION MARKERS (consolidated list)

```
hive/references/task-tracking-adapter.md       # full lifecycle adapter interface
hive/references/linear-integration.md          # per-phase Linear operations
hive/references/linear-commands.md             # copy-paste linearis CLI commands
```

Three files, identical banner wording, applied at top-of-file (no frontmatter
on any of them per `head -30` probe).

---

## SECTION G — IMPLEMENT-PHASE CHECKLIST FOR DEVELOPER

1. **Read** the c-2 ABI spec (`hive/references/task-tracking-adapter-abi.md`)
   and both reference adapters' READMEs/friction-notes.md to lift accurate
   method names + error mapping for migration guide §3.
2. **Read** `hive/hive.config.yaml` task_tracking block to lift exact
   field names + comments for migration guide §2.
3. **Create** `hive/references/task-tracking-adapter-migration.md` (~200 lines)
   per Section B outline.
4. **Prepend** the Section A deprecation banner to all three files in
   Section F (identical wording, no body changes).
5. **Skip** story YAML implement steps 3, 4, 5 — already shipped or gap-
   deferred per this brief.
6. **yamllint** + commit on `feat/task-tracking-adapter-abi` with message:
   `feat(adapter-abi): migration guide + prose-runbook deprecation banners (story c-6, W5)`.

## SECTION H — TEST-PHASE CHECKLIST FOR TESTER

Adjusted from the story YAML test step list:

1. **Verify** `task-tracking-adapter-migration.md` covers all 8 sections from
   the outline. Manual read.
2. **Verify** all three prose-runbook files have the identical deprecation
   banner (grep for the banner sentinel string; assert 3 matches).
3. **Verify** migration guide markdown links resolve (`task-tracking-adapter-abi.md`,
   c-3/c-4 adapter paths, `hive.config.yaml`).
4. **Verify** the two-event-family distinction is documented (`task-tracking-no-adapter`
   vs. `prose-runbook-fallback` — grep both strings in the migration guide).
5. **Skip** the audit-script test — deferred per Section D.
6. **yamllint** on the c-6 story file.

## SECTION I — REVIEW-PHASE GUIDANCE

Per story YAML review step, the Opus 4.7 cross-LLM reviewer should verify:
1. Migration guide is actionable — a user with a custom prose-runbook
   could follow §3 without follow-up questions.
2. Deprecation banner is byte-identical across all three files (same wording,
   same removal target, same links).
3. Rollback plan §6 does not leave the user in a broken state.
4. Telemetry event documentation in §7 matches the *actual shipped* event
   shape (cross-reference `hive/lib/task-tracking-dispatch/index.ts:381` and
   the on-disk fixture events).
5. Two-event-family distinction is preserved and clearly explained.

---

## SUMMARY

c-6 is genuinely low-complexity because c-5b already shipped the
telemetry. Three deliverables remain:

- **One new file:** `hive/references/task-tracking-adapter-migration.md`.
- **Three modified files:** identical deprecation banner on the three
  prose-runbook references in `hive/references/`.
- **Two gaps surfaced** (`gate-lift-telemetry.md` and `gate-mode-audit.mjs`
  don't exist) — handled by inlining event-shape documentation in the
  migration guide and deferring audit implementation to a future Epic B
  story.

No dispatch code changes. No new tests beyond markdown structural checks
and banner-consistency grep. Story stays methodology: classic, complexity: low.
