---
title: Vertical Slice Plan — Meta-Improvement System (Epic C)
type: vertical-plan
epic: meta-improvement-system
phase: epic-c-metrics-instrumentation
status: draft
created: 2026-04-19
---

# Vertical Slice Plan: Meta-Improvement System — Epic C (Metrics Instrumentation)

Each slice produces a working, independently-mergeable state. Slices are ordered so earlier
slices unblock later ones. Within a slice, stories with no `depends_on` may run in parallel.

---

## Slice 1 — Schema Foundation

**Goal:** Define the canonical metrics format. Every downstream story depends on this.
**Working state after:** Any agent or tool can write compliant JSONL records. Schema is
the single source of truth for field names, types, and nullability rules.

### Story C1-a: Metrics schema reference

**File:** `hive/references/metrics-schema.md`

**What it does:** Defines all four record types (step, story, epic, session) with field
names, types, nullability, and sourcing notes. Includes a `schema_version` field for
forward compatibility. Documents the token sourcing strategy (API → inference → null).

**Acceptance criteria:**
- `hive/references/metrics-schema.md` exists with all four record schemas
- Each field has: name, type, nullable (yes/no), sourcing note
- Schema version field `schema_version: 1` present in all record definitions
- Token sourcing decision documented (API-first, inference fallback, null-ok)
- File cross-references the experiment protocol (C4-a) once it exists

**Complexity:** Low  
**Agent:** developer  
**Depends on:** nothing

---

### Story C1-b: Storage layout bootstrap

**File:** `.pHive/metrics/` directory convention + `hive/references/metrics-query.md`

**What it does:** Documents the storage layout (which JSONL files, where, naming convention).
Creates `hive/references/metrics-query.md` with bash/python one-liners for common queries:
total cost per epic, average wall-clock per story, fix-loop rate, cache hit rate.

Does NOT create the JSONL files themselves — those are created on first write by the
instrumentation hooks. Creates only the `.pHive/metrics/experiments/` directory placeholder
(a `.gitkeep` or README).

**Acceptance criteria:**
- `hive/references/metrics-query.md` exists with at least 5 query patterns
- Each query pattern includes: name, intent, command, example output
- `.pHive/metrics/experiments/.gitkeep` exists (so directory is tracked)
- Storage layout documented in `metrics-schema.md` (via C1-a cross-reference or inline)

**Complexity:** Low  
**Agent:** developer  
**Depends on:** C1-a

---

## Slice 2 — Instrumentation Hooks

**Goal:** Wire the write points so real story executions produce metric records.
**Working state after:** Any story executed via the daily ceremony automatically writes
step and story JSONL records. Metrics start accumulating from this point forward.

### Story C2-a: Step-07 post-step metrics write

**File:** `hive/workflows/steps/daily-ceremony/step-07-kick-off.md`

**What it does:** Adds a "Write step metrics record" sub-task after the existing "Write
episode markers" sub-task (step 3c). The orchestrating team lead appends a step record to
`.pHive/metrics/episodes.jsonl` after each workflow step completes.

Record field sourcing:
- `wall_clock_s`: difference between step start timestamp (recorded at step invocation) and now
- `input_tokens` / `output_tokens` / `cache_hits`: from Agent tool response metadata if
  available; otherwise `null`
- `cost_usd`: computed from token counts × model pricing if tokens available; otherwise `null`
- `status`, `gate_verdict`: from step output
- `fix_loop_iterations`: count of fix-loop cycles during this step (0 if no fix loop)
- `respawn`: true if this step was executed by a respawned agent

Write is best-effort: if the append fails, log to cycle state and continue. Never block
story execution on a metrics write.

**Acceptance criteria:**
- step-07 includes the metrics write sub-task with all field sourcing instructions
- Write is explicitly marked best-effort (failure = log + continue)
- Step start timestamp is captured at invocation, not at write time
- Null handling documented inline (not crash on missing token data)

**Complexity:** Medium  
**Agent:** developer  
**Depends on:** C1-a, C1-b

---

### Story C2-b: Step-07 post-story rollup write

**File:** `hive/workflows/steps/daily-ceremony/step-07-kick-off.md`

**What it does:** After all steps for a story complete (or the story is marked
interrupted/failed), adds a story rollup write to `.pHive/metrics/stories.jsonl`.
Aggregates from in-memory step records accumulated during the story's execution — no file
re-reading required (the team lead holds step results in working context).

Handles the interrupted case: if the story didn't complete, write a story record with
`status: interrupted`, partial aggregates for completed steps, and `steps_total` set to the
number of steps in the story spec (so incomplete ratio is computable).

**Acceptance criteria:**
- story rollup write added to step-07 at the "story complete" point
- Interrupted story write handled: `status: interrupted`, partial aggregates
- Rollup fields: sum of tokens/cost across steps, count of steps, fix_loop count, respawn_count
- story record written to `.pHive/metrics/stories.jsonl`

**Complexity:** Medium  
**Agent:** developer  
**Depends on:** C2-a

---

### Story C2-c: Step-08 session metrics write

**File:** `hive/workflows/steps/daily-ceremony/step-08-session-end.md`

**What it does:** Adds a session record write to `.pHive/metrics/sessions.jsonl` as the
final sub-task in step-08 (after insight promotion, before the session summary). Also
handles any story records that weren't written during step-07 (interrupted mid-story).

Session record fields:
- `session_start` / `session_end`: timestamps
- `session_wall_clock_s`: total session duration
- `stories_completed`: count of stories that reached `status: passed`
- `stories_interrupted`: count of stories with `status: interrupted`
- `human_escalations`: count of times the team lead escalated to user during this session
- `permission_prompts`: count of permission prompts (if trackable from cycle state)
- `epics_active`: list of epic IDs touched this session

**Acceptance criteria:**
- step-08 includes session record write as final sub-task before session summary
- `human_escalations` sourced from cycle state (team lead increments during step-07)
- Any stories not written during step-07 get `status: interrupted` story records written here
- Session record written to `.pHive/metrics/sessions.jsonl`

**Complexity:** Medium  
**Agent:** developer  
**Depends on:** C2-b

---

## Slice 3 — Hive Config Extension

**Goal:** Add the experiment and metrics configuration block to `hive.config.yaml`.
**Working state after:** Operators can configure promotion thresholds, regression blocks,
and baseline window size. The meta-team nightly cycle can read these values.

### Story C3-a: hive.config.yaml metrics block

**File:** `hive/hive.config.yaml`

**What it does:** Adds a `metrics:` subsection under the existing `meta_team:` block with
configurable thresholds:

```yaml
meta_team:
  # existing fields...
  metrics:
    promotion_threshold_pct: 5      # min % improvement delta to promote an experiment
    regression_block_pct: 10        # auto-revert if any tracked metric drops >10% vs baseline
    baseline_window_stories: 10     # number of recent stories used to compute baseline
    enabled: true                   # set false to disable metrics writes globally
```

Also adds a top-level `metrics:` block for global settings:
```yaml
metrics:
  storage_path: .pHive/metrics/     # explicit, matches hardcoded path until state-dir epic
  record_nulls: true                # write records even when token data unavailable (nulls)
  max_file_size_mb: 50              # rotate JSONL file if it exceeds this size (not yet implemented, documented for future)
```

**Acceptance criteria:**
- `hive.config.yaml` has `metrics:` block under `meta_team:` with the three threshold fields
- Top-level `metrics:` block added with `storage_path`, `record_nulls`, `enabled` fields
- All fields have inline comments explaining their purpose
- `storage_path` comment notes it's hardcoded until the state-dir resolver epic lands

**Complexity:** Low  
**Agent:** developer  
**Depends on:** C1-a

---

## Slice 4 — Experiment Protocol

**Goal:** Define the experiment lifecycle so the meta-team nightly cycle can run controlled
comparisons. This is the reference layer — not the execution skill (Epic B).
**Working state after:** The nightly cycle has a documented protocol to follow for any
experiment. The storage layout for experiment results is defined.

### Story C4-a: Experiment protocol reference

**File:** `hive/references/experiment-protocol.md`

**What it does:** Defines the full experiment lifecycle:

1. **Baseline capture** — read last N story records from `stories.jsonl` (N from config),
   compute aggregate stats, write to `.pHive/metrics/experiments/{exp-id}/baseline.jsonl`
2. **Hypothesis** — write `hypothesis.md` with: what change is being tested, which metric
   is expected to improve, by how much, and what the rollback trigger is
3. **Sandbox apply** — apply the change (skill/agent/workflow file edit) in working tree
4. **Measure** — run at least 3 stories using the changed artifact, collect new records
5. **Delta compare** — compute delta vs baseline for each tracked metric
6. **Verdict** — promote if delta ≥ `promotion_threshold_pct` on target metric AND no metric
   drops > `regression_block_pct`; otherwise discard
7. **Ledger entry** — append result to `.pHive/meta-team/ledger.yaml` with verdict + deltas

Includes the experiment directory structure:
```
.pHive/metrics/experiments/{exp-id}/
  hypothesis.md
  baseline.jsonl
  result.jsonl
  verdict.yaml
```

**Acceptance criteria:**
- `hive/references/experiment-protocol.md` exists with all 7 lifecycle phases
- Each phase has: inputs, outputs, agent responsible, failure behavior
- Experiment directory structure documented with example `verdict.yaml` schema
- Threshold fields reference `hive.config.yaml` values (not hardcoded)
- Rollback procedure documented: revert file change, append `verdict: discarded` to ledger

**Complexity:** Medium  
**Agent:** developer  
**Depends on:** C1-a, C1-b, C3-a

---

## Slice 5 — Meta-Team Cycle Integration

**Goal:** Update the existing nightly meta-team analysis step to read metrics in addition to
ledger/git history. This closes the loop: metrics are written by daily ceremony → consumed by
nightly meta-team cycle.
**Working state after:** The nightly cycle's analysis step reads recent metrics records and
surfaces metric-driven findings (e.g., "researcher agent has 3× more fix-loop iterations than
average — persona scope discipline may need tuning").

### Story C5-a: Update step-02-analysis.md to read metrics

**File:** `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`

**What it does:** Adds a "Read recent metrics" phase to the existing analysis step. The
researcher agent reads:
- Last 10 story records from `stories.jsonl`
- Last 3 session records from `sessions.jsonl`
- Current experiment records from `experiments/` (if any in-progress)

Then produces metric-driven findings in addition to the existing structural/persona findings.
Metric finding categories:
- **Cost spike**: any story > 2× average cost → investigate agent token usage
- **Quality gap**: any agent with fix_loop_iterations > 0 on > 30% of steps → persona gap
- **Speed regression**: story wall-clock > 2× 10-story average → timeout risk
- **Friction spike**: session human_escalations > 2 → permission or clarity issue

Findings format is unchanged (same `finding` schema as existing step-02). New findings just
have `category: METRICS_SIGNAL` instead of `PERSONA_GAP` or `CROSS_REF_BROKEN`.

**Acceptance criteria:**
- step-02-analysis.md includes a "Read recent metrics" phase
- Phase documents exactly which files to read and which aggregates to compute
- Four metric finding categories defined with thresholds
- Existing structural analysis behavior is unchanged (additive, not replacing)
- If `.pHive/metrics/` doesn't exist yet, step silently skips metrics phase and notes it
  in the analysis report

**Complexity:** Medium  
**Agent:** developer  
**Depends on:** C2-c, C4-a

---

## Story Dependency Graph

```
C1-a (schema) ──┬──► C1-b (storage) ──► C2-a (step hook) ──► C2-b (story rollup) ──► C2-c (session) ──► C5-a
                │                                                                                           ▲
                └──► C3-a (config) ──────────────────────────────► C4-a (experiment protocol) ─────────────┘
```

Stories at the same depth with no `depends_on` between them may run in parallel:
- **Parallel-safe pairs:** C1-a + C1-b (C1-b depends on C1-a only), C3-a and C2-a (after C1-a)
- **Must be sequential:** C2-a → C2-b → C2-c → C5-a

---

## Slice Merge Order

| Order | Slice | Stories | Gate |
|-------|-------|---------|------|
| 1 | Schema Foundation | C1-a, C1-b | PR: `metrics-schema` |
| 2 | Config Extension | C3-a | PR: `metrics-config` (can merge with Slice 1) |
| 3 | Instrumentation Hooks | C2-a, C2-b, C2-c | PR: `metrics-hooks` |
| 4 | Experiment Protocol | C4-a | PR: `experiment-protocol` |
| 5 | Meta-Team Integration | C5-a | PR: `metrics-meta-integration` |

Minimum viable ship: Slices 1 + 2 + 3. Metrics start accumulating. Slices 4 + 5 add the
experiment framework and nightly cycle integration — useful but not blocking.

---

## Open Questions for User Sign-Off

1. **Metric storage format:** JSONL confirmed? Or embed enriched fields into existing episode
   marker YAMLs? (JSONL recommended — separate concerns, no breaking change to episode markers.)

2. **Token sourcing:** If the Claude Code SDK doesn't expose per-Agent token counts in tool
   responses, should we (a) omit token/cost fields entirely, (b) add a manual token estimation
   step, or (c) accept nulls and note the gap? (Recommendation: accept nulls.)

3. **Session human_escalations field:** Requires the team lead to explicitly increment a counter
   in cycle state each time it escalates to the user. Is this instrumentation burden acceptable,
   or should human_escalations be omitted from v1?

4. **Experiment runner scope:** C4-a defines the protocol document. The actual experiment
   execution logic is in the `meta-meta-optimize` skill (Epic B). Confirm this split — we are
   NOT building the experiment runner in Epic C.

5. **Story count for Epic C:** The plan above has 7 stories (C1-a, C1-b, C2-a, C2-b, C2-c,
   C3-a, C4-a, C5-a). Complexity breakdown: 3 Low + 5 Medium. Estimated at 1–2 sessions.
   Does this scope feel right, or should any slice be deferred?
