# Step 1: Context Gathering and Baseline Verification

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT assume test frameworks are present — run actual detection commands
- Do NOT skip baseline check even if the story seems straightforward
- Do NOT read files outside story spec, codebase structure, and baseline knowledge
- Do NOT proceed without producing the context report — it is the input for all downstream steps
- Always check `state/test-baseline/` before running a full discovery pass

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute the full task sequence without user input. Produce the context report and baseline status as output artifacts. If baseline does not exist, run a full discovery pass before producing the context report.

## CONTEXT BOUNDARIES

**Inputs available:**
- Build report from step 0 (confirms fresh build is deployed — do not test stale artifacts)
- Story spec YAML (provided by orchestrator via `story_spec` context key)
- Project codebase (for framework detection and structure scanning)
- Baseline knowledge at `state/test-baseline/{project}/baseline-knowledge.md` (if it exists)

**NOT available (do not read or assume):**
- Other story specs in the epic
- MAIN.md, GUIDE.md, or hive system files
- Test results from previous runs (those live in `state/test-artifacts/`)

## YOUR TASK

Gather structured test context from the story spec and codebase, verify or create baseline knowledge, and produce a context document that downstream agents (architect, inspector, worker) will consume.

## TASK SEQUENCE

### 1. Read the story spec

Read the story YAML file provided by the orchestrator. Extract:

- **Acceptance criteria:** Every testable requirement (these become test targets)
- **Affected areas:** Files, modules, screens, endpoints changed
- **Tech stack:** Languages, frameworks, platforms from `context.tech_stack`
- **Cross-cutting concerns:** Test tags, shared flows, regression-sensitive areas
- **Platform targets:** iOS, Android, Web, Backend (from story context)

### 2. Check for existing baseline

```bash
ls state/test-baseline/
```

- If baseline exists: read `state/test-baseline/{project}/baseline-knowledge.md`
- If baseline is missing or stale: proceed to step 3 (discovery pass)
- If baseline exists and is current: skip to step 4

### 3. Run discovery pass (if baseline missing or stale)

Inspect the codebase to build baseline knowledge:

**a. Detect test frameworks:**
```bash
# Check for Maestro
ls .maestro/ 2>/dev/null

# Check for Playwright
ls playwright.config.ts playwright.config.js 2>/dev/null

# Check for Cypress
ls cypress.config.ts cypress.config.js 2>/dev/null

# Check for pytest
ls pytest.ini conftest.py 2>/dev/null

# Check for Jest/Vitest
ls jest.config.ts jest.config.js vitest.config.ts vitest.config.js 2>/dev/null

# Check for XCTest
find . -name "*.swift" -exec grep -l "XCTestCase" {} \; 2>/dev/null | head -5

# Check for JUnit/Kotest
find . -name "*.kt" -exec grep -l "@Test" {} \; 2>/dev/null | head -5
```

**b. Scan existing test files and coverage:**
```bash
# Find all test files
find . -name "*test*" -o -name "*spec*" -o -name "*.maestro" | grep -v node_modules | grep -v .git

# Check for coverage reports
find . -name "coverage" -type d -o -name "*.lcov" -o -name "coverage.xml" | head -10
```

**c. Map project structure:**
- Key directories, modules, entry points
- Navigation/routing structure (if applicable)
- Technology stack and dependencies

**d. Write baseline knowledge:**
Save findings to `state/test-baseline/{project}/baseline-knowledge.md` with:
- Project structure summary
- Detected test frameworks and their config locations
- Existing test directories and file counts
- Known test patterns and conventions
- Platform-specific considerations

### 4. Check cross-cutting concerns

Scan for:
- Maestro flows that span multiple screens (shared test infrastructure)
- Test tags or categories in use (smoke, regression, e2e)
- Shared test utilities or fixtures
- Environment-specific test configurations

### 5. Produce context report

Output a structured context document:

```markdown
## Context Source
- Source type: {story | PR | commits | ad-hoc}
- Reference: {story ID, PR number, or commit range}

## What Was Built
- {Description of changes from story spec}

## Affected Areas
- {Files, modules, screens, endpoints affected}

## Acceptance Criteria
- AC-1: {criterion text}
- AC-2: {criterion text}
- ...

## Test-Relevant Details
- Frameworks detected: {list with config paths}
- Existing test coverage: {summary}
- Platform targets: {list}
- Cross-cutting concerns: {shared flows, tags, regression areas}

## Baseline Context
- Baseline status: {created | updated | current}
- Baseline path: state/test-baseline/{project}/baseline-knowledge.md
- Key patterns: {relevant sections from baseline}
```

## SUCCESS METRICS

- [ ] Story spec read and all acceptance criteria extracted
- [ ] Baseline knowledge checked (exists or discovery pass completed)
- [ ] Test framework detection commands executed (not assumed)
- [ ] Existing test files scanned with counts
- [ ] Cross-cutting concerns identified (or confirmed none)
- [ ] Context report produced with all sections populated

## FAILURE MODES

- **Assuming frameworks without running detection:** Architect authors tests for wrong framework. Always run the check commands.
- **Skipping baseline check:** Discovery pass runs unnecessarily on every invocation, wasting time.
- **Not extracting all acceptance criteria:** Downstream coverage validation misses requirements, producing false "100% coverage."
- **Reading beyond story spec:** Scope drift into unrelated stories or system files.
- **Not checking cross-cutting concerns:** Shared Maestro flows or test tags missed, causing gaps in integration coverage.

## NEXT STEP

**Gating:** Context report is complete with all sections. Baseline is verified or created.
**Next:** Load `workflows/steps/test-swarm/step-02-architect.md`
**If gating fails:** Report what is missing. Do not continue workflow.
