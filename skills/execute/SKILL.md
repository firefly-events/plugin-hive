---
name: execute
description: |
  Execute a planned epic's stories through phased development workflows (research,
  implement, test, review, integrate). Supports parallel execution of independent
  stories via agent teams when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set.
  Use when the user says "execute the epic", "run the workflow", "start
  implementation", "execute hive-phase2", or wants to run a previously planned
  epic. Supports --methodology flag (tdd, classic, bdd) and --sequential flag.
  Also triggers on "hive execute" or any request to start executing planned stories.
---

# Hive Execute

Execute a planned epic's stories through development workflow phases. When agent teams are available and the epic has independent stories, execution runs in parallel automatically.

**Input:** `$ARGUMENTS` contains the epic ID and optional flags:
- `--methodology tdd|classic|bdd` — selects the development workflow (default: `classic`)
- `--sequential` — force sequential execution even when agent teams are available

**Parallel execution:** Independent stories (those with no mutual dependencies) can execute in parallel when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment. Without this env var, or with the `--sequential` flag, stories execute one at a time in dependency order.

**Instructions:** Read the full Hive skill at `skills/hive/ORCHESTRATOR.md` and follow the **Execute Command** section. All shared resources (agents, references, workflows) are in the `skills/hive/` directory.
