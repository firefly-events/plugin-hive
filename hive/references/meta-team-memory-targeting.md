# Meta-Team Memory Targeting

The meta-team's coverage objective includes growing the agent memory starter set over time. This reference defines how the meta-team identifies memory gaps, selects target agents, and writes high-quality starter memories.

---

## What Counts as a Memory Gap

A memory gap exists when:
1. An agent has **zero non-gitkeep files** in `skills/hive/agents/memories/{agent}/`
2. An agent has memories, but none address **its most common failure mode** (e.g., a researcher with no memory about scope drift)
3. An existing memory's **TTL has expired** and the knowledge it describes may have changed

---

## How to Identify Good Memory Targets

### Step 1: Check the starter memory inventory
For each agent in the roster:
```
skills/hive/agents/memories/
├── analyst/          ← check for .md files beyond .gitkeep
├── architect/
├── backend-developer/
├── developer/        ← has: additive-schema-changes.md, binary-acceptance-criteria.md
├── frontend-developer/
├── orchestrator/
├── pair-programmer/
├── peer-validator/
├── researcher/       ← has: surface-findings-early.md, use-targeted-reads.md
├── reviewer/         ← has: read-before-recommending.md, verify-fallback-paths.md
├── team-lead/
├── technical-writer/
├── test-architect/
├── test-inspector/
├── test-scout/
├── test-sentinel/
├── test-worker/
├── tester/
├── tpm/
└── ui-designer/
```

### Step 2: Identify agents with sparse memory coverage
Agents with zero memories are primary targets. Among those, prioritize by how often the agent appears in workflows:
1. `team-lead` — used in every story execution
2. `architect` — used in planning phase
3. `tpm` — used in medium/large planning
4. `analyst` — used in planning phase
5. `tester` — used in every story
6. `frontend-developer` / `backend-developer` — used in every story

### Step 3: Identify the right memory for each agent
For each target agent, read its persona file (`hive/agents/{agent}.md`) and identify:
- What mistakes is this agent prone to? → `pitfall`
- What approach always works for this agent's domain? → `pattern`
- What does this agent need to know about the Hive system? → `codebase`

---

## Memory Quality Criteria

A good starter memory:
- **Is specific.** Not "be careful with schemas" — "schema changes must be additive (new optional fields only) to avoid breaking existing content"
- **Is actionable.** The agent reading it can immediately change its behavior
- **Is terse.** 1–4 sentences. If you need more, it's two memories
- **Names the thing.** References specific file paths, patterns, commands, or behaviors — not abstractions
- **Has a clear type.** Is this a `pattern` (do this) or a `pitfall` (avoid this)?

---

## Memory File Template

```markdown
---
name: {short-slug-title}
description: "{one-sentence summary for relevance matching}"
type: pattern | pitfall | override | codebase
last_verified: {YYYY-MM-DD}
ttl_days: {90 for pattern, 180 for pitfall, 60 for codebase, null for override}
source: agent
---

{1-4 sentences. Be specific. Name the thing.}
```

---

## Example Memory Targeting Session

**Target agent:** `team-lead`
**Persona read:** `hive/agents/team-lead.md`
**Identified gaps:**
- No memory about when to spawn a team vs handle solo
- No memory about domain validation enforcement

**Memory 1 — pitfall:**
```markdown
---
name: over-staffing-single-domain-stories
description: "spawning multiple agents for stories with only one type of work wastes tokens and coordination overhead"
type: pitfall
last_verified: 2026-04-09
ttl_days: 180
source: agent
---

Stories that only touch one domain (e.g., only backend, or only documentation)
don't need a full team. If the work is uniform, handle it with one agent or solo.
Coordination overhead for 3 agents editing the same type of file exceeds the benefit.
```

**Memory 2 — pattern:**
```markdown
---
name: domain-validation-after-each-step
description: "team lead validates domain compliance after every step, not just at review"
type: pattern
last_verified: 2026-04-09
ttl_days: 90
source: agent
---

Check that the implementing agent only wrote to its allowed domain after each step.
Don't wait for the reviewer to catch domain violations — they compound across steps.
Read the step output, verify file paths against the team config domain restrictions.
```

---

## How the Meta-Team Writes Starter Memories

The meta-team writes to `skills/hive/agents/memories/{agent}/` — the bootstrap path. These files migrate to `~/.claude/hive/memories/{agent}/` during kickoff (per the onboarding guide).

The meta-team NEVER writes to `~/.claude/hive/memories/` directly — that's the live system path outside the plugin repo.

Each new memory file must follow the memory file template above. The meta-team targets a maximum of 2 new memories per agent per cycle to avoid overwhelming agents with context.
