# Test Results — S5-fixture-test

Story: `.pHive/epics/kg-augmented-meta-signal/stories/S5-fixture-test.yaml`
Fixture: `tests/fixtures/kg-augmented-meta-signal/`
Date: _to be filled by tester_
Tester: _to be filled by tester_

## Strategy

**Hybrid asserts (per research-brief §Q2).** AC2 and AC3 are asserted
against the `kg-findings.yaml` that step-02c emits when walked against the
seeded tmp environment — the fixture seeds reproducible inputs, the
tester captures the LLM-mediated artifact, and the asserts read that
artifact. AC1 and AC4 are documented mental traces through step-03 §2c
and the step-03b AND-of-empty routing rule, matching the precedent in
`.pHive/episodes/memory-autonomy-foundation/chromadb-integration/test-results.md`
(quote the spec; mark PASS with `> "evidence quote"`).

**No-deps strategy (per research-brief §Q1).** The fixture uses
`/usr/bin/sqlite3` only — no `package.json`, no `better-sqlite3`.
`HOME` is overridden to the tmp `fake_home/` so the hardcoded
`~/.claude/hive/kg.sqlite` lookup resolves under the tmp tree.

## How to read these asserts

- **PASS** — the artifact or spec quote satisfies the AC; cite the
  quoted evidence inline with a `>` blockquote.
- **FAIL** — the artifact contradicts or omits the AC; cite the
  contradicting evidence and what the expected output would be.
- AC2/AC3 require a captured `kg-findings.yaml` (paste the relevant rows).
- AC1/AC4 quote the workflow spec markdown (step-03 §2c, step-03b §3).

## Setup commands (executed once)

```bash
cd /Users/don/Documents/plugin-hive
./tests/fixtures/kg-augmented-meta-signal/run.sh --keep
# record tmp_base from the FIXTURE-READY output
export HOME="<tmp_base>/fake_home"
cd "<tmp_base>/proj"
# walk step-02c against this environment, capture kg-findings.yaml
```

---

## AC1 — step-03 produces at least one kg_signal-backed proposal

> "Given the seeded fixture (empty metrics + populated KG with recent
> triples), when meta-optimize runs through the relevant steps, then
> step-03 produces at least one kg_signal-backed proposal"

**Status:** _PENDING_

_Evidence (quote step-03 §2c merge logic + the captured kg-findings.yaml
showing at least one kg_signal-tagged proposal flowing through):_

```
<paste evidence here>
```

---

## AC2 — Triples older than 30 days are excluded from kg-findings.yaml

> "Given the seeded fixture, when step-02c runs, then triples older than
> 30 days are excluded from kg-findings.yaml"

**Status:** _PENDING_

_Evidence: fixture-state.txt shows 5 recent + 2 stale triples seeded. The
captured kg-findings.yaml must reference only the 5 recent ones — quote
the relevant rows + show the absent stale triples:_

```
<paste evidence here>
```

---

## AC3 — cross_project_signal findings carry the 0.7× rank penalty

> "Given the seeded fixture, when step-02c runs, then cross_project_signal
> findings have rank values multiplied by 0.7 vs equivalent local_signal
> findings"

**Status:** _PENDING_

_Evidence: paste the rank values for at least one local_signal finding
and one cross_project_signal finding from kg-findings.yaml. Confirm the
ratio is 0.7×:_

```
<paste evidence here>
```

---

## AC4 — KG cleared between runs → routing falls through to step-03b

> "Given the seeded fixture with KG cleared between runs, when
> meta-optimize re-runs, then routing correctly falls through to step-03b
> (or terminal) per the routing rules"

**Status:** _PENDING_

_Evidence: clear the KG (`sqlite3 "$HOME/.claude/hive/kg.sqlite" "DELETE
FROM triples;"`), re-walk the step. Quote the AND-of-empty gate from
step-03b §3 and confirm step-02c emits `kg_findings: []`:_

```
<paste evidence here>
```

---

## AC5 — Test results documented per AC

> "Test results documented in
> .pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/test-results.md
> with explicit pass/fail per AC"

**Status:** _PENDING_

_This file itself satisfies the AC once AC1–AC4 above are filled in._

---

## AC6 — Fixture is reproducible (setup script + seed SQL committed)

> "Fixture is reproducible — setup script + seed SQL committed under
> tests/ or scripts/test-fixtures/"

**Status:** _PENDING_

_Evidence: confirm the four committed files exist and `./run.sh` produces
deterministic counts on a clean checkout. Reference the commit SHA from
the implement step:_

```
tests/fixtures/kg-augmented-meta-signal/seed.sql
tests/fixtures/kg-augmented-meta-signal/run.sh
tests/fixtures/kg-augmented-meta-signal/README.md
.pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/test-results.md
commit: <sha>
```

---

## Summary

| AC | Status |
|----|--------|
| AC1 | PENDING |
| AC2 | PENDING |
| AC3 | PENDING |
| AC4 | PENDING |
| AC5 | PENDING |
| AC6 | PENDING |
