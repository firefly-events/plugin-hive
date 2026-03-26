# Agent-Ready Story Checklist

Run this checklist against every story before saving during `/hive:plan`. Flag failures in the plan confirmation output so the user can fix them before execution.

## Checklist

| # | Check | What to look for |
|---|-------|-----------------|
| 1 | **One-sentence objective** | Can the story's goal be stated in one sentence? If the description needs a paragraph to explain what to build, it's too vague or too large. |
| 2 | **Pre-made decisions** | Are all architectural decisions settled? No "choose between X and Y" — agents can't negotiate, they need answers. |
| 3 | **Exact file paths** | Does the story reference specific files to read, modify, or create? Not "the auth module" but `src/auth/login.ts`. |
| 4 | **Executable verification** | Are there runnable commands to verify success? `npm test`, `pytest`, `lint`, `build` — not just prose criteria. |
| 5 | **Scope boundaries** | Is there an explicit DO / DO NOT list? Agents gold-plate without boundaries. |
| 6 | **Single session fit** | Can an agent complete this in one session (< ~5 files, well-scoped)? If not, break it down further. |
| 7 | **Reference implementation** | Is there an existing file or pattern to follow? Agents produce better code when they have a concrete example. |
| 8 | **Binary success criteria** | Are acceptance criteria pass/fail, not subjective? "Tests pass" not "code is clean." |

## How to Apply

During `/hive:plan`, after generating stories and before presenting for confirmation:

1. For each story, evaluate all 8 checks
2. Mark passing checks with checkmark, failing with X
3. In the confirmation output, flag stories with failures:

```
Stories:
  · cache-strategy — Design Redis Caching [8/8 checks passed]
  · event-detail — Redesign Event Detail View [6/8 — missing: exact file paths, verification commands]
```

4. The user can approve with known gaps (acceptable for planning-heavy stories) or ask to fix them

## Adapted INVEST Criteria

Traditional INVEST adapted for agent execution:

| Criterion | Agent Adaptation |
|-----------|-----------------|
| **I**ndependent | Agent can complete in a single session without waiting on other work |
| **N**egotiable | Pre-negotiate all decisions — agents need answers, not options |
| **V**aluable | Must produce a testable, verifiable artifact |
| **E**stimable | Fits within context window (~5 files, well-scoped) |
| **S**mall | Fits in a single agent session (< 200K tokens of work) |
| **T**estable | Has executable verification commands, not just prose |

## Common Failure Modes

| Failure | Fix |
|---------|-----|
| Scope creep | Add explicit DO NOT list |
| Wrong pattern chosen | Point to reference implementation file paths |
| Partial implementation | Break into sub-tasks, each independently verifiable |
| Silent incorrectness | Include runnable test/lint/build commands |
| Context overflow | Front-load critical requirements, keep spec concise |
| Architectural mismatch | Pre-make all design decisions in the spec |

Source: `/Users/don/Documents/project-hive/docs/research/agent-ready-story-specs.md`
