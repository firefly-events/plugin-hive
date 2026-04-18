# Methodology Routing

The workflow methodology controls phase ordering — specifically, whether tests are written before or after implementation.

## Supported Methodologies

### Classic (default)
Research → Implement → Test → Review → Integrate

The traditional approach: implement the feature, then write tests to verify it works. The developer sees the research brief and implements directly. Tests are written with knowledge of the implementation.

### TDD (Test-Driven Development)
Research → Test Spec → Implement → Review → Optimize → Integrate

Tests are written first, from the story specification — the test agent does NOT see implementation code. This ensures tests define behavior independently. The developer then writes code to make the tests pass.

Phase ordering:
1. Research (researcher) — codebase analysis
2. Test Spec (tester) — write failing tests from spec only
3. Implement (developer) — make tests pass
4. Review (reviewer) — fresh-context review
5. Optimize (developer) — apply review findings
6. Integrate (developer) — commit

### TDD-Codex (Cross-Model Test-Driven Development)
Research → Test Spec → Open Codex Pane → Implement → Review → Fix Loop → Integrate → Shutdown

Variant of TDD using a split-model path. Claude writes the failing tests and performs review; Codex handles implementation and follow-up fixes in a persistent cmux pane.

Requirements:
- `agent_backends` configured to route the implementation persona to `codex`
- `cmux` installed for the visible persistent pane path

### BDD (Behavior-Driven Development)
Research → Behavior Spec → Implement → Test → Review → Integrate

Similar to TDD but behavior specifications are written in Gherkin/Given-When-Then format before implementation. Tests are then derived from the behavior specs after implementation.

### FDD (Feature-Driven Development)
Research → Design → Implement → Test → Review → Integrate

Adds an explicit design phase between research and implementation. The architect produces interface definitions and component designs before the developer implements.

## Selecting a Methodology

When the user specifies `--methodology tdd` (or similar), load the corresponding workflow YAML:
- `workflows/development.classic.workflow.yaml`
- `workflows/development.tdd.workflow.yaml`
- `workflows/development.tdd-codex.workflow.yaml` — TDD cross-model variant (Claude tests + Codex implements)
- `workflows/development.bdd.workflow.yaml`

If no methodology is specified, default to **classic**.
