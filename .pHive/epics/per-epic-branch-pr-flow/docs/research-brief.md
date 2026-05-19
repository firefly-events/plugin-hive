# Research brief — Per-epic branching + base=develop

**Epic:** `per-epic-branch-pr-flow`
**Source:** GH issue #175

## Goal

Switch Hive's sandcastle event-dispatch from per-story branching to per-epic stacking. Default PR base = configurable (`develop` if upstream exists, else `main`). Stories commit on the same `feat/<epic-id>` branch; epic gets one PR.

## Existing code surface (verified via `gh` + `git ls-tree`)

### Sandcastle dispatch surface (shipped 2.3.x)

- `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl` — GH Actions workflow. Triggers on `issues: labeled` + `if: github.event.label.name == 'hive:ready'`. Concurrency per-issue. Currently calls `gh pr create` post-run (per-issue PR).
- `skills/sandcastle-gh-init/assets/sandcastle-hive-bridge.mts.tpl` — bridge script. Hard-coded `branchStrategy: 'agent/issue-<n>'` in the `sandcastle.run()` call.
- `skills/sandcastle-gh-init/scaffold.mjs` — scaffolder for both above. No branch-strategy logic here; it just substitutes `RUNNER` + `SECRET_KEY`.
- `.hive-dispatch/manifest.yaml` — repo-local manifest. Will need additional fields for `git_flow.base_branch` + `git_flow.branch_strategy`.

### Hive config surface

- `hive.config.yaml` (root, repo-local override) + `hive/hive.config.yaml` (plugin defaults). Existing keys: `task_tracking.*`, `paths.*`, `planning.*`, `agent_backends`, `model_overrides`.
- No `git_flow` key yet. Add as a new top-level block with `default_pr_base` + (optionally) `branch_strategy: per-epic|per-story`.

### `/plan` skill emission surface

- `skills/plan/SKILL.md` Phase D + step 14 — writes epic.yaml + per-story YAMLs + cross-cutting concerns.
- No `base_branch` field on story YAML today. Needs schema extension in `hive/references/story-yaml-schema.md`.
- `/plan` already resolves config root-first per `hive/references/skill-prelude.md`, so `git_flow.default_pr_base` lookup follows existing precedence.

### Inner agent behavior (`/hive:execute`)

- `hive/skills/execute-dispatch/SKILL.md` + step files under `hive/skills/execute-mode-sandcastle/` — currently expects single-story scope. Last-story-of-epic detection is novel surface for the workflow.
- `/hive:execute` writes commits; integrate step is per-story. No per-epic counter today.

### Upstream branch state

- `origin/develop` exists (confirmed via `git branch -r`). So Hive itself can use `develop` as default base immediately.
- Most existing GH workflows target `main` directly — switching base to `develop` is a consumer choice. Hive provides the knob; doesn't impose it.

## Inconsistency-risk signals

1. **Memory feedback `feedback_git_flow_per_epic.md`** asserts "one branch per epic, one commit per story" is established policy — but the shipped sandcastle dispatch (PR #165) violates it with per-issue branches. This epic resolves the contradiction.
2. **PR-stacking vs. epic-tracker issues.** GH issue #156 was an "epic tracker" with linked story issues. Either model can work; the workflow should not require one over the other.
3. **Concurrency groups.** Workflow currently uses `concurrency: hive-issue-<n>`. With per-epic branches, two stories of the same epic landing concurrently would race on the branch — need `concurrency: hive-epic-<epic-id>` to serialize.
4. **PR draft → ready transition.** Promoting PR from draft to ready on last-story completion requires the workflow to know the epic's total story count. Source = `.pHive/epics/<epic-id>/epic.yaml` (in-repo), or query GH issues by `hive:epic:<id>` label and count shipped vs. open.

## Library / SDK validation (context7)

No external library introduces the gap — this is workflow-template + scaffolder-template + step-file work. Sandcastle 0.5.x's `branchStrategy` supports arbitrary string templates (verified in `@ai-hero/sandcastle@0.5.10` types). No SDK migration needed.

## Open questions for design discussion

1. Detection model for "last story of epic" — `epic.yaml`-derived count vs. GH label query? (Recommend epic.yaml — single source of truth, no GH round-trip.)
2. Stacking order — sequential serial (story B waits for story A's PR commit) vs. dependency-graph parallel? With `depends_on`, sandcastle workflow can branch per-story-pickup as long as the merge commits land on the epic branch in dep order.
3. PR open/update semantics — open as draft on first story, update body as each subsequent commit lands, promote to ready on last? Or one PR per slice (V slices)?
4. Migration path for in-flight epics (sandcastle-gh-issue-dispatch shipped per-story; future epics use per-epic). Cleanly versioned in the workflow template; in-flight epics finish on old contract.
