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
- `workflows/development.tdd-codex.workflow.yaml`
- `workflows/development.bdd.workflow.yaml`

If no methodology is specified, default to **classic**.

## Per-step token budgets (advisory caps, all methodologies)

All methodology workflows honor advisory token caps from `hive.config.yaml → circuit_breakers.max_tokens_per_step`, `max_tokens_per_fix_loop`, and `max_tokens_per_story` (story `w5-sidecar-bundle`, A-31). The semantics are uniform across classic / tdd / tdd-codex / bdd / fdd:

- **Soft caps, not hard breakers.** Crossing a cap emits a `budget_exceeded` telemetry event but does NOT stop the step. The existing iteration-count breakers (`max_step_retries`, `max_fix_iterations`, `max_same_error_repeats`) are the hard gates; token caps are tuning signals.
- **Fail-open on missing data.** When token usage data is missing for a step (capture not enabled, persona doesn't emit usage, etc.), the cap is silently skipped. NO error, NO warning. Token caps require data to apply; absence is a no-op.
- **Per-step granularity.** Each workflow step (research / test / implement / review / etc.) gets its own usage tally; `max_tokens_per_step` applies to each individually. Fix-loop and story caps aggregate across multiple step invocations.
- **Set per project.** Defaults are `null` (unset) so consumers don't get spurious warnings before they've calibrated. Maintainer projects (like plugin-hive) may set caps based on observed historical usage.

These advisory caps complement the existing iteration breakers — choose token caps when "this step ran too long via too much output" is the right signal; choose iteration breakers when "this step keeps retrying without convergence" is the right signal.
