---
name: persona-resolve
description: Resolve a Hive roster persona into validated persona_context for spawn callers. Inherits the caller's model and execution context.
---

# Hive Persona Resolve

Atomic skill, NOT inline `agent-spawn` prose. It validates a roster persona, parses its config, checks required external tools, resolves persona paths, and returns a reusable `persona_context`. It inherits the caller's model and does not choose or override it.

## Invocation contract

Call this skill once before loading memories, checking applicable skills, or constructing a spawn prompt.

**Inputs:** `agent_name` (roster agent slug) and optional `task_context` (story or task context used only for caller traceability; path resolution is independent of caller CWD).

**Outputs:** `persona_context` with `persona_text` (raw markdown body, post-frontmatter), `frontmatter` (parsed YAML dict, preserving unknown fields), `resolved_paths` (fully resolved `knowledge` paths and any `skills` paths), `validated_tools` (CLI and MCP availability flags), and `domain_constraints` (parsed `domain` field if present, else `None`).

**Side effects:** STOP for an unknown roster agent; STOP for a missing required tool without fallback; WARN and proceed for a missing required tool with fallback; WARN for a missing resolved knowledge or skill path without fallback.

## Process

### Step 1: Validate agent name against roster

Check that the requested agent exists in the roster:

```text
hive/agents/{agent_name}.md
```

If the file does not exist: **STOP. Do not improvise a replacement.** Report the error and suggest the closest roster match from the current contents of `hive/agents/`.

The validated `agent_name` is the basename without `.md`; preserve it for downstream spawn naming and memory isolation.

### Step 2: Read persona and parse YAML frontmatter

Read `hive/agents/{agent_name}.md` in full. Split YAML frontmatter from the markdown body.

Set `persona_context.persona_text` to the raw markdown body after the closing frontmatter delimiter. Do not summarize, excerpt, or paraphrase it.

Parse the frontmatter into `persona_context.frontmatter`. Consume these fields when present:

- `model` -> spawn model selection
- `knowledge` -> memory paths to resolve and load later
- `skills` -> skill paths and matching metadata for later applicable-skill checks
- `tools` -> allowed tool list for the agent
- `required_tools` -> external tool validation list
- `domain` -> write/read/delete restrictions to communicate to the agent

Unknown frontmatter fields are allowed and must remain in `persona_context.frontmatter` for forward compatibility.

Set `persona_context.domain_constraints` to the parsed `domain` value if present; otherwise set it to `None`.

### Step 3: Check required tools

For each entry in `persona_context.frontmatter.required_tools`:

- **CLI tools** (`type: cli`): run `which {name}` to check availability.
- **MCP tools** (`type: mcp`): check whether the named MCP server/tool is available in the active session.

Record each check in `persona_context.validated_tools` with the tool name, type, availability flag, and fallback value if declared.

If a required tool is missing:

- If `fallback` is specified: emit `[warn] required tool {tool} missing, using fallback {fallback}` and proceed.
- If no `fallback` is specified: **STOP** with `[error] required tool {tool} missing, no fallback declared`.

If a required tool is present, continue silently.

### Step 4: Resolve all paths

Before any caller reads `knowledge` or `skills` paths, normalize every path declared in `persona_context.frontmatter.knowledge` and `persona_context.frontmatter.skills`:

- `~` or `~/` -> expand to the user's home directory (`$HOME`)
- `${CLAUDE_PLUGIN_ROOT}` -> expand to the plugin's installation directory
- Relative paths with no prefix -> resolve relative to the project root

Relative paths are resolved against REPO ROOT, NOT caller CWD.

This follows the existing `agent-spawn` convention: "Relative paths (no prefix) -> resolve relative to the project root."

Store fully resolved paths under `persona_context.resolved_paths`, preserving enough source metadata to associate each resolved path with its original `knowledge` or `skills` entry.

Validation: after expansion, check that each resolved path exists. If it does not and no fallback is specified, log a warning and continue; missing knowledge directories may not have been bootstrapped yet.
