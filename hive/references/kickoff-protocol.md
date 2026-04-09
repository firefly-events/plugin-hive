# Hive Kickoff Protocol

Initialize Hive for a project. Detects brownfield vs greenfield automatically.

**Input:** `$ARGUMENTS` optionally describes the project or intent.

## Step 1: Detect Scenario

Check the current working directory:
- **Has existing source code** (src/, lib/, app/, package.json, build.gradle, etc.) → **Brownfield**
- **Empty or minimal** (just a README, no source) → **Greenfield**
- **Ambiguous** → Ask the user

---

## Step 2A: Brownfield — Discovery & Onboarding

**Goal:** Build a comprehensive knowledge base so Hive agents understand the project before any planning or execution begins.

### Phase 1: Read Existing Knowledge FIRST

Before scanning any code, read what the project already knows about itself:

1. **CLAUDE.md** — THE primary source. Read it completely. It contains build commands, conventions, architecture decisions, known issues, and rules that the developers have already documented. Every finding here takes precedence over what you discover by scanning code.

2. **.claude/** directory — check for:
   - `settings.json` / `settings.local.json` — project-level config, enabled MCP servers
   - `commands/` — existing slash commands
   - `agents/` — existing agent definitions
   - `skills/` — existing skills
   - `memory.db` — prior Claude Code context

3. **Other documentation:**
   - `README.md` — project overview
   - `docs/` — architecture docs, ADRs, briefs, stories, sprint status
   - `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CHANGELOG.md`
   - Any `.md` files in project root

**Key principle:** CLAUDE.md is authoritative. If CLAUDE.md says "use X convention" and the code shows a mix of X and Y, the answer is X — the code has drift, not the doc.

### Phase 2: Codebase Discovery

Now scan the code to fill gaps not covered by documentation:

1. **Project structure** — key directories, modules, entry points
   - Don't just list top-level dirs — understand what each contains
   - For monorepos: identify each package/module and its purpose

2. **Tech stack detection** — languages, frameworks, build tools
   - Read build configs: `build.gradle.kts`, `package.json`, `Podfile`, `Cargo.toml`, etc.
   - Check version pins and dependency lists

3. **Test infrastructure** — THIS IS CRITICAL, get it right:
   - **Don't assume standard test locations.** Different frameworks put tests in different places:
     - KMP/Kotlin: `src/commonTest/`, `src/androidTest/`, `src/iosTest/`, `src/jvmTest/`
     - JavaScript: `__tests__/`, `*.test.ts`, `*.spec.ts` alongside source
     - Python: `tests/`, `test_*.py` alongside source
     - Swift: `*Tests/`, XCTest targets in Xcode project
     - E2E: `.maestro/`, `_testing/`, `cypress/`, `playwright/`
   - **Count actual test files** by searching for test patterns in the framework's convention
   - Check for coverage configs: `jacoco`, `kover`, `istanbul`, `coverage/`
   - Check for mocking/faking: `mockk`, `mockito`, `jest.mock`, fakes directories
   - Check test runner configs: `jest.config`, `pytest.ini`, `build.gradle` test tasks

4. **Architecture patterns** — scan actual code, not just file structure:
   - DI framework (Koin, Dagger, manual)
   - State management (Flow, StateFlow, Redux, MobX)
   - Navigation (Compose Navigation, React Router, Express routes)
   - Data layer (repositories, services, API clients)
   - Read 2-3 representative files to confirm patterns

5. **CI/CD** — `.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`

6. **Existing project management:**
   - Sprint/story files in `docs/`
   - Linear/Jira/YouTrack integration in `.claude/settings`
   - Branch naming conventions (check recent git branches)

### Phase 2b: Extended Discovery (Placeholders)

These sub-phases extend brownfield discovery with deeper project analysis. Each writes to a specific section of the project profile. All new fields are optional with sensible defaults — existing kickoff output is unchanged until detection logic is implemented.

#### Phase 2b-i: Integration Preflight

<!-- TODO: Implement integration detection logic (story: integration-preflight) -->
<!-- DATA CONTRACT: Writes to project-profile.yaml → integrations: {} -->
<!-- Detects: CLI tools (linearis, frame0, codex, maestro), MCP servers (firecrawl, context7, posthog, firebase, mobile-mcp), vaults (obsidian) -->
<!-- Default: integrations: {cli_tools: {}, mcp_servers: {}, vaults: {}} -->
<!-- Note: This populates integrations.mcp_servers (detected), NOT existing_knowledge.mcp_servers (manually declared) -->

Scan the development environment for available integrations. Check for CLI tools, MCP server configurations, and knowledge vaults. Results inform which Hive capabilities are available during execution.

#### Phase 2b-ii: Developer Discovery

<!-- TODO: Implement developer preference elicitation (story: developer-discovery) -->
<!-- DATA CONTRACT: Writes to hive.config.yaml → developer: {} -->
<!-- Discovers: pr_style, commit_granularity, review_depth, notes -->
<!-- Default: developer: {pr_style: null, commit_granularity: null, review_depth: null, notes: null} -->
<!-- Also populates: execution.default_methodology via elicitation (currently hardcoded to "classic") -->

Elicit developer preferences for PR workflow, commit style, and review expectations. These preferences configure Hive's execution behavior to match the developer's working style.

#### Phase 2b-iii: Code Quality & Linter Detection

Detect code quality tooling, extract representative code snippets, and collect test-first heuristic signals. All results write to `project-profile.yaml → code_quality`. Idempotent on re-run: merge new discoveries, preserve existing entries (including manual edits).

<!-- DATA CONTRACT: Writes to project-profile.yaml → code_quality: {} and project_maturity: "" -->
<!-- Default: code_quality: {linters: [], formatters: [], pre_commit: {framework: null, hooks: []}, code_snippets: []}; project_maturity: "not_detected" -->

##### Step 1: Linter & Formatter Detection (8 patterns)

Scan for config files across 4 ecosystems. V1 ceiling: 2 patterns per ecosystem = 8 total.

| Ecosystem | Pattern 1 | Pattern 2 |
|-----------|-----------|-----------|
| **JavaScript** | `.eslintrc.*` (any extension: `.js`, `.cjs`, `.json`, `.yml`) | `eslint.config.js` or `eslint.config.mjs` (flat config) |
| **Python** | `pyproject.toml` containing `[tool.ruff]` | `.flake8` |
| **Kotlin** | `detekt.yml` or `.detekt.yml` | `build.gradle.kts` containing `ktlint` or `spotless` plugin |
| **Swift** | `.swiftlint.yml` | `.swiftformat` |

For each match found:

1. **Extract tool name** — the linter/formatter name (e.g., `eslint`, `ruff`, `detekt`, `swiftlint`)
2. **Record config path** — relative path to the config file
3. **Infer lint command** — best-guess run command (e.g., `npx eslint .`, `ruff check .`, `./gradlew detekt`, `swiftlint`)
4. **Write to** `code_quality.linters[]`:

```yaml
code_quality:
  linters:
    - name: eslint
      config_path: .eslintrc.js
      lint_command: "npx eslint ."
      ecosystem: javascript
    - name: ruff
      config_path: pyproject.toml
      lint_command: "ruff check ."
      ecosystem: python
```

Also detect formatters alongside linters — common pairs:

| Ecosystem | Formatter pattern |
|-----------|-------------------|
| **JavaScript** | `.prettierrc`, `.prettierrc.*`, `prettier.config.js` |
| **Python** | `pyproject.toml` containing `[tool.black]` or `[tool.ruff.format]` |
| **Kotlin** | `spotless` plugin in `build.gradle.kts` |
| **Swift** | `.swiftformat` (also a formatter) |

Write formatter entries to `code_quality.formatters[]` with the same shape as linters.

**If no linters or formatters are found**, write empty arrays — do not omit the keys:
```yaml
code_quality:
  linters: []
  formatters: []
```

##### Step 2: Pre-Commit Hook Detection

Check for pre-commit hook frameworks in priority order:

1. **Husky** — `package.json` containing `"husky"` in `devDependencies`, OR `.husky/` directory exists
2. **pre-commit** — `.pre-commit-config.yaml` exists
3. **Lefthook** — `lefthook.yml` or `.lefthook.yml` exists

For the first framework found:

1. **Record framework name** — `husky`, `pre-commit`, or `lefthook`
2. **List hook names** — parse the config to extract registered hooks (e.g., `lint-staged`, `commitlint`, `prettier --check`)
3. **Write to** `code_quality.pre_commit`:

```yaml
code_quality:
  pre_commit:
    framework: husky
    hooks:
      - lint-staged
      - commitlint
```

**If no pre-commit framework is found**, write null/empty defaults:
```yaml
code_quality:
  pre_commit:
    framework: null
    hooks: []
```

##### Step 3: Code Snippet Extraction

Select 2–3 representative source files that demonstrate the project's coding patterns. Prefer:
- An entry point (e.g., `main.kt`, `index.ts`, `app.py`, `App.swift`)
- A service or repository file (business logic)
- A component or view file (if UI exists)

For each selected file, extract an **annotated pattern** — NOT verbatim file content:

```yaml
code_quality:
  code_snippets:
    - path: src/services/UserService.kt
      pattern: repository-pattern
      annotation: "Uses constructor-injected repository with suspend functions; returns Result<T> wrapper"
      lines: "12-45"
    - path: src/components/Dashboard.tsx
      pattern: react-component
      annotation: "Functional component with useQuery hook; follows container/presenter split"
      lines: "1-38"
```

Each snippet entry must have:
- `path` — relative file path
- `pattern` — short pattern name (e.g., `repository-pattern`, `react-component`, `fastapi-router`)
- `annotation` — 1–2 sentence description of what the pattern demonstrates
- `lines` — line range showing the representative section (keep under 40 lines)

##### Step 4: Test-First Heuristic Signals

Collect 5 signal types that indicate whether the project follows test-first practices. These are **data only** — collected here, consumed by the developer-discovery story (Phase 2b-ii) for smart defaults.

| Signal | How to detect | Value |
|--------|---------------|-------|
| **co_located_tests** | Test files adjacent to source (e.g., `UserService.test.ts` next to `UserService.ts`) | `true` / `false` |
| **test_before_source** | Compare git timestamps: do test files predate or match source file creation? Sample 3–5 pairs via `git log --diff-filter=A --format=%aI -- <file>` | `true` / `false` / `inconclusive` |
| **test_runner_in_precommit** | Pre-commit hooks include a test runner (e.g., `jest`, `pytest`, `gradle test`) | `true` / `false` |
| **bdd_keywords** | Source or test files contain BDD keywords: `describe`, `it`, `given`, `when`, `then`, `Feature:`, `Scenario:` | `true` / `false` |
| **test_absence** | No test files found at all (from Phase 2 test infrastructure scan) | `true` / `false` |

Write to `code_quality.test_first_signals`:

```yaml
code_quality:
  test_first_signals:
    co_located_tests: false
    test_before_source: inconclusive
    test_runner_in_precommit: true
    bdd_keywords: true
    test_absence: false
```

##### Step 5: Idempotent Merge Logic

When Phase 2b-iii runs on a project that already has `code_quality` data:

1. **Read existing** `code_quality` section from `project-profile.yaml`
2. **Match linters by name** — if a linter entry with the same `name` exists, preserve the existing entry (it may have been manually edited)
3. **Append new** — any newly detected linter not already present gets appended
4. **Never remove** — entries in the existing file that are NOT re-detected are kept (user may have added them manually)
5. **Same logic** applies to `formatters[]`, `pre_commit.hooks[]`, and `code_snippets[]` (match snippets by `path`)
6. **Scalar fields** (`pre_commit.framework`, `test_first_signals.*`) — overwrite with latest detection, unless existing value was manually changed (check for a `# manual` comment annotation)

This ensures `kickoff` can be re-run safely without losing manual curation.

#### Phase 2b Data Flow Summary

| Sub-phase | Target File | Target Section |
|-----------|------------|----------------|
| 2b-i Integration Preflight | project-profile.yaml | `integrations` |
| 2b-ii Developer Discovery | hive.config.yaml | `developer` |
| 2b-iii Code Quality & Linter Detection | project-profile.yaml | `code_quality` (linters, formatters, pre_commit, code_snippets, test_first_signals), `project_maturity` |

---

### Phase 3: Synthesize Project Profile

Write a structured project profile to `state/project-profile.yaml`. This is what all Hive agents read before starting work.

```yaml
project_name: "{name}"
type: brownfield
discovered: "{ISO 8601}"
source: "CLAUDE.md + codebase scan"

# From CLAUDE.md (verbatim or summarized)
claude_md_summary: |
  Key rules and conventions from CLAUDE.md that agents must follow.
  Build commands, test commands, lint commands.
  Any explicit DO/DON'T rules.

tech_stack:
  languages: []
  frameworks: []
  build_tools: []
  package_managers: []
  versions:
    # key version pins from build configs

structure:
  modules:
    - name: composeApp
      purpose: Shared KMP UI and business logic
      source: composeApp/src/commonMain/
      tests: composeApp/src/commonTest/
    - name: iosApp
      purpose: iOS native shell
      source: iosApp/iosApp/
    - name: server
      purpose: Backend API
      source: server/src/
      tests: server/__tests__/
  entry_points: []

architecture:
  pattern: MVVM | MVC | Clean | etc.
  di_framework: Koin | Dagger | manual
  state_management: description
  navigation: description
  data_layer: description

conventions:
  naming: description from CLAUDE.md or code analysis
  file_organization: description
  branching: description from git history
  commit_messages: description from git log

test_infrastructure:
  unit:
    framework: JUnit | pytest | Jest | etc.
    location: path/to/tests/
    count: N files, M test functions
    coverage_tool: kover | jacoco | istanbul | none
  integration:
    framework: description
    location: path
  e2e:
    framework: Maestro | Playwright | Cypress
    location: path
    count: N flows/specs
  mocking: mockk | fakes | none
  test_commands:
    - "./gradlew :composeApp:allTests"
    - "npm test"

ci_cd:
  platform: GitHub Actions | GitLab CI
  workflows: []
  gating: description (e.g., QA Queue required for PRs)

documentation_found:
  - path: CLAUDE.md
    content_summary: one-line
  - path: README.md
    content_summary: one-line
  - path: docs/
    content_summary: one-line

existing_knowledge:
  # Anything from .claude/ that Hive should know about
  mcp_servers: [list from settings]
  existing_skills: [list from .claude/skills]
  existing_hooks: [list from settings]
```

### Phase 4: hive.config.yaml

Create `hive.config.yaml` in the project root. This is Hive-specific config — NOT a duplicate of CLAUDE.md.

**What goes in hive.config.yaml:**
- Hive workflow settings (methodology, retry attempts, model tiers)
- Task tracking config (Linear team, project, user ID)
- Quality gate thresholds
- Token budgets

**What stays in CLAUDE.md:**
- Build/test/lint commands
- Code conventions and rules
- Architecture decisions
- Project-specific instructions for Claude

**Never duplicate CLAUDE.md content in hive.config.yaml.**

### Phase 5: Initialize Hive State

- Create `state/cycle-state/` directory
- Create `state/epics/` directory
- Create `state/insights/` directory (staging area for agent insights)
- Create `state/test-baseline/{project}/` if test swarm will be used
- Create `state/test-artifacts/` directory (screenshots, logs, results from test swarm)
- Create `~/.claude/hive/memories/` with subdirectories for each agent in the roster: frontend-developer, backend-developer, researcher, technical-writer, tester, reviewer, architect, analyst, tpm, ui-designer, team-lead, pair-programmer, peer-validator, test-architect, test-scout, test-worker, test-inspector, test-sentinel, orchestrator
- Create `state/team-memories/` directory (project-scoped team collective memories)
- Create `state/teams/` directory (loadable team configs)
- Run per-agent memory migration (idempotent — safe to run every kickoff):
  - For each agent, check `skills/hive/agents/memories/{agent}/` for `.md` files
  - Copy files that don't already exist at `~/.claude/hive/memories/{agent}/`
  - Skip files that already exist at the system path (don't overwrite)
  - Log: `Migrated: N files, Skipped: M files`
  - See `references/agent-memory-schema.md` → "Migration from old path" for full procedure

### Phase 5b: Generate Team Configs

Based on the project discovery from phases 1-4, generate team config files:

1. Identify project domains from directory structure (frontend dirs, backend dirs, test dirs, infra dirs)
2. Match domains to roster agents (frontend dir → frontend-developer, backend dir → backend-developer, etc.)
3. Generate domain restrictions based on actual directory paths discovered
4. Set tech_stack from discovered technologies
5. Write team config(s) to `state/teams/{team-name}.yaml`
6. For large projects, generate multiple specialized teams (e.g., `api-team`, `mobile-team`)
7. Present configs in the onboarding report for user review

See `references/team-config-schema.md` for the full format.

### Phase 6: Present Onboarding Report

```
## Project Onboarding: {project_name}

**Type:** Brownfield
**Source:** CLAUDE.md + codebase discovery
**Tech Stack:** {summary}
**Architecture:** {pattern} with {DI}, {state mgmt}, {navigation}
**Scale:** {N} source files, {M} modules

### From CLAUDE.md
{Key rules and conventions the agents must follow}

### Discovered
- {N} source directories mapped
- {N} test files found ({unit count} unit, {e2e count} E2E)
- CI/CD: {platform} with {N} workflows
- {N} conventions identified from code

### Test Infrastructure
- Unit: {framework} at {location} — {count} files
- E2E: {framework} at {location} — {count} flows
- Coverage: {tool or "not configured"}
- Gaps: {specific gaps identified}

### Files Created
- state/project-profile.yaml — comprehensive project profile
- hive.config.yaml — Hive workflow configuration
- state/insights/ — insight staging area
- ~/.claude/hive/memories/ — agent memory storage (16 agent subdirectories)

### Recommended Next Steps
- Review the project profile for accuracy
- /plugin-hive:plan — plan your first feature or improvement
- /plugin-hive:standup — begin daily operations
```

---

## Step 2B: Greenfield — Product Kickoff

For a new project starting from scratch.

**Goal:** Go from idea to implementable stories through a structured planning pipeline.

**Process:**

1. **Brainstorming / Ideation**
   - Ask the user: "What are you building and why?"
   - Use the analyst agent mindset: target users, core problem, key differentiators
   - If `$ARGUMENTS` has a description, use as starting point
   - Facilitate: what's in scope, what's explicitly out
   - Output: captured product concept with user validation

2. **Product Brief**
   - Synthesize into structured brief
   - Sections: Problem, Target Users, Core Features (P0/P1/P2), Success Metrics, Scope Boundaries
   - Write to `state/planning/product-brief.md`
   - Present for user approval before proceeding

3. **PRD (Product Requirements Document)**
   - Expand brief into detailed requirements
   - Each requirement: description, user value, acceptance criteria (Given/When/Then)
   - Write to `state/planning/prd.md`
   - Present for user approval

4. **Architecture**
   - Architect agent: tech stack, components, API contracts, data model
   - Decisions with alternatives considered and rationale
   - Write to `state/planning/architecture.md`
   - Present for user approval

5. **Epics & Stories**
   - Decompose PRD into epics and stories via `/plugin-hive:plan`
   - Apply agent-ready checklist to every story
   - Write to `state/epics/`

6. **Initialize Cycle State**
   - Create `state/cycle-state/{epic-id}.yaml` with all decisions from steps 2-4

7. **Present Kickoff Summary**
   ```
   ## Project Kickoff: {project_name}

   **Type:** Greenfield
   **Brief:** state/planning/product-brief.md
   **PRD:** state/planning/prd.md
   **Architecture:** state/planning/architecture.md
   **Epics:** {N} epics with {M} total stories

   ### Ready for Execution
   Run /plugin-hive:execute {epic-id} to begin development.
   Or /plugin-hive:standup to start daily operations.
   ```

---

## Shared Resources

All shared resources (agents, references, workflows) are in the `hive/` directory relative to the plugin root. Read the orchestrator guidance at `hive/MAIN.md` for command details.
