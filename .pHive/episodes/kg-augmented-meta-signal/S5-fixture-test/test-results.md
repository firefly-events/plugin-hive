# Test Results — S5-fixture-test

Story: `.pHive/epics/kg-augmented-meta-signal/stories/S5-fixture-test.yaml`
Fixture: `tests/fixtures/kg-augmented-meta-signal/`
Date: 2026-05-01T18:30:45Z
Tester: tester-s5 (claude / Sonnet 4.6)
Branch: feat/kg-augmented-meta-signal
Commits: 01e0a33 (fixture build) + d372019 (SHA fixup)

## Strategy

**Hybrid asserts (per research-brief §Q2).** AC2 and AC3 are asserted against the `kg-findings.yaml` that step-02c emits when walked against the seeded tmp environment — the fixture seeds reproducible inputs, the tester captures the LLM-mediated artifact, and the asserts read that artifact. AC1 and AC4 are documented mental traces through step-03 §2c and the step-03b AND-of-empty routing rule, matching the precedent in `.pHive/episodes/memory-autonomy-foundation/chromadb-integration/test-results.md` (quote the spec; mark PASS with `> "evidence quote"`).

**No-deps strategy (per research-brief §Q1).** The fixture uses `/usr/bin/sqlite3` only — no `package.json`, no `better-sqlite3`. `HOME` is overridden to the tmp `fake_home/` so the hardcoded `~/.claude/hive/kg.sqlite` lookup resolves under the tmp tree.

**Execution summary.** The fixture runner was invoked as `./tests/fixtures/kg-augmented-meta-signal/run.sh --keep`, which seeded a tmp kg.sqlite with 7 crafted triples and emitted `fixture-state.txt`. I (the LLM tester) then walked step-02c's Task Sequence (sections 1–7) literally, issuing SQLite queries against the seeded db, applying the three-layer relevance filter, and producing `kg-findings.yaml`. Step-03 and step-03b routing were traced via spec quotation.

## How to read these asserts

- **PASS** — the artifact or spec quote satisfies the AC; cite the quoted evidence inline with a `>` blockquote.
- **FAIL** — the artifact contradicts or omits the AC; cite the contradicting evidence and what the expected output would be.
- AC2/AC3 require a captured `kg-findings.yaml` (paste the relevant rows).
- AC1/AC4 quote the workflow spec markdown (step-03 §2c, step-03b §1).

## Setup commands (executed)

```bash
cd /Users/don/Documents/plugin-hive
git checkout feat/kg-augmented-meta-signal
./tests/fixtures/kg-augmented-meta-signal/run.sh --keep
# FIXTURE-READY
# tmp_base: /var/folders/2x/4d9d2kgn3rj4kn5gt6rmmgkm0000gn/T/kg-fixture-XXXXXX.nXYboDqSEF
# state_file: <tmp_base>/fixture-state.txt
```

---

## Fixture State (from fixture-state.txt)

Generated: 2026-05-01T18:30:45Z
KG path: `<tmp_base>/fake_home/.claude/hive/kg.sqlite`
Local epic: `kg-fixture-local-epic`
Logical now: `2026-05-01T00:00:00Z` / Recency cutoff: `2026-04-01T00:00:00Z`

**Q1 — triples by predicate:**
```
phase_blocked    3
phase_failed     3
superseded       1
```

**Q2 — triples by recency bucket:**
```
recent    5
stale     2
```

**Q3 — recent triples by signal class:**
```
cross_project_signal    2
local_signal            3
```

**Q4 — full triple dump (chronological):**
```
subject                  predicate      object                valid_from            source_epic
-----------------------  -------------  --------------------  --------------------  ---------------------
kg-fixture-other-epic    phase_blocked  pre-exec              2026-01-15T08:00:00Z  kg-fixture-other-epic  [STALE]
kg-fixture-local-epic    phase_failed   pre-exec              2026-02-01T08:00:00Z  kg-fixture-local-epic  [STALE]
kg-fixture-other-epic    phase_blocked  planning              2026-04-18T09:00:00Z  kg-fixture-other-epic
use-bun-spawn-stdin      superseded     use-node-spawn-stdin  2026-04-20T11:00:00Z  kg-fixture-local-epic
kg-fixture-local-epic    phase_failed   integrate             2026-04-22T10:00:00Z  kg-fixture-local-epic
S2-fixture-story         phase_failed   test                  2026-04-25T14:30:00Z  kg-fixture-local-epic
S7-other-story           phase_blocked  execute               2026-04-27T16:00:00Z  kg-fixture-other-epic
```

---

## LLM-Mediated Step-02c Trace

### 1. Resolve Configuration
- `window_days` = 30 (default; no project override in fixture)
- `now` = 2026-05-01T00:00:00Z
- `recency_cutoff` = 2026-04-01T00:00:00Z
- `local_epics` = `[kg-fixture-local-epic]` (from `proj/.pHive/epics/`)

### 2. Verify KG Availability
KG path `<tmp_base>/fake_home/.claude/hive/kg.sqlite` exists, WAL mode enabled, `triples` table present with 7 rows. KG available: YES.

### 3. Query the KG

**Failure signals (two underlying calls grouped as one):**
```sql
SELECT subject, predicate, object, valid_from, valid_until, source_epic
FROM triples
WHERE predicate IN ('phase_failed', 'phase_blocked') AND valid_until IS NULL;
```
Returns 6 rows.

**Supersession signals:**
```sql
SELECT subject, predicate, object, valid_from, valid_until, source_epic
FROM triples
WHERE predicate = 'superseded' AND valid_until IS NULL;
```
Returns 1 row.

Raw pool before filtering: 7 triples.

### 4. Apply Three-Layer Relevance Filter

**Layer 1 — Predicate filter:** All 7 triples carry `phase_failed`, `phase_blocked`, or `superseded`. All pass.

**Layer 2 — Recency window:**
```sql
SELECT subject, predicate, valid_from,
       CASE WHEN valid_from >= '2026-04-01T00:00:00Z' THEN 'KEEP' ELSE 'EXCLUDE' END AS decision
FROM triples
WHERE predicate IN ('phase_failed','phase_blocked','superseded')
ORDER BY valid_from;
```
```
kg-fixture-other-epic  phase_blocked  2026-01-15  → EXCLUDE (stale, 106 days)
kg-fixture-local-epic  phase_failed   2026-02-01  → EXCLUDE (stale, 89 days)
kg-fixture-other-epic  phase_blocked  2026-04-18  → KEEP
use-bun-spawn-stdin    superseded     2026-04-20  → KEEP
kg-fixture-local-epic  phase_failed   2026-04-22  → KEEP
S2-fixture-story       phase_failed   2026-04-25  → KEEP
S7-other-story         phase_blocked  2026-04-27  → KEEP
```
Remaining: **5 triples**.

**Layer 3 — Project tagging with rank penalty:**
```sql
SELECT subject, predicate, source_epic,
       CASE WHEN source_epic = 'kg-fixture-local-epic' THEN 'local_signal'
            ELSE 'cross_project_signal' END AS signal_class
FROM triples
WHERE predicate IN ('phase_failed','phase_blocked','superseded')
  AND valid_from >= '2026-04-01T00:00:00Z';
```
```
cross_project_signal: kg-fixture-other-epic / phase_blocked / planning  (2026-04-18)
cross_project_signal: S7-other-story        / phase_blocked / execute   (2026-04-27)
local_signal:         use-bun-spawn-stdin   / superseded               (2026-04-20)
local_signal:         kg-fixture-local-epic / phase_failed / integrate  (2026-04-22)
local_signal:         S2-fixture-story      / phase_failed / test       (2026-04-25)
```

### 5. Cluster and Score

Rank formula: `predicate_weight × recency_factor` where `recency_factor = 1/(1 + days_since × 0.05)`.
Weights: `phase_failed=1.0`, `phase_blocked=0.9`, `superseded=0.7`. Cross-project penalty: `×0.7`.

| id | subject | predicate | signal_class | days | base_rank | final_rank |
|----|---------|-----------|--------------|------|-----------|------------|
| kg-finding-001 | S2-fixture-story | phase_failed | local_signal | 6 | 0.77 | **0.77** |
| kg-finding-002 | kg-fixture-local-epic | phase_failed | local_signal | 9 | 0.69 | **0.69** |
| kg-finding-003 | S7-other-story | phase_blocked | cross_project_signal | 4 | 0.75 | **0.525** |
| kg-finding-004 | use-bun-spawn-stdin | superseded | local_signal | 11 | 0.455 | **0.455** |
| kg-finding-005 | kg-fixture-other-epic | phase_blocked | cross_project_signal | 13 | 0.549 | **0.384** |

### 6. Shape for step-03

No step-02 findings (empty metrics dir). No step-02b candidates. De-duplication: no overlaps. All 5 findings pass through tagged `discovery_source: kg_signal`.

### 7. Emitted kg-findings.yaml (inline excerpt)

```yaml
kg_signal: true
window_days: 30
as_of: "2026-05-01T00:00:00Z"
local_epics: [kg-fixture-local-epic]
findings:
  - id: kg-finding-001
    discovery_source: kg_signal
    signal_class: local_signal
    predicate: phase_failed
    subject: S2-fixture-story
    object: test
    source_epic: kg-fixture-local-epic
    valid_from: "2026-04-25T14:30:00Z"
    base_rank: 0.77
    final_rank: 0.77
    rank_note: "local_signal — no penalty applied"
  - id: kg-finding-002
    discovery_source: kg_signal
    signal_class: local_signal
    predicate: phase_failed
    subject: kg-fixture-local-epic
    object: integrate
    source_epic: kg-fixture-local-epic
    valid_from: "2026-04-22T10:00:00Z"
    base_rank: 0.69
    final_rank: 0.69
  - id: kg-finding-003
    discovery_source: kg_signal
    signal_class: cross_project_signal
    predicate: phase_blocked
    subject: S7-other-story
    object: execute
    source_epic: kg-fixture-other-epic
    valid_from: "2026-04-27T16:00:00Z"
    base_rank: 0.75
    final_rank: 0.525
    rank_note: "cross_project_signal — 0.7× penalty applied (0.75 × 0.7 = 0.525)"
  - id: kg-finding-004
    discovery_source: kg_signal
    signal_class: local_signal
    predicate: superseded
    subject: use-bun-spawn-stdin
    object: use-node-spawn-stdin
    source_epic: kg-fixture-local-epic
    valid_from: "2026-04-20T11:00:00Z"
    base_rank: 0.455
    final_rank: 0.455
  - id: kg-finding-005
    discovery_source: kg_signal
    signal_class: cross_project_signal
    predicate: phase_blocked
    subject: kg-fixture-other-epic
    object: planning
    source_epic: kg-fixture-other-epic
    valid_from: "2026-04-18T09:00:00Z"
    base_rank: 0.549
    final_rank: 0.384
    rank_note: "cross_project_signal — 0.7× penalty applied (0.549 × 0.7 = 0.384)"
excluded_stale:
  count: 2
  triples:
    - {subject: kg-fixture-other-epic, predicate: phase_blocked, valid_from: "2026-01-15T08:00:00Z"}
    - {subject: kg-fixture-local-epic, predicate: phase_failed,  valid_from: "2026-02-01T08:00:00Z"}
```

Full file saved to `<tmp_base>/kg-findings.yaml`.

---

## AC1 — step-03 produces at least one kg_signal-backed proposal

> "Given the seeded fixture (empty metrics + populated KG with recent triples), when meta-optimize runs through the relevant steps, then step-03 produces at least one kg_signal-backed proposal"

**Status: PASS**

Evidence — kg-finding-001 from the emitted kg-findings.yaml:
```yaml
id: kg-finding-001
discovery_source: kg_signal
signal_class: local_signal
predicate: phase_failed
subject: S2-fixture-story
object: test
final_rank: 0.77
```

Per step-03-proposal.md §2c:
> "treat each entry as an eligible analysis finding… Tag each entry with `discovery_source: kg_signal` if that field isn't already set on it."

5 kg_signal-backed findings enter the eligible pool. With no competing step-02 or step-02b inputs, all five flow through to Step 3 ranking and would generate proposals tagged `discovery_source: kg_signal`. AC1 PASS.

---

## AC2 — Triples older than 30 days are excluded from kg-findings.yaml

> "Given the seeded fixture, when step-02c runs, then triples older than 30 days are excluded from kg-findings.yaml"

**Status: PASS**

From fixture-state.txt (Q2):
```
recent    5
stale     2
```

The 2 stale triples (excluded from `findings:`, captured in `excluded_stale:`):
```
kg-fixture-other-epic / phase_blocked / pre-exec  — valid_from 2026-01-15 (106 days before now)
kg-fixture-local-epic / phase_failed  / pre-exec  — valid_from 2026-02-01 (89 days before now)
```

Neither stale triple appears in the `findings:` list of kg-findings.yaml. `excluded_stale.count: 2` exactly matches the fixture-state.txt stale bucket count. AC2 PASS.

---

## AC3 — cross_project_signal findings carry the 0.7× rank penalty

> "Given the seeded fixture, when step-02c runs, then cross_project_signal findings have rank values multiplied by 0.7 vs equivalent local_signal findings"

**Status: PASS**

Rank comparison for `phase_blocked` predicate (same weight=0.9):

```
kg-finding-003: S7-other-story / phase_blocked / execute
  signal_class: cross_project_signal
  base_rank:    0.75   (days=4, factor=0.83, 0.9×0.83=0.75)
  final_rank:   0.525  (0.75 × 0.7 = 0.525)
  ratio:        0.525 / 0.75 = 0.700  ✓

kg-finding-005: kg-fixture-other-epic / phase_blocked / planning
  signal_class: cross_project_signal
  base_rank:    0.549  (days=13, factor=0.61, 0.9×0.61=0.549)
  final_rank:   0.384  (0.549 × 0.7 = 0.384)
  ratio:        0.384 / 0.549 = 0.699 ≈ 0.700  ✓ (rounding)
```

Local findings (kg-finding-001, 002, 004): `final_rank == base_rank` — no penalty applied. Cross-project findings carry exactly 0.7× the base rank. AC3 PASS.

---

## AC4 — KG cleared between runs → routing falls through to step-03b

> "Given the seeded fixture with KG cleared between runs, when meta-optimize re-runs, then routing correctly falls through to step-03b (or terminal) per the routing rules"

**Status: PASS** (mental trace per approved strategy)

**Step-02c with empty KG:**
All three predicate queries (`phase_failed`, `phase_blocked`, `superseded`) return 0 rows. Per step-02c spec:
> "If both groupings return empty: jump to step 7, emit an empty findings list, and log `kg_signal: no eligible triples — skipping`."

kg-findings.yaml emitted with `findings: []` and `kg_signal: false`.

**Step-03b eligibility check** (per step-03b-backlog-fallback.md §1):
> "ONLY if all three are empty (zero findings AND zero external candidates AND no metric signal): continue into backlog fallback mode"

In the fixture's empty-metrics environment:
- `findings` from step-02: empty (no metrics events seeded)
- `external_research_candidates` from step-02b: empty
- `kg_findings` from step-02c: empty (cleared KG)
- `metric_signal`: none

AND-of-empty gate is satisfied → **step-03b fires**. If the backlog is also empty → terminal/no-candidate state. This matches the story spec's "step-03b fallback fires (or terminal failure if backlog also empty)." AC4 PASS.

---

## AC5 — Test results documented per AC

> "Test results documented in .pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/test-results.md with explicit pass/fail per AC"

**Status: PASS**

This file is at `.pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/test-results.md` with explicit PASS status for each of AC1–AC6. AC5 PASS.

---

## AC6 — Fixture is reproducible (setup script + seed SQL committed)

> "Fixture is reproducible — setup script + seed SQL committed under tests/ or scripts/test-fixtures/"

**Status: PASS**

Evidence:
- `run.sh` uses `mktemp -d "${TMPDIR:-/tmp}/kg-fixture-XXXXXX"` — no machine-specific paths; all paths derived from `$TMPDIR_BASE`.
- `seed.sql` committed under `tests/fixtures/kg-augmented-meta-signal/seed.sql` (verified on branch feat/kg-augmented-meta-signal, commits 01e0a33 + d372019).
- `README.md` committed at `tests/fixtures/kg-augmented-meta-signal/README.md` with triple matrix table, run procedure, and tester next steps documented.
- Fixture ran on a clean checkout with zero external dependencies beyond `/usr/bin/sqlite3`.
- `run.sh` is idempotent: seed.sql uses `INSERT OR IGNORE` throughout.

AC6 PASS.

---

## Defects

None found.

---

## Summary

| AC | Description | Status |
|----|-------------|--------|
| AC1 | At least one kg_signal-backed finding emerged | PASS |
| AC2 | Stale triples (2) excluded from kg-findings.yaml | PASS |
| AC3 | cross_project_signal findings carry 0.7× rank penalty | PASS |
| AC4 | Empty KG → step-03b fallback fires (mental trace) | PASS |
| AC5 | test-results.md with explicit pass/fail per AC | PASS |
| AC6 | Fixture reproducible (mktemp, seed.sql committed, README) | PASS |

**Final Verdict: PASS**
