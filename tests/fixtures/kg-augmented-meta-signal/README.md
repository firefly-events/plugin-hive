# Fixture — kg-augmented-meta-signal

End-to-end fixture for S5 of the `kg-augmented-meta-signal` initiative.
Backs the six acceptance criteria in
`.pHive/epics/kg-augmented-meta-signal/stories/S5-fixture-test.yaml`.

## What this fixture proves

Given an EMPTY metrics events directory and a populated `kg.sqlite`,
the KG-augmented meta-optimize path produces ranked, kg_signal-backed
proposals that:

- include only the **recent** triples (older than 30 days are filtered)
- penalise **cross-project** triples by the 0.7× rank multiplier vs equivalent local-signal triples
- merge into step-03's proposal stream tagged `discovery_source: kg_signal`
- fall through to step-03b only when ALL three feeds are empty (the AND-of-empty gate)

The fixture is the seeded *input*. The asserts read the kg-findings.yaml
that step-02c emits when an LLM walks the step against this seeded
environment — see strategy below.

## How to run

```bash
./run.sh           # build tmp env, print FIXTURE-READY + state, then cleanup
./run.sh --keep    # build tmp env, print FIXTURE-READY + state, KEEP tmp for inspection
```

The script:
- creates `$(mktemp -d)/{fake_home,proj}` under macOS/Linux tmp
- seeds `$fake_home/.claude/hive/kg.sqlite` from `seed.sql`
- creates a tmp `proj/.pHive/epics/kg-fixture-local-epic/` so step-02c §1's
  local-vs-cross-project tagging has something to match against
- writes `$tmp_base/fixture-state.txt` with the matrix counts and the
  exact SQL that produced each
- prints `FIXTURE-READY` followed by `tmp_base:` and `state_file:` paths
- cleans up via `trap` on EXIT/INT/TERM unless `--keep` is passed

## Strategy

**No-deps via `/usr/bin/sqlite3` CLI.** No `package.json`, no
`better-sqlite3`. The plugin-hive philosophy is bring-your-own-enhancements —
fixtures use system CLIs only. Confirmed in
`.pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/research-brief.md`
§Q1.

**LLM-mediated step-02c.** `step-02c` is markdown — it is consumed and
executed by an agent, not a binary. To assert AC2 + AC3 the tester walks
step-02c against the seeded tmp environment (with `HOME=$tmp_base/fake_home`
so the hardcoded `~/.claude/hive/kg.sqlite` resolves under the tmp tree),
captures the emitted `kg-findings.yaml`, and runs the count + multiplier
asserts against that artifact. AC1 + AC4 are documented mental traces
through step-03 §2c and the step-03b AND-of-empty routing rule —
matching the precedent in
`.pHive/episodes/memory-autonomy-foundation/chromadb-integration/test-results.md`.

## Tester next steps

1. Run `./run.sh --keep` — record the printed `tmp_base` and `state_file`.
2. `export HOME="$tmp_base/fake_home"` and `cd "$tmp_base/proj"`.
3. Walk `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` against
   that environment. Capture the resulting `kg-findings.yaml` under the
   episode directory.
4. Cross-reference the AC headers in
   `.pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/test-results.md`
   against the artifact; record PASS/FAIL with quoted evidence per the
   chromadb-integration precedent.
5. For AC4: clear the KG (`sqlite3 "$HOME/.claude/hive/kg.sqlite" "DELETE FROM triples;"`)
   and confirm the empty-input branch routes to step-03b per the AND-of-empty
   gate documented in step-03b.
6. After tester sign-off, `rm -rf "$tmp_base"`.

## Files in this fixture

- `seed.sql` — canonical bootstrap DDL + 7 hand-crafted INSERTs (idempotent)
- `run.sh` — bash runner; `mktemp -d` + `trap` cleanup; emits `fixture-state.txt`
- `README.md` — this file

## Triple matrix (seed.sql)

| Predicate | Recency | Signal class | source_epic | Notes |
|-----------|---------|--------------|-------------|-------|
| phase_failed  | recent (2026-04-22) | local        | kg-fixture-local-epic | AC2/AC3 baseline |
| phase_failed  | recent (2026-04-25) | local        | kg-fixture-local-epic | AC2/AC3 baseline |
| phase_blocked | recent (2026-04-18) | cross-project| kg-fixture-other-epic | AC3: 0.7× multiplier |
| phase_blocked | recent (2026-04-27) | cross-project| kg-fixture-other-epic | AC3: 0.7× multiplier |
| superseded    | recent (2026-04-20) | local        | kg-fixture-local-epic | mix coverage |
| phase_failed  | stale  (2026-02-01) | local        | kg-fixture-local-epic | AC2: must be excluded |
| phase_blocked | stale  (2026-01-15) | cross-project| kg-fixture-other-epic | AC2: must be excluded |
