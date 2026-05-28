# Simulated-Manual Test

## MANDATORY EXECUTION RULES (READ FIRST)

- Read the full scenario file before narrating any step
- Narrate EVERY step in the scenario in order — do not skip
- Record a pass or fail outcome for EACH step before moving to the next
- Never claim a step passed without executing it against the spec or implementation
- In implementation-walk mode: STOP and emit an error if the story's `integrate` episode marker is absent
- The `overall_verdict` is pass only if ALL steps pass; any fail → verdict is fail
- Write the `manual_verdict` block to the story YAML before declaring done

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute the scenario steps, capture outcomes, write the verdict.

## CONTEXT BOUNDARIES

**Inputs available:**
- Scenario file (`tests/scenarios/<topic>.yaml` or `.pHive/test-scenarios/` fallback)
- Story spec (acceptance criteria, description, key files)
- Implementation code (implementation-walk only; must be post-integrate)
- Story YAML at `.pHive/epics/<epic-id>/stories/<story-id>.yaml`

**NOT available:**
- Runtime environment (do not spin up services; narrate against the spec or existing code)

## EXECUTOR PROTOCOL

### 0. Load and validate the scenario

Call `hive/lib/scenarios/load.mjs` → `loadScenario(path)`.

If the file cannot be loaded or fails validation, stop and report the structured
error (`.code`, `.field`, `.filePath`). Do not proceed with a broken scenario.

### 1. Pre-mode check

**spec-walk:** narrate each step against the story spec (acceptance criteria,
design discussion, reference docs). The implementation may be absent or incomplete.

**implementation-walk:** narrate each step against the actual code at the
implementation paths listed in the story spec (`context.key_files`). The
story's `integrate` episode marker at `.pHive/episodes/<epic>/<story>/integrate.yaml`
MUST be present. If it is absent, stop immediately:

```
ERROR: implementation-walk refused.
Missing integrate marker: .pHive/episodes/<epic>/<story>/integrate.yaml
Complete the integrate step first, or switch mode to spec-walk.
```

### 2. Execute preconditions

For each item in `scenario.preconditions[]`, verify the condition holds.
If a precondition fails, record it and skip to the overall verdict (verdict: inconclusive).

### 3. Narrate each step

For each step in `scenario.steps[]`:

1. **Narrate the action** — describe in plain language what you are doing
   (reading a file, tracing a code path, checking a condition).
2. **Evaluate the expected** — compare what you observed to `step.expected`.
3. **Record outcome** — `pass` if the observation matches; `fail` with a
   one-line reason if it does not.

Output per step:

```
Step N: <action>
Actor: <actor if specified, else tester>
Observed: <what you found>
Outcome: pass | fail
Reason (if fail): <one-line reason>
```

Stop at the first failing step only if the failure makes subsequent steps
unreachable (e.g., a precondition for the next step is now unmet). Otherwise
continue to collect the full picture.

### 4. Execute postconditions

For each item in `scenario.postconditions[]`, verify the condition holds.
Record outcome the same way as steps.

### 5. Compute overall verdict

```
overall_verdict = 'pass'   if all steps pass and all postconditions pass
overall_verdict = 'fail'   if any step or postcondition failed
overall_verdict = 'inconclusive'  if any precondition failed (scenario skipped)
```

### 6. Write manual_verdict to story YAML

Write (or replace) the `manual_verdict` block in the story YAML at
`.pHive/epics/<epic-id>/stories/<story-id>.yaml`. This story-YAML block is the
canonical source of truth for simulated-manual verdicts. `.pHive/cycle-state/<epic-id>.yaml`
may mirror the verdict as a derived/index view, but it is not the source of truth.

```yaml
manual_verdict:
  scenario_ref: <resolved scenario path>
  verdict: pass | fail | inconclusive
  timestamp: "<ISO-8601 timestamp>"
  agent: tester
```

If a `manual_verdict` block already exists, merge these verdict fields into it
(overwrite the verdict fields, do not append) so existing story fields are preserved
and the story YAML remains the single source of truth.

## SUCCESS METRICS

- [ ] Scenario loaded and validated without error
- [ ] Every scenario step narrated and recorded
- [ ] overall_verdict computed from step results
- [ ] `manual_verdict` block written to the story YAML
- [ ] Episode marker written: `.pHive/episodes/<epic>/<story>/test.yaml`

## FAILURE MODES

- **Skipping steps:** All steps must be narrated, even obvious ones.
- **Soft verdicts:** "Looks correct" is not pass. Match `step.expected` exactly.
- **implementation-walk without integrate marker:** Stop and emit the error above.
- **Forgetting story-YAML write:** The verdict is not delivered until it is in the story YAML.

## NEXT STEP

**Gating:** manual_verdict written; overall_verdict is pass (or inconclusive with explanation).
**Next:** Load `workflows/steps/development-classic/step-06-review.md`
**If overall_verdict is fail:** Report the failing steps and reason. Do not proceed to review.
