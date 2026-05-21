# Structured Outline — autonomous-cycle-loop

## Part 1 — Vision

Cycle becomes a routing problem, not a running problem. Operator decides per-item: "GH issue queue (sandcastle runs it)" or "local (I watch it)". Plans, tests, and review chains run themselves when safe.

## Part 2 — Map of work

Five slices (S0 + A + B + C + D), 11 stories total. S0 is the schema/config foundation; A–D are independently shippable verticals.

## Part 3 — File manifest

### Net new files

- `hive/references/sandcastle-mode.md` — env-var contract + artifact-vs-prompt behavior.
- `hive/references/test-scenario-schema.md` — scenario YAML schema.
- `hive/workflows/steps/daily-ceremony/interactive-routing.md` — interactive routing step.
- `hive/workflows/steps/test/simulated-manual.md` — simulated-manual executor step.
- `hive/lib/scenarios/load.mjs` — scenario loader + validator.
- `hive/lib/handoff/dispatch.mjs` — terminal-handoff dispatcher.
- `tests/scenarios/.gitkeep` — directory for consumer test scenarios (consumer-controlled).

### Files modified

- `hive.config.yaml` (root) — append four new knob blocks under `standup`, `planning`, `execution`, `test`.
- `hive/hive.config.yaml` (shipped baseline) — same four blocks with commented schema descriptions.
- `hive/references/story-yaml-schema.md` — three new top-level fields documented.
- `hive/references/cycle-state-schema.md` — two new blocks documented.
- `hive/references/cross-cutting-concerns.md` — note the `simulated-manual` concern slot.
- `.pHive/cross-cutting-concerns.yaml` — add concern definition.
- `skills/standup/SKILL.md` — Phase 1.5 + flag parsing.
- `skills/plan/SKILL.md` — sandcastle_mode detection + `scenario` step injection on concern.
- `skills/execute/SKILL.md` — post-integrate handoff dispatch.
- `skills/test/SKILL.md` — `--simulated-manual` arg parsing + dispatch.
- `hive/workflows/daily-ceremony.workflow.yaml` — Phase 1.5 entry.
- `hive/lib/external/github-issues-adapter.js` — add `labelExistingIssue` helper.
- `.github/workflows/hive-dispatch.yml` — two-label trigger + `mode_decision` output.
- `.github/scripts/sandcastle-hive-bridge.mts` — `mode_decision: plan` branch.
- `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl` + `assets/sandcastle-hive-bridge.mts.tpl` — same edits propagated to the templates (re-scaffold idempotence).
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`, `CHANGELOG.md` — versioning concern (minor bump — additive features).

## Part 4 — Risk registry

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Interactive standup lengthens session significantly | low | opt-in flag; conservative heuristic; cap to 10 routing prompts per run |
| R2 | `hive:plan` + `hive:ready` co-labeling on same issue | medium | `derive` job fails fast on ambiguous label sets |
| R3 | `/plan` interactive gates inside sandcastle | medium | env-var contract documented in S0; B1 routes every prompt to artifact-write + log |
| R4 | Simulated-manual against unbuilt implementation | low | `mode: spec-walk` vs `implementation-walk`; refusal when implementation absent |
| R5 | Auto-handoff to /test stuck on flake | medium | timeout in dispatch helper; `phase_handoff_timeout` emit |
| R6 | /review handoff without PR | low | argparse already supports `git diff main..<branch>`; document |
| R7 | Visibility heuristic miscalibration | medium | confidence labels; require operator confirmation on `low` confidence; tune off retro metrics |
| R8 | Schema bump (S0) silently breaks an unrelated workflow | low | additive-only; absence = today's behavior; all readers tolerate missing fields |

## Part 5 — Acceptance

S0:
- `hive.config.yaml` shipped baseline contains the four new blocks with defaults preserving today's behavior; consumer override layer works as documented elsewhere; `gate_mode` unchanged.
- `story-yaml-schema.md` + `cycle-state-schema.md` show the new fields with examples.
- `sandcastle-mode.md` + `test-scenario-schema.md` exist and pass markdown-lint.

A:
- `/standup --interactive` produces a routing summary per open queue item; selecting `push-to-github` creates a labeled issue; selecting `keep-local` writes to cycle-state and the next standup run does not re-surface it; selecting `defer` is a no-op.
- Adapter helper `labelExistingIssue` returns `{labeled:true, issue_number}` for a real issue and warns-and-continues on auth failure.

B:
- A maintainer labels a fixture issue `hive:plan` in a test repo; `hive-dispatch.yml` runs; PR titled `[plan] <epic-id>` is created carrying `.pHive/epics/<epic-id>/` and the `.gitignore` allowlist edit.
- `HIVE_SANDCASTLE_MODE=1` causes every `/plan` interactive gate to write an artifact + log line instead of prompting.
- Co-labeling `hive:plan` + `hive:ready` on the same issue fails the `derive` job with a clear error.

C:
- `/test --simulated-manual tests/scenarios/example.yaml` walks the scenario, prints per-step verdicts, writes overall verdict to cycle-state.
- Scenario YAML missing required fields fails the loader with a precise error pointing at the missing key.
- A story carrying `cross_cutting: {concern: simulated-manual, action: ...}` plans with an injected `scenario` step.

D:
- A story with `terminal_handoff: {next: test}` causes `/execute` to invoke `/test --story <story-id>` after `integrate` completes; verdict appears in cycle-state `handoff_log[]`.
- `terminal_handoff: {next: review}` invokes `/review <branch>` (or `#<PR>` if a PR exists).
- `terminal_handoff: {next: both}` runs test first, review second.
- `terminal_handoff: {next: none}` (default) leaves behavior identical to today.
- Timeout (default 1800s) causes the handoff to emit `phase_handoff_timeout` and `/execute` to continue without blocking.

## Part 6 — Out of scope (named so they don't drift in)

- Publishing this epic's stories as GH issues. Explicitly skipped per user direction.
- A real-time UI for the interactive standup (it remains a CLI prompt sequence).
- Auto-merging the plan-output PR from sandcastle `/plan`.
- Wiring `/test --simulated-manual` into the `/standup` interactive routing (a follow-on once C lands).
- Operator overrides on the visibility heuristic that persist across sessions (a learning loop is a follow-on).
- An adapter shape for Linear `hive:plan` equivalent (out of scope; GH-only for now).
- Replacing the operator-driven gates inside `/plan` with PR review when running locally (sandcastle-only).

## Part 7 — Elicitation (team stress-test of the plan)

These are the questions the planning team asked themselves and the answers used in the plan.

**Q1. Should the visibility heuristic write to triage queue.yaml or only to standup's report?**
A. Standup's report + cycle-state only. Triage is the single writer of `queue.yaml`; standup is read-only against triage. The routing decision is metadata about how we *handle* the item, not about the item's triage state — it belongs to standup's audit trail (`routing_decisions[]` in cycle-state).

**Q2. Should sandcastle `/plan` ever auto-merge the plan-output PR?**
A. No. The PR review IS the human gate. Auto-merging here would defeat the trust scaffolding for planning artifacts. Sandcastle `/execute` already gates behind label transitions; sandcastle `/plan` gates behind PR review.

**Q3. Should simulated-manual scenarios live alongside `.feature` files for BDD repos?**
A. They live at `tests/scenarios/<topic>.yaml` regardless of methodology. They are not a BDD artifact — Gherkin `.feature` files are still the BDD artifact when BDD is the resolved methodology. Simulated-manual is orthogonal; co-locating them with `.feature` files would confuse the methodology autodetect.

**Q4. Test handoff verdict — PR comment or cycle-state only?**
A. Cycle-state only in the first cut. A PR comment is a follow-on once the verdict shape stabilizes. Avoid adding PR-comment surface area until the verdict schema is proven.

**Q5. `hive:plan` vs `hive:plan-ready`?**
A. `hive:plan`. Symmetry with `hive:ready` is a weak argument; `hive:plan` is shorter, easier to type, and "ready" framing implies "ready to execute" which is exactly the semantic confusion we want to avoid.

**Q6. Should B ship the `publish_in_sandcastle: true` codepath in slice B or as a follow-on?**
A. Follow-on. First cut emits files + PR only. Once the plan-output PR flow is stable in production, a follow-on adds the Phase D publish branch behind the `planning.publish_in_sandcastle` knob.

**Q7. Should the `scenario` step in the workflow YAML be cross-methodology?**
A. Yes — same `scenario` step appears in `classic`, `tdd`, `bdd` workflow YAMLs, gated by the cross-cutting concern. The position differs per methodology (after `behavior-spec` in BDD; after `implement` in classic; after `test-spec` in TDD).

**Q8. Should `/execute` skip the handoff if the integrate step failed?**
A. Yes. The handoff fires only on a successful `integrate` episode marker. A failed integrate is itself the signal to halt — no handoff fires, cycle-state records the integrate failure.

## Part 8 — Decision points for user sign-off

1. **Slice ordering:** S0 first, then A/B/C/D in parallel — confirm.
2. **`hive:plan` label name** (vs `hive:plan-ready`) — confirm.
3. **No Phase D publish for this epic's own stories** (user already directed) — confirm.
4. **Plan-output PR auto-merge stays disabled** — confirm.
5. **Scenario file location at `tests/scenarios/`** (`.pHive/scenarios/` as fallback when no consumer test dir) — confirm.
6. **Default `terminal_handoff.next: none`** (today's behavior preserved) — confirm.
7. **Sandcastle `/plan` writes artifacts-only first cut**, `planning.publish_in_sandcastle: false` default — confirm.
