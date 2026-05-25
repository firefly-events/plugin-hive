# Changelog

All notable changes to Plugin Hive are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

## [2.8.0] - 2026-05-24

### Added

- `/hive:context-snapshot` skill emits a versioned JSON snapshot of Hive state (branch, epics, stories via `deriveStoryStatus`, recent episodes, open triage, metric verdicts) for consumption by external coordinators (Hermes, custom scheduler integrations, etc.). Read-only, transport-agnostic (stdout default, optional `--write` to `.pHive/context-snapshot.json`).
- `hive/lib/context-snapshot.mjs` library composer (`composeContextSnapshot`) — reusable across consumers without going through the skill surface.
- `hive/references/context-snapshot-schema.md` documents the versioned JSON shape with additive-only versioning rule.
- `/hive:standup --format slack` flag emits Phase 1 standup report in Slack-friendly markdown (no ANSI, code-block tables, no interactive prompts) suitable for cron capture + Slack delivery.
- `hive/references/standup-slack-format.md` documents the slack output conventions.
- `/hive:triage --json` flag emits machine-parseable envelopes for every sub-command (`--list`, single-id inspect, create, `--advance`, `--hand-off`, `--close`). Single-writer invariant on `queue.yaml` preserved — `--json` only changes output formatting, never adds write paths.
- `skills/triage/run.mjs` CLI runner backing the triage skill with full state-machine implementation, queue read/write, and JSON envelopes.

### Changed

- `hive/references/routines-integration.md` adds §"External coordinators (Hermes equivalence)" noting that any cron/webhook-capable coordinator (Anthropic Routines, Hermes, custom) plugs into the standup skill via the same scheduler-as-trigger contract.
- `skills/hive/skills/execute-mode-multica/SKILL.md` adds explicit checkout + verify + fail-fast (mi-03).
- `hive/lib/multica-bootstrap/index.mjs` + `hive/lib/multica-agents-config/index.mjs` install Claude Code plugins via `custom_env.CLAUDE_PLUGIN_PATH` (mi-04).

### Fixed

- `hive/lib/multica-story-dispatch/custom-env.mjs` (new) resolves `~`, `${HOME}`, and `$HOME` in `custom_env` values before sending to Multica, so plugin paths reach the agent literally (ab17b0b, PR #220).

### Notes

- Substrate for the planned Hermes-as-external-supervisor integration (companion epic `hermes-bridge-mvp` in `~/Code/hermes-agent` planned separately). All three flags are additive opt-in surfaces — default behavior is byte-equivalent on every existing entry point.
- Bundles `multica-integration-fixes` epic (PR #220, merged before this release): mi-01/mi-02 spikes documented in `.pHive/upstream-watch/`, mi-03/mi-04 + custom-env-resolve fix shipped above.

## [2.7.0] - 2026-05-21

### Added

- Multica dispatch mode for `/execute`: `execution.mode: multica` or `HIVE_EXECUTION_MODE=multica` routes each story as a Multica issue assignment to the `developer` persona. The v1 contract is whole-story-to-one-agent, with one `multica-run.yaml` episode marker per story.
- `skills/hive/skills/execute-mode-multica/SKILL.md` atomic dispatch sub-skill.
- `hive/lib/multica-story-dispatch/` helper exports: `serializeStoryBrief`, `resolveAgentUuidByName`, `ensureIssueBriefMatches`, `dispatchStoryToAgent`, and `moveOutOfBacklogIfNeeded` from `index.mjs`; `pollTaskUntilTerminal` and `writeMulticaRunEpisode` from `episode-sync.mjs`.
- `tests/smoke/multica-execute-mode.test.mjs` first dogfood smoke against the live Multica spike, gated on `/healthz`.

### Changed

- `skills/hive/skills/execute-dispatch/SKILL.md` adds `multica` to the `mode_decision` enum, documents override precedence, and recognizes the mode in Step 1.5 parallel-gate handling. `HIVE_EXECUTION_MODE` wins over config on conflict, and the existing Sandcastle branch remains unchanged at line level.

### Notes

- Additive opt-in only: default execution mode remains sequential and this is not a breaking change.
- Sandcastle + GH-Actions paths remain available and are scheduled for archival in `sandcastle-adoption-followon`.
- v1 scope is intentional: whole-story-to-one-agent, polling not SSE, fail-loud bootstrap precondition, and per-phase markers plus sidecar routing deferred to v2 work.

## [2.6.0] - 2026-05-21

### Added

- `/hive:multica-init` bootstrap skill (s3).
- Multica task-tracking adapter (s1).
- Persona → Multica agent declarative config (s4).
- `/plan` Phase D Multica dispatch wiring (s2).
- `GUIDE.md` maintainer guide for the Multica execution model.

### Changed

- README setup pointer now leads with `/hive:multica-init`.
- `hive.config.yaml` gains commented `# Multica (built-in):` example block.

### Notes

- Sandcastle + GH-Actions execution paths remain available but are scheduled for archival in follow-on cleanup epic `sandcastle-adoption-followon`.
- No breaking changes in this release — minor bump (2.5.0 → 2.6.0).
- Consumers do not need to take action unless they want to adopt the Multica substrate (run `/hive:multica-init`).

## [2.5.0] - 2026-05-19

**Pre-built sandcastle container image distributed via GHCR — dispatch cold-start drops from ~4 min to ~20 s.**

The `Hive dispatch` workflow no longer builds the sandcastle container inside each run. A new `build-sandcastle-image.yml` workflow publishes the image to GitHub Container Registry on every `.sandcastle/**` push (plus a weekly cron for base-image CVE refresh), and dispatch pulls it on demand. A local-build fallback keeps dispatch unblocked when the image isn't yet published or GHCR is unreachable.

### Added

- **`build-sandcastle-image.yml` — new workflow at `.github/workflows/build-sandcastle-image.yml` (gi-1)** that builds the sandcastle container image (mirroring the cron `Hive Worker`'s proven local-build pattern: claude-code + codex + plugin-hive marketplace shims) and pushes both `:latest` and `:sha-<7>` tags to `ghcr.io/firefly-events/sandcastle`. Triggers on push to main with `paths: ['.sandcastle/**']`, `workflow_dispatch`, and a weekly cron (`'17 4 * * 0'`, Sunday 04:17 UTC) that refreshes the image to catch Debian base-image CVE fixes. Uses `docker/build-push-action@v5` with `cache-from: type=gha` + `cache-to: type=gha,mode=max` so cross-run builds reuse the BuildKit layer cache. A smoke step runs `which claude && which codex && claude --version` inside the freshly-pushed `:sha-<7>` image — non-zero exit fails the run and the immutable `:sha-<7>` tag serves as a rollback target. Requires `permissions: { contents: read, packages: write }`.

### Changed

- **`Hive dispatch` workflow now pulls from GHCR instead of building (gi-2).** The scaffolder template (`skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl`), its `.example.yml` mirror, and the in-repo `.github/workflows/hive-dispatch.yml` gained a new `Pull sandcastle image (with local-build fallback)` step between `Install dependencies` and `Resolve base branch`. The step runs `docker pull "${IMAGE_REF}"` (default `ghcr.io/firefly-events/sandcastle:latest`), retags the result as `sandcastle:hive` to preserve the bridge's `@ai-hero/sandcastle` `docker()` lookup contract, and falls back to an in-workflow `docker build .sandcastle` (with the same `AGENT_UID`/`AGENT_GID` build-args used by the cron worker) only when the pull returns non-zero. A new `workflow_dispatch.inputs.image_ref` knob lets maintainers pin a specific `:sha-<7>` tag for rollback testing. Net effect: dispatch cold-start drops from ~4 min (local build) to ~20 s (warm GHCR pull) for the normal path; the fallback preserves the legacy behavior with no regression.
- **Runbook `hive/references/sandcastle-gh-dispatch.md` (gi-3)** gains a new §4 "Image distribution" section covering default behavior, the `image_ref` override knob, the local-build fallback, first-time setup (manually trigger `build-sandcastle-image.yml` once after enabling), image rebuild cadence (push to `.sandcastle/**` + weekly cron), and image visibility (public by default; private adds a `docker login` step). Sections 5-9 renumbered accordingly; internal cross-references updated.
- **README "Unattended mode" section** gains a one-paragraph summary of the GHCR image flow with a deep-link to the new runbook section.

## [2.4.2] - 2026-05-19

### Changed

- **`Hive dispatch` workflow + sandcastle bridge migrated to Claude OAuth (`CLAUDE_CODE_OAUTH_TOKEN`).** The default authentication path for `/hive:sandcastle-gh-init`-scaffolded workflows is now the long-lived headless OAuth token generated by `claude setup-token` — billed against the maintainer's Claude subscription, no per-token API charges. Proven by the `.github/workflows/claude-auth-spike.yml` smoke test on 2026-05-17. `@ai-hero/sandcastle`'s `claudeCode()` provider does not hardcode an auth env-var name; it forwards the workflow-step env into the container, and the `claude` CLI itself reads `CLAUDE_CODE_OAUTH_TOKEN` directly — no file mount or aliasing required.
  - `--secret-mode` now accepts `claude-oauth` (the new default), `anthropic-api` (legacy pay-per-token), and `openai` (unchanged). The deprecated alias `anthropic` continues to work and resolves to `anthropic-api`, with a one-line deprecation warning on stderr so consumers can migrate.
  - `.github/workflows/hive-dispatch.yml` (in-repo) + the rendered `.github/scripts/sandcastle-hive-bridge.mts` now reference `CLAUDE_CODE_OAUTH_TOKEN` instead of `ANTHROPIC_API_KEY`. The scaffolder template + .example mirrors emit the same default; existing consumers' rendered files keep working — but to migrate to OAuth they should re-run `/hive:sandcastle-gh-init`, set the new repo secret via `gh secret set CLAUDE_CODE_OAUTH_TOKEN`, and remove the old `ANTHROPIC_API_KEY` secret.
  - Runbook `hive/references/sandcastle-gh-dispatch.md` §4 gains a new §4.1 "Generating the Claude OAuth token" subsection covering `claude setup-token` → `gh secret set` end-to-end. Rotation procedure updated to cover all three secret modes.

## [2.4.1] - 2026-05-19

### Fixed

- **`Hive dispatch` workflow no longer crashes on bare repos.** The `Install dependencies` step in `hive-dispatch.yml` (both the in-repo workflow and the scaffolder template + .example mirror) used `npm ci`, which requires a `package-lock.json`. Plugin-hive itself (and any consumer following the BYO-deps pattern) ships no lockfile, so the step exited non-zero before the bridge could start, leaving labeled issues stuck (issue #137 hit this on 2026-05-19). Replaced with a three-case conditional: lockfile present → `npm ci`; `package.json` only → `npm install --no-save`; no `package.json` → `npm install --no-save --no-package-lock @ai-hero/sandcastle` (bare-repo transient). Re-enable the workflow via `gh workflow enable "Hive dispatch"` once this patch is live.

## [2.4.0] - 2026-05-19

**Per-epic branch + stacked-PR dispatch — `feat/<epic-id>` against configurable base, one PR per epic.**

The sandcastle-gh-dispatch surface (added in 2.3.0 / refined in 2.3.1 + 2.3.2) now stacks stories of the same epic onto a single branch and produces one PR per epic — instead of the legacy one-branch-per-issue + one-PR-per-issue path. Aligns with the established `feedback_git_flow_per_epic.md` policy memory.

### Added

- **`git_flow` config block + `resolveGitFlow` helper (pe-1).** New top-level block in `hive.config.yaml` with `default_pr_base: auto` (auto = `develop` if `origin/develop` exists, else `main`) and `branch_strategy: per-epic` (the new default; `per-story` is retained for back-compat). Resolution helper lives at `hive/lib/git_flow.mjs`; read root-first per `hive/references/skill-prelude.md`, with array-form `execFileSync` only (no shell interpolation). Returns `{ base_branch, branch_strategy, source }`.
- **Sandcastle bridge derives branch from `hive:epic:` label (pe-2).** `skills/sandcastle-gh-init/assets/sandcastle-hive-bridge.mts.tpl` now fetches issue labels via the GitHub REST API (no `child_process`), looks for a `hive:epic:<id>` label, and dynamically imports `hive/lib/git_flow.mjs` to read the resolved `branch_strategy`. Branch becomes `feat/<epic-id>` when epic-labeled + `per-epic`; falls back to `agent/issue-<n>` otherwise. Structured stdout result now also reports `epicId` and `branchStrategy` for downstream verification.
- **Dispatch workflow gains per-epic concurrency + PR open-or-update (pe-3).** `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl` restructured into a two-job graph: an upstream `derive` job extracts `EPIC_ID` from `${{ toJSON(github.event.issue.labels) }}` via `jq` (label payload never reaches a shell word), and the heavy `run` job declares `needs: derive` and reads `concurrency.group: ${{ needs.derive.outputs.concurrency_key }}` (resolves to `hive-epic-<id>` for epic stories, `hive-issue-<n>` for non-epic fallback). A new `Resolve base branch` step imports the pe-1 helper at runtime. The success step now queries for an existing open PR on `feat/<epic-id>` and either creates a fresh `--draft` PR (first story) or `gh pr edit --body` the existing one (later stories), composing bodies via `jq -nr --arg` so user-controlled issue titles are JSON-encoded; bodies are truncated at 25 story entries with a "see commits" pointer.
- **Draft PR promotes to ready on last story (pe-4).** New `Promote PR to ready if last story` workflow step counts `hive:epic:<id>` + `hive:story:*` story issues (`hive:story:*` filter excludes any epic-tracker issue) against `hive:epic:<id>` + `hive:shipped` + state-closed shipped issues; on parity it calls `gh pr ready "feat/<epic-id>"`. A `0/0` count is treated as a label-propagation anomaly and does NOT promote — zero false-positive ready flips. Step is gated on `success() && needs.derive.outputs.epic_id != ''` so non-epic runs never attempt promotion.
- **`/plan` pins resolved `git_flow` on `epic.yaml` (pe-5).** Phase A gains a new step `0a. Pre-flight: resolve git_flow (pe-5)` that calls `resolveGitFlow({ cwd })` immediately after the kickoff gate and persists the result on the planning context as `${git_flow_resolution}`. Phase C step 15's emitted `epic.yaml` now includes a top-level `git_flow:` block with both `base_branch` and `branch_strategy` resolved at plan time (pinning ensures downstream dispatch runs use the same value even if config drifts). Re-plan is idempotent — existing blocks update in place, missing ones insert after `methodology:`. Schema documented in new `hive/references/story-yaml-schema.md` §5 "Epic index (`epic.yaml`)" with field table, pinning rationale, and back-compat note.
- **Runbook documentation (pe-6).** New "Branching model" section (§3) in `hive/references/sandcastle-gh-dispatch.md` documenting default behavior, the override knob, the `per-story` back-compat path, concurrency semantics (epic-scoped), and PR lifecycle (draft → ready on last shipped). README "Unattended mode" section gains a per-epic flow paragraph linking to the new runbook section.

## [2.3.2] - 2026-05-18

### Fixed

- **`/hive:sandcastle-gh-init` prereq accepts `.sandcastle/Containerfile`** in addition to `.sandcastle/Dockerfile`. Sandcastle 0.5.x ships a Podman-style `Containerfile` by default, so the previous Dockerfile-only check rejected validly-initialized repos with a misleading `Sandcastle is not initialized` exit-2. Both names are valid OCI build files; either now satisfies the prereq. Affects `scaffold.mjs` prereq check, `SKILL.md` prereq doc, runbook section 1, and adds a new `AC-1b` test that seeds `.sandcastle/Containerfile` and asserts the scaffold completes. Closes #171.

## [2.3.1] - 2026-05-18

### Fixed

- **Skill discovery path** for `/hive:sandcastle-gh-init` — moved from `skills/hive/skills/sandcastle-gh-init/` (atomic/internal nesting) to `skills/sandcastle-gh-init/` (top-level). Top-level layout is required for plugin discovery to register the user-facing slash command. Affects scaffold script path, SKILL.md self-references, tests, and the runbook. Plugin manifest version bumped 2.3.0 → 2.3.1.

## [2.3.0] - 2026-05-18

**Event-driven autonomous dispatch — `hive:ready` label fires `/hive:execute` inside Sandcastle.**

Replaces the 15-minute cron polling cadence introduced in 2.1.0 with a label-trigger workflow. Labeling an issue `hive:ready` immediately fires a GitHub Actions run that executes the story inside a Sandcastle container, opens a PR, and flips the canonical label state machine. Reuses the existing `hive:ready` / `hive:in-flight` / `hive:shipped` / `hive:failed` labels — no schema or label changes — so the cron loop and event-driven dispatch can coexist on the same repo.

### Added

- **New public skill `/hive:sandcastle-gh-init`** (`skills/sandcastle-gh-init/`). Scaffolds GitHub Actions event-trigger glue on top of an already-initialized `.sandcastle/` setup. Drops three managed files into the consumer repo via a single `chore(hive): wire github-issue dispatch via sandcastle` commit. Args: `--runner ubuntu-latest|self-hosted`, `--secret-mode anthropic|openai`, `--force-recover`. Refuses to write if `.sandcastle/Dockerfile` is absent (run `npx sandcastle init` first); warns non-blocking on missing canonical labels and prints copy-pasteable `gh label create` commands. Uses `child_process.execFile` array-form invocations throughout — user-supplied args cannot smuggle shell metacharacters.
- **New workflow template** `.github/workflows/hive-dispatch.yml` (shipped as a skill asset at `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl`). Triple-guards the dispatch trigger via `on: issues:[labeled]` + step-level `if: github.event.label.name == 'hive:ready'` + per-issue `concurrency.group`. Workflow YAML owns every label transition (`if: failure()` covers bridge crashes — load-bearing invariant that prevents stuck `hive:in-flight` labels). Sets `HIVE_EXECUTION_MODE: team` to prevent nested sandcastles in the inner Hive run.
- **New bridge script** `.github/scripts/sandcastle-hive-bridge.mts` (shipped at `skills/sandcastle-gh-init/assets/sandcastle-hive-bridge.mts.tpl`). Thin `sandcastle.run()` wrapper invoking `claudeCode("claude-opus-4-7")` with the docker sandbox factory, branch strategy `agent/issue-<n>`, `maxIterations: 5`, `idleTimeoutSeconds: 600`. Prompt body explicitly instructs the inner Hive not to invoke `/hive:plan` (human's responsibility) and not to spawn nested sandcastles.
- **New maintainer runbook** [`hive/references/sandcastle-gh-dispatch.md`](hive/references/sandcastle-gh-dispatch.md). Seven numbered procedures: install the dispatch surface, label state machine, secret rotation, runner switch (Podman/self-hosted), public-repo label-permission lockdown, future-labels extension point (where to wire `hive:plan` / `hive:test` / `hive:review` when scoped), and stuck `hive:in-flight` label debugging (workflow run inspection, sandcastle container logs, common bridge failures).
- **Reuse of existing label state machine.** The four canonical labels — `hive:ready`, `hive:in-flight`, `hive:shipped`, `hive:failed` — are unchanged from 2.1.0. No new labels introduced. Topic labels (`hive:epic:<id>`, `hive:story:<id>`, `hive:blocked-by:<id>`) coexist and are orthogonal.

### Notes

- The cron-based loop from 2.1.0 (`.github/workflows/hive-worker.yml` + `hive/lib/budget-gate.js`) is unchanged and continues to ship. Event-driven dispatch is an additional surface, not a replacement — consumers can adopt either or both.
- `HIVE_EXECUTION_MODE: team` is the single-isolation-layer guard: the outer Sandcastle container is the isolation boundary; the inner Hive must not nest another one.
- Plugin version bumped 2.2.0 → 2.3.0 (consumer-visible new skill).

## [2.1.0] - 2026-05-15

**Sandcastle ops layer — autonomous-execution loop on top of sandcastle (opt-in).**

Closes the cron → worker → PR → review loop by composing three things that already existed (`/plan`, sandcastle, GitHub Actions) rather than building a new dispatcher. All opt-in via `external_task_tracking.adapter: github` + sandcastle adoption + a maintainer-only workflow in plugin-hive's own `.github/`. Zero behavior change for default consumers.

### Added

- **S1 — GitHub Issues label-pass adapter + `/plan` step 19a** (`hive/lib/external/github-issues-adapter.js`). Story-YAML → `gh issue create` with `hive:story` + `hive:ready` labels; idempotent on `slug` body marker. Wired into `skills/plan/SKILL.md` step 19a as the consumer-visible publish seam when `external_task_tracking.adapter: github`. Adapter is BYO `octokit` — no root dependency added.
- **S2 — Sandcastle worker prompt + Zod result schema + runner** (`.sandcastle/prompts/worker-issue-pickup.md`, `hive/lib/sandcastle-worker-schema.js`, `hive/lib/sandcastle-worker-runner.js`). Worker reads `hive:ready` issues, picks the oldest, re-reads canonical story YAML from disk (issue body is snapshot only), implements, opens PR, comments back. `Output.object()` typed via Zod so `result.json` is contract-checked. Test seam exposed via `_deps` for unit testing without booting a container.
- **S3 — GH Actions cron workflow + token-budget gate** (`.github/workflows/hive-worker.yml`, `hive/lib/budget-gate.js`, `tests/budget-gate.test.js`). 15-minute cron + `workflow_dispatch` with optional `issue_number` input; `concurrency: hive-worker, cancel-in-progress: false` serializes runs. Pre-flight `node hive/lib/budget-gate.js` sums today's spend from `.pHive/metrics/events/stop-*.jsonl` (per-model rate-card, opus fallback for unknown models, malformed-row tolerant) and aborts the run when over `tokens.daily_usd_limit`. Stuck-in-flight safety net labels the issue `hive:failed` when the worker exits non-zero without `status: shipped`. Workflow is REFERENCE/maintainer-only — consumers copy it into their own repo (plugins distribute via `.claude-plugin/`, not `.github/`).
- **New reference doc** `hive/references/sandcastle-ops-loop.md` — end-to-end flow, opt-in instructions, constraints, config keys.

### Notes

- Pricing rate-card in `hive/lib/budget-gate.js` is intentionally inline so rate drift shows up in diffs; verify against Anthropic's current pricing before relying on absolute spend numbers.
- 15-minute cron cadence is a default, not a load-tested number — tune via the workflow's `cron:` field after the first observation window.
- Metrics contract: `autonomous_stories_closed` (target 3, window 14d post-merge, source `gh_issue_close_events`) per the S3 story metric block. Verifiable at epic-close + 14d.

## [2.0.1] - 2026-05-15

**Patch release.** Merges three nightly `meta-meta-optimize` cycle ledger appends (2026-05-13, -14, -15) into `main`. No code or workflow changes — operational state only.

### Added

- `.pHive/meta-team/ledger.yaml` — 3 new cycle entries (meta-2026-05-13, -14, -15). Cycle meta-2026-05-13 promoted 1 SCHEMA_INCONSISTENCY fix to `step-03-proposal.md` (NEXT STEP pointer correction); meta-2026-05-14 and meta-2026-05-15 closed as discard cycles (hive-cloud-roadmap.md STUB_DOC repeatedly flagged out_of_scope pending Hive Cloud epic activation).

### Changed

- `.pHive/meta-team/cycle-state.yaml`, `.pHive/meta-team/morning-summary.md` — rolled forward through nightly cycles.
- `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` — NEXT STEP pointer corrected from `step-04-implementation.md` to `step-03c-metric-declaration.md` per meta-2026-05-13 finding.

## [2.0.0] - 2026-05-12

**Hive 2.0 milestone.** Cut from `dev/hive-2.0`. Bundles CWC 2026 A-group + Epic A (catalog hygiene + 3 mattpocock-aligned borrows) + Epic B (structural refactor + gate-lift) + Epic C (Task-Tracking Adapter ABI) as the 2.0 cut-line, with Epic D (Sandcastle adoption follow-on) and Epic F (UI cluster extract-config deeper) riding parallel.

Brand reframe: from *"director's chair"* (Hive directs swarms) to *"composable substrate, user-directed"* (user directs Hive; Hive provides composable atoms + workflow primitives). See `recommendation.md:239-241`.

### Added

- **Epic A — Catalog hygiene + borrows** (PR #58, 13 stories, W0-W5). W0 boilerplate extraction; W1 doc-template reclassify; mattpocock-aligned borrows (CONTEXT.md, atomic-shape audit, grill-before-plan).
- **Epic B — Structural refactor + gate-lift** (PR #62, 14 stories, W6). Plan/execute skill split; `paths.gate_mode` knob (`hard` vs `warning`); post-run audit + gate-lift telemetry under `${HIVE_STATE_DIR}/audits/post-run/<run-id>.yaml`; 5-cluster brand/design/polish/visual-qa extract-config (3 of 5 cluster members thinned).
- **Epic C — Task-Tracking Adapter ABI** (PR #63, 7 stories, W1-W5). Hierarchy-agnostic ABI under `hive/lib/task-tracking-dispatch/`; reference adapters for GitHub Issues + Linear under `hive/adapters/{github,linear}/`; JSON schemas under `hive/references/task-tracking-adapter-abi-schemas/`; migration guide + prose-runbook deprecation; plan-skill Phase D (publish stories to tracker) + execute-skill step 7b (status updates) wired through dispatch; `gate_mode` + prose-runbook-fallback telemetry.
- **Epic D — Sandcastle adoption follow-on** (PR #66, 12 specs / 7 slices). Sandcastle as 5th `execute` mode; provider wrapper at `hive/lib/sandcastle-provider.js` with preflight semver pin (`>=0.5.10 <0.6.0`); log-line redaction at `hive/lib/sandcastle-log-redaction.js` (argv/env, bearer, JSON-kv forms); V1 hooks reference; `gate-claudecode-sandcastle.mjs` policy gate scanning `.js/.mjs/.cjs/.ts/.mts/.cts` for `sandcastle + claudeCode()` blocked-lane usage; adoption guide at `hive/references/sandcastle-adoption-guide.md`; issue #191 defer marker + warm-pool placeholder; specialist-phase security plan-audit + performance audit trail.
- **Epic F — UI cluster extract-config deeper** (PR #65, 4 stories). D2 full closure. 6 public reference files under `hive/references/ui-prompts/` (`brand-system`, `design-system`, `polish-audit`, `visual-qa`, `design-review-design-critique`, `design-review-synthesis`); `step_file:` loading support in `skills/design-review/SKILL.md` (precedence `step_file` > `task` per `hive/references/workflow-schema.md:39`); regression-gate documentation at `hive/references/ui-prompt-extraction-verification.md`.

### Changed

- `skills/brand-system/SKILL.md`, `skills/design-system/SKILL.md`, `skills/polish-audit/SKILL.md`, `skills/visual-qa/SKILL.md` — inline ui-designer task bodies replaced with load → cite → inject → spawn invocation envelopes. Net -125 lines (109→72, 89→75, 162→134, 128→82).
- `hive/workflows/design-review.workflow.yaml` — design-critique + synthesis steps use `step_file:` instead of inline `task:` (5750 → 3698 bytes, -2052).
- `skills/plan/SKILL.md` — added Phase D (step 19 tracker publish) + step 20 (post-run audit).
- `skills/execute/SKILL.md` — added step 7b (tracker status update) + expanded step 8 (post-run audit with backend resolution sources).

### Fixed

- CodeRabbit findings on PR #65 (CHANGELOG footer link map; `{artifact_target}` placeholder docs) and PR #66 (`RE_ARGV` case-insensitive `/gi`, `parseSemver` `$` anchor, `.cts` in `SCAN_EXTS`, `userns: false` security-default clarification, `printenv | podman` anti-pattern guidance corrected).

### Notes

- **2.0 cut-line** per `.pHive/epics/hive-composability-audit/docs/recommendation.md:432` = CWC 2026 A-group + Epic A + B + C merged.
- **Post-2.0 follow-ons** queued: Epic G (`memory-stack-optionalize`, discretionary) and Epic H (`brand-system-2.0-update`, auto-triggered on 2.0 merge).
- Epic E (`atoshell-reconsider`) remains dormant — trigger requires explicit user reopen.

## [1.3.0] - 2026-05-12

### Added

- 6 new public reference files under `hive/references/ui-prompts/`: `brand-system`, `design-system`, `polish-audit`, `visual-qa`, `design-review-design-critique`, and `design-review-synthesis`.
- `step_file:` loading support in `skills/design-review/SKILL.md` step-execution loop. Precedence is `step_file` > `task`, per `hive/references/workflow-schema.md:39`.
- `hive/references/ui-prompt-extraction-verification.md` regression-gate documentation.

### Changed

- `skills/brand-system/SKILL.md`, `skills/design-system/SKILL.md`, `skills/polish-audit/SKILL.md`, and `skills/visual-qa/SKILL.md` inline ui-designer task bodies replaced with load -> cite -> inject -> spawn invocation envelopes. No behavior change; net -125 lines across the four:
  - `skills/brand-system/SKILL.md`: 109 -> 72 (-37)
  - `skills/design-system/SKILL.md`: 89 -> 75 (-14)
  - `skills/polish-audit/SKILL.md`: 162 -> 134 (-28)
  - `skills/visual-qa/SKILL.md`: 128 -> 82 (-46)
- `hive/workflows/design-review.workflow.yaml` design-critique and synthesis steps now use `step_file:` instead of inline `task:`. Two specialist steps, accessibility-critique and animations-critique, keep inline `task:` content. Workflow size changed from 5750 -> 3698 bytes (-2052 bytes).
- `skills/design-review/SKILL.md` gained the `step_file:` loading extension code (+287 bytes).

## [1.2.2] - 2026-05-07

### Fixed
- **Session runtime CodeRabbit pass (PR #50 follow-up).** Resolves all
  8 inline findings filed against the memory-autonomy Phase 2 session
  execution path. Behavior unchanged for `sessions.enabled: false`
  (the default), but every fix is correctness-relevant once the
  feature is opted in.
  - `hive/lib/session-client.js` — `sendEvents()` now calls
    `client.beta.sessions.events.send()` (the actual SDK method)
    instead of the non-existent `events.create()`. Would have thrown
    `TypeError` on the first tool turn.
  - `hive/scripts/session-invoke.mjs` — extracted
    `handleRequiresAction()` and `drainStream()` helpers; the SSE
    flow now loops tool turns until a terminal `complete` is observed
    (capped at `MAX_TOOL_TURNS=16`). Previously a session with a
    nested `requires_action` was silently marked `completed` after the
    first tool round and the episode YAML was written without the
    unanswered turn.
  - `hive/lib/session-registry.js` — `acquireLock()` now PID-stamps
    the sentinel file and detects dead holders via
    `process.kill(pid, 0)`, unlinking and retrying immediately.
    Prevents a single crash from degrading the registry to permanent
    fail-open.
  - `hive/lib/session-episode-writer.js` — episode filenames include
    a 12-char sanitized `session_id` suffix
    (`<step_id>-<suffix>.yaml`); stuck-retry no longer overwrites the
    prior failed attempt's episode YAML.
  - `hive/lib/session-prompt-builder.js` — `KG_SQLITE_PATH` uses
    `os.homedir()` instead of `process.env.HOME || '~'` (Windows
    safe; no literal `~` paths).
  - `hive/lib/session-registry.js` — `upsert` insert-path pins
    `session_id` last in the spread, mirroring the update-path's
    ordering.
  - `hive/references/session-registry-schema.md` — re-aligned the
    ASCII lifecycle diagram so the `stuck` arrow visually originates
    under `active`, not `pending`.
  - `hive/references/session-resilience.md` — opening paragraph now
    references `step 6c` (matching line 8 + the References section);
    the previous `step 6b` collided with `cmux`'s 6b in main.

## [1.2.1] - 2026-05-07

### Added
- **Session-based execution path (memory-autonomy Phase 2).** New
  opt-in `/v1/sessions` runtime brings session-aware story execution
  to the `execute` skill as a top-priority mode. Ships a session
  registry at `${HIVE_STATE_DIR}/sessions/index.yaml`
  (`pending|active|completed|failed|stuck`) plus six lib modules
  (`session-client`, `session-episode-writer`, `session-prompt-builder`,
  `session-registry`, `session-sse-reader`, `session-turn-builder`),
  the `hive/scripts/session-invoke.mjs` driver, and an SSE
  stuck-detection + retry contract that replaces respawn for session
  execution. Default OFF; consumers opt in via
  `sessions.enabled: true` in `hive.config.yaml` or
  `HIVE_SESSIONS_ENABLED=1`. The existing TeamCreate path
  (step 6 / 6b cmux) is preserved unchanged.
- **`hive/references/session-registry-schema.md`** and
  **`hive/references/session-resilience.md`** — schema + resilience
  contracts for the new path.
- **`skills/hive/skills/session-registry/SKILL.md`** — bootstrap skill
  for the registry.

### Changed
- `skills/execute/SKILL.md` — adds `step 6c` session execution block;
  routes session sidecar injection through main's `appends[]` map and
  the canonical `specialist-triggers.md` catalog.
- `skills/hive/skills/respawn/SKILL.md` — callout that respawn does
  not apply under the session execution path.
- `hive/references/configuration.md` — documents the new `sessions.*`
  config block.
- `README.md` — version badge bumped to 1.2.1; ToC, revised North
  Star, and QRSPI inspiration link landed via PR #47.

### Chores
- Backfill `integrate.yaml` episode stamps for all 13
  `hive-dag-executor` stories (`hde-0` through `hde-10`).
- Meta-meta nightly cycle for 2026-05-07 (telemetry + ledger).

## [1.2.0] - 2026-05-04

### Added
- **Hive DAG executor v1 — cutover complete.** The deterministic DAG
  executor (`hive/lib/dag_executor/`) graduates from optional opt-in to
  the target runtime for workflows. 11 of 11 built-in workflows are now
  in the per-workflow graduation registry at
  `.pHive/runtime/executor-graduated-workflows.yaml`:
  `meta-team-cycle`, `code-review`, `performance-audit`, `test-swarm`,
  `development.tdd`, `development.bdd`, `development.tdd-codex`,
  `ui-design`, `design-review`, `development.classic`, `daily-ceremony`.
  Workflows opt in via
  `executor: hive-dag` + `executor_default: true` in
  `.pHive/hive.config.yaml`; default OFF posture preserved for
  consumers that don't flip the flag.
- **PR #31's metric_signal/findings conflation bug class is structurally
  retired.** AND-of-empty routing between `meta-team-cycle`'s
  `proposal` and `backlog-fallback` graduates from prose-narrated
  orchestrator judgement to mechanical YAML predicate evaluation against
  `step-02-analysis`'s declared `output_format` fields (`metric_signal`,
  `findings_count`, `external_candidates_count`).
- **`daily-ceremony` plan-approval gate ships as `node_type: pause`.**
  Operator approval sentinels at
  `<runs_root>/<run_id>/pause/plan-approval.{approve,reject}` carry the
  HMAC-signed token from the `pause_suspended` telemetry event (hde-8
  anti-forgery contract). Existing `step-06-approve-plan.md` is
  preserved as the operator-facing presentation script.
- **`hive/decisions/001-executor-cutover.md`** — canonical migration
  guide for graduating custom workflows; rollout history and sunset
  path for orchestrator-narrated routing; per-workflow rollback
  primitives.
- **`hive/references/story-spec-schema.md`** — minimal schema for the
  `metadata.needs_backend` / `metadata.needs_frontend` story booleans
  consumed by `development.classic`'s YAML-level domain decomposition.

### Changed
- `hive/references/workflow-schema.md` — the existing "Executor Cutover"
  section now also documents authoring-forward defaults: declarative
  `when:` predicates, structured `output_format` blocks, and named
  outputs are recommended for new workflows. Prose-routed workflows
  remain supported under the orchestrator-narrated path
  (maintenance-mode); the path is not removed in this release.
- `hive/GUIDE.md` — adds a "Hive DAG Executor (optional, per-workflow
  opt-in)" section with the consumer opt-in shape and migration guide.
- `hive/MAIN.md` — adds a "Two Execution Paths" architecture note and
  updates the Key References table with predicate-grammar, story-spec,
  and the executor ADR.
## [1.1.4] - 2026-05-01

### Added
- **kg_signal proposal source for `/meta-optimize`.** New optional workflow
  step `step-02c-kg-signal.md` queries the L2 knowledge graph for
  `phase_failed`, `phase_blocked`, and `superseded` triples and emits
  `kg-findings.yaml` with `discovery_source: kg_signal`. Three-layer relevance
  filter: predicate vocabulary, recency window, project-tag rank penalty.
- **System-level project registry + KG bootstrap.** New
  `~/.claude/hive/projects.yaml` registry plus
  `scripts/kg-bootstrap-from-projects.js` walks registered project roots and
  seeds `~/.claude/hive/kg.sqlite` with multi-project decision history.
- **step-03 proposal merge accepts kg_signal findings.** Auto-tags untagged
  KG findings with `discovery_source: kg_signal`, dedupes against internal
  grouped findings, and ranks the merged pool.
- **KG-before-backlog routing in meta-optimize.** Precedence is now
  metrics → external research → kg_signal → backlog. Threshold blending,
  new `meta_optimize.kg_signal` config block (`enabled` / `window_days` /
  `cross_project_penalty`); `enabled: false` reverts to the legacy
  metrics → backlog flow. No-op when `kg.sqlite` is absent.
- **End-to-end fixture for kg-augmented-meta-signal.** New
  `tests/fixtures/kg-augmented-meta-signal/` (seed.sql + run.sh + README.md)
  proves the full path with no Node deps — uses system `sqlite3` CLI per
  the bring-your-own-enhancements philosophy. Includes LLM-mediated step-02c
  run, mental-trace through step-03 and meta-optimize routing; all 6 fixture
  ACs verified.
- **OSS rollout brand foundation.** Concept-4 logo (`assets/hive-logo.svg`,
  256/400/512/1024 PNGs and lockup variants), README hero block with
  positioning tagline, Inspirations credit block.
- **README audit for 1.1.3+ drift cleanup.** New "Memory architecture"
  section (L0–L3 tiers + KG + ChromaDB graceful degradation + session-end
  three-op orchestration), Meta Optimization "Proposal sources" rewrite,
  persona count correction, Extensibility path-prefix fixes, cmux row
  description refresh, migration callout.
- **Versioning cross-cutting concern.** New entry in
  `.pHive/cross-cutting-concerns.yaml` requires consumer-visible epics to
  bump `.claude-plugin/plugin.json` + `marketplace.json`, update the README
  badge, and add a CHANGELOG entry. Prevents silent version drift.

## [1.1.3] - 2026-04-28

### Added
- **Memory & Autonomous Execution Phase 1 — Knowledge Graph (KG) substrate ships.**
  Cross-project, time-versioned decision/lifecycle store at `~/.claude/hive/kg.sqlite`.
  Triples are subject–predicate–object with controlled predicate vocabulary
  (`decided`, `superseded`, `assigned_to`, `blocked_by`, `depends_on`, `phase_started`,
  `phase_complete`, `phase_failed`, `phase_blocked`). WAL-mode SQLite, idempotent
  bootstrap DDL, unique index on `(subject, predicate, object, source_epic)`.
  See `hive/references/knowledge-graph-schema.md`.
- `MemoryStore.query_decisions(filter)` method — point-in-time triple retrieval
  with `entity` / `predicate` / `as_of` / `include_superseded` filters. Documented
  in `hive/references/memory-store-interface.md`.
- KG write path: `kg_write()` in `hive/lib/session-end.js` persists triples at
  session-end and pre-shutdown via the canonical three-op orchestration
  (insights → kg_write → compile ‖ chromadb.index). `INSERT OR IGNORE` with
  runtime `idx_unique_triple` precondition guard.
- KG bootstrap utility: `scripts/kg-import-cycle-state.js` — one-time backfill
  from existing `.pHive/cycle-state/*.yaml`. Atomic transaction wrapping,
  ISO-normalized `valid_from`, dry-run preview, surfaced fallback YAML parse drops.
- KG read path: `agent-spawn` Step 5e injects a "Decision Context" block into
  agent prompts using two `query_decisions({entity})` calls (current_agent +
  current_epic), merged and dedup'd by `(subject, predicate, object, valid_from)`.
- **ChromaDB L3 semantic memory tier (optional).** JSON-RPC wrapper at
  `hive/lib/chromadb-wrapper.js` (`isAvailable()`, `query()`, `index()`),
  agent-namespaced docIds (`${agentName}/${slug}`), graceful degradation to
  L1+L0 when sidecar absent. Indexed at session-end Phase C in parallel with
  `compile()`.
- **Session System Prompt Specification.** Authoritative design at
  `hive/references/session-system-prompt-spec.md` defining session prompt
  composition (persona + prior knowledge + KG decision context + domain note),
  per-step story context injection, session lifecycle, completion detection,
  and cleanup. Foundation for Phase 2 Managed Agent API migration.
- Session-end orchestration skill at `skills/hive/skills/session-end/SKILL.md`
  with three-phase ordering (Phase A insights → Phase B kg_write → Phase C
  compile ‖ chromadb.index), 30-second latency monitoring, asymmetric failure
  handling (KG = surface error, ChromaDB = warn only), and `skipCompile` for
  hard-shutdown pressure.
- Pre-shutdown protocol updated to share the canonical session-end orchestration
  via `runSessionEnd({ skipCompile: true })`.

### Changed
- Memory tier table in `memory-store-interface.md`: L3 row replaces the Qdrant
  placeholder with the actual ChromaDB JSON-RPC wrapper that ships in this release.
- `DecisionFilter.subject?` renamed to `DecisionFilter.entity?` to match the
  canonical SQL placeholder and accurately describe the cross-column matching
  behaviour (`subject = :entity OR object = :entity`).

### Fixed
- `session-end.js`: replaced `process.env.HOME` with `os.homedir()` so paths
  resolve in containerized / sanitized environments.
- `session-end.js`: agent-name and slug input validation (kebab-case regex +
  resolved-path containment) guards ChromaDB indexing against directory
  traversal via crafted inputs.
- `session-end.js` `kgWrite()`: `db.close()` is now guaranteed via try/finally
  even when `sqlite3()` open or `prepare()` setup throws.
- `chromadb-wrapper.js`: `query()` checks HTTP status before parsing the body
  (rejecting 4xx/5xx error payloads); `index()` drains the response body for
  keep-alive cleanliness; dropped unused `metadatas` from `query()` include list.
- `kg-import-cycle-state.js`: real-mode imports now wrap the entire backfill
  in `db.transaction()` for atomicity; fallback YAML parse drops are surfaced
  rather than silently swallowed; dry-run summary renamed to "Would process"
  to remove the optimistic claim that all parsed triples would insert.
- Markdown lint: collapsed multi-space blockquote continuations and removed
  spaces inside code spans across the KG/memory-autonomy stack.

## [1.1.2] - 2026-04-23

### Added
- **Public `/meta-optimize` skill ships (MVS milestone).** New consumer-facing
  skill that proposes and runs improvement experiments against a user project,
  with PR-only promotion (no direct main mutation), human-edit-only backlog
  fallback at `.pHive/meta-team/queue-meta-optimize.yaml`, and unknown-metric-
  dimension tolerance. See `skills/hive/skills/meta-optimize/SKILL.md` and
  `hive/references/meta-optimize-contract.md`.
- `PrPromotionAdapter` in `hive/lib/meta-experiment/` — concrete PR-artifact
  adapter alongside the maintainer `DirectCommitAdapter`. Close records
  carry explicit `pr_ref` + `pr_state` evidence.
- MVS acceptance proof at `.pHive/audits/mvs-proof/` (canonical + `latest.yaml`
  pointer), 10-item integrity checklist. Regeneration gated behind
  `HIVE_WRITE_MVS_PROOF=1` (see `hive/references/meta-optimize-maintainer.md`).
- `paths.state_dir` config setting (default: `.pHive`) — override to keep
  legacy `state/` or pick any directory name.
- Migration script: `scripts/migrate-state-to-pHive.sh` — renames `state/`
  to `.pHive/` while preserving git history and updating `.gitignore`.
- Kickoff Step 0: detects legacy `state/` directories on existing projects
  and offers in-place migration (or opt-in to keep using `state/`).

### Changed
- **Default state directory renamed `state/` → `.pHive/`.** Hidden by default
  (like `.git/` or `.claude/`). Configurable via `paths.state_dir` in
  `hive.config.yaml` if you prefer a different name.
- All skills and references updated to use `.pHive/` as the default storage
  location for epics, episodes, cycle state, sessions, memories, etc.
- Kickoff gate in every skill now proceeds silently when checks pass — no
  user-visible announcement. The gate still surfaces actionable guidance
  when a check fails.

### Migration
Existing projects with a `state/` directory should migrate. Two supported paths:

1. **Auto-migrate** (recommended): re-run `/hive:kickoff`, choose `yes` at
   the migration prompt.
2. **Manual migrate**: `bash scripts/migrate-state-to-pHive.sh` from your
   project root.

> **Note:** `paths.state_dir` is documented in the config schema but not yet
> wired into runtime path resolution in every skill. If you cannot migrate
> immediately, a symlink (`ln -s state .pHive`) is a safe stopgap. Full
> config-driven path resolution is tracked as follow-up work.

### Known follow-up
Wiring `paths.state_dir` end-to-end requires a single path resolver that
every skill, workflow step, agent domain spec, and hook reads from. Right
now those references hardcode `.pHive/` directly. This is deliberate scope
for this PR (rename + migration tooling + config surface); resolver wiring
will be a dedicated follow-up so the path changes stay reviewable. Until
that lands, any override of `paths.state_dir` other than the default
`.pHive` is best-effort — use the symlink stopgap if you need a different
layout today.

## [1.1.1] - 2026-04-18

cmux v2 API as native team execution backend.

### Added
- cmux team execution path (execute step 6b) — orchestrator manages parallel
  stories in cmux panes via v2 JSON-RPC API instead of TeamCreate
- `execution.interactive_panes` config toggle — controls whether cmux-spawned
  agents (Claude and Codex) launch in interactive or one-shot mode
- v2 API annotations in agent-spawn skill (surface.split, surface.send_text,
  surface.read_text, surface.health, surface.close)
- Completion marker convention (`[STORY-COMPLETE:{story-id}]`) for poll-based
  story completion detection
- Failure propagation for blocked dependents in cmux execution path
- Mode-dependent steps 8/9 in agent-spawn (team vs standalone pane lifecycle)

## [1.1.0] - 2026-04-17

External model integration: cross-model execution with OpenAI Codex.

### Added
- Per-agent spawn backend axis (`agent_backends` in `hive.config.yaml`) —
  route roster personas through OpenAI Codex in side-by-side cmux panes
  via the new `codex-invoke` skill. Default (unset) remains `claude`.
- TDD cross-model workflow (`development.tdd-codex.workflow.yaml`) — Claude
  writes tests, Codex implements in a persistent cmux pane, Claude reviews
  with a fix loop on the same pane before shutdown.
- Terminal multiplexer config (`execution.terminal_mux`) — tmux, cmux, or auto
- Persistent pane mode for multi-turn Codex workflows with idle timeout safety net
- Adapter prefix for persona reuse across models without forking
- Supported Codex personas: backend-developer, reviewer, technical-writer,
  architect, tpm

## [1.0.0] - 2026-04-09

First public OSS release under Apache 2.0.

### Added
- Apache 2.0 license
- Contributor documentation suite (CONTRIBUTING.md, CHANGELOG.md)
- GitHub issue and pull request templates with issue-first contributor model
- Ops guide for installation, configuration, and day-to-day operation
- Reference doc scrub replacing internal Firefly examples with generic ones
- Repository cleanup removing internal artifacts and fixing `.gitignore`
- Aligned `plugin.json` and `marketplace.json` to v1.0.0

---

## [0.9.0] - 2026-04-08

Autonomous meta-team for nightly self-optimization.

### Added
- Meta Team infrastructure: state schema and run ledger (`meta-team s1`)
- Optimization charter (`program.md` equivalent) defining meta-team goals (`s2`)
- Baseline cycle: boot, analyze Hive internals, close (`s3`)
- Sandbox pipeline: worktree isolation, destructiveness enforcement, promotion, rollback (`s4`)
- Full nightly cycle: 5-agent pipeline, 8 phases, `CronCreate` scheduling (`s5`)
- External research loop: web scanning with time budgets and source attribution (`s6`)
- Memory-driven targeting: pattern detection across Hive memory ecosystem (`s7`)
- Subjective evaluation UX: morning summary, `/meta-team review`, `/status` integration (`s8`)
- 5 specialist agent personas: UI, Performance, Security

---

## [0.8.0] - 2026-04-08

Extended onboarding flow with greenfield discovery and deeper brownfield analysis.

### Added
- Greenfield discovery skill: 7-step flow for deep product brainstorming
- Greenfield adaptation of existing brownfield capabilities
- Extended onboarding report, team config generation, and starter memory creation
- Cross-cutting concern auto-generation (Phase 2b-iv)
- Developer discovery elicitation (Phase 2b-ii)
- Linter detection, pre-commit hook scanning, snippet extraction, test-first signals (Phase 2b-iii)
- Data contracts for extended onboarding (schema foundations)
- Kickoff gate enforced at all user-invocable Hive commands

---

## [0.7.0] - 2026-04-06

Memory redesign: federated agent memory with TTL, provenance, and wiki compilation.

### Added
- `MemoryStore` interface and `MemoryBundle` federation format
- TTL, staleness detection, and provenance fields on agent memory schema
- Wiki compilation step in session-end workflow with compilation guide
- Wiki-first retrieval in agent-spawn and staged insight recovery
- Starter memories and onboarding guide for memory federation
- Mermaid standardized for dependency diagrams across all docs

---

## [0.6.0] - 2026-04-05

Planning flow improvements: TeamCreate gates, self-contained stories, agent respawn.

### Added
- `TeamCreate` team assembly and collaborative review gates in planning phase
- Self-contained story specs with inline snippets and methodology-aware steps
- Agent respawn skill for context-aware lifecycle management
- Pre-shutdown readiness protocol across all persona files
- Orchestrator pre-shutdown insight extraction
- Stop hook registration and interrupt detection

---

## [0.5.0] - 2026-04-02

Agent infrastructure v2: config schema, memory architecture, planning, and portability.

### Added
- Agent config schema reference (`hive/references/agent-config-schema.md`)
- Workflow schema reference (`hive/references/workflow-schema.md`)
- Team config schema reference (`hive/references/team-config-schema.md`)
- Configurable model tiers in `hive.config.yaml`
- Portable plugin structure with `${CLAUDE_PLUGIN_ROOT}` path resolution

---

## [0.4.0] - 2026-03-28

Step file architecture: BMAD-style step files across all workflows.

### Added
- BMAD-style step files for all core Hive workflows
- Step files for UI designer workflow
- `step-file-schema.md` reference document
- Per-project cross-cutting concerns system (`state/cross-cutting-concerns.yaml`)
- Retro findings from first and second Shindig runs addressed (circuit breakers, tool hierarchy fixes)
- `TeamCreate` enforced over `Agent` tool for parallel team execution

---

## [0.3.0] - 2026-03-26

Test swarm, kickoff command, and error handling.

### Added
- `/test` command: full test swarm (context gathering, test authoring, execution, bug triage, reporting)
- `/kickoff` command for project initialization (brownfield discovery)
- Circuit breakers: time-based, attempt-based, and progress-based halt conditions
- Comprehensive error handling playbook
- Reviewer must-be-different-agent rule (no self-review)

---

## [0.2.0] - 2026-03-26

Plugin distribution and configurable task tracking.

### Added
- `plugin.json` manifest for Claude Code plugin installation
- `marketplace.json` for plugin discovery
- Full Linear board integration (optional)
- Configurable task tracking: local mode as default, Linear as opt-in
- Final review and push gates in daily ceremony

---

## [0.1.0] - 2026-03-25

Initial release: core workflow orchestration for Claude Code.

### Added
- Core SDLC workflow: plan, execute, standup, review
- Multi-agent team orchestration with role-based personas (orchestrator, team lead, developer, researcher, reviewer, tester)
- `MAIN.md` orchestrator entry point
- Daily ceremony skill (`/standup`)
- Task tracking via Hive-native local state

---

[Unreleased]: https://github.com/firefly-events/plugin-hive/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/firefly-events/plugin-hive/compare/v2.4.2...v2.5.0
[2.4.2]: https://github.com/firefly-events/plugin-hive/compare/v2.4.1...v2.4.2
[2.4.1]: https://github.com/firefly-events/plugin-hive/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/firefly-events/plugin-hive/compare/v2.3.2...v2.4.0
[2.3.0]: https://github.com/firefly-events/plugin-hive/compare/v2.1.0...v2.3.0
[2.0.1]: https://github.com/firefly-events/plugin-hive/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/firefly-events/plugin-hive/compare/v1.3.0...v2.0.0
[1.3.0]: https://github.com/firefly-events/plugin-hive/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/firefly-events/plugin-hive/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/firefly-events/plugin-hive/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/firefly-events/plugin-hive/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/firefly-events/plugin-hive/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/firefly-events/plugin-hive/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/firefly-events/plugin-hive/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/firefly-events/plugin-hive/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/firefly-events/plugin-hive/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v1.0.0
[0.9.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.9.0
[0.8.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.8.0
[0.7.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.7.0
[0.6.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.6.0
[0.5.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.5.0
[0.4.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.4.0
[0.3.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.3.0
[0.2.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.2.0
[0.1.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.1.0
