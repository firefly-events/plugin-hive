> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 02c: KG Signal

## Purpose

Add a third proposal-source feed in parallel with the internal audit (step-02) and external research (step-02b): query the L2 Knowledge Graph (`~/.claude/hive/kg.sqlite`) for failure, blocker, and supersession triples and emit findings consumable by step-03 with `discovery_source: kg_signal`. This step is additive only — it does not replace step-02 findings, does not suppress step-02b candidates, and does not alter the existing proposal ranking or fallback behavior.

## When this step runs

This step runs after step-02-analysis and in parallel with step-02b-external-research. It is OPTIONAL — it is wired via the `/meta-optimize` SKILL routing (`skills/hive/skills/meta-optimize/SKILL.md`). The step is also self-skipping when its inputs are absent (see Task Sequence §2 "Verify KG availability" and the FAILURE MODES section).

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Treat this step as additive signal-mining only — do not replace, reinterpret, or suppress step-02 findings or step-02b candidates
- Output is shaped as **analysis findings** (the step-02 shape), NOT as proposal candidates (the step-02b shape). Step-03 merges this feed into its eligible-findings pool, then ranks proposals from the combined pool
- Tag every emitted finding with `discovery_source: kg_signal`
- Use `entity:` (NOT `subject:`) when calling `query_decisions()` — this is the canonical filter field on `DecisionFilter` per `hive/references/memory-store-interface.md`. The SQL implementation matches `entity` against both `subject` and `object` columns
- Apply the recency window CLIENT-SIDE, after the query returns. `DecisionFilter` has no recency parameter; `as_of=now` means "currently valid at this instant," not "recently created"
- Do NOT write to `kg.sqlite` in this step — read-only access only
- Do NOT block step-03 if KG inputs are absent — emit an empty findings list and continue

## EXECUTION PROTOCOLS

**Mode:** autonomous

Run a bounded read against the KG triples table, apply the three-layer relevance filter, and emit a findings list that step-03 consumes alongside step-02 findings and step-02b external candidates.

Use the query helper for miss-reason discrimination so empty-cycle telemetry is
based on query-time state rather than guessed after the output file is already
empty:

```bash
python3 -m hive.lib.kg_signal.miss_reason --json
```

The helper returns `miss_reason: null` when KG findings should surface. When
the emitted `kg_findings` list is empty, carry the returned non-null value into
the output payload and summary line.

## CONTEXT BOUNDARIES

**Inputs available:**
- `cycle_id` from step 1
- `findings` from step 2 for context on current internal gaps (used only to avoid duplicating exact-match findings; see Task Sequence step 4)
- `~/.claude/hive/kg.sqlite` — read-only access via `MemoryStore.query_decisions(filter)` (see `hive/references/memory-store-interface.md` and `hive/references/knowledge-graph-schema.md`)
- `<HIVE_STATE_DIR>/epics/` — used to enumerate target-project epic IDs for the `local_signal` vs `cross_project_signal` tagging gate
- `hive.config.yaml` → `meta_optimize.kg_signal.window_days` — recency window override (default 30)
- `<HIVE_STATE_DIR>/meta-team/charter.md` — scope boundaries (read for awareness; this step does not enforce charter — step-03 does)

**NOT available:**
- User input
- Authority to alter the controlled predicate vocabulary
- Authority to write to `kg.sqlite` (this step is read-only)
- Authority to suppress, downgrade, or rewrite findings from step-02 or candidates from step-02b

## YOUR TASK

Mine the L2 Knowledge Graph for failure / blocker / superseded triples, apply the three-layer relevance filter, and produce a findings list shaped for direct merge into step-03's eligible-findings pool.

## TASK SEQUENCE

### 1. Resolve configuration

- Read `hive.config.yaml` → `meta_optimize.kg_signal.window_days`. If unset, use the default `30`.
- Compute `recency_cutoff = now - window_days`. Both `now` and `recency_cutoff` are ISO 8601 timestamps in UTC.
- Read the target-project epic IDs by listing directories under `<HIVE_STATE_DIR>/epics/` (each subdirectory name is an epic ID). This is the `local_epics` set used in the project-tagging gate.

### 2. Verify KG availability

Check whether the KG is reachable BEFORE issuing queries:

- If `~/.claude/hive/kg.sqlite` does not exist on disk: log `kg_signal: kg.sqlite absent — skipping`, jump to step 7 and emit an empty findings list.
- If the file exists but `MemoryStore.query_decisions()` raises an availability error (locked, permission denied, schema missing): log the error, jump to step 7, and emit an empty findings list. Do NOT fail the step — graceful degradation is required.

### 3. Query the KG

Issue `MemoryStore.query_decisions()` calls covering the eight predicates `phase_failed`, `phase_blocked`, `superseded`, `phase_started`, `phase_complete`, `validated`, `tested`, and `implemented`. Conceptually this is **four logical groupings** (failures = `phase_failed` + `phase_blocked`; supersessions = `superseded`; lifecycle = `phase_started` + `phase_complete`; role verdicts = `validated` + `tested` + `implemented`); concretely it is **eight single-predicate calls** because the underlying `DecisionFilter` interface accepts at most one `predicate` per call. Both framings are acceptable as long as the eight predicates are covered. All calls use `as_of=now` so only currently-valid triples are returned (the SQL applies `valid_until IS NULL` for current-state queries).

```
failures   = query_decisions({ predicate: "phase_failed",   as_of: now })
            ∪ query_decisions({ predicate: "phase_blocked", as_of: now })
supersessions = query_decisions({ predicate: "superseded",   as_of: now })
lifecycle  = query_decisions({ predicate: "phase_started",  as_of: now })
            ∪ query_decisions({ predicate: "phase_complete", as_of: now })
role_verdicts = query_decisions({ predicate: "validated",   as_of: now })
            ∪ query_decisions({ predicate: "tested",        as_of: now })
            ∪ query_decisions({ predicate: "implemented",   as_of: now })
```

> CANONICAL FIELD NAME: pass `entity` and `predicate` keys on the filter object. Do NOT use `subject` — `subject` was deprecated in 1.1.3 because it implied a column-only match; the canonical `entity` field matches against BOTH the `subject` and `object` columns. See `hive/references/memory-store-interface.md` §`query_decisions` and the design decision recorded in this story.

If all groupings return empty: jump to step 7, emit an empty findings list, and log `kg_signal: no eligible triples — skipping`.

For any finding that will be tagged `cross_project_signal`, derive `<name>` from the source project's registry name (`projects[].name` in `~/.claude/hive/projects.yaml`, per the register-project row shape) and prepend `[cross-project: <name>]` to the finding `description` before any later rank or proposal handling. The rank multiplier in step 5 MUST NOT rewrite or strip this literal prefix.

### 4. Apply the three-layer relevance filter

For each returned triple, apply the layers in order. A triple that fails any layer is discarded.

#### Layer 1: predicate filter

The query already restricts to `phase_failed`, `phase_blocked`, `superseded`, `phase_started`, `phase_complete`, `validated`, `tested`, and `implemented`. Verify each returned triple's `predicate` is in this set; drop any stray triples (defensive — should be a no-op if the query was correctly scoped).

#### Layer 2: recency window (client-side)

For each triple, parse `valid_from` as an ISO 8601 timestamp.

- If `valid_from < recency_cutoff`: discard (older than the configured window).
- Else: retain.

This filter MUST be applied client-side after the query returns. `DecisionFilter` has no recency parameter; do not attempt to push the window into the filter object. `as_of=now` is a point-in-time validity gate, not a recency gate — they are different axes.

#### Layer 3: project tagging with rank penalty

For each retained triple, inspect `source_epic`:

- If `source_epic` is in `local_epics` (computed in step 1): tag the resulting finding `local_signal`. No rank adjustment.
- Else: tag the resulting finding `cross_project_signal`. Apply a `0.7×` multiplier to the finding's rank score (see step 5 for rank computation).
- If `source_epic` is null or empty: treat as `cross_project_signal` (best-effort — unknown provenance leans conservative).

Both tags surface; the cross-project rank penalty preserves the cross-project signal while preventing it from overwhelming local findings. The `0.7×` factor is an empirically-arbitrary starting point and is tunable later via meta-meta-optimize once shipped.

### 5. Cluster and score

Group the retained triples by `(predicate, source_epic)`. Each group becomes one candidate finding.

- `cluster_size` = number of triples in the group.
- `base_rank` = `cluster_size`. Rationale: more triples in the same `(predicate, source_epic)` cell indicates a stronger pattern signal.
- `final_rank` = `base_rank × project_tag_multiplier`, where the multiplier is `1.0` for `local_signal` and `0.7` for `cross_project_signal`.

Sort findings by `final_rank` descending.

### 6. Shape findings for step-03 merge

Each emitted finding uses the **step-02 analysis-findings shape** (per `step-02-analysis.md` Task Sequence §7), with two added fields: `discovery_source` and `tag`. Step-03 already accepts the shape as part of its eligible-findings pool (see `step-03-proposal.md` Task Sequence §1 and §2b — the merge logic recognizes `discovery_source` as the authoritative feed identifier).

```yaml
id: kg-finding-{N}
category: KG_FAILURE_CLUSTER | KG_BLOCKER_CLUSTER | KG_SUPERSESSION
severity: critical | high | medium | low
location: {source_epic value}        # the epic that produced these triples
description: {one-line description e.g. "3 phase_failed triples in epic memory-redesign within 30d window"}
evidence:
  predicate: {phase_failed | phase_blocked | superseded | phase_started | phase_complete | validated | tested | implemented}
  source_epic: {string}
  cluster_size: {N}
  representative_triples:              # up to 3 example triples for traceability
    - subject: {string}
      object: {string}
      valid_from: {iso8601}
      source_agent: {string|null}
discovery_source: kg_signal
tag: local_signal | cross_project_signal
rank_score: {final_rank from step 5}
```

When `tag: cross_project_signal`, `description` MUST start with `[cross-project: <name>]`, where `<name>` is the source project's registry name (`projects[].name`) from the project registry shape. Preserve the rest of the description as a one-line human-readable summary.

```yaml
# Cross-project finding example
description: "[cross-project: shindig] 3 phase_failed triples in epic create-event-enhancements within 30d window"
tag: cross_project_signal
evidence:
  predicate: phase_failed
  source_epic: shindig/create-event-enhancements
  cluster_size: 3
```

> ID NAMESPACE: use `kg-finding-{N}` to keep the kg_signal feed grep-separable from step-02's `finding-{N}` and step-02b's `external-proposal-{N}`. Step-03 consumers MUST accept `kg-finding-` alongside `finding-` and `external-proposal-`; the `discovery_source` field is the authoritative routing key.
>
> SEVERITY MAPPING: default to `medium` for clusters of 1–2 triples, `high` for 3–4 triples, `critical` for 5+ triples. `superseded` clusters of 1 trip to `low` (single supersessions are routine, not failures). The proposal step may re-rank.

#### De-duplication against step-02 findings

If a kg-finding's `(source_epic, predicate)` exactly matches the `location` and category of an existing step-02 finding, append the kg-finding's `evidence.representative_triples` to the existing finding's evidence rather than emitting a duplicate. Record this as a `merged_with: finding-{N}` field on the consumed kg-finding entry in the summary (step 8). Do NOT silently drop kg-evidence — preserve it as appended evidence. This mirrors the step-02b internal-vs-external dedup pattern.

### 7. Write `kg-findings.yaml`

Emit the findings list to a workflow output named `kg_findings`. The artifact written to disk is `<HIVE_STATE_DIR>/meta-team/kg-findings.yaml` for the current cycle, OR appended into `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` under a `kg_findings` key — match whichever persistence pattern step-02b uses for `external_research_candidates` so step-03 reads both feeds via the same convention.

```yaml
phase: kg-signal
kg_findings:
  - {finding objects shaped per step 6}
```

**Empty case:** when the list is empty (kg.sqlite absent, queries empty, or all triples filtered out), still emit the key with an explicit empty list:

```yaml
phase: kg-signal
kg_findings: []
miss_reason: empty_kg | empty_predicate_filter | recency_cutoff | project_tag_cutoff
```

The empty-list guarantee is how this step remains additive-only rather than a blocker on step-03. Downstream consumers MUST treat an empty list identically to a missing one (additive = additive + ∅).

Omit `miss_reason` when `kg_findings` is non-empty.

### 8. Produce kg-signal summary

As each finding is appended to `kg_findings`, increment the findings counter
once for that emitted finding:

```bash
python3 -m hive.lib.metric_increment_cli \
  --counter kg_signal_findings_total \
  --label cycle_id="{cycle_id}" \
  --by 1
```

```
## KG Signal Summary — Cycle {cycle_id}

KG availability:    available | absent | error
Recency window:     {window_days} days (cutoff: {recency_cutoff})
Triples retrieved:  {N} (failures: {N}, supersessions: {N}, lifecycle: {N}, role verdicts: {N})
After recency filter: {N}
Findings emitted:   {N}
  Local signal:       {N}
  Cross-project:      {N} (rank penalty 0.7× applied)
  Merged with step-02: {N}

Top findings (by rank):
  [{rank_score}] kg-finding-{N}: {description}  (tag={tag})
```

Also emit one compact machine-grepable line:

```
[meta-optimize] kg-signal: findings={N} miss_reason={bucket}
```

Include `miss_reason=...` only when `findings=0`.

## Non-scope

This step does NOT:
- Modify `kg.sqlite` (read-only)
- Replace or reinterpret step-02 findings or step-02b candidates
- Introduce a new fallback tier or change the existing fallback loop (the AND-of-empty routing rule across `findings`, `external_research_candidates`, and `kg_findings` belongs to step-03b — see `step-03b-backlog-fallback.md`)
- Suppress or skip internal-audit findings because KG signal produced alternatives
- Promote or rank proposals — step-03 owns ranking

## Output

Hand step-03 a list of KG-derived findings in the analysis-findings schema shape with `discovery_source: kg_signal`. These findings are additional inputs to step-03's eligible-findings pool, not a separate approval track.

Expected handoff:

```yaml
kg_findings:
  - {finding object with step-02 fields, discovery_source: kg_signal, tag, rank_score}
kg_signal_summary: {string summary of availability, counts, and notable clusters}
```

## SUCCESS METRICS

- [ ] KG availability check executed and outcome logged before any query
- [ ] Four query groupings issued (failures: phase_failed + phase_blocked; supersessions: superseded; lifecycle: phase_started + phase_complete; role verdicts: validated + tested + implemented), each with `as_of=now` and `entity:` field semantics if entity filtering is later added (currently no entity scope is required — predicate-only)
- [ ] Recency window applied client-side using `valid_from >= recency_cutoff` (inclusive boundary, matching the §4 Layer 2 rule and the fixture's `valid_from >= cutoff` comparator)
- [ ] Each retained triple tagged `local_signal` or `cross_project_signal` based on the `local_epics` set
- [ ] Cross-project findings carry a `rank_score` multiplied by `0.7`
- [ ] Output is shaped for direct consumption by step-03's eligible-findings merge — schema parity verified against `step-02-analysis.md` §7
- [ ] Empty cases (kg.sqlite absent, queries empty, all-filtered) emit `kg_findings: []` rather than failing
- [ ] Empty cases include exactly one query-time `miss_reason`; non-empty cases omit the field
- [ ] `discovery_source: kg_signal` set on every emitted finding

## FAILURE MODES

**Guaranteed output contract:** this step ALWAYS emits a `kg_findings` list as its output, including an explicit empty list `[]` when no findings qualify. Step-03's merge logic and step-03b's AND-of-empty routing rule both rely on the empty-list guarantee.

- `kg.sqlite` absent: log + emit empty list. Do NOT fail.
- `kg.sqlite` present but locked or permission-denied: log the error, emit empty list. Do NOT fail. (WAL mode normally avoids reader/writer contention; this branch covers genuinely broken filesystems.)
- All query groupings return zero triples: emit empty list, summary notes `Triples retrieved: 0`.
- All retrieved triples filtered out by recency or predicate gate: emit empty list, summary notes `After recency filter: 0`.
- Schema validation failure when shaping a finding: skip that finding with a warning, do NOT fail the whole step. Finalize the remaining findings.
- Configuration error (`window_days` non-numeric or negative): fall back to the default `30` and log a warning.

## NEXT STEP

**Gating:** `kg_findings` list produced (possibly empty), and the kg-signal summary recorded.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
**If gating fails:** Report which check or query could not run and why; emit `kg_findings: []` so downstream routing is unaffected.
