# Story YAML Schema

**Status:** canonical reference
**Audience:** planning agents (analyst, architect, technical-writer) and human story authors
**Companion docs:**
- [`cross-cutting-concerns.md`](cross-cutting-concerns.md) — concern catalog the planner evaluates per story (including `metrics`, the gate this schema's `metric:` block satisfies)
- [`.pHive/metrics/metrics-event.schema.md`](../../.pHive/metrics/metrics-event.schema.md) — append-only event-row carrier read when `metric.source.kind = events`
- [`.pHive/metrics/experiment-envelope.schema.md`](../../.pHive/metrics/experiment-envelope.schema.md) — per-experiment envelope carrier referenced when `metric.source.kind = envelope` (or via `envelope_id`)

## 1. Purpose

This reference fixes the canonical shape of a story YAML under
`.pHive/epics/<epic-id>/stories/<story-id>.yaml`. It enumerates the
fields that already appear across recent epics (catalog-hygiene-and-borrows,
structural-refactor-and-gate-lift, metrics-as-planning-concern) and adds
the new `metric:` field group required by the `metrics` cross-cutting
concern.

Scope rule: this doc does **not** redefine existing fields. It inventories
them so authors know where the new `metric:` block slots in.

## 2. Existing fields (inventory, do not redefine)

The following keys already appear at the top level of recent story YAMLs.
They are listed here for orientation only; their semantics live in the
planning skill and team-lead guidance, not in this schema.

| Field                | Cardinality | Example                                    |
|----------------------|-------------|--------------------------------------------|
| `id`                 | required    | `a-25-skill-prelude-extraction`            |
| `epic`               | required    | `catalog-hygiene-and-borrows`              |
| `title`              | required    | `Extract skill-prelude.md ...`             |
| `status`             | required    | `pending` \| `in-progress` \| `done`       |
| `complexity`         | required    | `small` \| `medium` \| `large`             |
| `methodology`        | required    | `classic` \| `tdd`                         |
| `depends_on`         | required    | `[]` or list of story ids                  |
| `wave`               | required    | `W0` … `W6`                                |
| `action_id`          | required    | `A-25`, `M-08`                             |
| `description`        | required    | block scalar `\|`                          |
| `acceptance_criteria`| required    | list of strings                            |
| `steps`              | required    | list of `{id, description, agent, depends_on?}` |
| `context`            | required    | `{codebase, key_files, tech_stack?}`       |
| `design_decisions`   | optional    | list of `{decision, rationale}`            |
| `risks`              | optional    | list of `{severity, description, mitigation}` |
| `references`         | optional    | list of `{path, relevant_excerpt}`         |
| `metric`             | **required from this schema forward** | see §3 |

Authors must not invent new top-level keys to carry metric-shaped
information. Anything metric-related goes inside `metric:`.

## 3. The `metric:` field group

Per the `metrics` cross-cutting concern, every story must either declare
a metric block or explicitly opt out. The block is a top-level mapping
under the story root and conventionally slots in **after**
`acceptance_criteria` and **before** `steps`, so a reader scanning the
file sees what the story is supposed to move alongside what "done" means.

### 3.1 Shape

```yaml
metric:
  applies: true | false

  # ---- if applies: true ----
  name: string              # e.g., "kg_signal.findings_emitted_per_cycle"
  direction: up | down      # which way the number should move
  unit: string              # "count" | "ratio" | "seconds" | "bytes" | etc.
  baseline: number | null   # null = first measurement (no prior baseline)
  target: number            # the target value at verify_at
  window: string            # observation window, e.g., "7d post-merge" |
                            # "epic-close" | "next-3-cycles"
  source:
    kind: events | sql | envelope | manual
    ref: string             # query name, envelope_id, JSONL filter,
                            # or one-line manual-measurement recipe
  envelope_id: string | null  # optional explicit link to
                            # .pHive/metrics/experiments/<id>.yaml
                            # (use this OR source.kind=envelope+ref, not both)
  verify_at: string         # ISO-8601 timestamp OR relative anchor
                            # ("story integrate step", "epic close",
                            # "first cycle post-merge")
  owner: string             # agent name or role responsible for the read
                            # ("developer", "tester", "tpm")

  # ---- if applies: false ----
  justification: string     # one-line reason metric does not apply;
                            # one-word answers fail review
```

### 3.2 Field semantics

#### 3.2.1 `applies`

Boolean gate. `true` means the story carries a falsifiable claim and the
remaining `applies:true` fields are required. `false` means the story is
substrate/un-falsifiable and `justification` is required.

#### 3.2.2 `name`

Dotted metric identifier. Recommended convention: `<domain>.<measurement>`
(e.g., `kg.import_coverage_ratio`, `plan.first_attempt_pass_rate`). If the
metric writes to `.pHive/metrics/events/*.jsonl`, this should match a
`metric_type` from the
[`metrics-event.schema.md`](../../.pHive/metrics/metrics-event.schema.md) §4
registry OR be a derived metric whose `source.ref` makes the derivation
explicit.

#### 3.2.3 `direction`

`up` if a higher value is better, `down` if lower is better. Both are
required even when "obvious"; readers without context cannot infer
direction from the name (e.g., is `fix_loop_iterations` good high or bad
high?).

#### 3.2.4 `unit`

The measurement unit. Use the same unit string the carrier emits
(`metrics-event.schema.md` §3.11). Common values: `count`, `ratio`,
`seconds`, `ms`, `tokens`, `bytes`, `bool`.

#### 3.2.5 `baseline`

The value before this story lands. `null` is allowed when no prior
measurement exists; in that case `verify_at` measures absolute level,
not delta. Numeric baselines should match the unit (`baseline: 0.55`
not `baseline: "55%"`).

#### 3.2.6 `target`

The value at `verify_at` that the story claims to reach. A story is
falsified at `verify_at` if `direction:up && observed < target` or
`direction:down && observed > target`. Targets must be concrete numbers,
not adjectives ("better", "improved").

#### 3.2.7 `window`

Observation window over which the read is taken. Stories that ship a
one-time delta use `"epic-close"` or `"story integrate step"`; stories
that ship behavioral changes whose effect amortizes use a duration
(`"7d post-merge"`, `"next-3-cycles"`). The window scopes the SQL filter
or envelope close-time.

#### 3.2.8 `source.kind` (enum)

How the measurement is read. Bounded to four kinds; each later kind
needs a reader implementation, so adding a kind is a schema change, not
a story-author choice.

| `source.kind` | Carrier read                                          | `source.ref` shape                |
|---------------|--------------------------------------------------------|-----------------------------------|
| `events`      | `.pHive/metrics/events/*.jsonl` per `metrics-event.schema.md` | a JSONL filter or named query |
| `sql`         | `~/.claude/hive/kg.sqlite` or other named SQL store    | a SELECT or named query           |
| `envelope`    | `.pHive/metrics/experiments/<id>.yaml` per `experiment-envelope.schema.md` | envelope_id |
| `manual`      | Human or scripted one-shot read at `verify_at`         | one-line recipe                   |

#### 3.2.9 `envelope_id`

Optional. When set, links the story to a per-experiment envelope under
`.pHive/metrics/experiments/`. Use either this field OR `source.kind=envelope`
with `source.ref=<envelope_id>`, not both — they encode the same
relationship.

#### 3.2.10 `verify_at`

When the verification read happens. Accepted forms:
- ISO-8601 timestamp: `"2026-06-01T00:00:00Z"`
- Anchored relative: `"story integrate step"`, `"epic close"`,
  `"first cycle post-merge"`, `"next-3-cycles"`

`"eventually"`, `"someday"`, and empty values fail review.

#### 3.2.11 `owner`

Agent name or role that performs the read at `verify_at`. This is the
person/role on the hook for falsifiability, not the implementer.

#### 3.2.12 `justification` (applies:false only)

One-line reason the metric does not apply. Acceptable patterns:
- "Process substrate; gate itself is what's shipping."
- "Pure-doc story; M-07 retro evaluates the cohort."
- "Internal refactor; no observable surface."

Unacceptable: `"N/A"`, `"none"`, `"-"`, empty string. The planning review
step rejects one-word justifications.

### 3.3 Worked examples

#### 3.3.1 `applies: true` — KG coverage delta read at integrate

From `m-08-kg-import-decision-shape-v2.yaml`:

```yaml
metric:
  applies: true
  name: kg.import_coverage_ratio
  direction: up
  unit: ratio
  baseline: 0.55           # 35 / 64 decisions ingested today
  target: 0.92              # ~59 / 64; allows ≤5 genuinely unparseable
  window: "first apply post-merge"
  source:
    kind: manual
    ref: "sqlite3 ~/.claude/hive/kg.sqlite 'SELECT COUNT(*) FROM triples;' / bootstrap-summary decisions-found"
  verify_at: "story integrate step"
  owner: developer
```

#### 3.3.2 `applies: true` — event-carried metric with envelope link

```yaml
metric:
  applies: true
  name: plan.first_attempt_pass_rate
  direction: up
  unit: ratio
  baseline: 0.64
  target: 0.80
  window: "next-3-cycles"
  source:
    kind: events
    ref: "metric_type=first_attempt_pass AND swarm_id=meta-meta-optimize"
  envelope_id: exp_2026-05-15_plan-grill-borrow
  verify_at: "2026-06-01T00:00:00Z"
  owner: tpm
```

#### 3.3.3 `applies: false` — substrate story

From `m-01-add-metrics-concern.yaml`:

```yaml
metric:
  applies: false
  justification: "Process-substrate; M-07 retro backfill measures whether the gate works."
```

## 4. Review checklist (for /plan + /review)

A story's `metric:` block is acceptable when:

- `applies` is present and boolean.
- If `applies: true`: `name`, `direction`, `unit`, `target`, `window`,
  `source.kind`, `source.ref`, `verify_at`, `owner` are all present and
  non-empty; `target` is a concrete number; `direction` is `up` or
  `down`; `source.kind` is one of the four enum values; `verify_at` is
  ISO-8601 or an anchored relative form (not `"eventually"`).
- If `applies: false`: `justification` is a full sentence, not a single
  token. One-word justifications fail review.
- The block is internally consistent: if `source.kind = envelope`,
  either `source.ref` or `envelope_id` resolves to a real envelope file
  under `.pHive/metrics/experiments/`.
- The metric is falsifiable from the declared source alone — a future
  reader does not need to re-read the story to decide pass/fail.

## 5. Epic index (`epic.yaml`)

Each epic carries a sibling index at `.pHive/epics/{epic-id}/epic.yaml`
emitted by `/plan` step 15. The index is a lightweight pointer to the
stories plus the small set of cross-story fields that downstream skills
(`/execute`, the sandcastle bridge, the GH Actions dispatch workflow)
need before opening any individual story YAML.

### 5.1 Canonical template

```yaml
name: <epic-id>                  # kebab-case identifier; matches dir name
title: <human title>
target_codebase: <abs path>      # absolute path to the codebase /plan targeted
methodology: <classic|bmad>      # selected in /plan; can be overridden per-story

# pe-5: pinned at plan time from `hive/lib/git_flow.mjs` (pe-1). The
# sandcastle bridge (pe-2) and dispatch workflow (pe-3) prefer these
# pinned values over the live `hive.config.yaml`, so a config drift
# after plan does not retroactively shift the epic's branching target.
git_flow:
  base_branch: <resolved>        # e.g. `develop` or `main` or `dev/hive-2.0`
  branch_strategy: <resolved>    # `per-epic` (default) | `per-story`

source_issue: <gh-issue-number>  # optional; tracker linkage

stories:
  - id: <story-id>
    title: <story title>
    complexity: <low|medium|high>
    depends_on: [<story-ids>]
```

### 5.2 The `git_flow` block

| Field | Type | Allowed values | Source |
|---|---|---|---|
| `base_branch` | string | any git branch name | resolved by `resolveGitFlow({ cwd })` at plan time |
| `branch_strategy` | string | `per-epic` \| `per-story` | resolved by `resolveGitFlow({ cwd })` at plan time |

**Pinning rationale.** `base_branch` and `branch_strategy` are resolved
**once** during Phase A step 0a of `/plan` and persisted into
`epic.yaml`. Subsequent dispatch runs (bridge + workflow) read the
pinned values from `epic.yaml` in preference to the live config — so
two stories of the same epic that ship a week apart land on the same
base regardless of config edits in between.

**Idempotency on re-plan.** If `epic.yaml` already exists when /plan
re-emits it:
- a `git_flow:` block that already exists has its two field values
  updated in place (no duplication);
- if absent, the block is inserted immediately after `methodology:`.

**Back-compat.** Epics that pre-date pe-5 may have no `git_flow:` block.
Downstream consumers fall back to the live `hive.config.yaml` for those
epics; the bridge / workflow emit a one-line info log noting the
fall-through.
