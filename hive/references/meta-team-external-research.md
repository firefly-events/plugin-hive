# Meta-Team External Research Loop

The meta-team's analysis phase is primarily focused on internal codebase audits. However, in some cases, improving the Hive plugin requires understanding external context — updated best practices, new Claude Code capabilities, or patterns from the broader ecosystem. This reference defines when and how the meta-team conducts external research.

---

## When External Research Is Warranted

External research is triggered when:

1. **Schema drift:** A reference doc describes a Claude Code feature (e.g., agent frontmatter fields) and the actual Claude Code API may have changed since the doc was written.
2. **Missing reference class:** A category of best practices (e.g., token management, parallel agent patterns) is referenced by step files but no authoritative reference doc exists.
3. **TTL expiry on a reference memory:** A `reference` type memory's `last_updated` is > 90 days old and covers an evolving topic.

External research is NOT warranted for:
- Internal consistency issues (broken cross-references, missing step file sections)
- Starter memory gaps (write from existing codebase knowledge)
- Schema compliance failures (apply the schema as-is)

---

## Research Loop Procedure

### 1. Identify the research question
Be specific. "What are current best practices for X?" is too vague. The question must be answerable with a specific, citable finding.

Good questions:
- "Does Claude Code's agent frontmatter support a `timeout_ms` field at the agent level, or only at the workflow step level?"
- "What is the current recommended approach for rate limiting tool calls in agent workflows?"

Bad questions:
- "What's new in Claude Code?"
- "How should we improve the agent memory system?"

### 2. Check internal sources first
Before any external search:
- Read the relevant reference docs in `hive/references/`
- Read the relevant agent persona frontmatter
- Check `hive/hive.config.yaml` for any existing configuration

If the answer is in the existing codebase, stop — no external research needed.

### 3. Conduct targeted web research
If internal sources don't answer the question:
- Use the WebSearch or WebFetch tools with the specific question
- Limit to 2–3 searches per question — don't spiral
- Prefer official documentation (Claude Code docs, Anthropic API docs) over blog posts or forums

### 4. Record the finding
Write the finding to `state/meta-team/research-notes/{cycle-id}/{slug}.md`:
```markdown
# Research Note: {slug}

**Question:** {the specific question}
**Source:** {URL or "internal"}
**Date:** {ISO date}

## Finding

{What was found. Be concise — one paragraph maximum.}

## Implication for Hive

{What this means for the Hive codebase. What should change, if anything.}

## Status

resolved | inconclusive | needs_human
```

### 5. Convert to a proposal
If the finding supports a concrete improvement:
- Add it as a finding in the analysis output
- Pass it to the proposal step (step-03) like any other finding
- The proposal step will rank it alongside internal audit findings

---

## Research Budget

The external research loop is bounded by the 5-hour cycle budget. Research should not consume more than 30 minutes of the cycle.

If research is inconclusive after 3 searches:
- Record as `status: inconclusive` in the research note
- Do NOT create a proposal based on inconclusive research
- Flag for human if the question is important

---

## When to Skip External Research

If the cycle is already tracking 5 high-priority internal proposals, skip external research entirely — the internal backlog is the higher priority.

External research only triggers when internal audits produce fewer than 3 eligible proposals.
