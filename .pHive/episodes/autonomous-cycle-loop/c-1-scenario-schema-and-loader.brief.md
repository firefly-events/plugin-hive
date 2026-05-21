# C.1 — scenario schema + loader + executor step file

**Hive story id:** `c-1-scenario-schema-and-loader`
**Epic:** `autonomous-cycle-loop`
**Complexity:** medium
**Methodology:** classic

## Description

Implement the scenario YAML loader/validator and the simulated-manual step
file. Scenario lives at tests/scenarios/<topic>.yaml (or .pHive/scenarios/
fallback). The step file describes the executor protocol: spec-walk vs
implementation-walk, per-step pass/fail capture, overall verdict writeback.

## Acceptance Criteria

- hive/lib/scenarios/load.mjs exports loadScenario(path) returning a parsed + validated scenario or throwing a structured error pointing at the first missing/invalid field.
- Schema rejects: missing id, missing title, missing/empty steps[], step lacking either `action` or `expected`, mode not in (spec-walk, implementation-walk).
- Schema accepts: optional preconditions[], optional postconditions[], optional per-step actor.
- hive/workflows/steps/test/simulated-manual.md exists; describes executor protocol (narrate each step, capture pass/fail, write overall verdict to cycle-state manual_verdict block).
- implementation-walk mode REFUSES to run until the story's `integrate` episode marker is present; emits a clear error pointing at the missing marker.
- Fixture scenario at tests/scenarios/example.yaml passes the loader.

## Workflow Steps (classic methodology)

### research (researcher)
Confirm S0 documented the schema; identify the cycle-state writeback shape that matches manual_verdict in story-yaml-schema.md.

### implement (developer)
Write loader + validator; write the step file.

### test (tester)
Unit-test the loader (valid + invalid fixtures); fixture scenario passes; missing-step-field cases fail with the expected error path.

### review (reviewer)
Confirm tests/scenarios/.gitkeep is present so the consumer dir convention is discoverable; confirm no hard dep on .pHive/ paths.

### integrate (developer)
Commit + push.

## Key Files

- `hive/lib/scenarios/load.mjs` — New loader + validator
- `hive/workflows/steps/test/simulated-manual.md` — New step file (executor protocol)
- `hive/references/test-scenario-schema.md` — Reference doc from S0
- `tests/scenarios/example.yaml` — Fixture scenario

## Cross-Cutting Concerns

- **documentation**: Cross-link from test-scenario-schema.md to the loader and step file.

---
*Dispatched from Hive epic `autonomous-cycle-loop` via Multica execution mode. Run the full classic workflow (research → implement → test → review → integrate) inside this issue. Commit on epic branch `feat/autonomous-cycle-loop`; open a story PR when done.*