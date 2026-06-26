# Payload Before/After — plugin-hygiene-remediation Slice A

Measured 2026-06-25 via fresh `git clone --single-branch feat/plugin-hygiene-remediation`.

| Metric | Baseline (develop) | After Slice A | Delta |
|--------|--------------------|--------------|------|
| Tracked files | 2,179 | 1,154 | **−1,025 (−47%)** |
| Tracked bytes | ~15.5 MB | ~8.8 MB | **−6.7 MB (−43%)** |

## What was untracked (Slice A)
- `.pHive/epics/` historical (53 maintainer epics) + `.pHive/episodes/` (15) — the 47% bulk
- `.pHive/cycle-state/`, `.pHive/specialist-phases/`, `.pHive/audits/` historical (kept post-run + plugin-install-payload)
- `.pHive/proposals/`, `.pHive/research/`, `.pHive/research-drafts/`, `.pHive/upstream-watch/`, `.hive/insights/`

## Verification (s5) — all PASS
- KEEP-TRACKED present in fresh clone: metrics, test-scenarios, multica (agents/squads/autopilots), team-memories, project-profile, cross-cutting-concerns, hive.config, runtime/executor-graduated-workflows, CONTEXT.md ✓
- Maintainer-historical absent: epics(non-active)=0, episodes=0, proposals=0, .hive/insights=0 ✓
- Active epic present: plugin-hygiene-remediation = 12 files ✓
- Runtime smoke: `resolve_state_dir()` ✓, `import hive.lib.dag_executor` ✓, consumer config reads ✓, multica mandatory config present ✓

## Deferred to Slice B (still tracked — repo needs them for CI/dev)
`tests/` (1.1 MB), `.github/`, `scripts/`, `maintainer-skills/`, `.pHive/meta-team/`, lint configs.
Moving these to `plugin-hive-internal` lands the remaining ~1.3 MB → projected ~7.5 MB final.
