# Design discussion — Per-epic branching + base=develop

**Epic:** `per-epic-branch-pr-flow`
**Methodology:** classic
**Scale:** medium (multi-file, multi-layer: workflow YAML + bridge .mts + config schema + step files + docs). H/V skipped per `--fast`-equivalent — slice is naturally vertical (each story is independently shippable).

## Goal

Move Hive's autonomous dispatch from per-story PRs to per-epic stacking. Each epic gets:

- One branch: `feat/<epic-id>`
- One commit per story (already established policy in memory feedback)
- One PR targeting a configurable base (`git_flow.default_pr_base`, default `develop` if upstream exists else `main`)
- PR opens as draft on first story; promotes to ready when the last story flips `hive:shipped`

## Proposed approach

### 1. Config schema (`pe-1-config-schema`)

Add `git_flow` block to `hive.config.yaml`:

```yaml
git_flow:
  default_pr_base: auto           # auto | <branch-name>; "auto" = develop-if-exists else main
  branch_strategy: per-epic       # per-epic | per-story (back-compat)
```

Resolution helper at `hive/lib/git_flow.mjs`: reads root-first config, then probes `git rev-parse --verify origin/<base>` for `auto`. Returns `{ base_branch, branch_strategy }`.

### 2. Bridge template — branch name per epic (`pe-2-bridge-epic-branch`)

`skills/sandcastle-gh-init/assets/sandcastle-hive-bridge.mts.tpl` reads the issue's `hive:epic:<epic-id>` label, derives branch name:

```ts
const epicId = labels.find(l => l.startsWith('hive:epic:'))?.slice(11);
const branchName = epicId ? `feat/${epicId}` : `agent/issue-${issueNumber}`;  // fallback for un-epic'd issues
```

Passes to `sandcastle.run({ branchStrategy: branchName })`. Sandcastle handles checkout-or-create.

### 3. Workflow template — stack + PR-update (`pe-3-workflow-stack-pr`)

`skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl` changes:

- Concurrency group: `hive-epic-<epic-id>` (derived from labels at job start)
- Base branch: resolved by `hive/lib/git_flow.mjs` (workflow shells out to a small JS helper)
- After bridge run, query for existing open PR with head `feat/<epic-id>` and base `<resolved-base>`:
  - **No existing PR:** `gh pr create --draft --base <base> --head feat/<epic-id>`
  - **Existing open PR:** `gh pr edit --add-body` (append new story summary) — no new PR
- Last-story detection (see §4 below). If last → `gh pr ready`.

### 4. Last-story-of-epic detection (`pe-4-pr-ready-on-last`)

Workflow step counts story issues:

```bash
total=$(gh issue list --label "hive:epic:${EPIC_ID}" --state all --json number -q '. | length')
shipped=$(gh issue list --label "hive:epic:${EPIC_ID}" --label "hive:shipped" --state closed --json number -q '. | length')
if [ "$shipped" = "$total" ]; then gh pr ready "feat/${EPIC_ID}"; fi
```

Edge case: epic without an epic-tracker issue. Count only stories with `hive:story:<id>` label that share `hive:epic:<id>`.

### 5. `/plan` emits `base_branch` per epic (`pe-5-plan-emit-base`)

`/plan` step 15 (epic-index write) populates `epic.yaml`:

```yaml
git_flow:
  base_branch: develop            # resolved at plan time
  branch_strategy: per-epic
```

Sandcastle bridge reads `epic.yaml` when present (preferred over global config). Falls back to global config if epic was created before this story shipped.

### 6. Docs (`pe-6-docs`)

Update:

- `README.md` "Autonomous worker loop" section — call out per-epic flow + base-branch knob.
- `hive/references/sandcastle-gh-dispatch.md` — new runbook section "Branching model" between sections 2 and 3.
- `CHANGELOG.md` — new dated section for the version bump (minor — additive consumer-visible).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| In-flight epics on per-story contract get half-converted | Medium | `branch_strategy: per-story` config back-compat. Default new epics to `per-epic`; consumer can pin `per-story` for legacy. |
| Concurrent stories of same epic race the branch | High | Workflow concurrency group keyed on `hive-epic-<id>`. Serializes story landings per epic. |
| PR description grows unbounded as stories land | Low | Edit appends a single line per story (`- ✅ <story-id>: <title>`). Truncate at 25 stories with a "see commits" pointer. |
| `auto` base resolution differs between local and CI | Medium | Resolve via `git rev-parse --verify origin/develop` (origin-aware). Cache in `epic.yaml.git_flow.base_branch` at plan time so all subsequent workflow runs see the same value. |
| Consumers without `origin/develop` get surprising `main` base | Low | `auto` is opt-in only when `git_flow` is absent from config. Falling back to `main` matches today's behavior — no regression. |

## Dependencies

- Sandcastle 0.5.x already supports arbitrary `branchStrategy` strings (verified). No SDK upgrade needed.
- No breaking schema changes to existing in-flight epics — `branch_strategy: per-story` (today's behavior) remains valid.

## Open questions

1. Should the workflow auto-merge the epic PR when promoted to ready, or require human review? **Recommendation:** human review (current sandcastle behavior). Auto-merge is a follow-on epic.
2. Should `/plan` warn when consumer's `git_flow.default_pr_base` doesn't exist on origin? **Recommendation:** warn-not-block — consumer may be intentionally targeting a future branch.
3. What about cherry-pick or hotfix workflows? **Out of scope** — those use direct PRs, not Hive dispatch.

## Scale assessment

**Medium**, leaning small. 5 stories, 8-10 files, no cross-system changes. H/V skipped — vertical slice is the story unit itself.
