# Plugin Install Payload Audit

**Ref:** `feat/plugin-hygiene`  
**Date:** 2026-06-19  
**Auditor:** story a1-audit-plugin-install-payload  

---

## Summary

| Metric | Value |
|--------|-------|
| Total tracked files | 2,179 |
| Total tracked bytes | ~15.5 MB |
| Maintainer-only files | ~1,313 (60%) |
| Maintainer-only bytes | ~8.6 MB (55%) |
| Runtime-required files | ~564 (26%) |
| Ambiguous files | ~302 (14%) |

Every tracked file ships to every consumer at install time via git clone. There is no native packaging manifest for Claude Code plugins. The `.gitignore` blanket-ignores `.pHive/*` but re-allowlists large maintainer-planning trees via per-epic negation rules, delivering ~7.9 MB of `.pHive` content alone.

---

## Tracked Top-Level Paths

| Path | Files | Bytes | Classification | Reason |
|------|-------|-------|----------------|--------|
| `.pHive/` | 1,154 | 7,896,349 | **mixed** | see subtree table below |
| `hive/` | 556 | 3,349,864 | runtime-required | core library, commands, agent configs |
| `skills/` | 166 | 1,218,388 | runtime-required | consumer-facing skill definitions |
| `tests/` | 137 | 1,137,394 | maintainer-only | test suite; consumers don't run it |
| `assets/` | 46 | 1,382,298 | runtime-required | images referenced by skills/docs |
| `.hive/` | 57 | 96,084 | maintainer-only | developer implementation insights only |
| `.github/` | 15 | 70,105 | maintainer-only | CI/CD workflows and PR templates |
| `scripts/` | 12 | 120,151 | maintainer-only | maintainer utility scripts |
| `hooks/` | 8 | 47,540 | runtime-required | Claude Code hook entrypoints |
| `docs/` | 2 | 46,164 | mixed | operations-guide: ambiguous; reports/: maintainer-only |
| `lib/` | 2 | 18,974 | runtime-required | runtime library code |
| `maintainer-skills/` | 2 | 16,572 | maintainer-only | meta-meta-optimize, meta-shotgun (internal) |
| `.claude-plugin/` | 2 | — | runtime-required | plugin.json + marketplace.json manifests |
| `CHANGELOG.md` | 1 | 72,087 | runtime-required | standard distribution file |
| `package-lock.json` | 1 | 67,407 | ambiguous | needed to install Node bridge deps |
| `package.json` | 1 | — | ambiguous | needed to install Node bridge deps |
| `README.md` | 1 | 7,603 | runtime-required | standard distribution file |
| `LICENSE` | 1 | 10,853 | runtime-required | required |
| `GUIDE.md` | 1 | — | runtime-required | consumer-facing guide |
| `CONTRIBUTING.md` | 1 | 6,149 | ambiguous | useful for contributors; not for consumers |
| `hive.config.yaml` | 1 | 13,365 | runtime-required | consumer default config baseline |
| `.gitignore` | 1 | 10,856 | ambiguous | needed in repo; irrelevant to consumers |
| `.mcp.json` | 1 | — | runtime-required | MCP server config |
| `.sandcastle` | 1 | 8,468 | runtime-required | sandcastle execution config |
| `.hive-dispatch` | 1 | — | runtime-required | dispatch config |
| `.coderabbit.yaml` | 1 | — | maintainer-only | code review bot config |
| `.markdownlint*` | 2 | — | maintainer-only | linting configs |
| `.yamllint.yml` | 1 | — | maintainer-only | linting config |
| `CODE_OF_CONDUCT.md` | 1 | — | ambiguous | standard; not consumer runtime |

---

## `.pHive/` Subtree Classification

| Subtree | Files | Bytes | Classification | Reason |
|---------|-------|-------|----------------|--------|
| `.pHive/epics/` | 644 | 5,477,254 | **maintainer-only** | 44 epic planning trees; sprint/story YAMLs |
| `.pHive/episodes/` | 378 | 1,832,421 | **maintainer-only** | 14 per-story dev run logs; agent episode records |
| `.pHive/meta-team/` | 18 | 102,770 | **maintainer-only** | maintainer's internal agent team config |
| `.pHive/metrics/` | 17 | 88,117 | **ambiguous** | schema docs + test fixtures for hive/lib/metrics/ unit tests |
| `.pHive/test-scenarios/` | 13 | 74,175 | **ambiguous** | referenced by autonomous-cycle-loop; unclear consumer need |
| `.pHive/cycle-state/` | 13 | 50,326 | **maintainer-only** | maintainer's per-epic planning cycle state |
| `.pHive/audits/` | 28 | 57,879 | **maintainer-only** | mvl-proof, mvs-proof, post-run, smoke-test audit trails |
| `.pHive/specialist-phases/` | 6 | 64,823 | **maintainer-only** | security/perf audit verdict records |
| `.pHive/proposals/` | 4 | 62,462 | **maintainer-only** | language-strategy ADRs; internal architecture decisions |
| `.pHive/upstream-watch/` | 4 | 13,180 | **maintainer-only** | maintainer's upstream blocker tracking |
| `.pHive/teams/` | 8 | 14,660 | **ambiguous** | team definitions; may be consumed by hive runtime |
| `.pHive/team-memories/` | 6 | 1,161 | **ambiguous** | maintainer agent memories or runtime template |
| `.pHive/multica/` | 4 | 11,790 | **ambiguous** | multica integration config; runtime only for multica consumers |
| `.pHive/triage/queue.yaml` | 1 | 3,357 | **maintainer-only** | maintainer's issue triage queue |
| `.pHive/research/` | 1 | 13,652 | **maintainer-only** | internal research notes |
| `.pHive/research-drafts/` | 1 | 6,099 | **maintainer-only** | internal draft research |
| `.pHive/CONTEXT.md` | 1 | 9,094 | **ambiguous** | domain glossary; useful to consumers who extend the plugin |
| `.pHive/cross-cutting-concerns.yaml` | 1 | 7,447 | **maintainer-only** | internal planning artifact |
| `.pHive/hive.config.yaml` | 1 | 914 | **runtime-required** | consumer-side config overlay |
| `.pHive/runtime/executor-graduated-workflows.yaml` | 1 | 3,054 | **runtime-required** | consumer-side executor flag |
| `.pHive/project-profile.yaml` | 1 | 732 | **ambiguous** | possibly consumer-configurable profile |
| `.pHive/meta/.gitkeep` | 1 | 0 | **ambiguous** | marker for /find-skills output dir |
| `.pHive/smoke` | 1 | 81 | **maintainer-only** | smoke test artifact |
| `.pHive/test-fixtures/` | 1 | 901 | **maintainer-only** | internal test fixtures |

---

## Allowlisted `.pHive` Subtrees (`.gitignore` force-re-track)

The `.gitignore` blanket-ignores `.pHive/*` then uses 40+ negation rules to re-allowlist these maintainer trees. All ship to consumers.

### `.pHive/epics/` — 44 epic directories

```
meta-improvement-system, hive-composability-audit, catalog-hygiene-and-borrows,
structural-refactor-and-gate-lift, task-tracking-adapter-abi,
ui-cluster-extract-config-deeper, sandcastle-adoption-followon,
brand-system-2.0-update, kg-signal-revival, sandcastle-ops-layer,
meta-hive-grooming-may2026, ui-logo-imagegen-integration,
claude-in-sandcastle-switch, sandcastle-gh-issue-dispatch,
exec-discipline-may2026, skill-ergo-may2026, per-epic-branch-pr-flow,
ghcr-sandcastle-image, hermes-integration-mvp, wire-execute-multica-codex,
smoke-test-execute-multica-codex, substrate-coverage-and-test-cleanup,
multica-substrate-adoption, multica-execute-routing, multica-integration-fixes,
meta-improvement-reset, story-loop-closure, multica-substrate-deepen,
multica-plan-test-cycles, cc-workflows-first-party, release-lifecycle,
multica-insight-capture, squad-leader-status-flip, state-dir-resolver,
kg-repair-activation, hive-composability-design, changelog-human-summaries,
artifact-lifecycle, dynamic-planning-team, plugin-hygiene,
autonomous-cycle-loop, external-model-integration, kg-augmented-meta-signal,
metrics-as-planning-concern
```

### `.pHive/episodes/` — 14 episode directories

```
meta-improvement-system, sandcastle-adoption-followon, hermes-integration-mvp,
wire-execute-multica-codex, smoke-test-execute-multica-codex,
substrate-coverage-and-test-cleanup, multica-integration-fixes,
cc-workflows-first-party, state-dir-resolver, task-tracking-adapter-abi,
autonomous-cycle-loop, hive-dag-executor, kg-augmented-meta-signal,
kg-repair-activation, memory-autonomy-foundation
```

---

## Maintainer-Only Payload: Size Ranking

| Rank | Path | Files | Bytes | % of total |
|------|------|-------|-------|------------|
| 1 | `.pHive/epics/` | 644 | 5,477,254 | 35% |
| 2 | `.pHive/episodes/` | 378 | 1,832,421 | 12% |
| 3 | `tests/` | 137 | 1,137,394 | 7% |
| 4 | `.pHive/meta-team/` | 18 | 102,770 | <1% |
| 5 | `scripts/` | 12 | 120,151 | <1% |
| 6 | `.hive/insights/` | 57 | 96,084 | <1% |
| 7 | `.pHive/specialist-phases/` | 6 | 64,823 | <1% |
| 8 | `.pHive/proposals/` | 4 | 62,462 | <1% |
| 9 | `.github/` | 15 | 70,105 | <1% |
| 10 | `.pHive/audits/` | 28 | 57,879 | <1% |

**Maintainer-only subtotal: ~1,313 files / ~8.6 MB (55% of payload)**

Top 2 entries (`.pHive/epics/` + `.pHive/episodes/`) account for **7.3 MB / 47% of total payload** and will grow with every new epic.

---

## Remediation Options

### Option A: Untrack (git rm --cached + gitignore expansion)

**Applies to:** `.pHive/epics/`, `.pHive/episodes/`, `.pHive/meta-team/`, `.pHive/specialist-phases/`, `.pHive/proposals/`, `.pHive/audits/`, `.pHive/cycle-state/`, `.pHive/upstream-watch/`, `.pHive/triage/`, `.pHive/research/`, `.pHive/research-drafts/`, `.pHive/cross-cutting-concerns.yaml`, `.hive/insights/`, `maintainer-skills/`, `docs/reports/`, `tests/`, `.github/`, `scripts/`, lint configs

**Mechanism:**
```sh
git rm --cached -r .pHive/epics/ .pHive/episodes/ ...
# add paths to .gitignore (remove negation rules)
git commit -m "chore: untrack maintainer-only payload from consumer install"
```

**Trade-off:**
- Pros: Zero consumer payload; cleanest; no tooling changes.
- Cons: Maintainer loses git history visibility for those trees unless a separate maintenance branch or repo hosts them. Reverting is easy (re-add to .gitignore allowlist) but requires discipline to not re-add them.
- Largest risk: teams currently link to `.pHive/epics/<id>/` paths in comments; those links break in clones without the trees.

### Option B: Separate maintainer repository

**Applies to:** all maintainer-only trees

**Mechanism:** Move `.pHive/epics/`, `.pHive/episodes/`, `.hive/`, etc. to a private `plugin-hive-internal` repo. Reference from the main repo via README link only.

**Trade-off:**
- Pros: Clean separation; maintainer tooling can evolve independently.
- Cons: Higher operational cost (two repos to manage); cross-referencing history is harder; existing tooling (hive daemon, multica dispatch) writes episode/epic YAMLs into the same working tree — those write paths would need updating.

### Option C: Packaging allowlist (files manifest)

**Mechanism:** Add a build step that copies only consumer-required files to a `dist/` directory or generates a `.claude-plugin/files.json` manifest; the plugin delivery mechanism reads this to do a sparse checkout.

**Trade-off:**
- Pros: Source tree unchanged; maintainer tooling unaffected.
- Cons: Claude Code plugin delivery is git clone with no native files manifest support — this requires upstream Claude Code support or a custom packaging workflow (e.g., a GitHub Action that publishes a trimmed release tag). Currently speculative unless the platform adds sparse-checkout support.

### Recommended approach

**Short term (immediate impact):** Option A for the largest contributors — untrack `.pHive/epics/` and `.pHive/episodes/` via `git rm --cached`. This alone removes 47% of payload. Tighten `.gitignore` to re-ignore the negation blocks for these two trees.

**Medium term:** Evaluate Option B for all of `.hive/` (insights) and `tests/` if the separate-repo overhead is acceptable. Option C should be parked until Claude Code adds packaging manifest support.

---

## Not Modified

This report is read-only. No `.gitignore` changes, no `git rm --cached` operations, no file moves were performed. All remediation is deferred to follow-on stories.
