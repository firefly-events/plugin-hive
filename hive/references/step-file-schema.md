# Step File Schema

Step files are self-contained instruction sets for individual workflow steps. Each step file tells an agent exactly what to do, how to verify success, and what NOT to do — replacing the paragraph-level `task` field in workflow YAML with robust, guardrailed instructions.

## Architecture

```
persona (WHO — identity, capabilities, quality standards)
  + step file (HOW — exact procedure, execution rules, gating)
  + story spec (WHAT — the specific feature or task)
  = agent context for one workflow step
```

Step files live at `hive/workflows/steps/{workflow-name}/step-{NN}-{kebab-name}.md`.

The workflow YAML references them via the `step_file` field on each step definition. When `step_file` is present, it replaces the inline `task` field.

## Required Sections

Every step file MUST contain these 7 sections in this order:

### 1. Title

```markdown
# Step {N}: {Name}
```

One-line title. The step number matches the workflow sequence.

### 2. Mandatory Execution Rules

```markdown
## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- {Rule specific to this step's scope}
- {Rule about what NOT to do}
- {Rule about when to STOP}
```

These are the hard constraints. The agent reads them before doing anything. Rules should be specific and actionable — not generic advice. Every rule should prevent a known failure mode.

**Good rule:** "ONLY use CLI commands from the Command Templates section below. Do NOT construct commands from memory."
**Bad rule:** "Be careful with commands."

### 3. Execution Protocols

```markdown
## EXECUTION PROTOCOLS

**Mode:** {autonomous | interactive}

### Autonomous mode (default during /hive:execute)
- Execute the task sequence without waiting for user input
- Write output artifacts to the paths specified
- Proceed to next step when all success metrics are met

### Interactive mode (during /hive:plan with UI steps)
- Present output to user at each approval touchpoint
- Wait for user confirmation before proceeding
- If user requests changes, apply them and re-present
```

Execution protocols define WHEN to act, WHEN to save, and WHEN to stop. The mode is determined by the calling context — the orchestrator tells the agent which mode to use.

### 4. Context Boundaries

```markdown
## CONTEXT BOUNDARIES

**Inputs available:**
- {What data this step receives from previous steps}
- {What files/artifacts are available}

**NOT available (do not read or assume):**
- {What is explicitly out of scope}
- {Files the agent should not touch}

**State from previous steps:**
- {What prior outputs feed into this step}
```

Context boundaries prevent scope drift. List both what IS available and what is NOT. If the agent needs something not listed, that's a gap in the step file, not permission to go exploring.

### 5. Task Sequence

```markdown
## YOUR TASK

{One-sentence description of what this step produces.}

## TASK SEQUENCE

### 1. {First action}
{Detailed instructions with exact commands, file paths, or templates.}

### 2. {Second action}
{Instructions reference specific inputs from Context Boundaries.}

### 3. {Third action}
{Instructions include concrete output format or artifact path.}
```

The task sequence is prescriptive — it tells the agent exactly what to do in order. Use concrete file paths, command templates with placeholders, and output format examples. The agent fills in specifics from the story spec; it doesn't improvise the procedure.

**Command templates:** When a step involves CLI commands, provide exact templates:

```markdown
### Command Templates

```bash
# Create project — fill {name} from screen manifest
cli-anything-frame-zero project new --name "{name}"

# Add page — fill {file} and {screen} from project and manifest
cli-anything-frame-zero --project {file} page add --name "{screen}"
`` `

IMPORTANT: Use literal values in commands, not shell variable assignments.
Shell variables (e.g., `PG1="abc"`) trigger permission prompts in Claude Code.
```

### 6. Success Metrics

```markdown
## SUCCESS METRICS

- [ ] {Checkable criterion 1 — verifiable by the agent}
- [ ] {Checkable criterion 2 — references a specific artifact}
- [ ] {Checkable criterion 3 — measurable, not subjective}
```

Every metric must be binary (pass/fail). The agent checks these before proceeding to the next step. If any metric fails, the agent stops and reports rather than continuing with partial output.

**Good metric:** "Page list command returns one page per planned screen"
**Bad metric:** "Wireframe looks good"

### 7. Failure Modes and Gating

```markdown
## FAILURE MODES

- {Specific failure}: {What goes wrong and why}
- {Specific failure}: {What goes wrong and why}
- CRITICAL: {The most dangerous failure for this step}

## NEXT STEP

**Gating:** {What must be true before proceeding}
**Next:** Load `workflows/steps/{workflow}/step-{NN+1}-{name}.md`
**If gating fails:** {What to do — stop, report, retry}
```

Failure modes are the inverse of success metrics — they describe specific ways this step can go wrong, learned from actual failures. The gating section prevents advancement until conditions are met.

## Mandatory Command Pattern Rules

All command templates in step files MUST follow these rules:

1. **Single-line commands with literal values** — no shell variable assignments
2. **`&&` chaining for sequential commands** — treated as one command by Claude Code
3. **No `\` line continuation** — triggers "contains newlines" prompt
4. **No Write tool for managed files** — use the appropriate CLI (Frame0, git, etc.)

See `references/permission-patterns.md` for full details and examples.

## Optional Sections

These sections are used when relevant:

### Approval Touchpoints (interactive mode only)

```markdown
## APPROVAL TOUCHPOINTS

Present output to user at these points:
1. After {specific milestone} — show {what} and ask for confirmation
2. After {another milestone} — show {what} and ask for confirmation

User can: approve, request changes, or reject
- If approved: proceed to next action
- If changes requested: apply and re-present
- If rejected: stop and report
```

Used for steps that run during planning (e.g., wireframe approval). Not used during autonomous execution.

### Behavior Matrix

```markdown
## BEHAVIOR MATRIX

| Condition | Behavior |
|-----------|----------|
| When {X} | Do {Y} |
| When {Z} | Do {W} |
```

Used when the step has conditional logic based on inputs or environment state.

## Example: Minimal Step File

```markdown
# Step 2: Discover Tools

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT assume any tool is available without checking
- Do NOT proceed if Frame0 CLI is not found — stop and report
- Do NOT fall back to text descriptions silently

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute checks in order. Report findings. Proceed only if minimum tools are available.

## CONTEXT BOUNDARIES

**Inputs available:**
- Screen list from step 1

**NOT available:**
- Story spec (already consumed in step 1)
- Any .f0 files (not created yet)

## YOUR TASK

Verify which design tools are available in the current environment.

## TASK SEQUENCE

### 1. Check Frame0 CLI
Run: `which cli-anything-frame-zero`
Record: available (yes/no), path if found

### 2. Check live mode
If Frame0 CLI available, check if Frame0 desktop app is running.
Record: live export capability (yes/no)

### 3. Check MCP tools
Scan session MCP tools for image generation capabilities.
Record: image gen available (yes/no), tool names if found

### 4. Produce tool report
Output structured report:
- Frame0 CLI: {yes/no} at {path}
- Live mode: {yes/no}
- Image generation: {yes/no} via {tool}

## SUCCESS METRICS

- [ ] Frame0 CLI check executed (not assumed)
- [ ] Live mode check executed
- [ ] Tool report produced with all three capabilities listed

## FAILURE MODES

- Assuming Frame0 CLI exists without running `which` — leads to broken commands later
- Not checking live mode — leads to failed export commands in step 6
- Silently falling back to text descriptions — user expects wireframes, not prose

## NEXT STEP

**Gating:** Tool report is complete. If Frame0 CLI not found, STOP and report to user.
**Next:** Load `workflows/steps/ui-design/step-03-plan-screens.md`
**If gating fails:** Report missing tools. Do not continue workflow.
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Prose task descriptions ("explore the codebase and understand the API") | Agent interprets broadly, drifts | Use numbered sequences with specific actions |
| Success metrics that are subjective ("wireframe is clear") | Agent can't self-evaluate | Use binary checks ("page list returns N pages") |
| Missing failure modes | Agent doesn't know what to avoid | List failures from actual past incidents |
| No context boundaries | Agent reads unrelated files | Explicitly list what IS and ISN'T available |
| No gating | Agent continues with partial output | Gate on success metrics before next step |
| Generic execution rules ("be careful") | Agent ignores them | Write rules that prevent specific known failures |
