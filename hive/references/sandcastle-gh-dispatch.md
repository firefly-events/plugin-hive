# Sandcastle GitHub-Issue Dispatch — Maintainer Runbook

**Epic:** `sandcastle-gh-issue-dispatch`
**Skill:** [`/hive:sandcastle-gh-init`](../../skills/sandcastle-gh-init/SKILL.md)
**Version introduced:** 2.3.0
**Related:** [`sandcastle-ops-loop.md`](sandcastle-ops-loop.md) (cron-based predecessor), [`sandcastle-adoption-guide.md`](sandcastle-adoption-guide.md)

Event-driven autonomous dispatch on top of Sandcastle. Labeling an issue
`hive:ready` fires a GitHub Actions workflow that runs `/hive:execute`
inside a Sandcastle container, opens a PR, and flips the canonical label
state machine.

This is the maintainer-facing reference for installing, operating, and
debugging the dispatch surface. Consumer-facing onboarding lives in the
skill SKILL.md; the [design discussion](../../.pHive/epics/sandcastle-gh-issue-dispatch/docs/design-discussion.md)
captures the rationale.

---

## Contents

1. [Install the dispatch surface](#1-install-the-dispatch-surface)
2. [Label state machine](#2-label-state-machine)
3. [Branching model](#3-branching-model)
4. [Rotate the agent secret](#4-rotate-the-agent-secret)
5. [Switch the workflow runner](#5-switch-the-workflow-runner)
6. [Lock label permissions on a public repo](#6-lock-label-permissions-on-a-public-repo)
7. [Future-labels extension point](#7-future-labels-extension-point)
8. [Debug a stuck `hive:in-flight` label](#8-debug-a-stuck-hivein-flight-label)
9. [Workflow vs bridge ownership](#workflow-vs-bridge-ownership)

---

## 1. Install the dispatch surface

The skill assumes Sandcastle is already initialized in the target repo
(`.sandcastle/Dockerfile` or `.sandcastle/Containerfile` present). It
only layers the GitHub-event-trigger glue on top.

1. **Initialize Sandcastle first.** Run `npx sandcastle init` in the
   consumer repo and pick provider (Docker / Podman / Vercel), template,
   and backlog manager. `/hive:sandcastle-gh-init` exits `2` with a
   remediation message if neither `.sandcastle/Dockerfile` nor
   `.sandcastle/Containerfile` is present. Sandcastle 0.5.x ships a
   Podman-style `Containerfile`; older / Docker-native installs ship
   `Dockerfile`. Either satisfies the prereq.
2. **Authenticate `gh`.** The skill probes `gh auth status` before
   writing. Run `gh auth login` if not authenticated.
3. **Run the skill.**

   ```bash
   /hive:sandcastle-gh-init                       # ubuntu-latest + anthropic
   /hive:sandcastle-gh-init --runner self-hosted  # custom runner
   /hive:sandcastle-gh-init --secret-mode openai  # OPENAI_API_KEY instead
   ```

   Outputs:
   - `.github/workflows/hive-dispatch.yml`
   - `.github/scripts/sandcastle-hive-bridge.mts`
   - `.hive-dispatch/manifest.yaml`

   The skill stages and commits these three files as a single
   `chore(hive): wire github-issue dispatch via sandcastle` commit on the
   current branch. Nothing under `.sandcastle/` is touched.
4. **Set the API-key secret.** Per the skill's `--secret-mode` choice:

   ```bash
   gh secret set ANTHROPIC_API_KEY    # default
   gh secret set OPENAI_API_KEY       # --secret-mode openai
   ```

   `GITHUB_TOKEN` is provided automatically by Actions and covers the
   workflow scopes (`issues: write`, `pull-requests: write`,
   `contents: write`).
5. **Verify canonical labels exist.** The skill warns (non-blocking) if
   any of `hive:ready`, `hive:in-flight`, `hive:shipped`, `hive:failed`
   are missing and prints copy-pasteable `gh label create` commands. Run
   them now — the workflow needs all four to execute the state machine.
6. **Smoke test.** Open a throwaway issue, ensure it carries enough
   context for `/hive:execute` (or pin via the worker's story-YAML
   resolution), label it `hive:ready`, and watch the workflow run.

---

## 2. Label state machine

| Label             | Meaning                                          | Set by                  |
|-------------------|--------------------------------------------------|-------------------------|
| `hive:ready`      | Spec'd, human-approved, ready for autonomous pickup | Human (trigger)      |
| `hive:in-flight`  | Workflow claimed the issue                       | Workflow YAML (claim step) |
| `hive:shipped`    | Worker opened a PR                               | Workflow YAML (success step) |
| `hive:failed`     | Worker exited non-shipped                        | Workflow YAML (`if: failure()`) |

**Workflow YAML owns every transition** — not the bridge, not the inner
Hive agent. This is load-bearing: if the bridge crashes, the
`if: failure()` step still fires and transitions
`hive:in-flight` → `hive:failed`. A worker process exit can never strand
an issue in `hive:in-flight` as long as the workflow itself terminates.

Topic labels (`hive:epic:<id>`, `hive:story:<id>`, `hive:blocked-by:<id>`)
are orthogonal to this state machine and the workflow ignores them.

Only `hive:ready` triggers a run. The workflow's step-level
`if: github.event.label.name == 'hive:ready'` guard makes other `hive:*`
labels — including the worker setting `hive:in-flight` — no-ops at the
`on: issues:[labeled]` dispatch level.

---

## 3. Branching model

*Added in 2.4.0 (per-epic-branch-pr-flow epic, stories pe-1 through pe-5).*

The dispatch workflow + bridge stack stories of the same epic onto a single branch and produce one PR per epic — instead of the legacy one-branch-per-issue + one-PR-per-issue path. This section is the maintainer reference for how that resolution works, where the overrides live, and how to fall back when an in-flight epic predates the change.

### 3.1 Default behavior

When a `hive:ready` issue carries a `hive:epic:<epic-id>` label:

- **Branch.** The bridge derives `branch = feat/<epic-id>` (instead of `agent/issue-<n>`). The first story of the epic creates the branch; later stories push to the same branch.
- **Base.** `resolveGitFlow({ cwd })` (`hive/lib/git_flow.mjs`) is called at dispatch time. With `default_pr_base: auto` (the shipped default), the helper probes `git rev-parse --verify origin/develop` and returns `develop` on success, `main` otherwise.
- **PR.** The workflow opens a `--draft` PR on the first story (title `[epic] <epic-id>`) and *edits the same PR's body* on subsequent stories — no second PR is created. The body is capped at 25 story entries with a "see commits" pointer.
- **Promotion.** When the last `hive:story:*` issue of the epic flips to `hive:shipped`, the workflow calls `gh pr ready "feat/<epic-id>"`, moving the PR out of draft.

Issues without a `hive:epic:*` label keep the legacy `agent/issue-<n>` branch + one-shot PR path. No behavior change for non-epic issues.

### 3.2 Override knob

Pin the resolution explicitly via the root `hive.config.yaml`:

```yaml
git_flow:
  default_pr_base: auto         # auto | <branch-name>; "auto" = develop if origin/develop exists, else main
  branch_strategy: per-epic     # per-epic | per-story (back-compat)
```

Examples:

- `default_pr_base: develop` forces every epic PR's base to `develop`, even if the repo also has `main`.
- `default_pr_base: main` pins to `main` and skips the `origin/develop` probe.
- `default_pr_base: dev/hive-2.0` lets you point all epic PRs at an integration branch for a milestone.

The bridge prefers a pinned value in the epic's `.pHive/epics/<epic-id>/epic.yaml` (emitted by `/plan` Phase A 0a — see `hive/references/story-yaml-schema.md` §5) over the live config, so a config drift mid-epic does not retroactively shift the branching target.

### 3.3 Back-compat — `branch_strategy: per-story`

In-flight epics that started before 2.4.0 may have already opened `agent/issue-<n>` branches and one-PR-per-issue. Switching them to per-epic mid-flight would orphan those branches. Set `branch_strategy: per-story` to restore the legacy path:

```yaml
git_flow:
  branch_strategy: per-story
```

In this mode the bridge emits a one-line warning when it encounters a `hive:epic:*` label (so reviewers can see the epic intent was acknowledged but bypassed) and falls back to `agent/issue-<n>` for every story.

### 3.4 Concurrency semantics

The workflow's job-level `concurrency.group` is **epic-scoped, not issue-scoped**:

| Issue carries | `concurrency.group` resolves to |
|---|---|
| `hive:epic:<id>` | `hive-epic-<id>` |
| no `hive:epic:*` label | `hive-issue-<n>` (legacy fallback) |

`cancel-in-progress: false` queues subsequent stories of the same epic instead of cancelling the active one — load-bearing for the stacked-PR invariant (two concurrent stories of the same epic racing the branch checkout would corrupt the stacked commits).

The derivation lives in a tiny upstream `derive` job because GitHub Actions evaluates `concurrency.group` before the consuming job's steps run, so step env/outputs of the same job are unavailable there. The heavy `run` job declares `needs: derive` and reads `${{ needs.derive.outputs.concurrency_key }}`.

### 3.5 PR lifecycle

| Phase | Event | PR state |
|---|---|---|
| First story of epic ships | bridge pushes `feat/<epic-id>`; workflow opens `--draft` PR | Draft |
| Each subsequent story ships | workflow edits PR body (`gh pr edit "$PR_NUMBER" --body "$NEW_BODY"`) | Draft (still) |
| Last story of epic ships | promote step counts shipped vs total; on parity calls `gh pr ready "feat/<epic-id>"` | Ready |

The promotion gate is `(shipped_count == total_count)` where `total_count = gh issue list --label "hive:epic:<id>" --label "hive:story:*" --state all` (the `hive:story:*` filter excludes any epic-tracker issue). A `0/0` result is treated as a label-propagation anomaly and does **not** promote — keeps the false-positive ready-flip rate at zero.

---

## 4. Rotate the agent secret

The dispatch workflow reads `ANTHROPIC_API_KEY` (default) or
`OPENAI_API_KEY` (with `--secret-mode openai`) from repo secrets. The
bridge passes it into the Sandcastle container at run time; the existing
[`sandcastle-log-redaction.js`](../../hive/lib/sandcastle-log-redaction.js)
strips it from sandbox stdout.

### Rotation procedure

1. Mint the new key in the provider dashboard (Anthropic Console or
   OpenAI Platform).
2. Update the GitHub secret:

   ```bash
   gh secret set ANTHROPIC_API_KEY    # paste new value at prompt
   ```

   The change is atomic — the next workflow run reads the new value; any
   in-flight run still holds the old value in its environment.
3. Wait for any in-flight runs to complete (watch the `hive:in-flight`
   labels), then revoke the old key in the provider dashboard. Do not
   revoke before in-flight drains, or queued runs will fail with auth
   errors after the next cron / label event.
4. Smoke test by labeling a low-stakes issue `hive:ready` and confirming
   the workflow succeeds end-to-end.

### Multi-key org policy

If your org rotates keys on a schedule, prefer GitHub Actions environment
secrets over repo secrets so rotation is centralized. The workflow's
`env:` block reads `secrets.<NAME>` — environment secrets shadow repo
secrets when the job pins an environment.

---

## 5. Switch the workflow runner

The skill scaffolds `runs-on: ubuntu-latest` by default. Two upgrade
paths:

### Podman / self-hosted runners

For consumers whose security posture requires Podman (rootless containers,
no Docker daemon), self-hosted runners, or a specific OS image:

1. Re-run the skill with `--runner self-hosted` (overwrites the workflow):

   ```bash
   /hive:sandcastle-gh-init --runner self-hosted
   ```

   The skill rewrites only the three managed files. Custom edits outside
   them survive.
2. Confirm the runner has the dependencies the workflow assumes:
   - **Node 22** (the workflow's `actions/setup-node@v4` step installs
     it, but self-hosted runners may need build tools available for
     native dependencies).
   - **Docker or Podman** depending on the provider chosen at
     `npx sandcastle init`. If Podman, set `DOCKER_HOST` to the Podman
     socket or alias `docker` to `podman` on the runner image.
   - **`gh` CLI** — preinstalled on `ubuntu-latest`; install manually on
     self-hosted images.
3. Tune `timeout-minutes` if your runner is slower than GitHub-hosted —
   `60` is the default ceiling.

### Pinning to a specific GitHub-hosted image

Edit `runs-on:` directly in `.github/workflows/hive-dispatch.yml` to e.g.
`ubuntu-22.04` if you need a specific OS version. The skill will
overwrite this on re-run; record the pin in a separate workflow or in a
manifest extension if you need it to survive scaffolding.

---

## 6. Lock label permissions on a public repo

**`hive:ready` is a remote-code-execution trigger on a public repo.** Any
contributor with `triage` permission or above can apply a label, which
fires `/hive:execute` against the repo's contents with the maintainer's
API budget. Lock this down before merging the workflow.

### Recommended posture

1. **Settings → Collaborators and teams → Manage access** — restrict the
   `triage` and `write` roles to trusted accounts. Default repo
   permissions for outside collaborators should be `read` only.
2. **Use a label-scoped GitHub App / fine-grained PAT** for label
   management. Settings → Actions → General — set "Workflow permissions"
   to "Read repository contents and packages permissions" and grant
   `issues: write` only via the workflow's `permissions:` block. The
   shipped template already pins to the minimum scopes.
3. **Auto-revoke on fork events.** Forks cannot apply labels to the
   parent repo's issues, so the trigger is structurally safe from fork
   PRs. The risk surface is direct repo contributors with triage perms,
   not external forkers.
4. **Future hardening (not shipped):** add an actor-permission guard at
   the first step:

   ```yaml
   - name: Verify actor permission
     env:
       GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     run: |
       PERM=$(gh api repos/${{ github.repository }}/collaborators/${{ github.event.sender.login }}/permission --jq .permission)
       if [[ "$PERM" != "admin" && "$PERM" != "write" ]]; then
         echo "::error::Actor $GITHUB_ACTOR lacks write permission; refusing to run."
         exit 1
       fi
   ```

   Place this step between `Claim issue` and `actions/checkout`. It costs
   one API call per fire and bounces unauthorized labelers. The v1
   template ships without this guard; add it if your repo's triage role
   is broader than your trust boundary.
5. **Budget ceiling.** Set `tokens.daily_usd_limit` in `hive.config.yaml`
   so a label-spam incident has a hard cost cap. See
   [`sandcastle-ops-loop.md` §"Opt-in checklist"](sandcastle-ops-loop.md)
   for the cron-loop's budget gate; the dispatch surface inherits the
   same posture via the inner `/hive:execute` call.

---

## 7. Future-labels extension point

The v1 scope ships exactly one dispatch route: `hive:ready` →
`/hive:execute`. Future labels (`hive:plan`, `hive:test`, `hive:review`)
are intentionally out of scope.

When extending:

1. **Add a sibling `if:` route in `.github/workflows/hive-dispatch.yml`.**
   Each label gets its own `job` (or its own conditional step inside the
   existing `run:` job) gated by
   `if: github.event.label.name == 'hive:<new-label>'`. The job runs the
   same `actions/checkout` + `setup-node` + `npm ci` prelude, then
   invokes a different bridge script with a different prompt body.
2. **Add a sibling bridge script under `.github/scripts/`.** Copy
   `sandcastle-hive-bridge.mts` and change the `prompt:` field to invoke
   `/hive:plan`, `/hive:test`, etc. instead of `/hive:execute`. Bridge
   scripts are intentionally thin — they exist so the prompt body is
   reviewable in git, not buried in workflow YAML.
3. **Extend `.hive-dispatch/manifest.yaml`.** The `managed_files` list is
   the idempotent re-run allowlist. Add the new bridge script + any new
   workflow file so re-running `/hive:sandcastle-gh-init` doesn't strand
   the new route. The scaffold helper at
   [`scaffold.mjs`](../../skills/sandcastle-gh-init/scaffold.mjs)
   is the source of truth for the allowlist; extend it in lockstep.
4. **Update the state machine.** Each new label needs its own
   in-flight / success / failure transitions OR an explicit decision to
   reuse an existing one. The v1 design deliberately ships only the
   `ready → in-flight → shipped|failed` cycle; new labels should declare
   their own state machine in the design discussion before being wired.

The skill SKILL.md explicitly does **not** ship `--label` or
`--template` flags — the trigger label is a fixed Hive convention and
template choice belongs to upstream `npx sandcastle init`. Future-labels
support, when scoped, will be additive routes in the workflow YAML, not
new skill flags.

---

## 8. Debug a stuck `hive:in-flight` label

If `if: failure()` is doing its job, an issue should never stay in
`hive:in-flight` after the workflow run terminates. When you do see one,
work through this list in order:

1. **Find the workflow run.** Open the issue → "Linked workflow runs" in
   the sidebar, or:

   ```bash
   gh run list --workflow hive-dispatch.yml --limit 20
   gh run view <run-id> --log
   ```

   If the run is still in progress, the label is correct — wait.
2. **Read the run's failure step output.** The `On failure — label +
   comment` step prints the workflow log URL into the issue comment. The
   run's job log should show which step exited non-zero (claim, checkout,
   `npm ci`, the bridge, or the success transition).
3. **Read sandcastle container logs.** The bridge step's stdout contains
   the Sandcastle run output. Look for:
   - `idleTimeoutSeconds` exceeded — the agent ran out of activity time;
     consider raising `idleTimeoutSeconds` in the bridge script or
     splitting the work into smaller stories.
   - `maxIterations: 5` exceeded — the agent looped without converging.
     Inspect the iteration logs for a stuck phase (often a failing test
     gate); fix the story spec.
   - Auth errors (`401`, `403`) — the API-key secret is missing or
     revoked. See [§4 Rotate the agent secret](#4-rotate-the-agent-secret).
   - `HIVE_EXECUTION_MODE: team` ignored — inner Hive tried to spawn a
     nested sandcastle. File a Hive bug; the bridge sets the env var
     correctly and the inner orchestrator should honor it.
4. **Manually transition the label.** Once the workflow run has
   terminated, the label is yours to fix:

   ```bash
   gh issue edit <N> --remove-label hive:in-flight --add-label hive:failed
   gh issue comment <N> --body "Manually transitioned — workflow log: <url>"
   ```

   Do not transition to `hive:shipped` manually without a PR; downstream
   consumers (audits, status reports) treat the label as ground truth.
5. **Workflow run was cancelled mid-step.** The `if: failure()` step does
   not fire on user-initiated cancellation. Treat as a stuck label and
   follow step 4. Consider whether the cancellation was load-bearing —
   if the bridge had already opened a PR, label as `hive:shipped`.
6. **Concurrent labels raced.** Two `hive:ready` events on the same issue
   are serialized via `concurrency.group: hive-issue-<n>`. If you see
   `hive:in-flight` co-existing with a queued run, that's expected —
   `cancel-in-progress: false` preserves the active job and the queued
   run will fire after.

### Common bridge failures

| Symptom in bridge stdout | Likely cause | Fix |
|---|---|---|
| `ISSUE_NUMBER env var required` | Workflow context not passed | Re-scaffold via `/hive:sandcastle-gh-init`; check the bridge template wasn't hand-edited |
| `sandcastle: command not found` | `@ai-hero/sandcastle` not installed in consumer repo | `npm install @ai-hero/sandcastle` |
| `docker: command not found` | Runner lacks Docker | Use `ubuntu-latest` or install Docker on the self-hosted runner; or switch the Sandcastle provider to Podman/Vercel via `npx sandcastle init` |
| `result.completionSignal: 'idle-timeout'` | Agent stalled inside the container | Inspect agent stdout for the last action; raise `idleTimeoutSeconds` if the work is legitimately slow |
| `result.commits.length === 0` | `/hive:execute` produced no commits | Issue body lacked actionable context, or story YAML was missing — verify `.pHive/epics/<epic>/stories/<story>.yaml` is present |
| `gh: not found` (success step) | Runner lacks `gh` CLI | Use `ubuntu-latest` or install `gh` on self-hosted |

---

## Workflow vs bridge ownership

A persistent source of confusion. The split is deliberate:

| Concern                               | Owner                | Why                                                                                      |
|---------------------------------------|----------------------|------------------------------------------------------------------------------------------|
| Label transitions                     | **Workflow YAML**    | Atomic with the job lifecycle; survives bridge crashes via `if: failure()`.              |
| Concurrency / serialization           | **Workflow YAML**    | `concurrency.group` is a GitHub Actions primitive; the bridge cannot see other runs.     |
| Timeout ceiling                       | **Workflow YAML**    | `timeout-minutes: 60` is the outer guard; the inner Sandcastle idle timeout is narrower. |
| Secret injection                      | **Workflow YAML**    | `secrets.*` only exists in the workflow context; the bridge inherits via `env:`.         |
| PR creation                           | **Workflow YAML**    | Requires `gh` + `GITHUB_TOKEN`; the bridge focuses on the agent loop only.               |
| Sandcastle invocation                 | **Bridge script**    | Calls `sandcastle.run()` with the provider, prompt, and iteration caps.                  |
| Prompt body for the inner agent       | **Bridge script**    | Reviewable in git as TypeScript instead of buried in workflow YAML strings.              |
| Branch strategy (`agent/issue-<n>`)   | **Bridge script**    | Passed to `sandcastle.run()` as `branchStrategy`; workflow only references the convention. |
| Nested-isolation prevention           | **Workflow + bridge**| Workflow sets `HIVE_EXECUTION_MODE: team`; bridge prompt also instructs the inner Hive not to spawn nested sandcastles. |

When extending, **keep label transitions in the workflow**. A bridge that
transitions labels itself is harder to recover from a crash. The current
shape is what makes a stuck `hive:in-flight` a debugging exercise rather
than a recurring incident.

---

## See also

- [`/hive:sandcastle-gh-init` SKILL.md](../../skills/sandcastle-gh-init/SKILL.md) — the scaffolding skill itself.
- [`sandcastle-ops-loop.md`](sandcastle-ops-loop.md) — the cron-based predecessor (2.1.0). Event-driven dispatch replaces the polling cadence; both surfaces can coexist.
- [`sandcastle-adoption-guide.md`](sandcastle-adoption-guide.md) — Sandcastle adoption checklist; prerequisite for this skill.
- [Epic design discussion](../../.pHive/epics/sandcastle-gh-issue-dispatch/docs/design-discussion.md) — open questions and rationale captured at planning time.
