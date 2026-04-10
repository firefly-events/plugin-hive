# Knowledge Layer

The knowledge layer provides agents with queryable information during execution. Three source types, three access patterns. Builds on the agent memory system but broader — cross-agent, cross-session, with annotation capability.

## Three Sources

### 1. External Docs

Up-to-date library documentation, API references, and best practices retrieved on demand.

**Providers:**
- **Context7** — library documentation and code examples (MCP plugin)
- **Firecrawl** — web scraping for docs, blog posts, current information (MCP plugin)
- **WebSearch/WebFetch** — built-in Claude Code tools for web research

**Access:** Agent-callable during execution. The agent checks available MCP tools and queries as needed. Results are session-scoped (not persisted).

**When to use:** Agent needs current documentation for a library, API, or framework. Agent needs best practices or known pitfalls for a technology. Agent needs to verify if an approach is current or deprecated.

### 2. Project Knowledge

Accumulated knowledge from past cycles in this project: decisions, quality feedback, patterns.

**Sources:**
- **Cycle state history** — `state/cycle-state/*.yaml` files from past epics. Decisions, constraints, naming conventions, technology choices.
- **Agent memories** — `~/.claude/hive/memories/{agent}/` files. Patterns, pitfalls, codebase understanding accumulated across sessions.
- **Gate feedback** — past quality gate rejections and the reasons why (from status markers with `failed` status + associated insights).

**Access:** Orchestrator pre-fetches relevant project knowledge during story ingestion and includes it in agent prompts. Agents can also query directly by reading memory files.

**When to use:** Agent is working in a codebase with prior Hive history. Agent needs to avoid repeating past mistakes. Agent needs to follow established conventions.

### 3. Capability Catalog

What's available in the current environment: agents, workflows, tools.

**Sources:**
- **Agent roster** — `skills/hive/agents/*.md` — available personas and their capabilities
- **Workflow definitions** — `skills/hive/workflows/*.yaml` — available methodologies
- **MCP tools** — session's available MCP servers and their capabilities
- **CLI tools** — available command-line tools (Frame0, Maestro, test runners, etc.)

**Access:** Orchestrator and team leads query at session start and when making staffing/tooling decisions.

**When to use:** Orchestrator deciding which agents to pull from the bench. Agent checking which tools are available before starting work. Planning swarm evaluating technology options.

## Three Access Patterns

### Agent-Callable (during execution)

Agents query knowledge sources during their step execution:
```
Agent working on step → needs library docs → queries Context7 MCP
Agent working on step → needs project convention → reads agent memories
Agent working on step → needs to check available tools → reads capability catalog
```

### Context Injection (orchestrator pre-fetch)

The orchestrator or team lead pre-fetches relevant knowledge before passing a task to an agent:

1. Read the story spec
2. Identify keywords/topics that need knowledge (technologies, libraries, conventions)
3. Query relevant sources (agent memories, cycle state, external docs if needed)
4. Include findings in the agent's task prompt as context

This saves agents from redundant queries and keeps their context focused.

### Annotation (agents write back)

When agents discover something useful, they annotate it back for future sessions:

- **Insight capture** → `state/insights/` staging area → promoted to agent memories at session end
- This is the existing insight system from `references/agent-memory-schema.md`
- Annotations are the write-back path that makes the knowledge layer self-improving

## Integration Points

| System | Reads From | Writes To |
|--------|-----------|-----------|
| Knowledge Layer — External Docs | Context7, Firecrawl, WebSearch MCP tools | Session cache only (not persisted) |
| Knowledge Layer — Project Knowledge | cycle state, agent memories, status markers | — (read-only) |
| Knowledge Layer — Capability Catalog | agent personas, workflows, MCP tools | — (read-only) |
| Insight Capture | — | state/insights/ staging |
| Session-End Evaluation | state/insights/ staging | agent memories (promoted) |

## Query Protocol

When an agent or orchestrator needs knowledge:

1. **Check agent memories first** — fastest, most project-relevant
2. **Check cycle state** — for decisions already made in this epic
3. **Check external docs** — only if local knowledge is insufficient
4. **Annotate if novel** — write insight to staging if the finding is reusable

## External Docs Integration Details

### Context7

Query library documentation by resolving a library ID then fetching docs:
```
1. Resolve: context7.resolve-library-id(libraryName: "react", query: "useEffect cleanup")
2. Query:  context7.query-docs(libraryId: "/facebook/react", query: "useEffect cleanup")
```

Agents should check if Context7 is available in session MCP tools before querying. If unavailable, fall back to WebSearch/WebFetch.

### Firecrawl

For scraping documentation pages, blog posts, and current web content:
- `firecrawl:search` — web search with LLM-optimized results
- `firecrawl:scrape` — scrape a specific URL to markdown
- `firecrawl:crawl` — crawl a site for multiple pages

Firecrawl is the preferred tool for web research when available (better than raw WebFetch).

### Caching

External doc results are session-scoped — they're not persisted between sessions. If an agent finds a critical external reference, they should capture it as an insight for promotion to agent memory.

## Project Knowledge Integration Details

### Querying Cycle State History

To find past decisions about a technology or pattern:
```
1. List past cycle states: ls state/cycle-state/*.yaml
2. Search for relevant decisions: grep for technology/pattern keywords
3. Load the relevant cycle state and extract decisions
```

### Querying Agent Memories

To find relevant patterns or pitfalls:
```
1. List memories for the relevant agent: ls ~/.claude/hive/memories/{agent}/
2. Read each memory's description (frontmatter) for relevance
3. Load full content of relevant memories
```

### Querying Past Gate Feedback

To find what types of issues caused past failures:
```
1. Find failed status markers: grep "status: failed" state/episodes/
2. Check associated insights in state/insights/ (if not yet cleaned up)
3. Check agent memories for promoted pitfall insights
```

### Building a Knowledge Summary

During story ingestion, the team lead builds a knowledge summary:

```markdown
## Relevant Knowledge for {story-id}

### From Agent Memories
- [developer] "This codebase uses X pattern for Y" (codebase insight)
- [tester] "Don't mock the database in integration tests" (pitfall)

### From Cycle State
- API protocol: REST (decided in architecture phase)
- Test framework: Maestro (decided in architecture phase)

### From Past Gate Feedback
- Previous PRD review failed structural completeness check — ensure all sections present
```

This summary goes into the agent's task prompt as context.
