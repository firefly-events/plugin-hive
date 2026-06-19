# ToDo Swimlane Audit + Release Grouping — 2026-06-09

125 ToDo issues audited (workspace `plugin-hive`), cross-referenced against
`origin/main..origin/develop` (525 files, +34,463/−785 — substrate-coverage epic,
meta-meta pipeline revival, writer doc-skills, language charter/ADR, reconcile
hardening).

## P0 — Swimlane hygiene (close before any planning math)

**18 stale-done issues: PLU-212..229.** These map 1:1 to
`substrate-coverage-and-test-cleanup` stories (s-1..s-4, t-1..t-3, d-1..d-5,
dr-1..dr-3, r-1..r-3). Epic closed 19/19 on develop (commit 86ced3c); all mode
atoms, dispatch routers, `mode-resolver.mjs`, `cc-workflows-preconditions.mjs`,
dispatch-parity.md exist on develop. Issues should flip to done.

**~~Partial-shipped, verify: PLU-167..171~~ VERIFIED ALL SHIPPED, closed 2026-06-09.**
All five cwfp Slice-2 issues confirmed on develop: step 6f branch (execute SKILL
L151/L188), cc-workflows in dispatch enum + epic_override field_sources, 390-line
execute-mode-cc-workflows skill with workflow_assembly + SERIAL-COMMIT GATE,
execution.runtime knob in root + shipped baseline configs, and e2e evidence via
the substrate-coverage post-run audits (real epics ran through the Workflow tool
with serial commits). cwfp story YAMLs still read pending — stale.

**BONUS FINDING:** `.pHive/epics/cc-workflows-first-party/docs/disposition-pass-msd.md`
and `disposition-pass-mpt.md` already exist on develop — the PLU-174/175 disposition
AUDITS appear already executed; the 30 APPLY issues (PLU-178..207) are their *output*.
Next step is reading those two docs and closing 174/175, then triaging the APPLY
issues per their recorded verdicts — not re-running audits.

**In-flight, leave alone:** PLU-304/310 (multica-plugin-ui synthesis — active branch),
PLU-314/315 (squad-leader-status-flip — active branch).

## Prioritized clusters (after hygiene)

| P | Cluster | Issues | Count | Rationale |
|---|---------|--------|-------|-----------|
| 1 | squad-leader-status-flip | PLU-314, 315 | 2 | Active branch; status-discipline theme matches just-merged PR-272 reconcile hardening |
| 1 | sdr-1 conformance fixture | PLU-247 | 1 | Direct mandate of language ADR shipping in this release ("config.py + JS callers agree via shared fixture") |
| 2 | kg-repair-activation | PLU-81..93 | 13 | Release wires kg-signal into nightly; without emit-wiring + density repair the new `kg_findings_count` signal stays near-zero. PLU-93 literally drafts the kg_signal weight-bump |
| 3 | ~~Disposition audits~~ EXECUTED 2026-06-09 | PLU-174, 175 | 2 | DONE: audits pre-existed on develop; 50 issues closed per recorded verdicts (174/175 + 19 msd disp + 11 mpt disp + 18 msd originals). Survivors: PLU-115 (w4-4 ci-drift-guard, only unshipped backlog) + PLU-104..107 (w2-4..w2-7 NEVER audited — need own disposition) |
| 4 | state-dir-resolver | PLU-248..256 | 9 | Self-contained; 349 sites; first Multica-driven plan |
| 5 | artifact lifecycle | PLU-267..274 | 8 | DEPENDS on sdr (al-7 scans *resolved* state dir) — sequence after P4 |
| 6 | dynamic-planning-team | PLU-149..153 | 5 | HOLD: squad-doctrine memo says Layer 2 absorbs this epic — replan before executing |
| 7 | cwfp remainder + msd survivors | PLU-167..173, 176..177, 208..210, post-audit msd | ~15-40 | Sized only after P3 audits; maintainer gate on cwfp Slices 2-6 still pending |

## Cross-reference verdict: fold into current release?

Three natural companions — ALL EXECUTED 2026-06-09, **ALL MERGED to develop 2026-06-10** (PR #276 sdr-1, PR #277 kg s2+s3, PR #274 sls pre-existing). R-next payload complete.
1. **PLU-314/315** — found already MERGED (PR #274 → develop); PLU-313..315 done. No work needed.
2. **PLU-247** — sdr-1 shipped on `feat/state-dir-resolver` (7439fb8): Python `resolve_state_dir` canonical, shell/Node shims, 18-row 3-runtime conformance fixture. Codex review passed (1 revision: CONFIG_FILE-unset divergence). Bonus: fixed latent config.js CJS-in-ESM-scope break. Needs PR → develop.
3. **kg-repair s2/s3 (PLU-86/87)** — shipped on `feat/kg-repair-activation` (107d4bb): H2 verdict cause (a), phase_started/phase_complete wired incl. resume replay path, step-02c consumer at 5 predicates. Codex passed (1 revision: replay bypass). s1 dependency waived (manual queries). Needs PR → develop.

Everything else: no overlap; release train below.

## Release grouping plan

- **R-next (current develop → main):** ship as-is, optionally + the 3 companions above.
- **R+1 "Signal & Status":** kg-repair-activation (PLU-81..93) + squad-leader-status-flip remainder. Theme: make the nightly's new signals trustworthy.
- **R+2 "State-dir resolver":** PLU-247..256. Pure infra; isolates churn from 349 call sites.
- **R+3 "Artifact lifecycle":** PLU-267..274. Rides on R+2's resolver.
- **R+4 "Substrate consolidation":** PLU-174/175 audits → surviving msd/mpt dispositions → cwfp Slices 2-6 (PLU-167..173, 176/177) → docs (PLU-208..210, README rewrite 209 LAST — describes the consolidated reality).
- **R+5 "Planning composition":** dpt (PLU-149..153) replanned under squad-doctrine Layer 2.

## Notes

- release-lifecycle epic (rl-1..6, PLU-232..237) is on Multica but NOT in ToDo —
  it defines /ship + version-bump mechanics. If the release-train above is adopted,
  pull rl-1..6 forward into R+1: every subsequent release uses it.
- msd originals (PLU-94..116) and msd dispositions (PLU-178..196) are pairwise twins
  of the same stories. Canonical-source rule: disposition issue decides fate;
  original carries the work. Do not schedule both.
