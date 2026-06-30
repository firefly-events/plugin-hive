# Research Brief — Modernize Hive Model Routing for the Claude 5 Generation

**Epic:** model-routing-claude5  
**Researcher:** researcher  
**Date:** 2026-06-30  
**Scope:** Five stories (PLAN-Q-019, PLAN-Q-011, PLAN-Q-012, PLAN-Q-014, PLAN-Q-007)

---

## Summary

Hive's model routing documentation and configuration are anchored to the Claude 4 generation (`claude-sonnet-4-6`, `claude-opus-4-8`). No reference to `claude-sonnet-5` or `claude-fable-5` exists in the shipped baseline. The root-level maintainer override (`hive.config.yaml`) shows evidence of a Fable 5 trial conducted 2026-06-09 that was **fully reverted** by 2026-06-12 — the overrides for architect, tpm, tester, peer-validator, and developer all rolled back to `opus` tier. A second gap: `--fallback-model` chain passing through session dispatch has no implementation anywhere in the codebase. Third gap: organization-level model restriction precedence is entirely absent from documentation. Fourth gap: `Agent(model:…)` permission rules for model-gating are absent from `permission-patterns.md`. All five stories are documentation + config updates — no runtime code changes are required.

---

## Key Files & Surfaces

- `hive/hive.config.yaml`:150-175 — Shipped baseline model tier map. `opus: [orchestrator]`, `sonnet: [most agents]`, `haiku: [test-worker]`. All values are tier aliases (`opus`/`sonnet`/`haiku`), not concrete model IDs.
- `hive.config.yaml`:144-203 — Root maintainer override layer. Contains `model_tiers` (lines 147-176), `model_overrides` (lines 181-186), and `agent_backends` (lines 197-203). Critical: Fable trial evidence in comments vs. reverted values.
- `hive/references/agent-config-schema.md`:54-59 — Model tier table mapping alias to concrete model ID and use case. Currently: `opus → claude-opus-4-8`, `sonnet → claude-sonnet-4-6`, `haiku → claude-haiku-4-5-20251001`. No `fable` row, no `claude-sonnet-5` entry.
- `hive/references/agent-config-schema.md`:191-194 — Interaction with `hive.config.yaml`: `model_overrides` wins at spawn time over frontmatter. No mention of org-level restrictions.
- `hive/agents/orchestrator.md`:1-4 — Frontmatter: `model: opus`. Model tier routing table at lines 171-175 cites `claude-opus-4-8` and `claude-sonnet-4-6`. No `fable` reference.
- `hive/agents/architect.md`:1-4 — Frontmatter: `model: sonnet`. No `fable` reference.
- `hive/GUIDE.md`:205-215 — Consumer-facing model tier routing table. All agents mapped to `claude-sonnet-4-6` or `claude-opus-4-8`. No Claude 5 models.
- `hive/references/configuration.md`:95-117 — Sessions model: "`sessions.model` inherits from `model_tiers` when unset." No Fable 5 context/output limits. Explicitly excludes `agent_backends` from consumer docs (line 117: "external model routing such as `agent_backends`").
- `hive/references/permission-patterns.md`:94-174 — `Tool(param:value)` syntax documented with Bash/Edit/Write/MCP examples and a role-to-deny-list table. **No `Agent(model:…)` model-routing examples anywhere in the file.**
- `hive/references/hooks-conventions.md`:1-116 — PostToolUse hook conventions. No mention of permission rules as a preferred gating mechanism over hooks for model control.
- `.pHive/multica/agents.yaml`:1-289 — Per-agent Multica model pins. Hardcoded concrete IDs: `claude-sonnet-4-6` (researcher, developer, frontend-developer, backend-developer, etc.), `claude-opus-4-8` (architect, peer-validator, tester, tpm). The comment on line 53 says "architect on Fable 5" but the actual `model` field is `claude-opus-4-8` — reflecting the reverted state.
- `hive/lib/messages-session.js`:36 — `const DEFAULT_MODEL = 'claude-opus-4-8'` — hardcoded fallback in the session JS library. Not using a config-driven value.
- `skills/hive/skills/execute-mode-session/SKILL.md`:39 — Session model resolution: "Use the model from `hive_config.sessions.model` (or inherit from `model_tiers` for the story's primary agent)." Single model only; no ordered fallback chain.
- `hive/references/episode-schema.md`:153-159 — Model tier resolution hierarchy: `model_overrides` → `model_tiers` → `default (sonnet)`. Runtime source of truth is `hive.config.yaml`; frontmatter is documentation only.

---

## Patterns & Conventions

- **Tier aliases, not IDs in shipped baseline.** The shipped `hive/hive.config.yaml` uses `opus`, `sonnet`, `haiku` as tier names. Concrete model IDs appear only in documentation tables (`agent-config-schema.md`, `GUIDE.md`, `orchestrator.md`) and in the root maintainer override layer. Adding `fable` as a tier alias follows this pattern.
- **Root override wins for routing-sensitive keys.** Per `hive/references/skill-prelude.md`:50-54, skills that consult `agent_backends` or `model_overrides` must read root `hive.config.yaml` first; the shipped baseline is a consumer-safe fallback, not the live routing truth.
- **Frontmatter is documentation, not runtime.** `hive/references/episode-schema.md`:159 is explicit: "The helper MUST NOT read persona frontmatter `model:` fields from `hive/agents/*.md`." Frontmatter `model:` annotations exist for human readers; `hive.config.yaml` drives actual dispatch. This distinction must survive the Claude 5 update — updating frontmatter is documentation work, not runtime work.
- **Multica agents.yaml is a parallel source of truth.** `.pHive/multica/agents.yaml` pins concrete model IDs separately from `hive.config.yaml`. The two must be updated in sync; there is no automated enforcement. The Fable trial left this file in a confused state (comment says Fable, value says Opus).
- **Deny rules beat allow rules.** `permission-patterns.md`:108 and the role-to-deny-list make this explicit. Model-routing permission rules will follow the same pattern: deny-list `fable` for low-priority agents even if a broader allow is present.
- **Cross-cutting concerns: documentation + versioning always apply.** Any story touching agent-config-schema.md, orchestrator.md, hive.config.yaml (shipped baseline), GUIDE.md, or permission-patterns.md triggers both the `documentation` and `versioning` cross-cutting concerns.

---

## Constraints

- **`hive.config.yaml` (shipped baseline) is consumer-facing.** Adding a `fable` tier alias and Fable 5 context/output limits to the shipped baseline changes the consumer-visible surface → semver bump required.
- **Frontmatter `model:` must stay as an alias that matches `hive.config.yaml` tiers.** `agent-config-schema.md`:194 says "Agent frontmatter `model_tier` must match `hive.config.yaml` tiers." If `fable` is added as a tier, orchestrator and architect frontmatter can use `model: fable`; if not, they must use an existing alias.
- **`hive/references/configuration.md` explicitly excludes `agent_backends`.** Story PLAN-Q-012 cannot add `agent_backends.fallback_model` documentation to this file; it would violate the maintainer-boundary contract (line 117). A separate maintainer-facing reference or inline config comments are the correct venue.
- **No `--fallback-model` wiring exists.** `skills/hive/skills/execute-mode-session/SKILL.md` has no provision for an ordered fallback chain. Story PLAN-Q-012 requires both: (a) a new config key under `sessions` or `agent_backends`, and (b) updated session-invoke logic to pass the chain to the Claude CLI. Source: `hive/lib/messages-session.js`:36 and `skills/hive/skills/execute-mode-session/SKILL.md`:39.
- **`Agent(model:…)` permission syntax must be verified against Claude Code.** The codebase only shows `Tool(param:value)` patterns (e.g., `Bash(command:…)`, `Edit(file_path:…)`). Whether `Agent(model:claude-fable-5)` is a valid permission rule requires external docs verification.
- **Fable 5 trial was reverted.** Root `hive.config.yaml` comments record "reverted from fable 2026-06-12" for architect, tpm, tester, peer-validator. The new epic must decide whether to re-introduce Fable with a stable designation or establish a fresh policy that avoids repeating the trial's failure mode (details not documented).

---

## Risks

- **Severity: high** | Risk: Fable 5 re-introduction may repeat the June 2026 revert | Evidence: Root `hive.config.yaml` line 182-185 shows "reverted from fable 2026-06-12" for 4 roles without explanation of *why* it was reverted. Story PLAN-Q-011 must document the revert reason before re-designating Fable 5 as the default orchestrator model.
- **Severity: high** | Risk: `claude-sonnet-5` model ID may not be stable or available in all deployments | Evidence: No references in codebase; model ID `claude-sonnet-5` provided only via user context. Stories should add the model ID to documentation but also verify it's currently available.
- **Severity: medium** | Risk: Multica agents.yaml drift | Evidence: `.pHive/multica/agents.yaml` hardcodes `claude-opus-4-8` despite comment saying "Fable 5" — the file is out of sync with `hive.config.yaml` intent. Any story touching model IDs must also update this file or the two sources diverge again.
- **Severity: medium** | Risk: `--fallback-model` Claude CLI capability may not support chained fallbacks in the way the requirement describes | Evidence: No evidence of the flag in the codebase; the requirement text implies it's a known Claude CLI capability but story PLAN-Q-012 must validate before wiring Hive's config path to it.
- **Severity: medium** | Risk: `Agent(model:…)` permission syntax may not exist | Evidence: `permission-patterns.md` only shows `Tool(param:value)` with verified tool names (`Bash`, `Edit`, `Write`, `mcp__*`). If `Agent` is not a valid tool name in the Claude Code permission system, story PLAN-Q-007's examples will be non-functional.
- **Severity: low** | Risk: Org-level restriction documentation may require knowing the exact Anthropic org-policy API or UI path | Evidence: No internal documentation of this mechanism exists. Story PLAN-Q-014 will need to reference external Anthropic operator docs, which may change.

---

## Open Questions

- Why exactly were the Fable 5 overrides reverted on 2026-06-12? The reason is not documented in `hive.config.yaml`. Story PLAN-Q-011 must resolve this before re-designating.
- What is the verified model ID for Claude Sonnet 5? The user provides `claude-sonnet-5`; story PLAN-Q-019 should confirm this is the canonical ID before updating schema tables.
- Does the Claude CLI `--fallback-model` flag support an ordered chain (multiple values), and is it available in sessions mode? Story PLAN-Q-012 requires verifying the API contract before designing the config key.
- Is `Agent(model:claude-fable-5)` a valid Claude Code permission rule? The existing `permission-patterns.md` only shows `Tool(param:value)` with conventional tool names. Story PLAN-Q-007 must verify this syntax with Claude Code docs before documenting it.
- Should the `fable` tier be added to the shipped baseline `hive/hive.config.yaml` or remain a maintainer-only override in root `hive.config.yaml`? The `versioning` cross-cutting concern and consumer-facing scope depend on this decision.
- Does `.pHive/multica/agents.yaml` need to be updated alongside `hive.config.yaml`, and if so, does the author story own both updates?

---

## Inconsistency Risk Signals

- Signal: Vocabulary mismatch — root `hive.config.yaml` comments say "Fable 5 replaces Opus" (line 179) but the actual `model_overrides` values are all `opus` (reverted)  
  | Where: `hive.config.yaml`:179-186  
  | Detail: Comment and value contradict. Any story relying on comments to infer current policy will reach the wrong conclusion.

- Signal: Hidden assumption — the requirement states "`hive/references/configuration.md` documents `agent_backends.fallback_model`" but no such key exists in the file  
  | Where: `hive/references/configuration.md` (entire file)  
  | Detail: Either the requirement description is forward-looking (describing what WILL be added) or it cites a non-existent doc section. The design node must clarify before story authors begin.

- Signal: Unresolved tension — `episode-schema.md` says frontmatter is documentation-only and `hive.config.yaml` is the sole runtime source; but both sources (`hive.config.yaml` tiers and `.pHive/multica/agents.yaml` model pins) must be updated in sync with no enforced link  
  | Where: `hive/references/episode-schema.md`:159, `.pHive/multica/agents.yaml`  
  | Detail: PLAN-Q-011 and PLAN-Q-019 must update three surfaces simultaneously (hive.config.yaml, agents.yaml, doc tables) or risk silent drift.

- Signal: Convention violation — `permission-patterns.md` role-to-deny-list covers only Bash/Edit/Write patterns; no agent-spawn parameter gating examples exist  
  | Where: `hive/references/permission-patterns.md`:159-174  
  | Detail: PLAN-Q-007 introduces a new category (`Agent(model:…)`) not established by any existing example. The grill node should probe whether this syntax is real before the story authors commit to it.

- Signal: Posture mismatch — `hooks-conventions.md` describes PostToolUse hooks for tool interception but says nothing about model-gating via permissions as a preferred alternative  
  | Where: `hive/references/hooks-conventions.md`:1-116  
  | Detail: PLAN-Q-007 requirement says "permission rules are preferred over hooks for model gating" — this posture is not established anywhere in the codebase and will need explicit documentation.

---

## Cross-Cutting Concerns

Applicable to this epic (from `.pHive/cross-cutting-concerns.yaml`):

- **documentation** (id: documentation): Applies to all five stories. Every story modifies consumer-facing reference docs (`agent-config-schema.md`, `orchestrator.md`, `configuration.md`, `permission-patterns.md`, `GUIDE.md`, `hooks-conventions.md`). Planning checklist: identify every doc section that references old model IDs or tier names.
- **versioning** (id: versioning): Applies to stories that touch the shipped baseline `hive/hive.config.yaml`. At minimum: adding `fable` as a tier and context/output limit guidance. Bump level: minor (additive feature). Applies to PLAN-Q-011, PLAN-Q-019 at minimum.
- **metrics** (id: metrics): All five stories are documentation-only changes with no measurable runtime outcome → `metric.applies: false` with one-line justification per story ("documentation-only; no measurable throughput, coverage, latency, or error-rate change").

---

## Validation Note

```
VALIDATION NOTE:
  Checked: Claude Sonnet 5 (claude-sonnet-5), Fable 5 (claude-fable-5),
           Claude CLI --fallback-model capability, Claude Code Agent(model:) permission syntax
  Source: codebase-only
  Confidence: high (for current repo state); medium (for external API capabilities)
  Findings:
    - claude-sonnet-5: ABSENT from codebase; user-provided as current context
    - claude-fable-5: Referenced only in root hive.config.yaml comments and .pHive/multica/agents.yaml comments; no active config values use it
    - --fallback-model CLI flag: ABSENT from codebase; no session-invoke or execute-mode-session wiring found
    - Agent(model:...) permission syntax: ABSENT; unverified against Claude Code runtime
    - context7 MCP not consulted (codebase-only research; all relevant files are local)
```
