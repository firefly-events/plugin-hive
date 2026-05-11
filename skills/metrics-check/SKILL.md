---
name: metrics-check
description: Post-merge verdict pass against story-declared metric blocks — read each story's metric, measure the carrier, write PASS/FAIL/INCONCLUSIVE back to the story YAML, print a summary table.
---

# Hive Metrics-Check

Close the claim-vs-reality loop for stories that declared a `metric:` block per [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §3. This skill scans `.pHive/epics/*/stories/*.yaml`, finds completed stories whose `metric.verify_at` has elapsed, reads the appropriate carrier (`source.kind`), computes a verdict (`PASS | FAIL | INCONCLUSIVE`), and writes a `metric.verdict:` block back to the story YAML.

**Input:** `$ARGUMENTS` optionally contains:
- an epic ID — scope the scan to a single epic
- a story ID — scope the scan to a single story
- `--reverify` — re-run on stories that already have a `metric.verdict:` block (default behavior is no-op on already-verified stories)
- `--dry-run` — compute verdicts and print the table; do NOT write back to story YAMLs
- `--include-pending` — also evaluate stories whose `status` is not `completed` (default skips them; rarely useful)

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** This skill is read-only-shaped except for the per-story verdict write described in §4 below. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## When to use

Run this skill:
- After an epic closes that contained any `metric.applies: true` stories
- Before a `meta-meta-optimize` cycle, so the inputs include current verdicts
- Whenever `/standup` (M-06) surfaces overdue verify_at dates and recommends a run
- Manually, anytime a maintainer wants ground truth on declared claims

Do NOT run this skill:
- Before stories complete (use `--include-pending` if you really mean it)
- To gate merge decisions in CI (this skill is post-merge by design; pre-merge claims are evaluated by `/plan` step 14a's review gate per M-03)

## Process

### 1. Discover stories with metric blocks

Walk `.pHive/epics/*/stories/*.yaml`. For each story file:

1. Parse the YAML. Skip files that fail to parse (warn, do not abort).
2. Locate the `metric:` block at the top level. If absent, skip the story.
3. Read `status`. If `status != completed` and `--include-pending` was NOT passed, skip the story.
4. Read `metric.applies`. If `applies: false`, skip the story (no verdict to compute; `applies:false` is an opt-out, already recorded at planning time per M-01/M-03).
5. Read `metric.verdict.outcome` (the post-verdict marker written by a prior run). If present AND `--reverify` was NOT passed, skip (idempotency).
6. Read `metric.verify_at`. Resolve to a concrete timestamp:
   - ISO-8601 timestamp (e.g., `2026-06-01T00:00:00Z`): parse directly.
   - Anchored relative form (`"story integrate step"`, `"epic close"`, `"first cycle post-merge"`, `"next-3-cycles"`, `"M-07 completion"`): resolve via the table in §1a below.
   - `"eventually"`, `"someday"`, empty, unparseable: tag the story as `verify_at_unresolvable` and surface in the table (do not write a verdict).
7. Compare resolved timestamp with `now()`. If `resolved_verify_at > now`: tag the story as `not_yet_due` and skip the verdict computation; it appears in the table under the `not_yet_due` count.

The set of stories that pass all six gates is the **evaluation set**.

#### 1a. `verify_at` anchor resolution

| Anchor form | Resolution |
|---|---|
| ISO-8601 (`2026-06-01T00:00:00Z`) | Parse with the local `date` / Node `Date.parse` utility. |
| `"story integrate step"` | Use the story's `integrate` episode timestamp from `.pHive/episodes/{epic-id}/{story-id}/integrate.yaml` if present; else use the story file's last git-tracked modification time. |
| `"epic close"` | Use the epic's close timestamp from `.pHive/epics/{epic-id}/epic.yaml` `closed_at` field if present; else use the latest `integrate` episode timestamp across the epic's stories; else fall back to story file mtime. |
| `"first cycle post-merge"` | Use the `merged_at` of the PR that landed the story (if epic.yaml carries `pr_merged_at`); else fall back to integrate episode timestamp. |
| `"next-3-cycles"` | Resolve to `integrate_timestamp + 3 cycles`. A cycle is approximated as 24h unless `hive.config.yaml → metrics_check.cycle_duration_hours` overrides. |
| Anchor token not in this table | Treat as `verify_at_unresolvable`; surface in the table. |

The resolution table is intentionally narrow. Adding a new anchor requires updating the schema's §3.2.10 enumeration AND this table; do not silently extend.

### 2. Compute the verdict per story

For each story in the evaluation set, dispatch on `metric.source.kind`:

- `envelope` → §2a
- `events` → §2b
- `sql` → §2c
- `manual` → §2d

A verdict is one of:

- `PASS` — measured value satisfies `direction` and `target` (see §2e).
- `FAIL` — measured value does NOT satisfy `direction` and `target`.
- `INCONCLUSIVE` — the carrier was readable but contained insufficient data to compute a value, OR the carrier produced multiple candidate values whose verdict diverges (rare; surfaces as a finding rather than auto-resolving).

A story whose carrier could not be opened at all (missing envelope file, no JSONL rows match the filter, sqlite file absent, etc.) produces verdict `INCONCLUSIVE` with `evidence_ref: "<missing or unreadable carrier path>"`, NOT a verdict of FAIL. Absence of evidence is not evidence of failure; the verdict reader cannot promote it to FAIL without a reading.

#### 2a. `source.kind: envelope`

Resolve the envelope path:
- If `metric.envelope_id` is set: read `.pHive/metrics/experiments/{envelope_id}.yaml`.
- Else parse `metric.source.ref` as the envelope id and read the same path.

The envelope is the B0-contract carrier per [`.pHive/metrics/experiment-envelope.schema.md`](../../.pHive/metrics/experiment-envelope.schema.md). Use the `baseline-vs-candidate` query shape (per `b0-consumer-contract.md` §2.1):

1. Read `baseline_ref`, `candidate_ref`, `metrics_snapshot`, `policy_ref` from the envelope.
2. Read the candidate-side value for the metric named by `metric.name` (or its closest match in `metrics_snapshot`). If `metric.name` is not present in the snapshot, INCONCLUSIVE.
3. Read the baseline-side value (where the envelope or its `baseline_ref` records it). If `baseline` is null in the story but the envelope has one, use the envelope's. If both are missing, the story declared an absolute-level claim (`baseline: null` per schema §3.2.5) and the verdict compares candidate against `target` directly.
4. Compute the verdict per §2e using `direction`, `target`, and the candidate value (and baseline if applicable).
5. Set `evidence_ref` to the envelope path plus the snapshot row identity (e.g., `experiments/exp_2026-05-15.yaml#metrics_snapshot[plan.first_attempt_pass_rate]`).

If the envelope file does not exist or fails to parse: INCONCLUSIVE, `evidence_ref: "<envelope path>"`.

#### 2b. `source.kind: events`

Read `metric.source.ref` as a JSONL filter expression. The expression follows the convention from [`/.pHive/metrics/metrics-event.schema.md`](../../.pHive/metrics/metrics-event.schema.md): a small `key=value AND key=value` predicate against event-row fields (`metric_type`, `swarm_id`, `story_id`, `proposal_id`, etc.).

1. Walk `.pHive/metrics/events/*.jsonl` (every file in the directory; the carrier is partition-friendly per the schema).
2. For each line: `jq -c 'select(<filter expression converted to jq>)'`, OR run the equivalent in the runner script (§5).
3. Aggregate the matched rows according to the metric semantics:
   - `direction: up`, `unit: ratio`/`count`: take the LAST row in the matched set (most recent value).
   - `direction: down`: same; LAST row.
   - When `metric.window` is a multi-cycle window (`"next-3-cycles"`, `"7d post-merge"`): aggregate the rows within the window into a single value via simple mean (the schema §3.10 records values per-event, not deltas; mean is the default aggregation). If a future story requires a different aggregation, declare it in `metric.source.ref` explicitly (e.g., `... AND aggregation=p95`).
4. If zero rows matched: INCONCLUSIVE, `evidence_ref: ".pHive/metrics/events/*.jsonl filter=<filter>"`.
5. Compute the verdict per §2e and set `evidence_ref` to the JSONL filter expression plus the event_ids of the rows that drove the value (cap at 3 event_ids for traceability — full count in `evidence.event_count`).

#### 2c. `source.kind: sql`

Read `metric.source.ref` as either:
- a literal SQL `SELECT ...` (single statement, single-row single-column result expected)
- a named query from a future registry (out of scope for M-05; if `source.ref` doesn't begin with `SELECT`, treat as INCONCLUSIVE with `evidence.note: "named-query registry not implemented in M-05; pass literal SQL until then"`)

Determine the database:
- If `metric.source.ref` includes a path hint (`-- db: ~/.claude/hive/kg.sqlite`) or the `name` namespace starts with `kg.`, use `~/.claude/hive/kg.sqlite`.
- Else INCONCLUSIVE with `evidence.note: "sql source.kind requires explicit DB hint; M-05 supports kg.sqlite only"`.

Execute via the `sqlite3` CLI:

```sh
sqlite3 -readonly -batch ~/.claude/hive/kg.sqlite "<SELECT>"
```

Parse stdout as the candidate value. Compute the verdict per §2e. Set `evidence_ref` to the SQL statement (capped at 200 chars for the verdict block; full statement persisted in the runner log).

The `-readonly` flag is mandatory. This skill never writes to the KG.

#### 2d. `source.kind: manual`

A manual source means the verdict requires a human read. The skill does NOT pretend to score these.

- Set `verdict.outcome: "MANUAL"` (a fifth value distinct from PASS/FAIL/INCONCLUSIVE — "MANUAL" means "I am explicitly handing this to a human, do not interpret as failure")
- Set `verdict.measured_value: null`
- Set `verdict.evidence_ref` to the `source.ref` text (the one-line recipe)
- Set `verdict.note: "Manual verification — run the recipe in source.ref and re-run this skill with the verdict written by hand, OR set --reverify after recording the read."`

The summary table column for MANUAL is rendered separately from PASS/FAIL/INCONCLUSIVE counts so manual-source stories are not silently lost.

#### 2e. Verdict computation

Given `candidate_value`, `direction`, and `target`:

| Direction | Verdict rule |
|---|---|
| `up` | `PASS` if `candidate_value >= target`; `FAIL` if `candidate_value < target`; `INCONCLUSIVE` if `candidate_value` is null/NaN/unparseable. |
| `down` | `PASS` if `candidate_value <= target`; `FAIL` if `candidate_value > target`; `INCONCLUSIVE` if `candidate_value` is null/NaN/unparseable. |

Equality is PASS in both directions (the target is the floor for `up` and the ceiling for `down`).

When `baseline` is non-null AND `metric.window` describes a delta (`"7d post-merge"`, `"next-3-cycles"`): the candidate value is itself treated as the post-state level (not the delta). The verdict rule above applies unchanged; deltas are not auto-computed here because the carriers (events/envelope/sql) already record absolute values. If a future metric requires explicit delta semantics, declare it via a named SQL view or an aggregation hint in `source.ref`.

### 3. Surface FAIL verdicts as actionable findings

For each story whose verdict is `FAIL`:

- Print a one-line action suggestion alongside the verdict in the summary table (§4). The suggestion text is templated per `direction` and `source.kind`:
  - `direction: up`, FAIL: "consider follow-up story to close the gap, or update `target` if the original was over-ambitious"
  - `direction: down`, FAIL: "consider revert of the change that introduced the regression, or follow-up story to bring the number back below target"
  - `source.kind: events` and FAIL: prepend "review event rows at `evidence_ref` to confirm the regression isn't a sampling artifact"
- Do NOT auto-create the follow-up story or revert; the suggestion is read-only and operator-facing.

### 4. Write `metric.verdict` block back to the story YAML

For each story in the evaluation set (skip on `--dry-run`):

Append a `verdict:` sub-block under the existing `metric:` block in the story YAML:

```yaml
metric:
  applies: true
  name: <unchanged>
  direction: <unchanged>
  unit: <unchanged>
  baseline: <unchanged>
  target: <unchanged>
  window: <unchanged>
  source: { kind: <unchanged>, ref: <unchanged> }
  envelope_id: <unchanged>
  verify_at: <unchanged>
  owner: <unchanged>
  verdict:
    outcome: PASS | FAIL | INCONCLUSIVE | MANUAL
    measured_value: <number | null>
    ran_at: <ISO-8601 timestamp of THIS skill run>
    evidence_ref: <string>
    note: <string, optional>
```

Mutation rules:
- Do NOT modify any field of `metric:` other than the `verdict:` sub-block.
- Preserve key order in the rest of the YAML (use a YAML library that supports round-tripping, or templated-string append — both satisfy the constraint). Per repo norms (`feedback_byo_enhancements_no_root_deps`), prefer the runner script approach if a YAML library is needed.
- Treat the write as an in-place edit: same file path, atomic temp-file-then-rename.
- If `--dry-run` was passed, print the verdict block to stdout instead of writing it.

### 5. Optional runner script

If the inline shell-out logic in §2 is awkward to express as bash, drop a runner at `scripts/metrics-check-runner.js` using only `node:child_process` + `node:fs` + the `sqlite3` and `jq` CLIs. Per repo norms, do NOT add `better-sqlite3` or any other root-level dependency.

The runner contract:
- argv: `--epic <id>`, `--story <id>`, `--reverify`, `--dry-run`, `--include-pending` (same as the skill)
- stdin/stdout: stdin unused; stdout is a JSON-lines stream of per-story verdict records
- side effects: only YAML writes to the story files in the evaluation set; never anywhere else

If the runner is not present, the skill performs the logic inline via `bash`, `jq`, `sqlite3`, and `yq` (or whatever YAML reader is installed; the skill should detect availability and fall back to a templated-string append if no YAML library is on path).

### 6. Print the summary table

After all writes complete, print:

```
## Metrics-Check Summary — <timestamp>

Scope: <all epics | epic={epic-id} | story={story-id}>
Stories scanned: <N>
Evaluation set:  <N>  (skipped: status_not_completed=<N>, already_verified=<N>, applies_false=<N>, not_yet_due=<N>, verify_at_unresolvable=<N>)

Verdicts:
  PASS:         <N>
  FAIL:         <N>
  INCONCLUSIVE: <N>
  MANUAL:       <N>
  OVERDUE:      <N>  (verify_at past + no verdict + source.kind != manual; these are the cohort /standup surfaces)

By epic:
  <epic-id>: pass=<N> fail=<N> inconclusive=<N> manual=<N>

Stories:
  ✓ <epic-id>/<story-id> — <metric.name> <direction>: <measured> vs target=<target>  [PASS]
  ✗ <epic-id>/<story-id> — <metric.name> <direction>: <measured> vs target=<target>  [FAIL] — <action suggestion from §3>
  ? <epic-id>/<story-id> — <metric.name> <direction>: <measured> vs target=<target>  [INCONCLUSIVE] — evidence_ref=<...>
  ⊘ <epic-id>/<story-id> — <metric.name>   [MANUAL] — recipe: <source.ref>
```

The table is read-only output. The story-YAML writes (§4) are the only persistent side effect of this skill.

## Output

- N story YAML files mutated to add `metric.verdict:` blocks (zero on `--dry-run`)
- 1 summary table to stdout
- Optional: `scripts/metrics-check-runner.js` invoked (output captured to stdout)

## Non-scope

This skill does NOT:
- Create follow-up stories or revert PRs (those are operator actions; the suggestion text is the prompt, not the action)
- Mutate any field of `metric:` other than `verdict:` (cannot overwrite the declaration after the fact)
- Write to the KG (`~/.claude/hive/kg.sqlite`) or any other shared store
- Read or write to `.pHive/metrics/events/*.jsonl` in write mode (events are immutable per their schema §2)
- Promote findings to the meta-team-cycle automatically (a maintainer or a /standup pass surfaces the verdicts; M-06 is the read-side of this loop)

## Failure modes

- `.pHive/epics/` missing: print `Metrics-Check: no epics directory; skipping.` and exit 0.
- No stories with `metric.applies: true` and elapsed `verify_at`: print the summary table with all zeros and exit 0.
- A story YAML fails to parse: warn, count it in `parse_errors`, continue with the rest.
- `sqlite3` or `jq` not on PATH and a story requires it: tag the relevant verdicts as `INCONCLUSIVE` with `evidence.note: "<tool> not installed"`. Do NOT abort the whole run.
- `~/.claude/hive/kg.sqlite` absent and a `source.kind: sql` story requires it: INCONCLUSIVE with `evidence.note: "kg.sqlite absent"`. Do NOT block.
- Write-back to a story YAML fails (filesystem error, permission denied): print the verdict to stdout with a `WRITE_FAILED:` prefix, count in the summary, continue.

## Key references

- [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §3 — canonical `metric:` block shape
- [`.pHive/metrics/metrics-event.schema.md`](../../.pHive/metrics/metrics-event.schema.md) — event-row carrier
- [`.pHive/metrics/experiment-envelope.schema.md`](../../.pHive/metrics/experiment-envelope.schema.md) — envelope carrier and closure invariant
- [`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`](../../.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md) §2 — three named query shapes (`baseline-vs-candidate`, `run-over-run`, `delayed-regression-watch`)
- [`hive/references/cross-cutting-concerns.md`](../../hive/references/cross-cutting-concerns.md) — `metrics` concern (M-01) the declarations satisfy
- `skills/standup/SKILL.md` "Metrics health" section (M-06) — read-side surfacing of OVERDUE + FAIL verdicts
