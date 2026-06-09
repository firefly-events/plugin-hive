> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 2: Analysis

## OUTPUT FORMAT (executor contract)

Step output is a JSON object that downstream `when:` predicates bind to
by explicit field name. The DAG executor fail-closes (downstream skips
with a `predicate_evaluated` warning event) when any required field is
missing — see `hive/references/predicate-grammar.md`.

```yaml
output_format:
  metric_signal: bool                    # perf-baseline-only flag (orthogonal to findings)
  findings_count: int                    # number of structural findings emitted in this cycle
  external_candidates_count: int         # number of step-02b external_research_candidates available at routing time
  findings: list                         # full structural findings (id, category, severity, location, ...)
  external_research_candidates: list     # candidate proposals from step-02b (may be empty)
```

Routing between step-03 and step-03b is an **AND-of-empty** rule across
the three signals — `metric_signal` is NOT a proxy for "are there
findings". The canonical predicates (left-associative, no parentheses
per strict-Archon grammar) are:

- step-03 runs when ANY signal is non-empty:
  `$analysis.output.findings_count > 0 || $analysis.output.external_candidates_count > 0 || $analysis.output.metric_signal == true`
- step-03b runs ONLY when ALL three are empty:
  `$analysis.output.findings_count == 0 && $analysis.output.external_candidates_count == 0 && $analysis.output.metric_signal == false`

Predicates bind to the explicit `_count` fields rather than to list
lengths because the strict-Archon grammar does not support `len(...)`.
Cycles that produce findings but no perf delta route to step-03 — the
meta-2026-04-29 regression scenario covered by
`tests/meta_meta/test_routing_findings.py`.

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- ONLY read — no writing to the target-project codebase in this step
- Run all checks in the prescribed order — skipping checks leads to missed findings
- Do NOT propose solutions in this step — only identify and document problems
- Respect charter scope: only flag issues in domains the meta-team is allowed to change

## EXECUTION PROTOCOLS

**Mode:** autonomous

Systematic scan of the target-project codebase (`$HIVE_TARGET_PROJECT`). Produce a findings report. Do not fix anything.

## CONTEXT BOUNDARIES

**Inputs available:**
- `cycle_id` from step 1
- The full target-project codebase at `$HIVE_TARGET_PROJECT` (resolved from paths.target_project via `hooks/common.sh`, cwd fallback when unset). For plugin-hive maintainers, HIVE_TARGET_PROJECT resolves to the plugin-hive root — analysis then scans the same `hive/` and `skills/` trees as before.
- `<HIVE_STATE_DIR>/meta-team/charter.md` — scope boundaries
- `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` — for writing findings to disk

**Target resolution fallback:** If `paths.target_project` is unset in `hive.config.yaml`, the analyzer falls back to the invoking cwd (the directory where the cycle was started). This preserves maintainer behavior for plugin-hive: running the cycle from the plugin-hive root with no config override resolves to the plugin-hive codebase, making the generalized step functionally identical to the prior hardcoded form.

**NOT available:**
- User input
- Prior cycle findings (for independence — re-analyze the codebase fresh each cycle)

> **Independence vs. in-flight dedup — read carefully.** "Re-analyze fresh"
> means do not let a *prior cycle's conclusions* bias this cycle's read of the
> codebase. It does **NOT** mean ignore work already proposed and waiting for
> human review. Open PRs that propose a fix are *in-flight* — the maintainer
> simply has not merged them yet. Re-finding and re-proposing the same fix every
> cycle (the meta-2026-05-30..06-05 duplicate-PR incident: 7 nightly PRs all
> re-derived the identical `claude-opus-4-7 -> claude-opus-4-8` bump because none
> had merged) is wasted work, not independence. Step 0 below consults open PRs to
> suppress already-proposed findings.

## YOUR TASK

Systematically audit the target-project codebase (`$HIVE_TARGET_PROJECT`, resolved per hooks/common.sh) and produce a ranked findings list with severity and category for each issue.

## TASK SEQUENCE

### 0. In-flight proposal pre-flight (dedup gate) — RUN FIRST

Before auditing the codebase, build the set of fixes that are **already
proposed and awaiting review** so this cycle does not re-derive them.

1. Enumerate open PRs authored by prior meta cycles (and any other open PRs
   touching the maintainer-owned trees):
   ```bash
   gh pr list --state open --base develop --limit 100 \
     --json number,title,headRefName,files \
     --jq '.[] | {number, title, head: .headRefName, files: [.files[].path]}'
   # also catch any still-mistargeted-at-main nightlies:
   gh pr list --state open --base main --limit 100 \
     --json number,title,headRefName,files \
     --jq '.[] | select(.headRefName|test("meta-meta/|meta/")) | {number, title, files: [.files[].path]}'
   ```
2. For each open PR, collect its changed file paths and (for small diffs)
   the proposed change. Treat this as the **in-flight proposal set**.
3. Hold this set in working memory for Step 7's dedup filter.

**Independence is preserved:** you still scan the codebase fresh. Step 0 only
governs which findings survive into the proposal — it never seeds findings.

If `gh` is unavailable or returns an error, log a `PREFLIGHT_DEGRADED` note,
proceed without suppression, and surface it in the analysis report (so a
duplicate slipping through is visible rather than silent).

### 1. Cross-reference audit — dangling references
For each reference doc listed in the target project's top-level documentation manifest (e.g., plugin-hive's `hive/GUIDE.md` and `hive/MAIN.md`; adapt to the target project's equivalent structure if different):
- Check that the referenced file actually exists at the stated path
- Record any files listed but missing as `MISSING_FILE` findings

Also check: if the target project has workflow YAML files (plugin-hive does under `hive/workflows/`; other projects may not), check that all `step_file` paths actually exist.

### 2. Schema consistency audit
Compare field usage across instances of the same schema type:
- Read 3+ agent persona files and check frontmatter field consistency
- Read 2+ team config files (if they exist) and check schema compliance
- Read workflow YAML files and confirm steps follow `workflow-schema.md`

Record any missing required fields or undocumented fields as `SCHEMA_INCONSISTENCY` findings.

### 3. Step file completeness audit
If the target project has step files under a workflows/steps/ tree (plugin-hive uses `hive/workflows/steps/`), for each step file verify it contains all 7 required sections per `step-file-schema.md`:
- Verify each step file contains all 7 required sections:
  1. Title (`# Step N: Name`)
  2. MANDATORY EXECUTION RULES
  3. EXECUTION PROTOCOLS
  4. CONTEXT BOUNDARIES
  5. YOUR TASK / TASK SEQUENCE
  6. SUCCESS METRICS
  7. FAILURE MODES and NEXT STEP
- Record incomplete step files as `INCOMPLETE_STEP_FILE` findings

### 4. Agent memory starter set audit
If the target project has an agent roster document (plugin-hive lists agents in `hive/GUIDE.md`), inspect each listed agent:
- Check whether the target project's agent-memory location for that agent (plugin-hive uses `skills/hive/agents/memories/{agent}/`) contains any `.md` files beyond `.gitkeep`
- Agents with zero memories: record as `MEMORY_GAP` finding (low severity — expected for new agents)
- Agents with memories: check frontmatter completeness (required: name, description, type)

### 5. Reference documentation audit
If the target project has a shared references directory (plugin-hive uses `hive/references/`), for each doc in that directory:
- Read the first 20 lines to confirm it has a title, clear purpose statement, and usable content
- Flag docs that are stubs (< 30 lines of content) as `STUB_DOC` findings

### 6. Workflow completeness audit
If the target project has workflow YAML files (plugin-hive uses `hive/workflows/`), read each workflow YAML:
- Confirm `name`, `version`, `steps` fields present
- Confirm each step has either `task` or `step_file`
- Flag missing step files as `MISSING_STEP_FILE` findings

### 6b. CodeRabbit recurring-comment audit

CodeRabbit posts inline review comments on every PR; titles that recur across multiple recent PRs are a real signal — either the codebase has a recurring convention issue, or reviewers are repeating the same advice because the author did not internalize it last time. Either way, the meta-team can address the root cause.

Implementation module: `hive/workflows/steps/meta-team-cycle/coderabbit-finder.mjs`. The helper is pure-function over already-fetched data — gather the PR comment list first, then pass it in.

Gather data (skip cleanly if `gh` is unavailable — log `PREFLIGHT_DEGRADED` per Step 0 and continue with zero findings from this audit):

```bash
# Window: last 14 days. Adjust via meta_optimize.coderabbit_finder.window_days in
# hive.config.yaml when present; default 14.
since=$(date -u -v-14d '+%Y-%m-%d' 2>/dev/null || date -u -d '14 days ago' '+%Y-%m-%d')
gh pr list --state merged --search "merged:>=${since}" \
  --limit 100 \
  --json number,title,mergedAt \
  --jq '.[] | .number' \
  > /tmp/recent_prs.txt

for n in $(cat /tmp/recent_prs.txt); do
  gh api "repos/${OWNER}/${REPO}/pulls/${n}/comments" \
    --jq "[.[] | {user: {login: .user.login}, body: .body, id: .id}]" \
    > "/tmp/cr_${n}.json"
done
```

Then invoke the helper:

```js
import { findRecurringCoderabbitComments } from 'hive/workflows/steps/meta-team-cycle/coderabbit-finder.mjs';

const pullRequests = recentPrNumbers.map((n) => ({
  number: n,
  comments: JSON.parse(readFileSync(`/tmp/cr_${n}.json`, 'utf8')),
}));
const crFindings = findRecurringCoderabbitComments(pullRequests, {
  minRecurrence: 3,
  windowDays: 14,
});
```

Each emitted finding uses the standard step-02 finding shape with
`category: CODERABBIT_RECURRING` and `location: cross-repo` (the finding spans multiple PRs, not a single file). Severity is `medium` for 3-4 recurring PRs and `high` for 5+. Append these findings to the same list emitted by audits 1-6 above; the AND-of-empty routing gate treats them as ordinary signal.

`coderabbit-finder.mjs` is pure — no fetch, no shell. Tests live at `hive/workflows/steps/meta-team-cycle/__tests__/coderabbit-finder.test.mjs` and cover the title-extraction regex, author filtering (only `coderabbitai*` logins), tally semantics (duplicate comments in the same PR count once toward distinct-PR recurrence), and the threshold gate.

### 7. Compile findings
For each finding, record:
```yaml
id: finding-{N}
category: MISSING_FILE | SCHEMA_INCONSISTENCY | INCOMPLETE_STEP_FILE | MEMORY_GAP | STUB_DOC | MISSING_STEP_FILE | CODERABBIT_RECURRING | OTHER
severity: critical | high | medium | low
location: {file path | cross-repo}
description: {one-line description}
evidence: {specific field, line, or pattern that demonstrates the issue}
```

**Dedup against in-flight PRs (from Step 0):** Before sorting, drop any
finding whose fix is already proposed in an open PR. A finding is a duplicate
when its `location` (file path) is in an open PR's changed-file set AND the
PR's title/diff addresses the same issue (e.g. an open PR already bumps
`claude-opus-4-7 -> claude-opus-4-8` in that file). Record each suppressed
finding under `findings_suppressed` (id, location, pr_number) for the report —
do NOT carry it into `findings`. This is the gate that prevents re-proposing
unreviewed work; the suppressed count makes the dedup auditable.

Sort the surviving findings by severity descending, then by category.

### 8. Update cycle-state.yaml
Append all findings to `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml`:
```yaml
phase: analysis
findings:
  - {finding objects}
```

**`metric_signal` field (orthogonal to findings):** If the analyzer also evaluates a perf-baseline delta (token / wall_clock_ms / first_attempt_pass) against a prior cycle baseline, record the result as a separate `metric_signal: true | false` field on this step's output. This flag is **perf-baseline-only** — it indicates whether a usable baseline-vs-candidate metric delta exists for proposal ranking. It is NOT a proxy for "are there findings". Routing between step-03 and step-03b uses an AND-of-empty rule across `findings`, `external_research_candidates`, and `metric_signal`; structural findings drive step-03 even when `metric_signal: false`. See `step-03b-backlog-fallback.md` §MANDATORY EXECUTION RULES for the canonical routing rule.

### 9. Emit structured output (executor contract)
In addition to the cycle-state write above, emit a JSON object matching
the OUTPUT FORMAT declared at the top of this file. The DAG executor
binds downstream `when:` predicates to these fields by name:

```json
{
  "metric_signal": false,
  "findings_count": 8,
  "external_candidates_count": 0,
  "findings": [{"id": "finding-1", "category": "MISSING_FILE", "severity": "high", ...}],
  "external_research_candidates": []
}
```

`findings_count` MUST equal `len(findings)` and `external_candidates_count`
MUST equal `len(external_research_candidates)`. Predicates bind to the
explicit count fields (the strict-Archon grammar does not support
`len(...)`); list-length parity is a contract invariant — diverging
counts will silently misroute step-03 vs step-03b.

### 10. Produce analysis report
```
## Analysis Report — Cycle {cycle_id}

Total findings: {N}
  Critical: {N}
  High: {N}
  Medium: {N}
  Low: {N}

Suppressed (already proposed in open PRs): {N}
  - [{location}] dup of PR #{pr_number}
  ...

By category:
  MISSING_FILE: {N}
  SCHEMA_INCONSISTENCY: {N}
  INCOMPLETE_STEP_FILE: {N}
  MISSING_STEP_FILE: {N}
  MEMORY_GAP: {N}
  STUB_DOC: {N}
  OTHER: {N}

Top findings:
  [{severity}] {category} — {location}: {description}
  ...
```

## SUCCESS METRICS

- [ ] Step 0 in-flight PR pre-flight executed (or `PREFLIGHT_DEGRADED` logged)
- [ ] All 6 audit checks executed (cross-ref, schema, step files, memories, reference docs, workflows)
- [ ] Each finding has category, severity, location, description, evidence
- [ ] Findings already proposed in open PRs suppressed and reported (not re-proposed)
- [ ] Findings appended to `cycle-state.yaml`
- [ ] Analysis report produced with counts by severity and category
- [ ] Structured output emitted matching the OUTPUT FORMAT contract: `metric_signal: bool`, `findings_count: int` (== len(findings)), `external_candidates_count: int`, `findings: list`, `external_research_candidates: list`

## FAILURE MODES

- File not found during audit: log as finding, continue (don't stop the audit)
- YAML parse error on a workflow/config file: log as `critical` finding, continue
- Large codebase slows scan: prioritize critical and high checks; skip low checks if time is short

## NEXT STEP

**Gating:** Analysis report complete with at least one finding (or explicit "no findings" if clean)
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-02b-external-research.md`. That step runs in parallel with the findings from this step and produces additional proposal candidates with `discovery_source: external_research`. Step 03 (`step-03-proposal.md`) consumes both this step's findings and step-02b's external candidates to compose the ranked proposal list.
**If gating fails:** Report which audit checks could not run and why.
