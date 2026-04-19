# Step 2: Load Memories

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT load all memories indiscriminately — filter for relevance to active epics
- Do NOT modify or delete any memory files during this step — read only
- Do NOT skip cross-cutting concerns — they affect planning and validation in later steps
- If no memories exist yet (new project), produce an empty memory summary and proceed

## EXECUTION PROTOCOLS

**Mode:** autonomous

Read memory files, filter for relevance, compile summary. No user interaction required.

## CONTEXT BOUNDARIES

**Inputs available:**
- State reconstruction report from step 1 (active epics, story statuses)
- `~/.claude/hive/memories/` — agent memory YAML files organized by agent name
- `.pHive/cross-cutting-concerns.yaml` — project-wide concerns (if present)

**NOT available:**
- User input (not needed until step 4)
- Story specs (loaded during execution phase)

## YOUR TASK

Load agent memories and cross-cutting concerns relevant to today's active epics so the standup report includes institutional knowledge from prior sessions.

## TASK SEQUENCE

### 0. Staged insight recovery (pre-step)

Before loading memories, check for unpromoted staged insights from prior sessions:

1. Scan `.pHive/insights/` for any `.md` or `.yaml` files
2. If no files found: skip to step 1
3. If files found: surface to the user —
   "Found {N} staged insights from a prior session that were not promoted.
   These may be lost if not promoted now.
   Options: (a) promote all now, (b) review individually, (c) skip"
4. If user selects promote: run the session-end promotion procedure (see step-08-session-end.md steps 2-4) for each staged insight
5. If user selects review: present each insight for individual keep/discard decision
6. If user skips: note that insights remain in `.pHive/insights/` for manual review later
7. Continue with step 1 (normal memory loading)

**Non-interactive mode:** If running in CI or automated mode (no TTY), skip the prompt and log:
"Staged insights found — run manual promotion to preserve."

### 1. Scan agent memory directories
List directories under `~/.claude/hive/memories/`. Each subdirectory is named for an agent (e.g., `developer/`, `tester/`, `architect/`). For each agent directory, list all `.md` memory files.

### 2. Read and filter memories
For each memory file, read its YAML frontmatter to extract:
- `name` — short identifier
- `description` — what this memory captures
- `type` — one of: `pattern`, `pitfall`, `override`, `codebase`, `process`
- `agent` — which agent this applies to
- `source_epic` — which epic produced this insight

Filter for relevance: a memory is relevant if:
- Its `source_epic` matches an active epic, OR
- Its `description` contains keywords that match active story descriptions, OR
- Its `type` is `override` or `process` (these apply broadly)

### 3. Load cross-cutting concerns
Check for `.pHive/cross-cutting-concerns.yaml`. If present, read all concerns. Each concern has:
- `id`, `title`, `description`
- `applies_when` — condition for when this concern is relevant
- `action` — what to do when it applies

These will be used in step 5 (validate stories) to evaluate per-story applicability.

### 4. Compile memory summary
Produce a structured summary. This output is consumed by step 3 (standup report) and also cached for the execution phase — when agents are spawned later in the session, the orchestrator uses this pre-filtered memory index instead of re-scanning from scratch.

```
## Memory Summary

### Agent Memories Loaded
| Agent | Memory | Type | Source Epic | Relevance |
|-------|--------|------|-------------|-----------|
| {agent} | {name} | {type} | {epic} | {why relevant} |

### Memories Skipped (not relevant to active epics)
- {agent}/{name}: {description} — skipped because {reason}

### Cross-Cutting Concerns
| ID | Title | Applies When |
|----|-------|-------------|
| {id} | {title} | {condition} |

### Key Insights for Today
- {Summarize the most important memories that should influence today's work}

### Per-Agent Memory Index (for spawn-time injection)
For each agent with relevant memories, list the memory file paths to inject:
- {agent}: [{memory-file-1.md}, {memory-file-2.md}]
- {agent}: [{memory-file-3.md}]
```

The per-agent memory index is the key consumable output. When the orchestrator or team lead spawns an agent later in the session, they read this index rather than re-scanning the memory directories. This saves time and ensures consistency — the same memories identified during standup are the ones injected during execution.

## SUCCESS METRICS

- [ ] All agent memory directories under `~/.claude/hive/memories/` scanned
- [ ] Each memory file's frontmatter read and relevance evaluated
- [ ] Cross-cutting concerns file checked and loaded (if present)
- [ ] Memory summary produced with loaded, skipped, and key insight sections
- [ ] No memory files modified or deleted

## FAILURE MODES

- Loading all memories without filtering — floods context with irrelevant information, wastes orchestrator's context window
- Skipping cross-cutting concerns — stories will not be validated against project-wide requirements in step 5
- Ignoring `override` type memories — these correct prior mistakes and must always be loaded
- Not reading the `description` field for keyword matching — misses relevant memories that came from different epics but apply to current work

## NEXT STEP

**Gating:** Memory summary is complete. Cross-cutting concerns loaded (or confirmed absent).
**Next:** Load `workflows/steps/daily-ceremony/step-03-present-standup.md`
**If gating fails:** Report which memory directories could not be read. Proceed with partial data if at least the state reconstruction from step 1 is available.
