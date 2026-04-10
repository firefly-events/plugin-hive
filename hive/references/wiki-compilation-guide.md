# Wiki Compilation Guide

The compiled memory wiki provides topic-based navigation across all agent memories, replacing keyword matching with LLM-synthesized topic articles.

## Directory Structure

```
~/.claude/hive/memory-wiki/
├── index.md                     # Master topic index (LLM-authored)
├── topics/
│   └── {topic-slug}.md          # Synthesized article per topic
├── agents/
│   └── {agent-name}.md          # Per-agent memory digest with backlinks
└── meta/
    └── compiled-at.md           # ISO 8601 timestamp of last compilation
```

## File Templates

### index.md (Master Index)

```markdown
# Memory Wiki — Master Index

*Last compiled: {ISO 8601 timestamp}*

## Topics

- [[topics/dependency-coupling]] — patterns and pitfalls around module coupling
- [[topics/api-error-handling]] — error propagation, retry logic, boundary strategies
- [[topics/testing-conventions]] — test setup, mocking policy, coverage standards

## Agents

- [[agents/researcher]] — {N} memories across {M} topics
- [[agents/developer]] — {N} memories across {M} topics
```

### topics/{slug}.md (Topic Article)

```markdown
# {Topic Title}

*Sources: [[agents/researcher]], [[agents/developer]]*
*Last compiled: {ISO 8601 timestamp}*

## Summary

{LLM-synthesized summary across all agent memories on this topic. This should be a readable narrative, not a list of raw memory contents. Highlight connections between memories from different agents.}

## Key Patterns

{Synthesized from pattern-type memories. Each pattern with context for when to apply it.}

## Pitfalls

{Synthesized from pitfall-type memories. Each pitfall with what went wrong and how to avoid it.}

## Codebase Notes

{From codebase-type memories. Project-specific observations relevant to this topic.}

## Reference Material

{From reference-type memories. Living document section — appended to, never regenerated.}

## Related Topics

[[related-topic-1]] | [[related-topic-2]]
```

### agents/{name}.md (Agent Digest)

```markdown
# {Agent Name} — Memory Digest

*Last compiled: {ISO 8601 timestamp}*
*Total memories: {N}*

## Memories by Topic

- [[topics/dependency-coupling]]: "framework coupling risks" (pattern, 2026-03-01)
- [[topics/api-error-handling]]: "surface errors at boundary only" (pitfall, 2026-02-15)
- [[topics/testing-conventions]]: "prefer integration over unit for data layer" (pattern, 2026-03-10)
```

### meta/compiled-at.md

```
2026-04-06T14:32:00Z
```

Plain text, single line, ISO 8601 timestamp. No frontmatter, no markdown formatting. Written LAST during compilation.

## Compilation Rules

1. **Incremental:** Only recompile topics affected by newly promoted memories
2. **Synchronous:** Compilation runs at session-end, not in the background
3. **Reference append:** `reference` type memories append to existing topic sections
4. **All other types regenerate:** The topic article section for patterns, pitfalls, codebase notes is regenerated via LLM synthesis
5. **Wikilinks:** All cross-references use `[[wikilinks]]` syntax for Obsidian compatibility
6. **Timestamp last:** `compiled-at.md` is written last — interrupted compilation leaves a stale timestamp
7. **Fallback safe:** If compilation fails, log a warning but do not block session-end

## Topic Assignment

Memories are assigned to topics based on their `name` and `description` fields. The LLM determines topic slugs during compilation. Stable assignments across incremental runs are maintained by reading existing topic slugs from `index.md` before assigning new memories.

## Cross-Agent Sharing

The wiki is organized by topic, not by agent. A researcher memory about "framework coupling" and an architect memory about "dependency management" both contribute to `topics/dependency-coupling.md`. This is the primary mechanism for cross-agent knowledge sharing.
