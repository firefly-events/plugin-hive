# Session System Prompt Spec

**Version:** 1.0  
**Status:** Authoritative  
**Audience:** Phase 2 implementers (story-execution-migration, S9)  
**Last updated:** 2026-04-13

---

## Section 1: Overview

### Purpose

This document is the authoritative design spec for Managed Agent API session prompts used in Phase 2 of the Memory & Autonomous Execution epic. Phase 2 replaces TeamCreate-based agent spawning with persistent API sessions. This spec is sufficient for a developer to build session creation without additional clarification.

### Relationship to Phase 2 Stories

Story `story-execution-migration` (S9) builds the session creation logic using this spec as its primary reference. No other document supersedes this spec for session prompt construction.

### Managed Agent API Session Model

- **Session creation:** `POST /v1/sessions` with a `system_prompt` body field
- **Message delivery:** `POST /v1/sessions/{id}/messages` as sequential `user_turn` events
- **State persistence:** Session maintains full conversation context between turns; each `user_turn` sees all prior exchanges
- **Session granularity:** One session per workflow step (not one per story). Each step — research, implement, test, review — gets a fresh session with fresh system prompt injection
- **System prompt role:** Sets agent identity, domain constraints, prior knowledge, and KG decision context. Does not change between turns in a session
- **User turn role:** Delivers per-step task instructions and story context. Can be sent multiple times within a session for sub-task follow-up

---

## Section 2: Agent Role → System Prompt Mapping

### Table

| Role | Persona Source | System Prompt Template | Notes |
|------|----------------|----------------------|-------|
| `researcher` | `hive/agents/researcher.md` | See template below | Read-only by default; may write to `.pHive/` and `hive/memory/` |
| `developer` | `hive/agents/backend-developer.md` or `hive/agents/frontend-developer.md` (resolved by story domain) | See template below | Resolves to backend or frontend based on `story.domain` field |
| `tester` | `hive/agents/test-architect.md` | See template below | Write access scoped to `tests/` and `.pHive/` |
| `reviewer` | `hive/agents/reviewer.md` | See template below | Read-only; writes review artifacts to `.pHive/episodes/` |

### System Prompt Template (all roles)

```
{full content of hive/agents/{role}.md}

---

{prior_knowledge_block}

{kg_decision_context_block}

---

## Domain Access

You may modify files matching: {domain_patterns}

All other paths are read-only. Do not modify files outside your domain without explicit instruction.
```

**Template variable resolution:**

| Variable | Source | Behavior when empty |
|----------|--------|---------------------|
| `{full content of hive/agents/{role}.md}` | Read persona file verbatim | Error — persona is required |
| `{prior_knowledge_block}` | MemoryStore `read()` output, formatted per Section 3 | Omit block |
| `{kg_decision_context_block}` | KG `query_decisions()` output, formatted per Section 6 | Omit block |
| `{domain_patterns}` | `story.domain_patterns[]` from story YAML, or role default (see below) | Use role default |

**Role default domain patterns:**

| Role | Default Write Patterns |
|------|----------------------|
| `researcher` | `.pHive/`, `hive/memory/` |
| `backend-developer` | `src/`, `lib/`, `api/`, `.pHive/` |
| `frontend-developer` | `src/`, `components/`, `pages/`, `styles/`, `.pHive/` |
| `tester` | `tests/`, `__tests__/`, `spec/`, `.pHive/` |
| `reviewer` | `.pHive/episodes/` |

---

## Section 3: Prior Knowledge Injection

### Source

Prior knowledge comes from MemoryStore `read()`, which returns up to 5 memory entries. The read path uses:

- **L0/L1:** Keyword scan or wiki navigation (always available)
- **L3:** ChromaDB semantic re-ranking when available (improves relevance ordering)

See `hive/references/memory-store-interface.md` for full `read()` contract.

### KG Decision Context

Decision context from `query_decisions()` (Knowledge Graph) is a separate block and does **not** count against the 5-memory cap. See Section 6 for sourcing details.

### Placement in System Prompt

Prior knowledge is injected **after** the persona text and **before** the domain note. It appears in the middle section of the system prompt, between the identity section and the domain access section.

### Format

```
## Prior Knowledge

{N} memories loaded for {agent-role}:

**[{memory-name}]** (type: {type}, last verified: {date})
{memory content}

---

**[{memory-name}]** (type: {type}, last verified: {date})
{memory content}

---

[repeat for each memory entry]

### Decision Context (from knowledge graph)

- {subject} {predicate} {object} (since {valid_from}, via {source_epic})
- {subject} {predicate} {object} (since {valid_from}, via {source_epic})
```

### Character Limit and Truncation

If the Prior Knowledge block exceeds **4,000 characters**, apply truncation in priority order:

1. **Always include in full:** entries with type `override` or `pitfall`
2. **Truncate to first 200 chars each:** entries with type `reference` or `codebase`
3. **Drop lowest-recency entries:** if block still exceeds limit after steps 1–2, drop entries with the oldest `last_verified` dates until under limit

**Truncation signal:** Append the following line at the end of the Prior Knowledge block when any truncation occurs:

```
[{N} memories truncated for length]
```

Where `{N}` is the count of dropped or truncated entries.

---

## Section 4: Story Context Injection

Story YAML fields are mapped to session content as follows:

### Story Field → Session Location Mapping

| Story Field | Session Location | Format |
|-------------|-----------------|--------|
| `story.description` | First user_turn preamble | `## Story\n{description}` |
| `story.acceptance_criteria[]` | First user_turn | `## Success Criteria\n- {criterion}\n...` |
| `story.context.key_files[]` | First user_turn | `## Files to Read First\n- {path}: {purpose}\n...` |
| `story.steps[current].description` | Step user_turn | `## Your Task\n{step description}` |
| `story.references[]` | First user_turn (if present) | `## Reference Excerpts\n{excerpt}\n...` |
| `story.design_decisions[]` | First user_turn (if present) | `## Design Decisions (settled)\n- {decision}: {rationale}\n...` |

### First user_turn Structure (Session Initialization)

The first `user_turn` is sent immediately after session creation. It contains all story context the agent needs to understand scope before receiving step instructions.

```
## Story: {story.title}

## Your Task for This Step: {step.id} ({step.description one-liner})

## Story Description
{story.description}

## Success Criteria
- {criterion_1}
- {criterion_2}
- {criterion_N}

## Files to Read First
- {path_1}: {purpose_1}
- {path_2}: {purpose_2}

## Design Decisions (settled — do not re-debate)
- {decision_1}: {rationale_1}
- {decision_2}: {rationale_2}

## Reference Excerpts
{excerpt_1}

---

{excerpt_2}
```

Fields `Design Decisions` and `Reference Excerpts` are omitted if `story.design_decisions[]` and `story.references[]` are empty or absent.

### Step user_turn Structure (Subsequent Steps, Session Reuse)

If the orchestrator sends additional steps within the same session (sub-tasks within a single workflow step), each follow-up `user_turn` uses this minimal format:

```
## Next Step: {step.id}

{step.description}
```

---

## Section 5: Session Lifecycle

### Session Granularity

**One session per workflow step** (not per story). Each workflow step — research, implement, test, review — is a fresh session with fresh system prompt injection. This prevents context accumulation across steps, which would degrade prompt quality and waste tokens.

### Session Creation Sequence

1. Resolve agent role from story step definition
2. Load persona from `hive/agents/{role}.md`
3. Call `MemoryStore.read({role, story_id})` — returns up to 5 memory entries
4. Call `query_decisions({subject: story_id OR agent_role})` — returns KG decision triples
5. Compose system prompt: persona + prior knowledge block + KG decision context block + domain note
6. `POST /v1/sessions` with composed `system_prompt`
7. `POST /v1/sessions/{id}/messages` with first user_turn (story context + step instructions)

### Step Completion Detection

The orchestrator sends the step `user_turn` and waits for the session to produce a response indicating completion. Completion is detected by any of the following signals:

1. **Structured output:** Response contains a YAML or JSON artifact block (indicating a file was written)
2. **Completion phrase:** Response ends with `"Step complete."` or `"Implementation complete."`
3. **Timeout:** If no completion signal within `story.steps[current].timeout_ms`, the orchestrator sends a follow-up `user_turn`:
   ```
   Are you done? Reply "Step complete." when finished.
   ```
   If no signal after one follow-up, the orchestrator marks the step as `timed_out` and escalates.

### Session Reuse vs Fresh Session

| Scenario | Action |
|----------|--------|
| Sub-task within the same workflow step | Reuse current session; send additional `user_turn` |
| Moving from one workflow step to the next (e.g., research → implement) | Always create a **fresh session** |
| Resuming after a timeout escalation | Create a fresh session; re-inject full story context |

### Session Cleanup

After step completion (success or timeout escalation), close the session:

```
DELETE /v1/sessions/{id}
```

Sessions must not be left open. The orchestrator is responsible for cleanup even on error paths.

---

## Section 6: KG Decision Context Injection

### Source

Call `query_decisions()` with subject scoped to the story or agent role:

```
query_decisions({ subject: story_id })
query_decisions({ subject: agent_role })
```

Both calls are merged; deduplication is by triple identity `(subject, predicate, object)`. See `hive/references/knowledge-graph-schema.md` for the full `query_decisions()` contract.

### Placement Decision

KG decision context is placed in the **system prompt** (not in a `user_turn`). Rationale: decision context answers "what has been settled about this story/epic?" — it is background knowledge and a constraint on agent behavior, not a per-step instruction. Placing it in the system prompt ensures the agent carries this context through all `user_turns` in the session.

### Format

The KG block appears inside the Prior Knowledge section (see Section 3):

```
### Decision Context (from knowledge graph)

- {subject} {predicate} {object} (since {valid_from}, via {source_epic})
- {subject} {predicate} {object} (since {valid_from}, via {source_epic})
```

Each line represents one decision triple from the KG.

### Fallback

If `query_decisions()` returns no triples, or if the KG service is unavailable, **omit the block silently**. Do not include an empty "Decision Context" header. Do not surface the error to the agent.

---

## Open Questions (tracked)

| ID | Question | Impact |
|----|----------|--------|
| OQ2 | Memory pre-seeding: inject at session start (current spec) vs. load on-demand during session | Affects Section 3 — current spec assumes pre-seeding |
| OQ3 | Managed Agents GA status: if still beta, implementation must handle rate limits and fallback paths | Affects Section 5 session creation error handling |

These questions do not block spec authoring. Implementers should check Linear for resolution status before building.
