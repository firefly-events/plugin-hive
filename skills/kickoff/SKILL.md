---
name: kickoff
description: |
  Initialize Hive for a new or existing project. Use when starting work on a
  project for the first time, onboarding to an existing codebase, or kicking
  off a new product from scratch. Triggers on: "kickoff", "initialize",
  "onboard", "discover this codebase", "start a new project", "brownfield",
  "greenfield", or any request to begin structured work on a project.
---

# Hive Kickoff

Initialize Hive for a project. Determines whether this is a brownfield (existing codebase) or greenfield (new project) scenario and runs the appropriate onboarding flow.

**Input:** `$ARGUMENTS` optionally describes the project or intent.

## Step 1: Detect Scenario

Check the current working directory:
- **Has existing source code** (src/, lib/, app/, package.json, build.gradle, etc.) → **Brownfield**
- **Empty or minimal** (just a README, no source) → **Greenfield**
- **Ambiguous** → Ask the user

## Step 2A: Brownfield — Discovery & Onboarding

For an existing codebase that Hive hasn't worked with before.

**Goal:** Build a knowledge base so Hive agents understand the project before any planning or execution begins.

**Process:**

1. **Codebase Discovery** (researcher agent mindset)
   - Scan project structure: key directories, modules, entry points
   - Detect tech stack: languages, frameworks, package managers, build tools
   - Detect test infrastructure: frameworks, configs, test directories, existing coverage
   - Map navigation/routing (if applicable: mobile nav graphs, web routes, API endpoints)
   - Read existing documentation: README, CLAUDE.md, architecture docs, API docs
   - Check for existing CI/CD, linting, formatting configs
   - Identify design patterns and conventions in the codebase

2. **Synthesize Project Profile**
   Write a structured project profile to `state/project-profile.yaml`:
   ```yaml
   project_name: Shindig
   type: brownfield
   discovered: "2026-03-26T10:00:00Z"

   tech_stack:
     languages: [Kotlin, Swift, TypeScript]
     frameworks: [KMP, Compose Multiplatform, Express.js]
     build: [Gradle, CocoaPods, npm]
     testing: [JUnit, XCTest, Maestro]
     ci_cd: [GitHub Actions]

   structure:
     key_directories:
       - composeApp/ — shared Compose Multiplatform UI
       - iosApp/ — iOS native shell
       - server/ — Node.js backend
     entry_points:
       - composeApp/src/commonMain/App.kt
       - iosApp/iosApp/ContentView.swift
       - server/index.ts

   documentation:
     - README.md — project overview
     - CLAUDE.md — Claude Code instructions
     - docs/ — additional docs (if present)

   conventions:
     naming: camelCase (Kotlin), snake_case (API)
     architecture: MVVM with shared ViewModel layer
     state_management: Kotlin Flow → Compose State

   test_infrastructure:
     unit: JUnit (composeApp/src/commonTest/)
     e2e: Maestro (_testing/)
     coverage: unknown

   existing_knowledge:
     - "list any CLAUDE.md or .claude/ content found"
   ```

3. **Create Test Baseline** (if test swarm will be used)
   Write initial baseline knowledge to `state/test-baseline/{project}/baseline-knowledge.md`

4. **Initialize Hive State**
   - Create `state/cycle-state/` directory
   - Create initial `hive.config.yaml` in project root (or note the global one)
   - Report findings to user with a summary of what was discovered

5. **Present Onboarding Report**
   ```
   ## Project Onboarding: {project_name}

   **Type:** Brownfield
   **Tech Stack:** {summary}
   **Key Modules:** {list}
   **Test Infrastructure:** {summary}
   **Documentation Found:** {list}

   ### What Hive Now Knows
   - Project profile saved to state/project-profile.yaml
   - {N} source directories mapped
   - {N} conventions identified
   - Test baseline: {created | not applicable}

   ### Recommended Next Steps
   - Review the project profile for accuracy
   - Run /plugin-hive:plan to plan your first feature or improvement
   - Run /plugin-hive:standup to begin daily operations
   ```

## Step 2B: Greenfield — Product Kickoff

For a new project starting from scratch.

**Goal:** Go from idea to implementable stories through a structured planning pipeline.

**Process:**

1. **Brainstorming / Ideation**
   - Ask the user: "What are you building and why?"
   - Use the analyst agent mindset to probe: target users, core problem, key differentiators
   - If `$ARGUMENTS` contains a description, use it as the starting point
   - Facilitate structured ideation: what's in scope, what's explicitly out
   - Output: captured product concept with user validation

2. **Product Brief**
   - Synthesize the brainstorming into a structured product brief
   - Sections: Problem, Target Users, Core Features (P0/P1/P2), Success Metrics, Scope Boundaries
   - Write to `state/planning/product-brief.md`
   - Present for user approval before proceeding

3. **PRD (Product Requirements Document)**
   - Expand the brief into detailed requirements
   - Each requirement gets: description, user value statement, acceptance criteria (Given/When/Then)
   - Write to `state/planning/prd.md`
   - Present for user approval

4. **Architecture**
   - Architect agent evaluates: tech stack, component design, API contracts, data model
   - Documents decisions with alternatives considered and rationale
   - Write to `state/planning/architecture.md`
   - Present for user approval

5. **Epics & Stories**
   - Decompose PRD requirements into epics and stories
   - Use the standard `/plugin-hive:plan` flow for story creation
   - Apply agent-ready checklist to every story
   - Write epics and stories to `state/epics/`

6. **Initialize Cycle State**
   - Create `state/cycle-state/{epic-id}.yaml` with all decisions from steps 2-4
   - Technology choices, naming conventions, scope boundaries — all captured

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

## Shared Resources

All shared resources (agents, references, workflows) are in the `hive/` directory relative to the plugin root. Read the orchestrator guidance at `hive/ORCHESTRATOR.md` for command details.
