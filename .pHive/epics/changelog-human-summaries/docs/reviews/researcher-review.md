REVIEW: researcher
VERDICT: approve-with-escalation
COMMENTS:

## Accuracy Assessment

The research brief and design discussion accurately represent the raw findings. All key patterns, constraints, and risks from `research-findings-raw.md` are faithfully carried forward. No fabrication or material omission found.

Specific confirmations:
- Brief §2 table correctly identifies the 6 key files and their roles.
- Brief §3 patterns accurately summarize the execute-7e-mechanical-line and manual-chore-release patterns.
- Brief §4 constraints are correct (append-only, Unreleased-before-ship, step-7e-owns-bump-write, release_post-separation).
- Design discussion §2 "What I Found" accurately distills the findings without distortion.
- The quality classification (~50% strong, ~50% thin) is consistent with the full `ENTRY QUALITY CLASSIFICATION` section in raw findings.

One gap: the brief and design discuss `release_post.mjs` at a high level but do not mention that `shippedStories` data source is unconfirmed — the raw findings flagged this as an UNANSWERED_QUESTION but neither document escalates it to a constraint.

---

## Grill Finding U1 — Step 7e Ghost: CONFIRMED GHOST

**Evidence from `git log --follow -p -- CHANGELOG.md`:**

```
grep 'release finalization' CHANGELOG.md → (no output — zero matches)
```

All CHANGELOG.md commits in the git log are:
- `chore(release): prepare v2.11.0 — version bump, changelog, status reconcile`
- `chore(release): bump version 2.9.0 → 2.10.0`
- `chore(release): amend 2.9.0 changelog with full multi-epic scope`
- `h-05: bump plugin version to 2.8.0 — hermes-integration-mvp epic close`
- `docs(multica): smoke + README/GUIDE/CHANGELOG + v2.7.0 — s5`
- `docs(ghcr-sandcastle-image): gi-3 README + runbook + CHANGELOG + 2.5.0 bump`
- (and similar manual/docs commits for all other versions)

The string "release finalization" has **never appeared in any committed CHANGELOG.md entry** in the repository's full history. Step 7e's template line is a confirmed ghost — it is never written in the normal release flow. All CHANGELOG entries are manually authored, either via `chore(release)` commits by maintainers or by agent docs-step commits.

**Design implication (HIGH RISK confirmed):** Step A as written (extending execute step 7e) proposes modifying a callsite that does not fire in practice for the normal release flow. The planner must pivot: the correct authoring hook is the `chore(release)` commit process or a new dedicated step — not step 7e.

---

## Grill Finding H1 — Story YAML `outcome:` Fields: NOT POPULATED

**Evidence from sampling shipped story YAMLs:**

Sampled 3 shipped story YAMLs across 2 epics:
- `.pHive/epics/release-lifecycle/stories/rl-4-version-bump-flow.yaml` (shipped, v2.10.0)
- `.pHive/epics/exec-discipline-may2026/stories/ed-4-drift-status-surface.yaml` (shipped)
- `.pHive/epics/exec-discipline-may2026/stories/ed-3-drift-metric-emit.yaml` (shipped)

```
grep 'outcome' rl-4-version-bump-flow.yaml → (no output — field absent)
grep 'outcome' ed-4-drift-status-surface.yaml → (no output — field absent)
grep 'outcome' ed-3-drift-metric-emit.yaml → (no output — field absent)
```

Story YAML schema contains: `id`, `epic`, `title`, `status`, `shipped_at`, `release_id`, `complexity`, `methodology`, `depends_on`, `description`, `acceptance_criteria`, `steps`, `context`. **No `outcome:` field exists in any sampled YAML.**

**Design implication (MEDIUM RISK confirmed):** The design assumption that `shippedStories[].outcome` is available from story YAML at step 7e execution time is false. `release_post.mjs` likely synthesizes `outcome` from story `title` + `acceptance_criteria` + `description` at ship time, not from a pre-populated field. Any prose-authoring step that relies on `outcome` fields will find them empty or absent and will produce hallucinated or blank bullets.

The planner must either: (a) define when/how `outcome` is populated (a new field requirement), (b) direct the authoring agent to derive prose from `title` + `acceptance_criteria`, or (c) require human-authored content at chore(release) time.

---

## Missing from Codebase Analysis

One gap not surfaced in the raw findings or brief: the design treats `/plan` as a passive recorder of `version_bump` intent but does not address whether `/plan` could also capture a draft `changelog_summary` field per story at planning time. If each story YAML received a one-line outcome statement at plan time (author: agent or human), step 7e would have the data it needs. This is a design option the brief omits.

Additionally: the raw findings did not check `hive/workflows/steps/development-classic/step-08-integrate.md` (noted as an UNANSWERED_QUESTION in raw findings), which is directly relevant to the per-story vs per-epic aggregation question. This remains unresolved.
