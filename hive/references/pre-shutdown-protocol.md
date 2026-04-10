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

1. **Record insights first.** Write any non-obvious, reusable patterns or findings to your memory path (defined in your persona frontmatter `knowledge` field). Use the insight format from `hive/references/insight-capture.md`. If nothing reusable emerged, skip this step.
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
