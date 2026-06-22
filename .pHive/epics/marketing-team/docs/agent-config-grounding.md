# Agent-Config Grounding — Marketing Team Personas

Authoring contract for `b1`/`b2`/`b3`. The three marketing personas are authored
**once** as Hive persona `.md` files, but must dispatch cleanly to **both** runtimes
Hive routes to (Claude Code Agent tool, and the Codex backend via `agent_backends`).
This doc pins the full config spec of each runtime — verified at plan time, June 2026 —
so the personas degrade cleanly on either backend, not just the frontmatter.

> Verified sources:
> - Claude Code: repo's own `hive/references/agent-config-schema.md` (canonical Hive
>   schema, aligned to CC runtime, v2.1.181).
> - Codex: `developers.openai.com/codex/{guides/agents-md, subagents, config-reference,
>   config-advanced}` + `github.com/openai/codex` (`codex-rs/config`, `core/src/config/agent_roles.rs`,
>   `exec/src/lib.rs`). Codex ~0.13x. KB labels: `codex-config-reference`,
>   `codex-config-advanced`, `codex-agents-md`, `codex-subagents`.

---

## 1. Claude Code subagent contract (what CC actually parses)

| Field | Req | Values | Semantics |
|---|---|---|---|
| `name` | ✓ | kebab-case 3–50, `[a-z0-9-]`, alnum ends | unique per location |
| `description` | ✓ | prose; `<example>` blocks if auto-triggered | drives delegation; third person |
| `model` | ✓ | `opus` \| `sonnet` \| `haiku` \| `inherit` | tier selector; `hive.config.yaml` `model_overrides` win at spawn |
| `color` | ✓ | blue/cyan/green/yellow/magenta/red | UI only, no behavior |
| `tools` | ✗ | capitalized array, e.g. `["Grep","Glob","Read","Write"]` | **omit = inherit ALL**; allowlist = restrict (case-sensitive) |

Model tiers: `opus → claude-opus-4-8`, `sonnet → claude-sonnet-4-6`, `haiku → claude-haiku-4-5-20251001`.

**Hive-only fields** (CC runtime ignores; Hive orchestrator + reviewer consume):
`knowledge: [{path, use-when}]`, `skills: [{path, use-when, optional?}]`,
`required_tools: [{name, type(mcp|cli), fallback}]`, `domain: [{path, read, write, delete}]`.

Body: 150–400 words, sections `# Name` → identity → `## Activation Protocol` →
`## What you do` → `## Areas of expertise` → `## Quality standards` → `## Output format` →
`## Insight capture`. File precedence: project `.claude/agents/` > user `~/.claude/agents/`
> plugin `agents/` (plugin personas like these are shadowable).

## 2. Codex CLI agent contract (DIFFERENT — TOML, not md+frontmatter)

Codex personas are **standalone TOML**, not markdown-with-frontmatter:
- Location: `~/.codex/agents/<name>.toml` (personal) or `.codex/agents/<name>.toml` (project).
- **Required:** `name`, `description`, `developer_instructions` (the persona/system-prompt
  body, TOML triple-quoted string).
- **Optional (inherit from parent if omitted):** `model`, `model_reasoning_effort`
  (`minimal|low|medium|high`), `sandbox_mode` (`read-only|workspace-write|danger-full-access`),
  `[mcp_servers.*]`, `skills.config`.
- Inline alternative: `[agents.<name>]` in `config.toml` with `config_file` pointing at the
  role TOML. Built-ins: `default`, `worker`, `explorer`.
- `AGENTS.md` is freeform markdown, **no frontmatter** — project conventions, not persona def.
- `model_instructions_file` (config key; renamed from deprecated `experimental_instructions_file`)
  = custom system-prompt override.

**Dispatch (orchestrator → Codex):** `codex exec "<prompt>"` (or `codex exec -` for stdin).
Persona injection: `--profile <name>` | `model_instructions_file` | `-c key=value` dotted
TOML overrides (`-c model=… -c model_reasoning_effort=high -c sandbox_mode=…`).

## 3. The dual-dispatch mapping (the authoring rule for b1/b2/b3)

Author each persona as a **Hive `.md`** (§1 superset). The mapping below is how each field
must survive both backends — the persona must be written so NO field is backend-essential
that the other backend drops silently.

| Hive persona `.md` field | → Claude Code | → Codex |
|---|---|---|
| `name` | `name` | `name` (TOML) |
| `description` | `description` (delegation) | `description` (TOML) |
| persona **body** (the `# …` prose) | system prompt | `developer_instructions` (triple-quoted) |
| `model: opus\|sonnet\|haiku` | native tier | map to Codex `model` + `model_reasoning_effort` per `agent_backends`/`model_overrides` |
| `tools: [...]` | native allowlist | not a Codex persona field → enforce via `sandbox_mode` + MCP allow/deny |
| `domain` (Hive) | reviewer-enforced | reviewer-enforced + `sandbox_workspace_write.writable_roots` |
| `knowledge`/`skills`/`required_tools` | Hive-only | Hive-only (load into prompt; `skills.config` if used) |
| `color` | UI | dropped (no Codex analog) — non-essential by design |

**Authoring rules that fall out of this:**
1. Keep the persona **body** self-sufficient as a system prompt — it is the one artifact
   both backends consume (CC system prompt == Codex `developer_instructions`). Do not put
   behavior-critical instructions only in Hive-only fields.
2. Express tool restriction as a `tools` allowlist AND state the intent in prose, so the
   Codex path (which has no `tools` field) can honor it via sandbox/MCP config.
3. `model` stays a tier word (`opus|sonnet|haiku|inherit`); never hard-code a model id in
   frontmatter (per `feedback_frontmatter_base_tier_not_override` — frontmatter is base tier,
   runtime promotion lives in `hive.config.yaml`).
4. Nothing backend-essential may live in `color` or any CC-only/Codex-only field.

## 4. Reviewer checklist for b1/b2/b3 (add to each persona's review step)
- [ ] Frontmatter has all 5 CC fields (`name`,`description`,`model`,`color`,`tools`) + Hive
      `knowledge`/`domain`; `model` is a tier word, not a model id.
- [ ] Body is a valid standalone system prompt (works verbatim as Codex `developer_instructions`).
- [ ] Tool restriction stated in both `tools` allowlist and prose.
- [ ] No behavior-critical instruction lives only in a Hive-only or CC-only field.
- [ ] `name` kebab-case, unique; mirrors `hive/agents/ui-designer.md` structure.
