# Session-End Skill

Orchestrate the session-end three-operation window when a session completes naturally.
Brings together insight promotion (L0/L1), KG triple writes (L2), and compile/ChromaDB
index updates into a single timed window with latency monitoring.

**Input:** `$ARGUMENTS` optionally identifies the session agent and epic context.

## When to Use

- On natural session completion (Stop hook or session-end event)
- NOT on circuit-breaker kills (immediate termination — no session-end protocol)
- The pre-shutdown receiver protocol (see `hive/references/pre-shutdown-protocol.md`)
  follows compatible ordering but is triggered by shutdown_request, not session-end

## Three-Op Orchestration

The session-end window has three phases with strict ordering:

### Phase A: Insight Promotion (Sequential Prerequisite)
1. Identify promoted insights staged in `.pHive/insights/{epic-id}/{story-id}/`
2. Write each insight file to `~/.claude/hive/memories/{agent}/` (slug-based naming)
3. **Await completion before Phase B.** KG triples reference promoted slugs —
   kg_write() must not start until all promotion writes are complete.

### Phase B: KG Triple Write (Sequential, After A)
4. Call `kg_write()` with triples constructed from promoted insight slugs and
   session decisions. See `hive/references/knowledge-graph-schema.md` for the contract.
5. **Await completion before Phase C.** compile() reads the same memory directory
   that promotion just wrote to — ordering ensures consistency.
6. **On failure:** surface the error. KG write failure is not silently swallowed.
   Session-end is still considered complete, but the error is reported to the caller.

### Phase C: Wiki Compile + ChromaDB Index (Parallel, After B)
7. Fire `compile()` and `chromadb.index()` concurrently using `Promise.all` or equivalent.
8. `compile()`: rebuild `~/.claude/hive/memory-wiki/` from promoted memories.
9. `chromadb.index()`: index promoted documents via `hive/lib/chromadb-wrapper.js`.
   **On failure:** catch error, log warning, do not rethrow. ChromaDB failure does not
   block session-end completion.
10. **Await both** before closing the session-end window.

## Latency Monitoring

Record elapsed time across the full three-op window (Phase A start → Phase C complete):

> **Threshold rationale:** 30s provides headroom for `compile()` on a corpus of ~2,000 memory files (empirically ~15–20s) plus `chromadb.index()` overhead. Corpora significantly larger than this may need the threshold tuned upward.

```
If elapsed > 30s:
  log: "⚠ session-end latency spike: {elapsed}s (threshold: 30s).
        Consider optimizing compile() or chromadb.index() for large memory corpora."
```

If elapsed ≤ 30s: no warning. Continue normally.

## Failure Summary Table

| Operation | Failure behavior |
|-----------|-----------------|
| Insight promotion | Propagate — promotion failure blocks Phase B/C |
| kg_write() | Surface error — log and report, but continue to Phase C |
| compile() | Preserve existing behavior |
| chromadb.index() | Warn only — log warning, do not block |

> **Why the asymmetry?** KG triples are the authoritative record of agent decisions and lifecycle events — a missed write means permanent data loss in the decision lineage. ChromaDB, by contrast, is a rebuildable semantic index: any missing entries can be re-indexed from the memory files. This asymmetry (KG = surface error, ChromaDB = warn only) reflects the different recoverability of each store.

## Pre-Shutdown Compatibility

`hive/lib/session-end.js` (`runSessionEnd`) is the canonical orchestrator for both
paths. The pre-shutdown receiver invokes the same function with `skipCompile: true`
on hard shutdown (2-turn timeout pressure), preserving the A→B→C ordering: insights
→ kg_write() (sequential) → compile() ‖ chromadb.index() (parallel). See
`hive/references/pre-shutdown-protocol.md` for receiver-side details; that doc has
been aligned to this ordering.

## Implementation Reference

See `hive/lib/session-end.js` for the JavaScript orchestration module. Call:
```javascript
const { runSessionEnd } = require('./session-end');
const { elapsed, kgError, chromadbWarning } = await runSessionEnd({
  agentName,                                    // string — persona whose memories were promoted
  epicId,                                       // string — current epic id (becomes triple source_epic)
  promotedSlugs: ['avoid-x', 'prefer-y'],       // string[] — kebab-case slugs written to ~/.claude/hive/memories/{agent}/
  triples: [                                    // Array — KG triples to persist in Phase B
    { subject, predicate, object, source_agent } // valid_from defaults to now if omitted
  ],
  skipCompile: false                            // boolean — true under hard-shutdown pressure
});
```
`chromadbWarning` is a `; `-joined string of all warnings raised during the ChromaDB phase (or `null` if none).
