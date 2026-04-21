---
title: Horizontal Plan — Meta-Improvement System (Epic C)
type: horizontal-plan
epic: meta-improvement-system
phase: epic-c-metrics-instrumentation
status: draft
created: 2026-04-19
---

# Horizontal Plan: Meta-Improvement System — Epic C (Metrics Instrumentation)

## What We're Building

A metrics data layer that instruments every story execution with objective measurements (cost,
quality, speed, friction, knowledge reuse), stores them in append-only JSONL files under
`.pHive/metrics/`, and exposes a simple query surface for the meta-team nightly cycle to consume.
This is the foundational layer. Without it, no meta swarm has anything to optimize.

Epics A and B depend on this layer being in place before they can produce meaningful baselines.

---

## Layer 1: Metrics Storage

**What it is:** The durable record format and storage convention. Append-only JSONL files per
metric category under `.pHive/metrics/`. No database — file-based so it survives context resets
and can be read by any agent or shell script.

**Files involved:**
- `.pHive/metrics/episodes.jsonl` — one record per story step execution
- `.pHive/metrics/stories.jsonl` — one record per completed story (rolled up from steps)
- `.pHive/metrics/epics.jsonl` — one record per closed epic (rolled up from stories)
- `.pHive/metrics/sessions.jsonl` — one record per session (session wall-clock, human escalations)
- `hive/references/metrics-schema.md` — canonical field definitions and format contract

**Episode step record schema** (what gets written after each workflow step):
```jsonl
{
  "ts": "2026-04-19T03:12:45Z",
  "epic_id": "meta-improvement-system",
  "story_id": "C1-episode-schema",
  "step_id": "implement",
  "agent": "developer",
  "model": "sonnet",
  "status": "passed",
  "wall_clock_s": 142,
  "input_tokens": 18400,
  "output_tokens": 3200,
  "cache_hits": 11200,
  "cost_usd": 0.0041,
  "fix_loop_iterations": 0,
  "gate_verdict": "passed",
  "respawn": false
}
```

**Story record schema** (written at story close):
```jsonl
{
  "ts": "2026-04-19T03:18:00Z",
  "epic_id": "meta-improvement-system",
  "story_id": "C1-episode-schema",
  "methodology": "classic",
  "total_wall_clock_s": 510,
  "total_cost_usd": 0.0189,
  "total_input_tokens": 72000,
  "total_output_tokens": 14000,
  "total_cache_hits": 41000,
  "steps_total": 4,
  "steps_passed_first_attempt": 4,
  "fix_loop_iterations": 0,
  "respawn_count": 0,
  "review_verdict": "passed",
  "coderabbit_fixes": 0,
  "human_escalations": 0,
  "permission_prompts": 0
}
```

**Key constraint:** JSONL append-only. Writers never read-modify-write — they append a new line.
Readers (meta-team analysis, query skill) handle deduplication if a record gets written twice.

**Existing state:** `.pHive/metrics/` does not exist. The episode marker format
(`.pHive/episodes/{epic}/{story}/{step}.yaml`) exists but has no metric fields. This layer adds
the parallel metrics write — it does NOT modify episode markers (those are status markers, not
metrics). Two separate writes per step: status marker → episode YAML, metrics record → JSONL.

---

## Layer 2: Instrumentation Hooks

**What it is:** The write points — where and how metric records get written during story
execution. Three hook points are needed:

### Hook Point A: Post-step (step-07 kick-off)
After each workflow step completes, the orchestrating team lead writes a step record to
`episodes.jsonl`. Token counts come from the Claude API response headers (or estimated from
context window state if unavailable). Wall-clock from step start/end timestamps.

**Where to instrument:** `hive/workflows/steps/daily-ceremony/step-07-kick-off.md` — add a
"Write metrics record" sub-task after the existing "Write episode markers" sub-task (step 3c).

### Hook Point B: Post-story (step-07, story close)
After all steps for a story complete, roll up step records into a story record. This is a
pure aggregation — sum tokens/cost, count steps, check fix_loop_iterations.

**Where to instrument:** Same file (step-07), after story completion before moving to next story.

### Hook Point C: Session end (step-08)
Write the session record: total session wall-clock, human_escalations count (tracked in
cycle state during step-07), permission_prompts (from hook data if available). Also write
any pending story records that weren't closed during step-07 (e.g., interrupted stories).

**Where to instrument:** `hive/workflows/steps/daily-ceremony/step-08-session-end.md` — add
a "Write session metrics record" sub-task after the existing insight promotion tasks.

### Token sourcing
Token counts are the hardest field to source. Three options in preference order:
1. **API response metadata** — Claude Code exposes token usage in tool results; team lead
   reads from the Agent tool response if the SDK surfaces it.
2. **Context window inference** — estimate from the agent's known model context size minus
   remaining context (rough, ±20%).
3. **Omit with null** — record `input_tokens: null` rather than guess. The metrics layer
   accepts nulls — partial records are better than fabricated ones.

**Key constraint:** Instrumentation must not block story execution. Metrics writes are
best-effort fire-and-forget appends. If the write fails, log to cycle state and continue.

---

## Layer 3: Meta Skills

**What it is:** The two new skills that consume metrics and drive the auto-improvement loops.

### Skill: `meta-meta-optimize`
**Target:** The plugin itself (skills, agents, workflows under `plugin-hive/`).
**Trigger:** Nightly meta-team cycle (step-02-analysis already reads ledger and findings;
this skill replaces/extends that step to also read metrics).
**Loop:** Read metrics baseline → identify worst-performing dimension → hypothesize improvement
→ implement in sandbox → measure delta → promote if better, discard if not → write to ledger.
**Location:** `skills/meta-meta-optimize/SKILL.md`

### Skill: `meta-optimize`
**Target:** User's project code (performance, quality, test coverage).
**Trigger:** Explicitly invoked by user (`/hive:meta-optimize`) or scheduled.
**Loop:** Same Karpathy loop but scoped to user's project metrics (project-defined, not harness-defined).
**Location:** `skills/meta-optimize/SKILL.md`

**Key constraint:** Both skills are Epic B scope. Epic C only defines the data contract these
skills will consume. We do NOT implement the skills in Epic C.

---

## Layer 4: Experiment Runner

**What it is:** The scaffolding that lets the meta swarm run controlled experiments — apply a
change, measure, compare against baseline, decide keep/discard.

**Components:**
- `hive/references/experiment-protocol.md` — defines the experiment lifecycle: baseline capture
  → hypothesis → sandbox apply → measure → delta compare → verdict → ledger entry
- `.pHive/metrics/experiments/` — per-experiment directories with: `hypothesis.md`,
  `baseline.jsonl`, `result.jsonl`, `verdict.yaml`
- `hive/references/metrics-query.md` — simple query patterns agents can use to compute
  aggregates from JSONL files (bash one-liners, python snippets)

**Baseline capture:** A baseline snapshot is a metrics query result frozen at a point in time.
Stored as JSONL in `.pHive/metrics/experiments/{exp-id}/baseline.jsonl`. The experiment runner
reads a window of recent story/epic records (e.g., last 10 stories) to establish the baseline.

**Promotion threshold:** Configurable in `hive.config.yaml` under `meta_team:` block:
```yaml
meta_team:
  metrics:
    promotion_threshold_pct: 5      # min improvement delta to promote
    regression_block_pct: 10        # auto-revert if any metric drops >10%
    baseline_window_stories: 10     # how many recent stories form the baseline
```

**Key constraint:** Experiment runner is a reference + config addition in Epic C. The actual
runner logic lives in the `meta-meta-optimize` skill (Epic B). Epic C provides the protocol,
storage layout, and config schema — not the execution logic.

---

## Cross-Cutting Concerns

### Token count sourcing gap
Current episode markers capture no token data. The Claude Code SDK may not expose per-agent
token counts in TeamCreate responses. This is the highest-risk unknown. Mitigation: design the
schema to accept nulls; document the sourcing approach in `metrics-schema.md`; add a TODO in
the metrics hook to revisit once SDK behavior is confirmed empirically.

### `paths.state_dir` is explicitly deferred
All metric paths use `.pHive/` directly. The `paths.state_dir` resolver epic is tracked
separately and explicitly excluded from this work. Do NOT add path resolver calls here.

### Metrics write performance
JSONL appends are fast. No locking needed for single-agent writes. If parallel team execution
(parallel_teams: true) produces concurrent writes, the append is still safe because the OS
guarantees atomic line-level writes for small appends (<4KB). No coordination needed.

### Backward compatibility
Existing episode markers (`.pHive/episodes/`) are untouched. Metrics JSONL is additive.
Old epics without metrics records are simply absent from metric queries — the query layer
must handle missing data gracefully (return null, not crash).

---

## Dependencies (layer order = merge order)

```
Layer 1: metrics-schema.md + storage layout (no code deps)
  ↓
Layer 2: instrumentation hooks in step-07 + step-08 (depends on schema)
  ↓
Layer 3: meta skill skeletons / data contracts (depends on schema; full impl in Epic B)
  ↓
Layer 4: experiment protocol + config additions (depends on schema + storage layout)
```

Stories within a layer may be developed in parallel if they touch different files.

---

## Architect Stress-Test Notes

**Risk 1 (High): Token sourcing**
The schema assumes `input_tokens`, `output_tokens`, `cache_hits` are available per agent step.
If the Claude Code SDK doesn't expose per-TeamCreate token counts, these fields will be null
for all records, making cost/efficiency metrics blind. Mitigation in schema design: nullable
fields with explicit `sourcing_note` field documenting how the value was obtained.

**Risk 2 (Medium): Rollup timing**
Story rollups require all step records to be present before aggregation. If a session is
interrupted mid-story, the story record is never written. The session-end hook (Hook Point C)
must handle incomplete stories: write a `status: interrupted` story record with whatever
steps completed. The experiment runner must filter these out of baseline calculations.

**Risk 3 (Medium): Meta-team cycle integration**
The existing `step-02-analysis.md` in the nightly cycle reads ledger.yaml and git history for
findings. Adding metrics reading requires modifying this step file. This is in scope for Epic C
(the instrumentation layer must be readable by the meta-team). But the step file change must
not break the existing nightly cycle behavior.

**Risk 4 (Low): Schema drift**
As we add metrics dimensions, the JSONL schema will evolve. Since records are append-only, old
records won't have new fields — readers must tolerate missing keys. Document this in
`metrics-schema.md` with an explicit versioning note and a `schema_version` field in every record.

---

## Out of Scope (Epic C)

- Implementing `meta-optimize` or `meta-meta-optimize` skills (Epic B)
- Auditing or repairing the existing meta-team nightly cycle paths (Epic A)
- Wiring `paths.state_dir` end-to-end (separate epic, explicitly deferred)
- Dashboard or visualization for metrics (future work)
- External metric export (PostHog, etc.) — noted in brief but not scoped
