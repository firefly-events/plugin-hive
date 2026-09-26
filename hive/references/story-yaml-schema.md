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
| `status`             | advisory    | `pending` \| `in_progress` \| `completed` (derived) plus `deferred` \| `blocked` \| `failed` (forward-stated) — **derived status is authoritative; episode markers + git state win on conflict.** See `hive/lib/story-status.mjs`. The deriver currently reads `deferred` as a YAML block and respects it; other forward-stated values are advisory. |
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
| `parallel_allowed`   | optional    | `true` (default: `false` when omitted)     |
| `parallel_rationale` | conditional | `variation` \| `read-only` \| `bounded-slice` (required iff `parallel_allowed: true`) — see §4 |
| `test_scenario`      | optional    | pointer into `.pHive/test-scenarios/` — see §7 |
| `terminal_handoff`   | optional    | post-integrate dispatch config — see §8    |
| `manual_verdict`     | optional    | simulated-manual test result — see §9      |

Authors must not invent new top-level keys to carry metric-shaped
information. Anything metric-related goes inside `metric:`.

## 2a. Status field — advisory vs authoritative

The `status:` field is **advisory**. Derived status from `hive/lib/story-status.mjs`
(`deriveStoryStatus({ epic_id, story_id })`) is authoritative. Tools reading story
state (`/hive:status`, planning consumers, meta-team feeds) MUST call the deriver,
not read the raw YAML field.

The deriver computes status from:
1. `deferred:` block in YAML → `deferred`
2. Episode markers with `status: failed|escalated` → `failed`
3. `depends_on` stories not yet completed + no markers → `blocked`
4. No markers → `pending`
5. Final workflow step has marker `status: completed` → `completed`
6. Markers exist, final step not complete → `in_progress`

The `status:` field is still writable for forward-stating intent (`deferred`,
`blocked`, `failed`) and planning scaffolding. The deriver gives it lower
priority than episode markers + git state (per `episode-schema.md` §"Authoritative source order"). Currently only `deferred` is read by the deriver (as a YAML block) — the other forward-stated values are advisory.

## 8. The `terminal_handoff:` field group

Added by story `d-1-handoff-dispatch-and-execute-wire`. Controls what `/execute` dispatches
immediately after the story's `integrate` step writes its episode marker.

### 8.1 Shape

```yaml
terminal_handoff:
  next: none | test | review | both   # target for the post-integrate dispatch
```

### 8.2 Field semantics

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `next` | enum | `none` | What to invoke after integrate. `none` = no-op. `test` = `/test --story <id>`. `review` = `/review #<pr>` or `/review <branch>`. `both` = test first, then review. |

### 8.3 Precedence

`/execute` resolves the target using this cascade (first non-null wins):

1. `story.terminal_handoff.next`
2. `epic.execution.terminal_handoff_default` (in the loaded `epic.yaml`)
3. `execution.terminal_handoff_default` in the root `hive.config.yaml` (default `none`)

The default `none` at all levels preserves prior behavior byte-equivalently.

### 8.4 Example

```yaml
# story YAML — opt this story into a post-integrate test run
terminal_handoff:
  next: test
```

```yaml
# epic.yaml — opt every story in the epic into review
execution:
  terminal_handoff_default: review
```

## 9. The `manual_verdict:` field group

Added by story `c-2-test-simulated-manual-mode` in the `autonomous-cycle-loop` epic. Carries the result of a `/test --simulated-manual` run. This story-YAML block is the canonical source of truth for simulated-manual verdicts; `.pHive/cycle-state/<epic-id>.yaml` may expose a derived/index view, but it is not the source. The block is written by `tester` after executing the linked scenario; `/plan` seeds a placeholder when the `simulated-manual` cross-cutting concern applies.

### 9.1 Shape

```yaml
manual_verdict:
  scenario_ref: <repo-relative path>   # path to .pHive/test-scenarios/<id>.yaml
  required: true | false               # default false — see 9.1b
  verdict: pass | fail | inconclusive  # written by /test --simulated-manual
  timestamp: <ISO 8601>                # when the verdict was rendered (null = not yet run)
  agent: <agent-name>                  # persona that executed the scenario (null = not yet run)
  waived:                              # optional — see 9.1a
    reason: <string>
    timestamp: <ISO 8601>
    owner: <string>
```

### 9.1b The `required:` field (story wr-3-manual-verdict-aging, REVISION-1b)

"Required device-pass" is not derivable from any other existing story/epic data —
the `simulated-manual` concern can apply to non-UI stories too, and no separate
device/UI tier field exists elsewhere in the schema. `required` is therefore
**plan-owned and derived at plan time**, never a human-set field at ship time:

- **Who writes:** `/plan` step 14, when seeding `manual_verdict` for the
  `simulated-manual` concern (see [`skills/plan/SKILL.md`](../../skills/plan/SKILL.md)
  step 14 "Simulated-manual concern"). The planning persona sets `required: true`
  only when the story is judged a genuine UI/device-pass gate (a real device or
  manual pass is needed to validate it); otherwise `required: false`. This is
  automatic during planning — no operator prompt at ship time, no ship-time toggle.
- **Default:** `false` when absent, for byte-compatibility with every
  pre-existing `manual_verdict` block seeded before this field existed.
- **Who honors:** `/ship`'s UI-done-done refusal
  (`hive/lib/manual_verdict_status.py:epic_has_required_device_pass` /
  `blocking_pending_verdicts`) blocks done-done ONLY for a PENDING, non-waived
  verdict with `required: true`. `required: false`/absent is never a blocker —
  this corrects the round-1 bug that keyed blocking off mere `manual_verdict`
  presence, which wrongly blocked non-UI epics. `/status`'s PENDING aging
  section is unaffected by `required` — it surfaces every PENDING block
  regardless of the flag (broad nag).

### 9.1a The optional `waived:` sub-field (story wr-3-manual-verdict-aging)

Added by story `wr-3-manual-verdict-aging` in the `wfd-retro-hardening` epic. Reuses
the existing `manual_verdict` block — this is NOT a new top-level schema block (per
the grill-reduced scope of proposals (b)+(i); see
`.pHive/epics/wfd-retro-hardening/docs/design-discussion.md` sec 0b).

| Sub-field | Type | Default | Description |
|-----------|------|---------|-------------|
| `waived.reason` | string | — | Required when `waived` is present. Human-readable reason the PENDING verdict is being waived. |
| `waived.timestamp` | ISO 8601 | — | Required when `waived` is present. When the waive was recorded. |
| `waived.owner` | string | — | Required when `waived` is present. Who recorded the waive. |

**Who writes:** an operator, via `/ship`'s waive path (`hive/lib/manual_verdict_status.py:waive_pending_verdict`), only while `verdict` is still `null` (PENDING). Writing a waive never mutates `verdict`, `timestamp`, or `agent` — those still update normally if `/test --simulated-manual` later runs for real.

**Who honors:** `/status`'s PENDING aging section (still lists a waived entry, labeled `waived (aging)`, not hidden) and `/ship`'s UI-done-done refusal (a waived PENDING no longer blocks shipping).

**Absence semantics:** `waived` absent (the common case, and the only case for every pre-existing story) means "not waived" — identical behavior to before this field existed. No migration needed for existing epics.

**Audit posture (grill T3):** a waive is additive, never a deletion of the PENDING signal — it must not become a new silent indefinite-PENDING. `/status` keeps surfacing a waived entry with its aging, so a waive is a visible, owned decision, not a bypass.

### 9.2 Field semantics

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scenario_ref` | string | — | Repo-relative path to the scenario YAML; must resolve to a file conforming to [`test-scenario-schema.md`](test-scenario-schema.md). Set at plan time; updated by the tester if the scenario file is renamed. |
| `required` | bool | `false` | Plan-derived flag marking a UI/device-pass gate that must render a passing (or waived) verdict before `/ship` may mark the epic done-done. See 9.1b. |
| `verdict` | enum \| null | `null` | The outcome of the last `/test --simulated-manual` run: `pass`, `fail`, or `inconclusive`. `null` = not yet run. |
| `timestamp` | ISO 8601 \| null | `null` | Wall-clock time when the verdict was recorded. `null` = not yet run. |
| `agent` | string \| null | `null` | Persona name that executed the scenario (e.g., `tester`). `null` = not yet run. |
| `waived` | mapping \| absent | absent | See 9.1a. Only meaningful while `verdict` is `null`. |

### 9.3 Lifecycle

1. **Plan time:** `/plan` step 14 seeds `manual_verdict` with `scenario_ref` set to a placeholder path and `verdict: null` when the `simulated-manual` cross-cutting concern applies.
2. **Scenario authoring:** The tester who executes the `scenario` step writes the real scenario YAML at `scenario_ref` per [`test-scenario-schema.md`](test-scenario-schema.md).
3. **Verdict time:** `/test --simulated-manual <story-id>` reads `manual_verdict.scenario_ref`, executes the scenario, and writes the final `verdict`, `timestamp`, and `agent` into the block.

### 9.4 Worked example

```yaml
# story YAML — seeded by /plan at planning time for a UI/device-pass story
manual_verdict:
  scenario_ref: .pHive/test-scenarios/c-2-test-simulated-manual-mode-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null

# same story YAML — after /test --simulated-manual runs successfully
manual_verdict:
  scenario_ref: .pHive/test-scenarios/c-2-test-simulated-manual-mode-manual.yaml
  required: true
  verdict: pass
  timestamp: "2026-05-21T20:45:00Z"
  agent: tester

# a non-UI story that also opts into simulated-manual — required stays false
manual_verdict:
  scenario_ref: .pHive/test-scenarios/some-backend-story-manual.yaml
  required: false
  verdict: null
  timestamp: null
  agent: null
```

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

## 4. The `parallel_allowed` / `parallel_rationale` field group

Per the default-serial parallel-dispatch contract (`exec-discipline-may2026`
epic, capability #132), stories opt INTO parallelization explicitly rather
than out of it. The two fields live at the story-YAML top level and
conventionally slot in **after** `depends_on` and **before** `description`,
so the dispatcher (and a human skimming the file) can decide concurrency
without parsing the body.

### 4.1 Shape

```yaml
parallel_allowed: true | false                              # optional; default false
parallel_rationale: variation | read-only | bounded-slice   # required iff parallel_allowed: true
```

### 4.2 Field semantics

#### 4.2.1 `parallel_allowed` (optional, default `false`)

Boolean opt-in flag. A story with `parallel_allowed: true` MAY be
dispatched concurrently with its dependency-graph peers; a story with
`parallel_allowed: false` (or the field omitted entirely) MUST be
dispatched serially even when no `depends_on` edges block it.

The default is `false` so a planner who forgets the flag gets safe
serial execution, not accidental concurrency. Defaulting to `true` would
let an unconsidered story step on another story's writes without anyone
having to think about it.

#### 4.2.2 `parallel_rationale` (required iff `parallel_allowed: true`)

Enumerated string capturing **why** parallel dispatch is safe for this
specific story. The enum is bounded — free-form prose is rejected because
the lint rule that consumes this field (`ed-7-execute-enforces-gate`)
cannot decide safety from arbitrary justifications.

| Value | Meaning |
|---|---|
| `variation`     | One of N near-identical stories that apply the same template to disjoint targets (e.g., the same refactor against N sibling modules). Each story's file set does not overlap any sibling's. |
| `read-only`     | The story performs reads + analysis + reporting only — no writes to repo state. Multiple read-only stories can interleave freely. |
| `bounded-slice` | The story writes to a narrow, declared slice of the codebase that does not overlap any concurrent story's slice. The slice boundary is set by `/plan` and audited by `/execute`; "shouldn't conflict" prose is not acceptable. |

### 4.3 Required-when rules

- **`parallel_allowed: true` + missing `parallel_rationale`**: the story
  is **malformed**. Validators reject it.
- **`parallel_allowed: true` + `parallel_rationale` not one of the three
  enum values**: the story is **malformed**. Validators reject it.
- **`parallel_allowed: false` (or omitted) + `parallel_rationale`
  present**: the rationale is **ignored**. Validators emit a warning
  (stale field), not a fatal error — a leftover rationale is a
  documentation hygiene issue, not a correctness issue.

### 4.4 Worked examples

#### 4.4.1 `variation` — same refactor across sibling modules

```yaml
id: ui-cluster-extract-config-header
depends_on: [ui-cluster-extract-config-base]
parallel_allowed: true
parallel_rationale: variation
# One of 7 stories that apply the same "extract <Component>Config out of
# <Component>.tsx" refactor. Each variation edits exactly one component
# file; the seven file sets are disjoint, so all seven can land
# concurrently.
```

#### 4.4.2 `read-only` — analysis-only story

```yaml
id: audit-skill-prompt-token-budgets
depends_on: []
parallel_allowed: true
parallel_rationale: read-only
# Reads every skill prompt under skills/, counts tokens, writes a
# report to .pHive/audits/skill-token-budgets/. Touches no production
# code, runtime config, or other story's output.
```

#### 4.4.3 `bounded-slice` — narrow declared write surface

```yaml
id: cmux-add-logging-hook
depends_on: [cmux-pane-spawn-base]
parallel_allowed: true
parallel_rationale: bounded-slice
files_to_modify:
  - file: hive/lib/cmux/pane_hooks.mjs
    change: register new "log" hook
# Slice boundary: hive/lib/cmux/pane_hooks.mjs only. No other concurrent
# story in this epic writes anywhere under hive/lib/cmux/.
```

## 5. Review checklist (for /plan + /review)

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

A story's `parallel_allowed` / `parallel_rationale` pair is acceptable when:

- `parallel_allowed` is either absent, `false`, or `true` (no other
  values; no string `"yes"`/`"no"`).
- If `parallel_allowed: true`: `parallel_rationale` is present and is
  exactly one of `variation`, `read-only`, `bounded-slice`. Any other
  value, or missing rationale, is malformed.
- If `parallel_allowed: false` or omitted: `parallel_rationale` is
  ignored. A stale rationale here yields a warning (documentation
  hygiene), not a failure.

## 6. Epic index (`epic.yaml`)

Each epic carries a sibling index at `.pHive/epics/{epic-id}/epic.yaml`
emitted by `/plan` step 15. The index is a lightweight pointer to the
stories plus the small set of cross-story fields that downstream skills
(`/execute`, the sandcastle bridge, the GH Actions dispatch workflow)
need before opening any individual story YAML.

### 6.1 Canonical template

```yaml
name: <epic-id>                  # kebab-case identifier; matches dir name
title: <human title>
target_codebase: <abs path>      # absolute path to the codebase /plan targeted
methodology: <classic|tdd|bdd>   # selected in /plan; can be overridden per-story
version_bump: <major|minor|patch|none>  # selected in /plan; consumed by /execute finalize

# pe-5: pinned at plan time from `hive/lib/git_flow.py` (pe-1). The
# sandcastle bridge (pe-2) and dispatch workflow (pe-3) prefer these
# pinned values over the live `hive.config.yaml`, so a config drift
# after plan does not retroactively shift the epic's branching target.
git_flow:
  base_branch: <resolved>        # e.g. `develop` or `main` or `dev/hive-2.0`
  branch_strategy: <resolved>    # `per-epic` (default) | `per-story`

depends_on_epic: <epic-id | [epic-ids]>  # optional; see 6.5
planned_base_ref: <sha>          # optional; see 6.5

source_issue: <gh-issue-number>  # optional; tracker linkage

stories:
  - id: <story-id>
    title: <story title>
    complexity: <low|medium|high>
    depends_on: [<story-ids>]
```

### 6.2 The `git_flow` block

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

### 6.3 The `version_bump` field

| Field | Type | Allowed values | Source |
|---|---|---|---|
| `version_bump` | string | `major` \| `minor` \| `patch` \| `none` | selected by the user during `/plan` |

**Release intent.** `/plan` asks "Does this epic bump the version?
major | minor | patch | none" and persists the answer on `epic.yaml`.
This records intent only; `/plan` does not edit version sources.

**Execution ownership.** `/execute` reads `version_bump` during the
epic-finalize path after story implementation has completed. When the
value is `major`, `minor`, or `patch`, `/execute` bumps every plugin
version source to the same semver and writes a changelog entry for the
epic. When the value is `none`, finalize performs a clean no-op for
version files and changelog release text.

**Back-compat.** Epics that pre-date this field may omit it. Downstream
consumers treat omission as `none` and emit a one-line info log so the
operator can decide whether to re-plan with explicit release intent.

### 6.4 The `planning_team:` block

Added by dpt-4-wire-plan-and-provenance. Written by `/plan` step 15 alongside `git_flow:`. Contains the operator-visible provenance of the planning team — what planning-classification matched, why, and what gate decisions it produced. This is the audit surface that makes team composition traceable and overridable.

#### 6.4.1 Shape

```yaml
planning_team:
  matched_tags: [<list of tag strings>]   # classification signals that fired
  roster: [<list of persona names>]        # resolved assembled_personas passed to planning-routing
  per_tag_reasoning:
    <tag>: <one-line reasoning string>     # why this tag matched, per tag
  confidence: <matched|low>                # classification confidence
  gate_decisions:                          # per-tag gate outcome from classification
    <tag>: <included|suppressed-no-ui|suppressed-unknown-ui>
```

#### 6.4.2 Field semantics

| Field | Type | Description |
|---|---|---|
| `matched_tags` | list of strings | The classification tags that fired for this requirement. Sourced from `${classification_output}.matched_tags`. |
| `roster` | list of strings | The resolved `assembled_personas` list passed to planning-routing. This is what was actually used for team assembly. |
| `per_tag_reasoning` | map string→string | One-line reasoning string per matched tag explaining why the tag applied. Sourced from `${classification_output}.per_tag_reasoning`. |
| `confidence` | enum | Classification confidence: `matched` (≥1 tag matched with clear evidence) or `low` (no tag matched, or weak/ambiguous evidence). Sourced from `${classification_output}.confidence`. |
| `gate_decisions` | map string→enum | Per-matched-tag gate outcome, keyed by work-type tag. One of `included`, `suppressed-no-ui`, or `suppressed-unknown-ui` (the latter two from the `requires_ui` project gate). Sourced from `${classification_output}.gate_decisions`. |

#### 6.4.3 Idempotency on re-plan

If `epic.yaml` already contains a `planning_team:` block, `/plan` overwrites it with the current run's classification output. The canonical field order in epic.yaml is `methodology` → `version_bump` → `git_flow` → `planning_team`; if the block is absent on a re-plan, insert it immediately after `git_flow:`.

#### 6.4.4 Back-compat

Epics that pre-date dpt-4 have no `planning_team:` block. Downstream consumers treat its absence as unknown provenance and emit a one-line info log; they do not fail or block on its absence.

#### 6.4.5 Worked example

```yaml
planning_team:
  matched_tags: [architecture, security]
  roster: [researcher, technical-writer, tpm, architect, security-reviewer]
  per_tag_reasoning:
    architecture: "requirement describes a new REST endpoint surface spanning subsystems"
    security: "introduces auth/token handling across three services"
  confidence: matched
  gate_decisions:
    architecture: included
    security: included
```

### 6.5 The `depends_on_epic:` / `planned_base_ref:` field group

Added by story `wr-6-plan-drift-instrument`. Canonicalizes a field that
existed ad-hoc on exactly one prior epic (`skill-ergo-may2026`, plan-dated
2026-05-17) before this story — absent from this schema, and absent from
`/plan`'s emit path. These two fields are the input the `/execute`
auto-firing reconciliation gate (§ below, see `skills/execute/SKILL.md`)
reads to decide whether an epic's dependency has moved since planning.

#### 6.5.1 Shape

```yaml
depends_on_epic: <epic-id>              # scalar form, OR:
depends_on_epic: [<epic-id>, ...]       # list form — both are canonical

planned_base_ref: <sha>                  # resolved merge-base SHA, pinned at plan time
```

#### 6.5.2 Field semantics

| Field | Type | Allowed values | Source |
|---|---|---|---|
| `depends_on_epic` | string \| list of strings | one or more `epic-id`s this epic's stories depend on | operator-declared during `/plan`, when the requirement names a real prerequisite epic rather than honor-system sequencing |
| `planned_base_ref` | string | a resolved git commit SHA | pinned by `/plan` as the resolved merge-base SHA of `git_flow.base_branch` and the dependency ref (`git merge-base <base_branch> <dependency-ref>`) at the moment this epic's branch forked from it, mirroring the `git_flow` pinning rationale in § 6.2 |

Both fields are independent: an epic may declare `depends_on_epic` for
documentation/audit purposes without `planned_base_ref` (no reconciliation
tracking), though `/plan` sets both together going forward when a real
dependency is declared.

#### 6.5.3 Who-writes / who-honors / absence-semantics

| Field | Who writes | Who honors | Absence semantics |
|---|---|---|---|
| `depends_on_epic` | `/plan`, at epic-creation time, when the operator confirms a real prerequisite epic (gate decision, not inferred) | `/execute` preamble (reconciliation gate), `/status` (dependency display) | Absent means "no declared epic-level dependency" — treated identically to an epic that pre-dates this story. Never inferred from `depends_on` story-level fields or narrative description text. |
| `planned_base_ref` | `/plan`, at the same time as `depends_on_epic`, resolved via `git merge-base <base_branch> <dependency-ref>` | `/execute` preamble (reconciliation gate) — compared against the CURRENT resolved `git merge-base <base_branch> <dependency-ref>` | Absent (or present on `depends_on_epic` alone) means "dependency declared but not tracked for drift" — the gate never fires; no reconciliation is ever required. A present-but-non-SHA value (a bare branch name such as `develop`, written before this story canonicalized the field) is a **legacy placeholder**: the gate skips with a one-line info log rather than treating it as a resolvable ref — no migration is forced on pre-dating epics. |

#### 6.5.4 Idempotency on re-plan

If `epic.yaml` already contains `depends_on_epic:`/`planned_base_ref:`,
`/plan` re-resolves `planned_base_ref` in place on a re-plan (the pinned
merge-base may have shifted since the last plan pass); `depends_on_epic`
is left untouched unless the operator explicitly changes the dependency.
Canonical field order in `epic.yaml` is `git_flow` → `depends_on_epic` →
`planned_base_ref` → `planning_team`; insert immediately after `git_flow:`
when absent.

#### 6.5.5 Back-compat

Epics that pre-date this story (including `skill-ergo-may2026`'s ad-hoc
list-form usage) validate as-is — both scalar and list forms of
`depends_on_epic` are canonical, and a non-SHA `planned_base_ref` is a
legacy placeholder rather than a validation error. No existing epic
requires a migration to keep validating.

#### 6.5.6 Worked example

```yaml
depends_on_epic: skill-footprint
planned_base_ref: a35c3c3e1b2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f
```

## 7. The `test_scenario` field group

Per the `autonomous-cycle-loop` epic (story `s0-1-schema-and-config-bump`),
a story MAY declare an optional link from itself to a replay scenario
that the autonomous cycle loop can use as an end-to-end regression
guard against the behavior the story ships. The field is **optional**
and **additive** — pre-existing stories continue to validate without
edits.

### 7.1 Shape

```yaml
test_scenario:
  id: <scenario-id>           # kebab-case; must resolve to
                              # .pHive/test-scenarios/<scenario-id>.yaml
                              # per test-scenario-schema.md
  required: true | false      # optional, default false
                              # true  → loop run FAILS if the scenario is missing
                              # false → loop skips with an info log
```

### 7.2 Field semantics

#### 7.2.1 `id`

Kebab-case scenario identifier. Must resolve to a real scenario YAML at
`.pHive/test-scenarios/<id>.yaml` (path overridable via
`autonomous_cycle_loop.test_scenarios_path`; see
[`sandcastle-mode.md`](sandcastle-mode.md)). The schema does not enforce
existence at story-write time — the loop runner checks at replay time,
and `required:` controls whether absence is fatal.

#### 7.2.2 `required` (optional, default `false`)

Whether the linked scenario must exist when the loop runs.

- `false` (default): a missing scenario is a `[debug]` log line; the
  loop continues. Use this when the scenario is aspirational, or when
  the story ships substrate that does not yet have a scenario built
  against it.
- `true`: a missing scenario fails the loop run for this story. Use
  this when the story explicitly co-ships a scenario that asserts the
  story's behavior — losing the scenario silently would defeat the
  guard.

### 7.3 Foundation status

This story (`s0-1-schema-and-config-bump`) ships the schema only. No
consumer reads `test_scenario:` yet — the loop runner that consumes it
lands in a later story of the `autonomous-cycle-loop` epic. Until the
runner ships, the field is inert; authors may begin declaring it on new
stories so the link is in place when the runner arrives.

### 7.4 Worked example

```yaml
id: auto-loop-runner-walk-directory
test_scenario:
  id: standup-empty-queue
  required: true
# Stub: when this story's runner lands, it must keep the smoke-tier
# standup-empty-queue scenario green. Marking required:true asserts the
# scenario will exist as of the story's integrate phase.
```
