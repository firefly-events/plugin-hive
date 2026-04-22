# Hive Kickoff Protocol

Initialize Hive for a project. Detects brownfield vs greenfield automatically.

**Input:** `$ARGUMENTS` optionally describes the project or intent.

## Step 0: Legacy state/ Migration Check

Before any other work:

1. Read `hive.config.yaml` if present and resolve `STATE_DIR = paths.state_dir`
   (fall back to `.pHive` if unset).
2. If `STATE_DIR` is explicitly set to `state` → the user has opted to keep
   the legacy directory. Skip the migration check entirely and continue.
   Do not prompt on subsequent runs.
3. Otherwise, check the filesystem:
   - If both `state/` and `.pHive/` exist → warn the user, do not auto-migrate.
     They likely have a half-finished migration. Tell them to resolve manually.
   - If only `state/` exists (no `.pHive/`) → strongly recommend migration:
     - Show: "Found legacy state/ directory. Hive v1.2+ uses .pHive/ by default,
       and all shipped skills/workflows now reference `.pHive/` directly.
       Migrate now? (yes/no)"
     - **yes**: run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-state-to-pHive.sh`
     - **no**: skip and continue. **Important caveat:** `paths.state_dir` in
       `hive.config.yaml` is not yet honored by all skills, so keeping `state/`
       without migrating will cause skills that hardcode `.pHive/` paths to
       write to a new empty directory. Tell the user this explicitly, and
       suggest a symlink (`ln -s state .pHive`) as a stopgap if they cannot
       migrate right now. Next kickoff run will ask again.
   - If only `.pHive/` exists or neither → no action needed.

This step is idempotent — safe to re-run on any project.

## Step 1: Detect Scenario

Check the current working directory:
- **Has existing source code** (src/, lib/, app/, package.json, build.gradle, etc.) → **Brownfield**
- **Empty or minimal** (just a README, no source) → **Greenfield**
- **Ambiguous** → Ask the user

## Step 1a: Fresh Kickoff Metrics Opt-In

Before entering the brownfield or greenfield path on a fresh kickoff run, ask the user:

`Enable metrics tracking?`

Keep the explanation inline and short: opting in enables metric-driven meta-optimization later; opting out keeps metrics off and future meta runs fall back to qualitative/backlog-fallback mode.

Add a clearly labeled consequence line immediately with the question:

`Consequence of opting out: metrics stay off. Meta work will use qualitative/backlog mode, and future metric-driven optimization features won't be available.`

Follow it with the matching future-facing clause:

`Opting in is what would unlock metric-driven behavior for those future skills.`

Default to `no`. The user must actively choose `yes` to enable metrics. Empty input, unclear input, or any non-yes answer leaves metrics disabled.

Persist the answer to `hive.config.yaml` using the existing kickoff config write pattern:

1. Write the final choice to `metrics.enabled`
2. `yes` → `metrics.enabled: true`
3. `no` or default-off path → `metrics.enabled: false`

Example result in `hive.config.yaml`:

```yaml
metrics:
  enabled: false
```

If this is a brownfield re-kickoff and `hive.config.yaml` already contains `metrics.enabled`, extend this same step with a preservation branch:

1. Read the current `metrics.enabled` value from `hive.config.yaml` before prompting.
2. Show the current value explicitly to the user, for example: `Metrics tracking is currently enabled.` or `Metrics tracking is currently disabled.`
3. Ask a change prompt, not the fresh opt-in question. Example: `Do you want to change metrics tracking from its current setting?`
4. If the user keeps the existing value, preserve it as-is and do not write `hive.config.yaml`.
5. If the user explicitly chooses to change it, write only the new value to `metrics.enabled` using the existing kickoff config write pattern.

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

**Execution order:** 2b-i (Integration Preflight) and 2b-iii (Code Quality) run first (parallel — no dependency on each other). Then 2b-ii (Developer Discovery) runs using test-first signals from 2b-iii for smart defaults. Finally 2b-iv (Cross-Cutting Concerns) runs using outputs from all prior phases.

#### Phase 2b-i: Integration Preflight

<!-- TODO: Implement integration detection logic (story: integration-preflight) -->
<!-- DATA CONTRACT: Writes to project-profile.yaml → integrations: {} -->
<!-- Detects: CLI tools (linearis, frame0, codex, maestro), MCP servers (firecrawl, context7, posthog, firebase, mobile-mcp), vaults (obsidian) -->
<!-- Default: integrations: {cli_tools: {}, mcp_servers: {}, vaults: {}} -->
<!-- Note: This populates integrations.mcp_servers (detected), NOT existing_knowledge.mcp_servers (manually declared) -->

Scan the development environment for available integrations. Check for CLI tools, MCP server configurations, and knowledge vaults. Results inform which Hive capabilities are available during execution.

#### Phase 2b-ii: Developer Discovery

<!-- DATA CONTRACT: Writes to hive.config.yaml → developer: {} -->
<!-- Discovers: pr_style, commit_granularity, review_depth, notes -->
<!-- Also populates: execution.default_methodology via elicitation -->

Elicit developer preferences for PR workflow, commit style, and review expectations. These preferences configure Hive's execution behavior to match the developer's working style.

##### Idempotent Guard

Before eliciting, check `hive.config.yaml` for existing developer preferences:

1. Read the `developer:` section from `hive.config.yaml`
2. If **any** of `pr_style`, `commit_granularity`, or `review_depth` are non-null → **skip elicitation entirely**
3. Print: `Developer preferences already configured — skipping discovery.`
4. Continue to Phase 2b-iv

This ensures `kickoff` can be re-run without re-asking questions the developer already answered.

##### Step 1: Infer Smart Defaults from Test-First Signals

Read `code_quality.test_first_signals` from `project-profile.yaml` (populated by Phase 2b-iii which runs before this phase). Apply this decision table to determine the methodology default:

| Priority | Condition | Default Methodology |
|----------|-----------|-------------------|
| 1 | `bdd_keywords: true` | **BDD** |
| 2 | `co_located_tests: true` AND (`test_before_source: true` OR `test_runner_in_precommit: true`) | **TDD** |
| 3 | `co_located_tests: true` (alone) | **TDD** |
| 4 | `test_absence: true` | **Classic** |
| 5 | No signals available or all inconclusive | **Classic** |

Rules:
- BDD wins over TDD when both signals are present (BDD is a superset of TDD practices)
- When signals conflict, prefer the higher-priority row
- If `test_first_signals` is missing entirely (unexpected — Phase 2b-iii should have run first), default to **Classic**

Also infer a PR style default from recent git history:
- Run `git log --oneline -20` and check merge patterns
- Mostly merge commits with single parents → `single-commit`
- Squash merge messages (e.g., "Squashed commit of…") → `squash-merge`
- No clear pattern or fresh repo → `single-commit` (safe default)

##### Step 2: Present Elicitation (5 Questions)

Present the questions as a single conversational block. The tone should feel like a colleague asking preferences, not a form to fill out.

**Prompt template:**

```
I've detected some patterns in your codebase. Here are my suggested defaults
for how Hive should work with you — press Enter to accept all, or type the
number(s) you'd like to change (e.g., "1,3"):

  1. Methodology:           {inferred_methodology} {reason_hint}
  2. PR style:              {inferred_pr_style}
  3. Commit granularity:    feature-scoped
  4. Review depth:          standard
  5. Collaborative reviews: on
  6. Meta-team GitHub sync: off
  7. Additional notes:      (none)

Options for each:
  1 → Classic / TDD / BDD
  2 → single-commit / squash-merge / atomic-prs / bundled
  3 → fine (per-change) / medium (per-task) / coarse (per-story)
  4 → thorough / standard / light
  5 → on / off (team review gates during planning — adds quality but takes longer)
  6 → on / off (meta-team files plugin-level issues to GitHub — off keeps everything local)
  7 → free text (workflow preferences, pet peeves, anything Hive should know)
```

The `{reason_hint}` after methodology briefly explains why that default was chosen:
- `(co-located tests suggest test-first)` → TDD
- `(BDD keywords found in test files)` → BDD
- `(no strong test-first signals)` → Classic

**Interaction flow:**

1. If the developer presses **Enter** (empty input) → accept all defaults as-is
2. If the developer types numbers (e.g., `1,3`) → prompt for each selected question individually:
   - `Methodology (Classic/TDD/BDD):` and wait for input
   - `Commit granularity (fine/medium/coarse):` and wait for input
3. For Q5 (collaborative reviews), if selected: `Collaborative reviews (on/off):` and wait for input
4. For Q6 (meta-team GitHub sync), if selected: `Meta-team GitHub sync (on/off):` and wait for input
5. For Q7 (notes), if selected: `Any notes for Hive? (workflow preferences, things to avoid, etc.):` and capture free text
6. Validate inputs — if an answer doesn't match known options, show the options again (once). On second invalid input, keep the default.

##### Step 3: Write Preferences to Config

Write the final values (defaults + any overrides) to `hive.config.yaml`:

1. **Methodology** → `execution.default_methodology` (update the EXISTING field — do NOT create a new `developer.methodology` field)
2. **PR style** → `developer.pr_style`
3. **Commit granularity** → `developer.commit_granularity`
4. **Review depth** → `developer.review_depth`
5. **Collaborative reviews** → `planning.collaborative_review` (on = `true`, off = `false`)
6. **Meta-team GitHub sync** → `meta_team.github_forwarding` (on = `true`, off = `false`)
7. **Notes** → `developer.notes` (null if no notes provided)

Example result in `hive.config.yaml`:

```yaml
execution:
  default_methodology: tdd    # ← updated by developer discovery

developer:
  pr_style: single-commit
  commit_granularity: medium
  review_depth: standard
  notes: "I prefer small PRs. Always run tests before pushing."
```

##### Step 4: Confirm and Continue

After writing, print a brief confirmation:

```
Got it! Your preferences are saved to hive.config.yaml.
You can update them anytime by editing the file directly.
```

Continue to Phase 2b-iv.

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

#### Phase 2b-iv: Cross-Cutting Concern Auto-Generation

Silently auto-generate project-specific cross-cutting concerns from the discovered tech stack. No interactive review gate — write the file and show a summary.

<!-- DATA CONTRACT: Writes to .pHive/cross-cutting-concerns.yaml → concerns: [] -->
<!-- Default: concerns contain at minimum the 'documentation' concern -->

##### Step 1: Map Tech Stack to Template

Read `tech_stack` from `.pHive/project-profile.yaml` (populated in Phase 2). Map the discovered stack to a concern template file in `hive/references/examples/`:

| Tech Stack Signal | Template File |
|-------------------|---------------|
| KMP, Kotlin Multiplatform, Compose Multiplatform, Android + iOS | `cross-cutting-concerns.mobile-app.yaml` |
| React, Next.js, Vue, Angular, Svelte | *(no template — web)* |
| Express, FastAPI, Django, Rails, Spring | *(no template — API)* |
| CLI, argparse, cobra, clap | *(no template — CLI)* |

Detection logic:
1. Read `tech_stack.frameworks[]` and `tech_stack.languages[]` from project profile
2. If any framework or language matches mobile indicators (KMP, `kotlin-multiplatform`, `compose-multiplatform`, Android, iOS, Swift + Kotlin together, React Native, Flutter) → use `cross-cutting-concerns.mobile-app.yaml`
3. If no template file matches → fall through to Step 3 (graceful fallback)

##### Step 2: Generate Concerns from Template

If a matching template was found:

1. **Read the template** YAML from `hive/references/examples/{template-file}`
2. **Read existing** `.pHive/cross-cutting-concerns.yaml` (may already have concerns from prior runs or manual edits)
3. **Idempotent merge** using the following algorithm:
   - Parse both files into concern lists, keyed by `id`
   - For each concern in the **template**:
     - If a concern with the same `id` exists in the **state file** → **keep the state file version** (it may have manual edits)
     - If the concern `id` is new (not in state file) → **append** it to the state file
   - For each concern in the **state file** that is NOT in the template → **preserve** it (user added it manually)
   - The `documentation` concern (default) is always preserved — never removed
4. **Write** the merged result to `.pHive/cross-cutting-concerns.yaml`
5. **Count** how many new concerns were added (template entries not previously in state file)

##### Step 3: Graceful Fallback (No Template)

If no template matches the detected tech stack:

1. Ensure `.pHive/cross-cutting-concerns.yaml` exists with at least the `documentation` concern:
   ```yaml
   concerns:
     - id: documentation
       name: Documentation Updates
       description: >
         When a story changes user-facing behavior, workflow steps, or configuration,
         corresponding documentation must be updated.
       applies_when: >
         Story modifies workflows, schemas, directory structure, configuration files,
         or adds/removes/renames reference documents
       planning_prompt: >
         Which documentation files reference the behavior this story changes?
         List each doc and what section needs updating.
       implementation_checklist:
         - "All docs referencing changed behavior identified"
         - "Affected sections updated to reflect new behavior"
         - "No stale references to old behavior remain"
   ```
2. If the file already exists with concerns, do not modify it — just proceed to summary

##### Step 4: Output Summary

Print a single summary line (no interactive prompt, no review gate):

- **Template matched:** `"Auto-generated N concerns for {stack}. Edit at .pHive/cross-cutting-concerns.yaml."`
  - Where `N` is the count of newly added concerns (0 if all already existed from a prior run)
  - Where `{stack}` is the matched template name (e.g., "mobile-app")
- **No template:** `"No concern templates found for {stack}. Using 'documentation' default. Edit at .pHive/cross-cutting-concerns.yaml."`
  - Where `{stack}` is the detected primary framework/language (e.g., "react", "fastapi")

This summary is informational only — kickoff continues to the next phase regardless.

##### Step 5: Idempotent Re-Run Safety

When Phase 2b-iv runs on a project that already has `.pHive/cross-cutting-concerns.yaml`:

1. **Never remove** existing concerns — they may have been manually curated
2. **Never overwrite** an existing concern's fields — the user may have customized `applies_when`, `planning_prompt`, or checklist items
3. **Only append** template concerns whose `id` is not already present
4. **Re-running produces identical output** if no new concerns need adding (N=0 in summary)

#### Phase 2b Data Flow Summary

| Sub-phase | Target File | Target Section |
|-----------|------------|----------------|
| 2b-i Integration Preflight | project-profile.yaml | `integrations` |
| 2b-ii Developer Discovery | hive.config.yaml | `developer` |
| 2b-iii Code Quality & Linter Detection | project-profile.yaml | `code_quality` (linters, formatters, pre_commit, code_snippets, test_first_signals), `project_maturity` |
| 2b-iv Cross-Cutting Concern Auto-Generation | .pHive/cross-cutting-concerns.yaml | `concerns` |

---

### Phase 3: Synthesize Project Profile

Write a structured project profile to `.pHive/project-profile.yaml`. This is what all Hive agents read before starting work.

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

- Create `.pHive/cycle-state/` directory
- Create `.pHive/epics/` directory
- Create `.pHive/insights/` directory (staging area for agent insights)
- Create `.pHive/test-baseline/{project}/` if test swarm will be used
- Create `.pHive/test-artifacts/` directory (screenshots, logs, results from test swarm)
- Create `~/.claude/hive/memories/` with subdirectories for each agent in the roster: frontend-developer, backend-developer, researcher, technical-writer, tester, reviewer, architect, analyst, tpm, ui-designer, team-lead, pair-programmer, peer-validator, test-architect, test-scout, test-worker, test-inspector, test-sentinel, orchestrator
- Create `.pHive/team-memories/` directory (project-scoped team collective memories)
- Create `.pHive/teams/` directory (loadable team configs)
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
5. **Integration-driven tool access** — read `project-profile.yaml → integrations` and configure agent tool access:
   - If **Maestro** detected → add `tool_access: [maestro]` to test agents (tester, test-worker, test-architect)
   - If **Frame0** detected → add `tool_access: [frame0]` to UI agents (ui-designer, frontend-developer)
   - If **mobile-mcp** detected → add `tool_access: [mobile-mcp]` to mobile agents
   - If **codex** detected → add `tool_access: [codex]` to reviewer agent
   - Only grant tool access for integrations that are actually detected — agents should not reference unavailable tools
6. **Linter domain restrictions** — read `project-profile.yaml → code_quality.linters[]` and configure code agents:
   - For each detected linter, add `lint_command` to code agent context (frontend-developer, backend-developer, pair-programmer)
   - Example: if `eslint` detected with command `npx eslint .`, add to the agent's `context.lint_commands[]`
   - This enables code agents to run linters before submitting PRs
7. **Developer methodology** — read `hive.config.yaml → developer` and `execution.default_methodology`:
   - Set team `methodology` field from `execution.default_methodology` (e.g., `tdd`, `classic`)
   - Propagate `developer.pr_style` and `developer.review_depth` into reviewer agent context
   - Propagate `developer.commit_granularity` into all code agent contexts
8. Write team config(s) to `.pHive/teams/{team-name}.yaml`
9. For large projects, generate multiple specialized teams (e.g., `api-team`, `mobile-team`)
10. Present configs in the onboarding report for user review

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

### Integration Status

| Integration | Type | Status | Impact |
|-------------|------|--------|--------|
| linearis | CLI | {detected/missing} | Task tracking automation |
| frame0 | CLI | {detected/missing} | UI wireframe generation |
| codex | CLI | {detected/missing} | Adversarial code review |
| maestro | CLI | {detected/missing} | Mobile E2E test execution |
| firecrawl | MCP | {detected/missing} | Web research & scraping |
| context7 | MCP | {detected/missing} | Library documentation lookup |
| posthog | MCP | {detected/missing} | Product analytics queries |
| firebase | MCP | {detected/missing} | Firebase project management |
| mobile-mcp | MCP | {detected/missing} | Mobile simulator interaction |
| obsidian | Vault | {detected/missing} | Knowledge base access |

Source: `.pHive/project-profile.yaml → integrations`

### Developer Preferences

- **Methodology:** {methodology or "not yet set"}
- **PR Style:** {pr_style or "not yet set"}
- **Commit Granularity:** {commit_granularity or "not yet set"}
- **Review Depth:** {review_depth or "not yet set"}
- **Notes:** {notes or "none"}

Source: `hive.config.yaml → developer`

### Cross-Cutting Concerns

Auto-generated {N} concerns. Edit at `.pHive/cross-cutting-concerns.yaml`.

### Files Created
- .pHive/project-profile.yaml — comprehensive project profile
- hive.config.yaml — Hive workflow configuration
- .pHive/insights/ — insight staging area
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

1. **Product Discovery (via greenfield-discovery skill)**

   Delegate to the **greenfield-discovery** skill for deep product exploration. This replaces inline brainstorming with a structured, Socratic facilitation conversation.

   - Read and invoke: `skills/hive/skills/greenfield-discovery/SKILL.md`
   - Use the analyst agent in **creative/exploratory mode** (not requirements-analysis mode)
   - If `$ARGUMENTS` has a description, pass it as input context to the skill
   - The skill facilitates a 7-area discovery conversation: problem space, target users, competitive landscape, differentiators, success metrics, MVP boundaries, and technical constraints
   - Output: structured **Product Discovery Brief** written to `.pHive/planning/product-discovery-brief.md`
   - The user validates the brief before proceeding to Step 2
   - The discovery brief feeds directly into Step 2 (Product Brief) as structured input

   **1a. Integration Preflight**

   Run the same integration detection as brownfield Phase 2b-i. CLI tools (`linearis`, `frame0`, `codex`, `maestro`) and MCP servers (`firecrawl`, `context7`, `posthog`, `firebase`, `mobile-mcp`) are system-level — they exist regardless of whether a codebase exists. Vaults (`obsidian`) are also system-level.

   - Detect available integrations using the same logic as brownfield (check `which` for CLIs, check MCP server configs for servers, check vault paths)
   - Write results to `.pHive/project-profile.yaml → integrations`
   - Results inform which Hive capabilities are available during execution (e.g., Frame0 for wireframes, Maestro for E2E tests)

   **1b. Developer Discovery (Static Defaults)**

   Elicit developer preferences for PR workflow, commit style, and review expectations — identical to brownfield Phase 2b-ii elicitation. However, greenfield discovery uses **static defaults only**:

   - **No test-first heuristic signals** — there is no codebase to analyze
   - **No linter detection** — there are no config files to scan
   - **No code snippet extraction** — there is no existing code
   - All smart-default fields (`test_first_signals`, `code_quality`) are skipped entirely
   - Elicitation still asks the developer about: `pr_style`, `commit_granularity`, `review_depth`, `methodology`, and `notes`
   - Write results to `hive.config.yaml → developer` and `execution.default_methodology`

2. **Product Brief**
   - Synthesize into structured brief
   - Sections: Problem, Target Users, Core Features (P0/P1/P2), Success Metrics, Scope Boundaries
   - Write to `.pHive/planning/product-brief.md`
   - Present for user approval before proceeding

3. **PRD (Product Requirements Document)**
   - Expand brief into detailed requirements
   - Each requirement: description, user value, acceptance criteria (Given/When/Then)
   - Write to `.pHive/planning/prd.md`
   - Present for user approval

4. **Architecture**
   - Architect agent: tech stack, components, API contracts, data model
   - Decisions with alternatives considered and rationale
   - Write to `.pHive/planning/architecture.md`
   - Present for user approval

   **4a. Cross-Cutting Concern Auto-Generation (from Architecture Choices)**

   After the user approves the architecture, silently auto-generate cross-cutting concerns. This follows the same generation logic as brownfield Phase 2b-iv, but the input is the **chosen architecture stack** (from `.pHive/planning/architecture.md`), not a discovered codebase.

   - Read the chosen tech stack from the architecture document (frameworks, languages, patterns)
   - Map to a concern template in `hive/references/examples/` using the same mapping table as brownfield Phase 2b-iv Step 1
   - If a template matches: idempotent merge into `.pHive/cross-cutting-concerns.yaml` (same algorithm as brownfield — match by `id`, preserve existing, append new)
   - If no template matches: ensure `documentation` default concern exists
   - Print summary: `"Auto-generated N concerns for {stack}. Edit at .pHive/cross-cutting-concerns.yaml."`

   **4b. Linter & Formatter Setup Recommendation**

   Since no codebase exists, there are no linter/formatter configs to detect. Instead, **recommend** setup based on the chosen tech stack:

   - Map the chosen language/framework to recommended linters and formatters:
     - JavaScript/TypeScript → ESLint + Prettier
     - Python → Ruff (linter + formatter)
     - Kotlin → detekt + ktlint
     - Swift → SwiftLint + SwiftFormat
     - Go → golangci-lint + gofmt (built-in)
     - Rust → clippy + rustfmt (built-in)
   - Present as a recommendation (not a detection result): `"Recommended for {stack}: {linter} + {formatter}. Configure these early to establish code quality standards."`
   - Do **not** write to `project-profile.yaml → code_quality` — there are no detected configs to record. The developer will configure these tools when they scaffold the project.

5. **Epics & Stories**
   - Decompose PRD into epics and stories via `/plugin-hive:plan`
   - Apply agent-ready checklist to every story
   - Write to `.pHive/epics/`

6. **Initialize Cycle State**
   - Create `.pHive/cycle-state/{epic-id}.yaml` with all decisions from steps 2-4

7. **Present Kickoff Summary**
   ```
   ## Project Kickoff: {project_name}

   **Type:** Greenfield
   **Discovery:** .pHive/planning/product-discovery-brief.md
   **Brief:** .pHive/planning/product-brief.md
   **PRD:** .pHive/planning/prd.md
   **Architecture:** .pHive/planning/architecture.md
   **Epics:** {N} epics with {M} total stories

   ### Discovery Session Summary

   **Problem:** {1-sentence problem statement from discovery brief}
   **Primary User:** {primary persona from discovery brief}
   **Platform:** {project-type signal: web/mobile/API/CLI/desktop/hybrid}
   **Core Differentiator:** {key differentiator from discovery brief}

   **MVP Scope:** {count} features in v1, {count} deferred to v2+
   - {top 3 v1 features, abbreviated}

   **Key Decisions:**
   - {decisions reached during discovery conversation}

   **Open Questions:** {count} unresolved — see discovery brief for details

   Source: `.pHive/planning/product-discovery-brief.md`

   ### Integration Status

   | Integration | Type | Status | Impact |
   |-------------|------|--------|--------|
   | linearis | CLI | {detected/missing} | Task tracking automation |
   | frame0 | CLI | {detected/missing} | UI wireframe generation |
   | codex | CLI | {detected/missing} | Adversarial code review |
   | maestro | CLI | {detected/missing} | Mobile E2E test execution |
   | firecrawl | MCP | {detected/missing} | Web research & scraping |
   | context7 | MCP | {detected/missing} | Library documentation lookup |
   | posthog | MCP | {detected/missing} | Product analytics queries |
   | firebase | MCP | {detected/missing} | Firebase project management |
   | mobile-mcp | MCP | {detected/missing} | Mobile simulator interaction |
   | obsidian | Vault | {detected/missing} | Knowledge base access |

   Source: `.pHive/project-profile.yaml → integrations`

   ### Developer Preferences

   - **Methodology:** {methodology or "not yet set"}
   - **PR Style:** {pr_style or "not yet set"}
   - **Commit Granularity:** {commit_granularity or "not yet set"}
   - **Review Depth:** {review_depth or "not yet set"}
   - **Notes:** {notes or "none"}

   Source: `hive.config.yaml → developer`

   ### Cross-Cutting Concerns

   Auto-generated {N} concerns for {stack}. Edit at `.pHive/cross-cutting-concerns.yaml`.

   ### Recommended Linter Setup

   {linter + formatter recommendation for chosen stack, from Step 4b}

   ### Ready for Execution
   Run /plugin-hive:execute {epic-id} to begin development.
   Or /plugin-hive:standup to start daily operations.
   ```

---

## Shared Resources

All shared resources (agents, references, workflows) are in the `hive/` directory relative to the plugin root. Read the orchestrator guidance at `hive/MAIN.md` for command details.
