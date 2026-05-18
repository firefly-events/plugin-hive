# Research Brief: Sandcastle GitHub-Issue Event Dispatch

## Summary

Hive already ships Sandcastle as an execution substrate (epic `sandcastle-adoption-followon`: Codex-only container sandbox, worktree lifecycle, log redaction). The Sandcastle library itself (`@ai-hero/sandcastle`) ships pull-based templates (`simple-loop`, `parallel-planner-with-review`) for GitHub Issues backlogs, but **does not prescribe a trigger**. Consumers today must run `.sandcastle/main.mts` on cron or manually. This epic closes that gap with an event-driven trigger via GitHub Actions `on: issues:[labeled]`, scaffolded by a new public Hive skill.

## Directed Source Findings

### Existing sandcastle integration in plugin-hive

- `hive/lib/sandcastle-provider.js:6-23,87,220-223,259-297` — wraps `@ai-hero/sandcastle`, lazy-loads Docker/Podman, mounts `.sandcastle/codex-config` → `/home/agent/.codex`.
- `hive/lib/sandcastle-log-redaction.js:64-71` — masks `OPENAI_API_KEY`, Bearer headers, JSON `_key`/`_token` values.
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md` — sandcastle execution mode skill (5th dispatch path).
- `skills/hive/skills/sandbox-setup/SKILL.md:15-49` — writes `.sandcastle/codex-config/auth.json` (mode 0600).
- `.pHive/epics/sandcastle-adoption-followon/` — 5 stories shipping the substrate.

### What's missing

- No trigger layer. No `.github/workflows/sandcastle-dispatch.yml`. No scaffolding skill.
- No consumer-facing one-shot scaffold that initializes `.sandcastle/`, writes the workflow, and labels-up the repo.

### Existing public skills (sibling examples)

- `skills/kickoff/` — initialization skill for new projects; pattern for our scaffold skill.
- `skills/hive/skills/register-project/` — writes config into consumer repo.

## Web Research Findings

### Sandcastle upstream conventions (source: github.com/mattpocock/sandcastle README + npm docs)

- `npx sandcastle init` is the canonical scaffold path. Prompts for: sandbox provider (Docker/Podman/Vercel), backlog manager (GitHub Issues / Beads), template.
- Five templates ship: `blank`, `simple-loop`, `sequential-reviewer`, `parallel-planner`, `parallel-planner-with-review`.
- Default Dockerfile (`.sandcastle/Dockerfile`) bakes in `gh` CLI + Claude Code CLI + Node 22 + non-root `agent` user.
- Prompt idiom: `` !`gh issue list --state open --label Sandcastle --json …` `` — dynamic shell expansion at run time.
- `docs/agents/issue-tracker.md` codifies `gh issue create/view/comment/edit/close` as the canonical CRUD.
- Programmatic API: `sandcastle.run({ agent, sandbox, promptFile, branchStrategy, maxIterations, idleTimeoutSeconds, signal })`. Returns `{ branch, commits[], iterations[], logFilePath, completionSignal }`.
- Cost controls: `maxIterations` (default 1), `idleTimeoutSeconds` (default 600), `AbortSignal`. **No monetary budget.**

### GitHub Actions `on: issues` (source: GitHub Docs — events that trigger workflows)

- Event types: `opened`, `edited`, `deleted`, `labeled`, `unlabeled`, `assigned`, `closed`, `reopened`, etc.
- Filter by label in `if:`: `if: contains(github.event.label.name, 'sandcastle') || contains(github.event.issue.labels.*.name, 'sandcastle')`.
- Default `GITHUB_TOKEN` has `issues: write` + `pull-requests: write` when granted in workflow `permissions:` block.
- Public repos: free runner minutes. Private: counts against plan.
- Self-hosted runners required if container needs persistent Docker state across runs.

### Recommended pattern (sandcastle docs do not specify trigger; community pattern from issue threads)

1. Label issue with `sandcastle` (or custom label).
2. Workflow fires `on: issues:[labeled]`, filters by label.
3. Runs `npx tsx .sandcastle/main.mts` with `ISSUE_NUMBER=${{ github.event.issue.number }}`.
4. Sandcastle's template (parallel-planner-with-review) pulls issue via `gh`, runs agent, commits to `agent/issue-<n>` branch.
5. Workflow opens PR with `gh pr create`, comments on issue with PR link.

## Cross-Reference Analysis

| Concern | Sandcastle ships | Hive needs to add |
|---|---|---|
| Container sandbox lifecycle | ✅ provider | — |
| Auth mount (`auth.json`) | ✅ sandbox-setup skill | — |
| Log redaction | ✅ redaction module | — |
| GH Issues backlog reader (`gh issue list --label`) | ✅ via prompt expansion | — |
| Trigger mechanism | ❌ none — assumes operator runs script | **THIS EPIC** |
| Consumer-repo scaffold flow | partial (`npx sandcastle init`) | Hive wrapper that calls init + writes workflow + opens PR |
| PR-back + issue-comment after run | ✅ workable via `gh` CLI inside workflow | **THIS EPIC** (workflow template) |
| Repo permissions config | ❌ | **THIS EPIC** (label creation, workflow perms block) |

## Recommendation

**Build a single public skill `/hive:sandcastle-gh-init` plus a workflow + bridge template pair.** Scope is Small (3 stories):

1. **Workflow + bridge templates** — `.github/workflows/hive-dispatch.yml` fires on `issues:[labeled]` filtered to `hive:ready` (existing canonical label). Handles label state machine transitions (`ready` → `in-flight` → `shipped` | `failed`). Invokes `.github/scripts/sandcastle-hive-bridge.mts` which calls the upstream `sandcastle.run()` API with a prompt delegating to `/hive:execute`. `HIVE_EXECUTION_MODE=team` prevents inner-sandcastle recursion.
2. **Init skill** — layers GH-event-trigger glue on top of an already-initialized `.sandcastle/`. **Sandcastle init is a prerequisite, not embedded.** Skill writes only the workflow YAML, the bridge .mts, and a manifest at `.hive-dispatch/manifest.yaml`. No files under `.sandcastle/` — that directory stays sandcastle's domain. No label creation — `hive:ready` and siblings already exist.
3. **Docs + version bump** — consumer-facing skill doc, runbook with label permission lockdown + future-label extension point, CHANGELOG entry, plugin version bump per `versioning` concern.

Decision points (deferred to design discussion):
- Self-hosted runner vs `ubuntu-latest`. Default to `ubuntu-latest` (docker preinstalled); document the self-hosted upgrade path.
- Label name configurable via skill arg. Default `sandcastle`.
- Anthropic API key vs Claude Code Max subscription. Workflow requires `ANTHROPIC_API_KEY` secret OR falls back to Codex via existing `OPENAI_API_KEY` mount.

Migration cost: low. Substrate already on disk. This epic only adds trigger + scaffold.

## Sources

1. `/Users/don/Documents/plugin-hive-ui-f/hive/lib/sandcastle-provider.js:6-23,87,220-223,259-297`
2. `/Users/don/Documents/plugin-hive-ui-f/hive/lib/sandcastle-log-redaction.js:64-71`
3. `/Users/don/Documents/plugin-hive-ui-f/skills/hive/skills/execute-mode-sandcastle/SKILL.md`
4. `/Users/don/Documents/plugin-hive-ui-f/skills/hive/skills/sandbox-setup/SKILL.md:15-49`
5. `/Users/don/Documents/plugin-hive-ui-f/.pHive/epics/sandcastle-adoption-followon/epic.yaml`
6. `/Users/don/Documents/plugin-hive-ui-f/docs/reports/litellm-vs-sandcastle.md`
7. https://github.com/mattpocock/sandcastle — README, docs/agents/issue-tracker.md
8. https://www.npmjs.com/package/@ai-hero/sandcastle — templates, Dockerfile contract
9. https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#issues — `on: issues` event types
