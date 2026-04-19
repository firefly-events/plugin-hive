# Step 8: Session End

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT promote insights without evaluating them against the keep/discard criteria in `references/agent-memory-schema.md`
- Do NOT delete staged insights before evaluation — read first, then promote or discard
- Do NOT skip the session summary — the user needs to know what happened today
- For borderline insights, present to the user for a keep/discard decision — do NOT auto-discard

## EXECUTION PROTOCOLS

**Mode:** interactive (for borderline insight decisions), otherwise autonomous

Evaluate staged insights, promote or discard, clean up staging, produce session summary.

## CONTEXT BOUNDARIES

**Inputs available:**
- `.pHive/insights/` — staged insight files from execution phase
- `~/.claude/hive/memories/` — existing agent memories (to check for duplicates)
- `references/agent-memory-schema.md` — keep/discard criteria, memory file format
- Episode markers from step 7 (stories completed, failed, blocked)
- Cycle state from step 7 (updated decisions and statuses)

**NOT available:**
- Story specs (no longer needed — execution is complete)
- External tracker live data (final ticket updates already done in step 7)

## YOUR TASK

Evaluate staged insights for promotion to agent memories, clean up staging, and produce a session summary covering the day's work.

## TASK SEQUENCE

### 0. Check for forced-stop interrupts

Before evaluating insights, check whether any previous session was interrupted by a forced stop (Ctrl+C):

1. Check whether `.pHive/interrupts/` exists. If it does not exist, skip this section silently.
2. If it exists, list all `.yaml` files in `.pHive/interrupts/`.
3. If any sentinel files exist, surface a report to the user:

```
⚠️  INTERRUPTED SESSIONS DETECTED

The following sessions were interrupted before completing cleanly:

{for each sentinel file:}
  [{timestamp}] — Epic: {active_epic | none}, Story: {active_story | none}, Step: {active_step | none}
  File: .pHive/interrupts/{filename}

These files have NOT been deleted. To clear them, delete the files manually after reviewing.
```

4. Ask the user: "Do you want to trigger recovery for any of these, or acknowledge and continue?"
5. **Do NOT auto-delete sentinel files** — the user must acknowledge them explicitly.
6. After the user responds, continue to step 1 regardless of their answer (recovery is out of scope for this step — just surface the information).

### 1. Scan for staged insights
List all files under `.pHive/insights/`. Insights are organized by `{epic-id}/{story-id}/` and follow the staged insight format:
- `type` — pattern, pitfall, override, codebase, process
- `agent` — which agent produced this
- `summary` — one-line description
- `detail` — full insight content
- `source_step` — which workflow step produced it

### 2. Evaluate each insight
For each staged insight, apply the criteria from `references/agent-memory-schema.md`:

**Keep criteria (promote):**
- Repeatable pattern that applies beyond this specific story
- Pitfall warning that would save future agents from the same mistake
- Override that corrects a previously promoted memory
- Codebase-specific understanding (naming conventions, architecture patterns, API quirks)
- Process improvement that changes how a workflow step should be executed

**Discard criteria:**
- One-time fix that will not recur
- Story-specific detail with no broader applicability
- Already captured in an existing memory (check for duplicates)
- Vague observation without actionable guidance

### 3. Check for duplicates
For each insight marked for promotion, check `~/.claude/hive/memories/{agent}/` for existing memories with similar descriptions. If a duplicate exists:
- If the new insight is more specific or corrects the old one: promote as an `override` type, note the superseded memory
- If the new insight adds nothing: discard

### 4. Promote kept insights
For each insight that passes evaluation, write a memory file to `~/.claude/hive/memories/{agent}/{slug}.md`:

```yaml
---
name: {slug}
description: {one-line summary}
type: {pattern | pitfall | override | codebase | process}
agent: {agent-name}
timestamp: {ISO 8601}
source_epic: {epic-id}
---

{Full detail of the insight. Written as actionable guidance for future sessions.}
```

The slug should be a kebab-case version of the summary (e.g., `api-rate-limit-retry-pattern`).

### 4b. Promote team-level insights

For insights that capture collective team patterns (handoff conventions, tooling quirks, process adjustments), promote to the team memory directory instead of the agent memory:

Write to `.pHive/team-memories/{team-name}/{slug}.md`:

```yaml
---
name: {slug}
description: {one-line summary}
type: {convention | handoff-pattern | tooling | process}
team: {team-name}
timestamp: {ISO 8601}
source_epic: {epic-id}
---

{Detail of the team-level pattern.}
```

**Decision rule:** If one agent could have learned this alone → agent memory at `~/.claude/hive/memories/`. If it required multiple agents coordinating → team memory at `.pHive/team-memories/`.

### 4c. Append to reference memories

If a new insight matches an existing reference memory's `topic` (keyword match on `topic` field):
- Append a new entry to the reference memory's `## Entries` section
- Add any new external sources to `## Sources`
- Update `last_updated` in the frontmatter
- Do NOT create a duplicate standalone memory

### 4d. Compile memory wiki

After promoting memories (steps 4, 4b, 4c), compile the memory wiki to reflect new knowledge.

**When to compile:** Only if at least one insight was promoted in steps 4, 4b, or 4c. If no insights were promoted, skip compilation.

**Compilation procedure:**

1. **Identify affected topics:** For each newly promoted memory, determine which topic(s) it belongs to based on its `name`, `description`, and `type`. One memory may contribute to multiple topics. Use kebab-case slugs for topic names (e.g., `dependency-coupling`, `api-error-handling`).

2. **Incremental compilation:** Only recompile topics touched by newly promoted memories. Do NOT recompile the entire wiki.

3. **For each affected topic:**
   a. Read ALL raw memories across ALL agents in `~/.claude/hive/memories/` whose topic assignment includes this slug
   b. Separate memories by type: pattern, pitfall, codebase, override, reference
   c. For `reference` type: append new content to existing topic article section (do not regenerate — reference memories have append semantics)
   d. For all other types: regenerate the topic article via LLM synthesis — produce a readable summary, not a raw dump
   e. Ensure all cross-references use `[[wikilinks]]` syntax (e.g., `[[dependency-coupling]]`, `[[agents/researcher]]`)
   f. Write the topic article to `~/.claude/hive/memory-wiki/topics/{slug}.md`

4. **Regenerate agent digests:** For each agent whose memories were touched, update `~/.claude/hive/memory-wiki/agents/{agent-name}.md` with backlinks to topic articles.

5. **Update master index:** If any new topic slugs were introduced, add them to `~/.claude/hive/memory-wiki/index.md`.

6. **Write compilation timestamp:** Write the current ISO 8601 timestamp to `~/.claude/hive/memory-wiki/meta/compiled-at.md`. This file is written LAST — if compilation is interrupted, the stale timestamp signals the wiki needs recompilation.

**First-run note:** The first compilation after wiki structure creation will be a full compilation (all topics). This is expected to take longer than subsequent incremental runs.

**If compilation fails:** Log "wiki stale — will use keyword fallback at next spawn." Do not block the session-end step. The wiki is an enhancement, not a requirement — L0 keyword scan remains the fallback.

### 5. Handle borderline cases
For insights that do not clearly match keep or discard criteria:
- Present them to the user with the insight summary and a recommendation
- Ask: "Keep (promote to memory) or Discard?"
- Apply the user's decision

### 6. Clean up staging
After all insights have been promoted or discarded:
- Delete the processed insight files from `.pHive/insights/{epic-id}/{story-id}/`
- Remove empty staging directories
- Do NOT delete `.pHive/insights/` itself — other epics may have staged insights

### 7. Produce session summary
Compile a final summary for the user:

```
## Session Summary

### Stories Completed
- [{story-id}] {title} — {final status}

### Stories Failed
- [{story-id}] {title} — {failure reason}
  Action for next session: {retry | redesign | user decision needed}

### Stories Blocked
- [{story-id}] {title} — {blocker}
  Blocked since: {date}

### Insights Promoted ({count})
- [{agent}] {memory-name}: {one-line summary}

### Insights Discarded ({count})
- {summary} — reason: {discard reason}

### Tomorrow's Agenda
- Unfinished stories: {list}
- Blocked items needing resolution: {list}
- New work flagged during execution: {list if any}

### Cycle State Updates
- Decisions recorded: {count}
- Status transitions: {list of story status changes}
```

## SUCCESS METRICS

- [ ] All staged insights under `.pHive/insights/` scanned
- [ ] Each insight evaluated against keep/discard criteria from agent-memory-schema
- [ ] Duplicate check performed against existing memories
- [ ] Promoted insights written to `~/.claude/hive/memories/{agent}/` with correct format
- [ ] Borderline cases presented to user for decision
- [ ] Staging directories cleaned up
- [ ] Session summary produced with all sections

## FAILURE MODES

- Promoting all insights without evaluation — memory bloat, irrelevant memories loaded in future sessions
- Discarding all insights without evaluation — valuable learnings lost, agents repeat mistakes
- Not checking for duplicate memories — redundant memories waste context window in future sessions
- Skipping the session summary — user does not know what to expect tomorrow
- Deleting `.pHive/insights/` root directory — other epics lose their staged insights

## NEXT STEP

**Gating:** All insights evaluated. Staging cleaned up. Session summary presented to user.
**Next:** Session complete. No further steps in the daily ceremony workflow.
**If gating fails:** If insight files cannot be read, report the error and proceed with the session summary using available data. Do not leave the session without a summary.
