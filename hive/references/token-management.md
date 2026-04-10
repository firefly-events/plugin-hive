# Token Budget & Context Window Management

Track token consumption, enforce budgets, and manage context window health during agent execution.

## Budget Configuration

```yaml
# In hive.config.yaml (future) or inline in workflow YAML
token_budgets:
  per_task_limit: 100000       # max tokens per individual step
  per_story_limit: 500000      # max tokens per story (all steps combined)
  per_epic_limit: 2000000      # max tokens per epic execution
  warning_threshold: 0.8       # warn at 80% of any limit
```

## Tracking

After each agent step, record token usage in the status marker:

```yaml
step_id: implement
status: completed
timestamp: "2026-03-25T14:00:00Z"
artifacts:
  - src/auth/login.ts
tokens:                         # optional extension to status markers
  input: 12500
  output: 3200
```

The orchestrator maintains a running total per story and per epic. When approaching a limit (`warning_threshold`), it surfaces a warning before starting the next step.

## Budget Enforcement

| Condition | Action |
|-----------|--------|
| Step approaching per_task_limit | Warn before step starts; suggest reducing scope |
| Story approaching per_story_limit | Warn; consider splitting remaining work |
| Epic approaching per_epic_limit | Warn; present options to user (continue, pause, reprioritize) |
| Any limit exceeded | Halt and escalate — push item to task tracker |

## Context Window Monitoring

Agent context windows degrade as they fill. Symptoms: forgetting earlier instructions, inconsistent output, ignoring acceptance criteria.

### Thresholds

```yaml
context_window:
  budget_fraction: 0.7         # agent should use at most 70% of context window
  degradation_threshold: 0.85  # at 85%, spawn fresh instance
```

### Fresh Instance Spawning

When an agent's context usage exceeds `degradation_threshold`:

1. **Capture curated context** — extract from current session:
   - Story spec (always)
   - Most recent step output (context_for_next_phase equivalent)
   - Relevant agent memories
   - Cycle state
2. **Spawn fresh instance** — new agent session with curated context only
3. **Continue execution** — fresh instance picks up from where the degraded one left off
4. **Write status marker** — note the instance refresh in the marker

### Detection

Context usage can be estimated from token counts:
- Input tokens to the current agent session (cumulative)
- Compare against known context window size (e.g., 200K for Opus)
- When cumulative input exceeds `budget_fraction × window_size`, start monitoring
- When it exceeds `degradation_threshold × window_size`, spawn fresh

## Reporting

During standup, the orchestrator can report:
- Token usage per story/epic from the previous session
- Approaching budget limits
- Context window refreshes that occurred
- Budget remaining for active epics
