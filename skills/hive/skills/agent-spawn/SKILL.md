# Agent Spawn Skill

Spawn a roster agent with full config validation, persona injection, and memory loading. This skill enforces the pre-spawn checklist from the orchestrator persona — use it instead of raw TeamCreate or Agent calls for story-level work.

**Input:** `$ARGUMENTS` contains the agent name and story context.

## When to Use

- **Orchestrator** spawning a team lead or specialist for a story
- **Team lead** spawning sub-workers (developer, tester, reviewer) for workflow steps
- Any time a roster agent needs to be created with its full persona and context

## When NOT to Use

- Quick inline questions where Agent tool is sufficient (no persona needed)
- The orchestrator deciding to handle work solo (no spawn needed)

## Procedure

### 1. Validate the agent name

Check that the requested agent exists in the roster:

```
hive/agents/{agent-name}.md
```

If the file does not exist: **STOP. Do not improvise a replacement.** Report the error and suggest the closest roster match.

Available roster (check `hive/agents/` for the current list):
`researcher`, `technical-writer`, `developer`, `frontend-developer`, `backend-developer`, `tester`, `reviewer`, `architect`, `analyst`, `tpm`, `ui-designer`, `pair-programmer`, `peer-validator`, `team-lead`, `test-scout`, `test-worker`, `test-inspector`, `test-sentinel`, `test-architect`

### 2. Read the agent's persona and config

Read `hive/agents/{agent-name}.md` in full. Parse the YAML frontmatter to extract:

- `model` → maps to the `model` parameter on Agent/TeamCreate
- `knowledge` → memory paths to load
- `skills` → skills to inject if their `use-when` matches the task
- `tools` → tool list for the agent
- `required_tools` → external tools to validate
- `domain` → write restrictions to communicate to the agent

### 3. Check required tools

For each entry in `required_tools`:

- **CLI tools** (`type: cli`): run `which {name}` to check availability
- **MCP tools** (`type: mcp`): check if the MCP server is in the active session

If a required tool is missing:
- If `fallback` is specified: note the fallback, proceed with a warning
- If no `fallback`: **STOP. Report the missing tool.** Do not silently proceed.

### 4. Resolve all paths

Before reading any `knowledge` or `skills` paths, normalize them:

- `~` or `~/` → expand to the user's home directory (`$HOME`)
- `${CLAUDE_PLUGIN_ROOT}` → expand to the plugin's installation directory
- Relative paths (no prefix) → resolve relative to the project root

**This is mandatory.** Paths containing unexpanded `~` or `${CLAUDE_PLUGIN_ROOT}` will silently fail to resolve. Always expand before reading.

Validation: after expansion, check that the resolved path exists. If it doesn't and no fallback is specified, log a warning (don't block the spawn — the directory may not have been bootstrapped yet).

### 5. Load relevant memories

Read the agent's memory directory (from the resolved `knowledge` paths).

For each memory file:
1. Read the frontmatter `description` field
2. Check relevance to the current task (keyword match against story description)
3. Load the full content of relevant memories

Include relevant memories in the agent's prompt as a "Prior Knowledge" section.

### 6. Check for applicable skills

For each skill in the agent's `skills` list:
1. Read the `use-when` description
2. If it matches the current task, check if the skill file exists at the resolved path
3. If the file exists: read it and include in the agent's prompt
4. If the file does not exist and `optional: true`: skip silently — the agent has fallback behavior
5. If the file does not exist and not optional: **STOP. Report the missing skill.**

### 7. Construct the spawn call

Build the Agent or TeamCreate call with:

```
Agent(
  prompt: [full persona markdown + story context + memories + skills + domain note],
  model: "{model}",  // opus, sonnet, or haiku
  name: "{agent-name}-{story-id}",
  description: "{agent-name} working on {story-id}"
)
```

**Prompt structure:**
1. **Persona** — the full agent markdown file (this is the system prompt)
2. **Domain note** — "You may modify files matching: {allow patterns}. Do not modify files outside this domain."
3. **Prior knowledge** — relevant memories from the agent's memory directory
4. **Applicable skills** — skill content if any matched
5. **Continuation Context** (respawn only) — if `respawn_summary_path` is provided, read the summary file and include it here. See step 7b below.
6. **Task** — the story spec, step instructions, and any inputs from prior steps

### 7b. Handle respawn continuation (optional)

If a `respawn_summary_path` is provided (indicating this is a respawn, not a fresh spawn):

1. **Read the respawn summary** from the provided file path
2. **Parse the frontmatter** to extract `respawn_iteration`, `story_id`, `step_id`
3. **Inject the summary** into the prompt as a "Continuation Context" section (position 5 in the prompt structure above), wrapped with:

```
## Continuation Context

You are continuing work from a previous instance of yourself (respawn iteration {N}).
Review the context below carefully before proceeding. Do not repeat completed work.
Verify the current state of files and tests before assuming the summary is accurate —
things may have changed since the previous instance wrote this.

{full respawn summary content}
```

If `respawn_summary_path` is NOT provided, skip this step entirely — behavior is unchanged from a normal fresh spawn.

### 8. Report spawn result

After spawning, report:
- Agent name and model tier used
- Respawn: yes (iteration {N} of 3) | no (fresh spawn)
- Required tools: available / missing (with fallback)
- Memories loaded: count and names
- Skills injected: count and names
- Continuation context: loaded from {path} | none
- Domain restrictions communicated

## Key Rules

1. **Never improvise replacements.** If a roster persona exists for the task, use it. If it fails, improve the persona — don't bypass it.
2. **Always inject the full persona.** Do not summarize, excerpt, or paraphrase the agent markdown.
3. **Always pass the model parameter.** Without it, the spawner may default to the wrong tier.
4. **Always load memories.** Memories are what make agents improve over time. Skipping them wastes accumulated knowledge.
5. **Always communicate domain.** The agent needs to know its write boundaries.
