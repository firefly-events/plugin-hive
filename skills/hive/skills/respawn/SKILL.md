# Agent Respawn Skill

Gracefully replace a context-exhausted agent with a fresh instance, preserving work state and accumulated knowledge. This prevents agent degradation from context window pressure.

**Input:** The orchestrator invokes this skill when it detects context pressure in an active agent.

## When to Use

- An agent teammate has been working for an extended period and shows signs of context degradation
- The orchestrator detects heuristic signals indicating context pressure (see Detection section)
- A long-running workflow step needs to continue but the current agent is losing coherence

## When NOT to Use

- The agent is nearly done with its current step — let it finish
- The task is simple enough that degradation won't matter
- The agent has already been respawned 3 times on this step — escalate to the user instead

## Detection: How the Orchestrator Identifies Context Pressure

The orchestrator monitors active agents for these heuristic signals. No single signal is definitive — look for a cluster of 2+ signals:

1. **Response quality decline** — agent responses become shorter, less detailed, or lose specificity
2. **Repetitive behavior** — agent re-reads files it already read, re-asks questions it already answered, or re-discovers information from earlier in the conversation
3. **Task drift** — agent loses track of its objective, starts working on tangential concerns, or forgets constraints established earlier
4. **Excessive tool calls** — agent is making many small tool calls without making progress, suggesting it can't hold enough context to work efficiently
5. **Self-contradiction** — agent makes decisions that contradict its earlier reasoning without acknowledging the change

**Important:** These are heuristic signals, not exact measurements. Agents cannot precisely measure their own token usage. The orchestrator uses behavioral observation, not token counting.

**False positive mitigation:** Complex tasks naturally produce long conversations. If the agent is making steady progress (completing sub-tasks, producing output, moving through the procedure), do NOT trigger respawn just because the conversation is long. Only trigger when quality signals degrade.

## Respawn Protocol

### Step 1: Signal the Agent

The orchestrator sends a `SendMessage` to the agent:

```
RESPAWN SIGNAL: Context pressure detected. Begin respawn protocol:
1. Run your insight capture pass (per agent-memory-schema.md)
2. Write your respawn summary to: state/respawn-summaries/{agent}-{story-id}-{N}.md
   where {N} is the respawn iteration (1, 2, or 3)
3. Reply with the file path when complete
```

### Step 2: Agent Performs Memory Assessment

The agent follows the insight capture protocol from `hive/references/agent-memory-schema.md`:

1. Review work done during this session
2. Identify any insights worth promoting (patterns, pitfalls, overrides, codebase knowledge)
3. Stage insights using the staged insight format
4. Write insights to the agent's memory directory

This ensures knowledge gained during the session is not lost when the agent terminates.

### Step 3: Agent Writes Respawn Summary

The agent writes a structured MD file to `state/respawn-summaries/`. This file is the bridge between the old and new agent instances.

**File path:** `state/respawn-summaries/{agent-name}-{story-id}-{N}.md`
- `{agent-name}` — the roster agent name (e.g., `developer`, `researcher`)
- `{story-id}` — the story being worked on
- `{N}` — respawn iteration number (1, 2, or 3)

**Summary format:**

```markdown
---
agent: {agent-name}
story_id: {story-id}
step_id: {current-step-id}
respawn_iteration: {N}
timestamp: {ISO-8601}
---

# Respawn Summary

## Current Position
- Story: {story-id} — {story title}
- Step: {step-id} — {step description}
- Phase within step: {where in the procedure — e.g., "implementing the second acceptance criterion"}

## Work Completed
- {Decision made or action taken}
- {Files modified: path/to/file — what was changed}
- {Commands run and their outcomes}
- {Tests written/passing/failing}

## Work Remaining
- {Next immediate action to take}
- {Remaining acceptance criteria to satisfy}
- {Any deferred items}

## Non-Obvious Context
{This section is critical — capture anything the new agent can't derive from reading the files alone}
- {Approaches tried and abandoned, with reasons}
- {Gotchas discovered (e.g., "this API returns X instead of Y")}
- {Key constraints learned during implementation}
- {Implicit decisions not yet documented anywhere}

## Active Blockers
- {Any issues preventing progress, or "None"}

## Open Questions
- {Unresolved decisions the new agent should address, or "None"}
```

### Step 4: Agent Reports Completion

The agent sends a `SendMessage` back to the orchestrator:

```
RESPAWN READY: Summary written to state/respawn-summaries/{agent}-{story-id}-{N}.md
```

### Step 5: Orchestrator Checks Respawn Count

Before spawning a new agent, the orchestrator checks the respawn iteration number:

- **N < 3:** Proceed with respawn (step 6)
- **N = 3:** This was the agent's third respawn. **Escalate to user:**

```
RESPAWN LIMIT REACHED for {agent-name} on story {story-id}, step {step-id}.

This agent has been respawned 3 times on the same step. Continuing may indicate:
- The step is too large and should be decomposed
- There's a fundamental blocker the agent can't resolve
- The task requires human judgment

Respawn summaries:
1. state/respawn-summaries/{agent}-{story-id}-1.md
2. state/respawn-summaries/{agent}-{story-id}-2.md
3. state/respawn-summaries/{agent}-{story-id}-3.md

Options:
a) Decompose this step into smaller sub-steps
b) Provide additional guidance and respawn once more
c) Take over this step manually
```

### Step 6: Orchestrator Terminates Old Agent

The orchestrator allows the old agent to finish its current response, then does not send further messages to it. The agent naturally terminates.

### Step 7: Orchestrator Spawns Fresh Agent

Use the agent-spawn skill (`skills/hive/skills/agent-spawn/SKILL.md`) to create a new instance of the same agent. Include the `respawn_summary_path` parameter pointing to the summary file. The agent-spawn skill injects the summary as "Continuation Context" in the agent's prompt.

The new agent receives:
1. Full persona (unchanged)
2. Loaded memories (including any insights the previous instance captured)
3. Continuation Context (the respawn summary)
4. Task specification (story spec + step instructions)

The new agent should verify file state before acting on the summary — files may have changed between instances.

## Key Rules

1. **Max 3 respawns per step.** After 3, escalate. No exceptions.
2. **Never skip the memory assessment.** The insight capture pass is what prevents knowledge loss across respawns.
3. **The summary must be written to a file.** Do not pass the summary only via SendMessage — it must be persisted for audit and for the new agent to read.
4. **The orchestrator monitors, the agent executes.** Agents do not self-trigger respawn. The orchestrator decides when respawn is needed based on behavioral signals.
5. **Don't respawn near completion.** If the agent is close to finishing its step, let it finish rather than incurring the overhead of a respawn handoff.
6. **Verify before continuing.** The new agent must verify the current state of files and tests before assuming the summary is accurate.

## Directory Setup

The orchestrator should ensure `state/respawn-summaries/` exists before triggering a respawn. Create it if needed:

```
mkdir -p state/respawn-summaries/
```

Respawn summaries accumulate during an epic's execution. They are not cleaned up automatically — they serve as an audit trail. Clean up manually or per-epic if disk space is a concern.

## Pre-Shutdown Protocol Safety

**Audit result (hive-workflow-foundation/respawn-audit):** Respawn does NOT bypass the orchestrator's pre-shutdown insight protocol.

Evidence:
- **Step 1** sends a RESPAWN SIGNAL asking the agent to run the insight capture pass before anything else — this is functionally equivalent to the pre-shutdown message in `hive/references/pre-shutdown-protocol.md`.
- **Step 2** explicitly requires the agent to write insights before writing the respawn summary.
- **Step 6** terminates the old agent by withholding further messages (natural termination), NOT via `shutdown_request`. There is no direct `shutdown_request` call in this skill that could bypass the orchestrator.

No protocol change required. The insight-before-shutdown guarantee holds for respawned agents.

## References

- `hive/references/agent-memory-schema.md` — insight capture protocol
- `hive/references/pre-shutdown-protocol.md` — pre-shutdown insight protocol (respawn is safe, see above)
- `skills/hive/skills/agent-spawn/SKILL.md` — agent spawning with persona injection
- `hive/references/episode-schema.md` — status markers for tracking step completion
