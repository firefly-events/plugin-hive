# Pre-Shutdown Insight Protocol

Shared reference for the pre-shutdown insight capture protocol. All agent personas reference this doc.

---

## Sender Protocol (Orchestrator)

Before sending a `shutdown_request` to any agent, the orchestrator must first send a pre-shutdown message and wait for confirmation:

1. **Send pre-shutdown message** to the agent using `SendMessage`:

   ```
   Pre-shutdown: Before I shut you down, please record any non-obvious insights or
   patterns you discovered during this session to your memory path. Reply "ready to
   shut down" when done.
   ```

2. **Wait up to 2 turns** for the agent to reply "ready to shut down".

3. **Send `shutdown_request`** once the agent confirms readiness, or after 2 turns without a reply (graceful degradation — see Timeout Behavior below).

---

## Receiver Protocol (Any Persona)

When you receive a pre-shutdown message from the orchestrator:

1. **Record insights and write KG triples.** Execute in order:
   1a. **Write insight files.** Record any non-obvious, reusable patterns or findings to your memory path (defined in your persona frontmatter `knowledge` field). Use the insight format from `hive/references/insight-capture.md`. If nothing reusable emerged, skip this sub-step.
   1b. **Call kg_write() (sequential, after 1a).** Persist decision and lifecycle triples to `~/.claude/hive/kg.sqlite`. Triples reference promoted insight slugs — ordering matters. See `hive/references/knowledge-graph-schema.md` for the kg_write() contract. If kg.sqlite is unavailable, kg_write() logs a warning and returns without error. Surface KG errors but do not block; proceed to 1c.
   1c. **Call compile() and chromadb.index() (parallel, after 1b).** Both run concurrently:
       - `compile()` refreshes the memory wiki with newly written insights. **Conditional under hard shutdown:** when invoked via `runSessionEnd({ skipCompile: true })` (2-turn timeout pressure), `compile()` is skipped entirely and the wiki is rebuilt at the next normal session-end. `chromadb.index()` still runs best-effort regardless of `skipCompile`.
       - `chromadb.index()` indexes each promoted insight document via `hive/lib/chromadb-wrapper.js`. **Best-effort:** if ChromaDB is unavailable or index() fails, log a warning and continue — do NOT block shutdown response.

       The two calls are independent; either may fail without affecting the other.

   **Step 1 ordering is mandatory:** insight files → kg_write() → compile() ‖ chromadb.index(). This matches the canonical orchestration in `hive/lib/session-end.js` (`runSessionEnd`); the pre-shutdown receiver invokes the same library with `skipCompile: true` on hard shutdown (compile is skipped, chromadb.index still runs best-effort).
2. **Reply "ready to shut down"** via `SendMessage` back to the orchestrator.
3. **Do NOT send `shutdown_response`** before receiving the formal `shutdown_request`. The pre-shutdown message and the shutdown request are two separate turns.
4. When the `shutdown_request` arrives, respond with `shutdown_response` as normal.

---

## Timeout Behavior

If the agent does not reply "ready to shut down" within 2 turns after the pre-shutdown message:

- The orchestrator sends `shutdown_request` anyway.
- This is graceful degradation — insight loss is acceptable when an agent is unresponsive.
- Do not retry the pre-shutdown message. Move forward.

---

## Circuit-Breaker Exception

The pre-shutdown protocol **does NOT apply** to circuit-breaker kills.

Circuit-breaker kills are immediate terminations triggered by runaway behavior (infinite loops, excessive tool calls, budget overruns). In these cases, the orchestrator sends `shutdown_request` directly without the pre-shutdown message. Insight loss is an acceptable consequence of circuit-breaker activation.

---

## Pre-Shutdown Message Template

```
Pre-shutdown: Before I shut you down, please record any non-obvious insights or
patterns you discovered during this session to your memory path. Reply "ready to
shut down" when done.
```

Use this template verbatim. Agents recognize this message and follow the Receiver Protocol above.

---

## Session-End Path (Natural Completion)

When a session ends naturally (not via shutdown_request), the session-end hook fires automatically. The same three sub-steps from Receiver Protocol step 1 apply:

1. Write insight files to `~/.claude/hive/memories/{agent}/`
2. Call `kg_write()` (sequential, after step 1 — see Receiver Protocol step 1b for details)
3. Call `compile()` and `chromadb.index()` in parallel (after step 2 — see Receiver Protocol step 1c for details)

The pre-shutdown receiver protocol handles orchestrator-initiated termination; the session-end hook handles natural completion. Both paths write KG triples — these are complementary, not redundant. Circuit-breaker kills skip both paths (no insight capture, no KG writes).

---

## Multica Mode Variant

Multica execution realizes the same insight-capture intent through the task lifecycle
rather than the in-process Claude-Code pre-shutdown turn:

1. **Agent self-capture (mic-1):** the Multica-assigned agent writes any
   non-obvious, reusable implementation insight to `.hive/insights/{story_id}.md`
   inside its task repository checkout before finishing the issue.
2. **Post-terminal orchestrator distill (mic-2):** after polling reaches a terminal
   state and `multica-run.yaml` plus `multica-run.messages.jsonl` are written, the
   orchestrator runs the Multica distill pass over the self-capture file, transcript
   tail, and git diff. Reusable team signal is written to
   `${HIVE_STATE_DIR}/team-memories/{epic_handle}/{story_id}.md`.

This is a valid realization of the pre-shutdown protocol for Multica mode because
the assigned agent is not available for a separate in-process pre-shutdown exchange
after the daemon task has terminated. The episode marker remains the execution
source of truth; the distill pass is the protocol's memory-capture layer.
