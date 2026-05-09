# Session System Prompt Spec

**Version:** 2.0
**Status:** Authoritative
**Audience:** Wave 3 / Group A implementers (S5/A2 messages-session loop, S6/A3 prior_knowledge_block, S14/B1 Outcomes graders)
**Last updated:** 2026-05-09
**Supersedes:** v1.0 (2026-04-13). v1.0 §1 described a `POST /v1/sessions` + `system_prompt:` body shape that does not exist on the public Anthropic Sessions API (researcher SDK probe 2026-05-07; cycle-state escalation `architecture:spec-drift`). The Sessions-API path is reframed in §7 as the cloud adapter behind `execution.substrate: sessions-cloud`.

---

## Section 1: Overview

### Purpose

This document is the authoritative design spec for **Hive's internal session abstraction over the Anthropic Messages API**. It defines the contract a developer needs to build a session loop without further clarification: which API surface to call, what goes in which slot of the request, how the orchestrator drives the tool-use cycle, and when a turn terminates.

The substrate is **caller-side**: the orchestrator process holds the conversation state, dispatches tool calls, and decides when the agent is done. There is no server-side agent runtime in the default path.

### Substrate semantics

Hive sessions run on `client.messages.create` (Messages API, GA, stable). One agent's working interval is a **session**; one back-and-forth between the orchestrator and the model is a **turn**.

Each request to the Messages API carries three slots that together form the agent's working context for the turn:

- **`system:`** — agent identity (persona text), prior knowledge block, KG decision context block, and domain-access note. Composed once at session creation; **does not change between turns within a session**.
- **`tools:`** — the tool definitions the agent is allowed to call this turn. Resolved from the persona's declared tools plus any per-step overrides. Stable for the life of the session unless a step explicitly narrows or widens the toolset.
- **`messages:`** — the running conversation history. The orchestrator appends to this list across turns; nothing is dropped between turns within a session.

### Turn loop

A single turn proceeds as follows:

1. Orchestrator appends a `user` message (story context on the first turn; step instructions or a tool-result block on subsequent turns) to `messages:`.
2. Orchestrator calls `client.messages.create({ model, system, tools, messages, max_tokens })`.
3. The response carries a `stop_reason` and a list of `content` blocks. Two cases:
   - **`stop_reason: "tool_use"`** — the response contains one or more `tool_use` blocks. The orchestrator (a) appends the assistant message verbatim to `messages:`, (b) dispatches each tool call locally, (c) appends a `user` message containing one `tool_result` block per `tool_use` (matched by `tool_use_id`), and (d) loops back to step 2.
   - **`stop_reason: "end_turn"`** — the assistant has finished producing output for this turn. The orchestrator records the final assistant message and exits the turn loop.
4. Other `stop_reason` values (`max_tokens`, `pause_turn`, `refusal`) are surfaced as turn-level errors per `hive/references/error-handling.md`; the substrate does not retry automatically.

### Termination

A session terminates when any of the following fires:

- **`end_turn` on a step that is the workflow's last step.** The orchestrator marks the step complete and closes the session.
- **Per-turn budget hit.** A single turn produces no `end_turn` after `circuit_breakers.max_tool_iterations` tool-use cycles (default 25). The orchestrator records `terminated: turn_budget` and escalates per `error-handling.md`.
- **Per-story budget hit.** Cumulative tokens across all turns in the session exceed `tokens.per_story_limit` (resolved from `hive/hive.config.yaml`). The orchestrator records `terminated: story_budget` and escalates.
- **Explicit caller close.** Workflow logic decides the agent is done (e.g., a downstream gate failed) and closes the session.

### Relationship to Wave 3 stories

This spec is the contract that S5/A2 (Messages-API session loop module), S6/A3 (`prior_knowledge_block` + two-call merge), and S14/B1 (Outcomes graders) build against. No other document supersedes this spec for session-prompt construction.

---

## Section 2: Agent Role → System Prompt Mapping

### Table

This table covers only the four Phase 2 / Wave 3 workflow roles (`researcher`, `developer`, `tester`, `reviewer`). The full orchestrator roster — `technical-writer`, `architect`, `analyst`, `tpm`, `ui-designer`, `pair-programmer`, `peer-validator`, `team-lead`, plus specialist agents — will be mapped in subsequent waves. Treat this mapping as partial and Wave-3-scoped, not exhaustive.

| Role | Persona Source | System Prompt Template | Notes |
|------|----------------|----------------------|-------|
| `researcher` | `hive/agents/researcher.md` | See template below | Read-only by default; may write to `.pHive/` and `hive/memory/` |
| `developer` | `hive/agents/backend-developer.md` or `hive/agents/frontend-developer.md` (resolved by story domain) | See template below | Resolves to backend or frontend based on `story.domain` field |
| `tester` | `hive/agents/tester.md` | See template below | Write access scoped to `tests/` and `.pHive/` |
| `reviewer` | `hive/agents/reviewer.md` | See template below | Read-only; writes review artifacts to `.pHive/episodes/` |

### Developer Role Resolution

Map `story.domain` to persona file:

- `backend`, `api`, `database`, `service` → `hive/agents/backend-developer.md`
- `frontend`, `ui`, `components`, `web` → `hive/agents/frontend-developer.md`

If `story.domain` is missing or matches no entry above, session creation must raise an error. Do not guess a default — story authors are responsible for declaring `domain` explicitly.

### System Prompt Template (all roles)

The composed string is passed verbatim as the `system:` argument to `client.messages.create`:

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

See `hive/references/memory-store-interface.md` for the full `read()` contract.

### KG Decision Context

Decision context from `query_decisions()` (Knowledge Graph) is a separate block and does **not** count against the 5-memory cap. See Section 6 for sourcing details.

### Placement in System Prompt

The `prior_knowledge_block` lives in the **`system:` slot** of the Messages-API request — composed at session creation, immutable across turns. It is injected **after** the persona text and **before** the domain-access note, exactly as shown in the §2 template.

Rationale for the system slot: prior knowledge answers "what does this agent already know going into the session?" — it is durable context, not per-step instruction. Placing it in `system:` (a) keeps it stable across every turn without re-sending, and (b) makes it cache-eligible when prompt caching is enabled (see §7 caching note).

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

### Truncation rules

The `prior_knowledge_block` participates in a **single shared token budget** with the persona text, KG decision context, and domain-access note: the assembled `system:` string must fit within `tokens.system_prompt_budget` (default 4,000 tokens, resolved from `hive/hive.config.yaml`).

When the assembled `prior_knowledge_block` would push `system:` over budget, apply truncation in this order:

1. **Always include in full:** entries with type `override` or `pitfall`.
2. **Truncate to first 200 chars each:** entries with type `reference` or `codebase`.
3. **Drop oldest by `last_verified` first:** if `system:` still exceeds budget after steps 1–2, drop entries in ascending `last_verified` order (oldest first) until under budget. Entries without a `last_verified` timestamp are treated as oldest and drop first.

**Budget scope:** The budget covers the full assembled `system:` string. Decision Context (KG triples from `query_decisions()`) is exempt from per-entry truncation (steps 1–2) and is never shortened mid-line, but it does count toward the overall `system:` budget. If the Decision Context block alone exceeds half the budget, log a warning and proceed — do not truncate triples.

**Truncation signal:** Append the following line at the end of the `prior_knowledge_block` when any truncation occurs:

```
[{N} memories truncated for length]
```

Where `{N}` is the count of dropped or per-entry-truncated memories. Do not include dropped/truncated KG triples in this count.

---

## Section 4: Story Context Injection

Story YAML fields are mapped to the **first user message** (the first entry the orchestrator appends to `messages:` after composing `system:`).

### Story Field → Message Location Mapping

| Story Field | Message Location | Format |
|-------------|------------------|--------|
| `story.description` | First user message preamble | `## Story\n{description}` |
| `story.acceptance_criteria[]` | First user message | `## Success Criteria\n- {criterion}\n...` |
| `story.context.key_files[]` | First user message | `## Files to Read First\n- {path}: {purpose}\n...` |
| `story.steps[current].description` | Step user message | `## Your Task\n{step description}` |
| `story.references[]` | First user message (if present) | `## Reference Excerpts\n{excerpt}\n...` |
| `story.design_decisions[]` | First user message (if present) | `## Design Decisions (settled)\n- {decision}: {rationale}\n...` |

### First user message structure (session initialization)

The first user message is the very first entry appended to `messages:` after `system:` is composed. It contains all story context the agent needs to understand scope before receiving step instructions.

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

The `Design Decisions` and `Reference Excerpts` sections are omitted if `story.design_decisions[]` and `story.references[]` are empty or absent.

### Step user message structure (subsequent steps within the same session)

If the orchestrator drives additional sub-tasks within the same session, each follow-up user message uses this minimal format:

```
## Next Step: {step.id}

{step.description}
```

---

## Section 5: Session Lifecycle

### Session Granularity

**One session per workflow step** (not per story). Each workflow step — research, implement, test, review — is a fresh session with fresh `system:` composition. This prevents context accumulation across steps, which would degrade prompt quality and waste tokens.

### Session Creation Sequence

1. Resolve agent role from the story step definition.
2. Load persona from `hive/agents/{role}.md`.
3. Build a query string from `story.description` plus `story.steps[current].description` (and any other story context fields the implementer chooses), then call `MemoryStore.read(query)` — returns up to 5 memory entries. The interface contract in `hive/references/memory-store-interface.md` defines `read(query: string)`; do NOT pass an object.
4. Call `query_decisions({ entity: story_id })` and `query_decisions({ entity: agent_role })` (two explicit calls), then merge per Section 6.
5. Compose the `system:` string: persona + `prior_knowledge_block` + `kg_decision_context_block` + domain note.
6. Initialize an empty `messages: []` array and resolve `tools:` from the persona's declared tools plus any per-step overrides.
7. Append the first user message (story context + step instructions) to `messages:`.
8. Enter the turn loop (§1).
9. Allocate a Hive `session_id` and persist the session metadata to `.pHive/sessions/index.yaml` via `session-registry.js` (see `session-registry-schema.md`). When `process.env.CLAUDE_CODE_SESSION_ID` is present, stamp it onto the registry entry's `cc_session_id` field — Hive's `session_id` remains canonical for KG `source_epic` / `source_session`.

### Step Completion Detection

The substrate's terminal signal is `stop_reason: "end_turn"` from the Messages API (§1). The orchestrator does not poll for completion — it consumes the response stream from `client.messages.create` synchronously per turn.

If a turn loop hits the per-turn budget (`circuit_breakers.max_tool_iterations`) without producing `end_turn`, the orchestrator sends a follow-up user message:

```
Are you done? Reply with a final summary when finished.
```

If the next turn still does not yield `end_turn`, mark the step `timed_out` and escalate per `error-handling.md`.

### Session Reuse vs Fresh Session

| Scenario | Action |
|----------|--------|
| Sub-task within the same workflow step | Reuse current session; append additional user message and run another turn |
| Moving from one workflow step to the next (e.g., research → implement) | Always create a **fresh session** |
| Resuming after a timeout escalation | Create a fresh session; re-inject full story context |

### Session Cleanup

On step completion (success or timeout escalation), the orchestrator:

1. Records the final session state (token usage, terminator reason, last assistant message) to `.pHive/sessions/index.yaml`.
2. Drops the in-memory `messages:` array.

There is no remote `DELETE` call in the default substrate — sessions are caller-side state, so cleanup is local. The cloud adapter (§7) does issue a remote close; see that footnote.

---

## Section 6: KG Decision Context Injection

### Source — two-call merge

Decision context is sourced from **two explicit calls** to `query_decisions()`:

```
story_triples = query_decisions({ entity: story_id })
role_triples  = query_decisions({ entity: agent_role })
```

Both calls always run; do not skip the role call when the story call returns triples (and vice versa). The triples are merged into a single ordered list per the rules below.

### Dedupe rule

After concatenating `story_triples` and `role_triples`, deduplicate by triple identity `(subject, predicate, object, valid_from)` — including `valid_from` preserves distinct historical entries when a triple has been superseded and re-asserted.

(Note: this read-time merge key differs from the writer-side unique index `(subject, predicate, object, source_epic)` defined in `knowledge-graph-schema.md`; the writer key enforces idempotent inserts per epic, while the reader key preserves time-versioned semantics.) See `hive/references/knowledge-graph-schema.md` for the full `query_decisions()` contract.

### Merge ordering

Story-id-scoped triples sort **before** role-scoped triples in the rendered block. Within each group, sort by `valid_from` descending (most recent first). Rationale: story-scoped triples are tighter context for the current task; role-scoped triples are durable background. Putting story first puts the most relevant lines closest to where the model attends.

A triple that appears in both groups (matched by the dedupe key above) is rendered **once** in the story group and dropped from the role group.

### Placement Decision

The `kg_decision_context_block` is placed in the **`system:` slot** (composed at session creation, immutable across turns). Rationale matches §3: decision context is durable background that constrains agent behavior, not a per-step instruction. Placing it in `system:` ensures the agent carries this context through every turn in the session and keeps it cache-eligible.

### Format

The KG block appears inside the Prior Knowledge section (see Section 3):

```
### Decision Context (from knowledge graph)

- {subject} {predicate} {object} (since {valid_from}, via {source_epic})
- {subject} {predicate} {object} (since {valid_from}, via {source_epic})
```

Each line represents one decision triple from the merged list, in the order defined above.

### Fallback

If both `query_decisions()` calls return empty lists, or if the KG service is unavailable, **omit the block silently**. Do not include an empty "Decision Context" header. Do not surface the error to the agent.

---

## Section 7: Fixture Example and Cloud Adapter

### Fixture: a single tool-use cycle

This is the on-the-wire shape of one turn for a `researcher` session whose first step is "find the canonical example of `messages.create` in this repo." The orchestrator composes `system:` + `tools:` once at session creation and appends to `messages:` across turns.

**Turn 1 request** (orchestrator → API):

```python
client.messages.create(
    model="claude-opus-4-7",
    max_tokens=4096,
    system=(
        "# Researcher\n"
        "You are a precise researcher who gathers raw findings...\n"
        "---\n"
        "## Prior Knowledge\n\n"
        "2 memories loaded for researcher:\n\n"
        "**[research-sprawl-prevention]** (type: pitfall, last verified: 2026-04-22)\n"
        "Broad prompts plus the Explore agent spiral; use targeted reads.\n\n"
        "---\n\n"
        "**[memory-store-interface]** (type: reference, last verified: 2026-05-02)\n"
        "MemoryStore.read(query: string) returns up to 5 entries...\n\n"
        "### Decision Context (from knowledge graph)\n\n"
        "- session-spec uses Messages-API substrate (since 2026-05-09, via cwc-2026-integration)\n"
        "---\n\n"
        "## Domain Access\n\n"
        "You may modify files matching: .pHive/, hive/memory/\n"
    ),
    tools=[
        {
            "name": "Read",
            "description": "Read a file from the local filesystem.",
            "input_schema": {
                "type": "object",
                "properties": {"file_path": {"type": "string"}},
                "required": ["file_path"],
            },
        },
        {
            "name": "Grep",
            "description": "Search for a pattern in files.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["pattern"],
            },
        },
    ],
    messages=[
        {
            "role": "user",
            "content": (
                "## Story: Find canonical messages.create example\n"
                "## Your Task for This Step: research-01 (locate example in repo)\n"
                "## Story Description\nWe need one in-repo reference site for ...\n"
                "## Success Criteria\n- Identify file path\n- Quote the call site\n"
                "## Files to Read First\n- hive/lib/: substrate code lives here\n"
            ),
        },
    ],
)
```

**Turn 1 response** (`stop_reason: "tool_use"`):

```json
{
    "id": "msg_01ABC",
    "role": "assistant",
    "model": "claude-opus-4-7",
    "stop_reason": "tool_use",
    "content": [
        {"type": "text", "text": "I'll start by searching for messages.create in hive/lib."},
        {
            "type": "tool_use",
            "id": "toolu_01XYZ",
            "name": "Grep",
            "input": {"pattern": "messages.create", "path": "hive/lib"}
        }
    ]
}
```

**Turn 2 request** — orchestrator appends the assistant message verbatim, then appends a user message containing the matching `tool_result`:

```python
messages = [
    # ... prior turn-1 user message ...
    {
        "role": "assistant",
        "content": [
            {"type": "text", "text": "I'll start by searching for messages.create in hive/lib."},
            {
                "type": "tool_use",
                "id": "toolu_01XYZ",
                "name": "Grep",
                "input": {"pattern": "messages.create", "path": "hive/lib"},
            },
        ],
    },
    {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "toolu_01XYZ",
                "content": "hive/lib/messages-session.js:42:  const resp = await client.messages.create({...});",
            }
        ],
    },
]
```

**Turn 2 response** (`stop_reason: "end_turn"`):

```json
{
    "id": "msg_01DEF",
    "role": "assistant",
    "stop_reason": "end_turn",
    "content": [
        {
            "type": "text",
            "text": "Canonical example: hive/lib/messages-session.js:42. The call wraps client.messages.create with retry and stop_reason dispatch. Step complete."
        }
    ]
}
```

The orchestrator records the final assistant message, exits the turn loop, and closes the session locally.

### Caching note

When prompt caching is enabled (`anthropic-beta: prompt-caching-2024-07-31` or successor header), apply `cache_control: {type: "ephemeral"}` to the trailing block of the `system:` string. Because `system:` is composed once at session creation and never changes between turns, every turn after the first benefits from the cache hit.

### Cloud adapter footnote

The Sessions API path (`client.beta.sessions.create` with `agent_id` + `environment_id`, server-side tools and persistence) is retained as an **opt-in cloud adapter** behind the config flag:

```yaml
execution:
  substrate: messages   # default; this spec
  # substrate: sessions-cloud   # cloud adapter
```

When `execution.substrate: sessions-cloud` is set, the substrate routes to `hive/lib/session-client.js` instead of the Messages-API loop above. Persona, prior-knowledge, and KG-decision composition rules from §2–§6 still apply — they get serialized into the cloud agent's bootstrap payload rather than into a `system:` argument. The cloud adapter does issue a remote close on cleanup. See [`hive-cloud-roadmap.md`](./hive-cloud-roadmap.md) (S16 stub) for the cloud-mode rollout plan; that document may not yet exist on `main` and is forward-referenced for continuity.

Wave 3 does **not** migrate consumers to the cloud substrate. PR #50 (`ed075d3`) wired `session-client.js` to the Sessions API correctly per the actual API contract; the historical drift was in this spec's prior §1, not in that code. Cloud-mode bootstrap (`agent_id` + `environment_id` provisioning) is deferred to the Hive Cloud epic — under `sessions-cloud`, the substrate emits a clear capability error pointing at the bootstrap requirement instead of a confusing API error.

---

## Open Questions (tracked)

| ID | Question | Impact |
|----|----------|--------|
| OQ2 | Memory pre-seeding: inject at session start (current spec) vs. load on-demand mid-session via a `memory_lookup` tool | Affects Section 3 — current spec assumes pre-seeding |
| OQ4 | Per-turn budget default — 25 tool-use cycles is a guess; revisit after S5/A2 telemetry lands | Affects Section 1 termination |

These questions do not block spec authoring. Implementers should check Linear for resolution status before building.
