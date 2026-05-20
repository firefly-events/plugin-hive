# Design Discussion — autonomous-cycle-loop

## §0 Prelude

- Branch: `feat/autonomous-cycle-loop` (created at plan time).
- Working tree at plan time: clean of tracked-file modifications; untracked metrics events and scratch worktree dirs only (noise from prior sessions).
- git_flow: `base_branch=main`, `branch_strategy=per-epic` (helper available; not vendored into this checkout — recorded for parity with shipped flow).
- gate_mode resolved to `warning` (project-profile present; no gate-lift fired).
- Phase D explicitly skipped per user direction ("dont worry about pushing these as gh issues just yet"). No `tracker_id` is populated.

## §1 The goal

User wants the SDLC cycle to become more **self-directing**: the human becomes a router and a witness, not a runner. Four concrete moves:

1. **Standup as a queue router.** Today the operator reads the standup report, picks today's work in their head, and runs the next skill. Move: turn standup into an optional interactive flow that proposes routing decisions per open item — push to GH issues with `hive:ready` (autonomous), keep local (human-observed), defer.
2. **Plan inside sandcastle.** Today `/plan` runs in the operator's local Claude Code session. Move: allow `/plan` to run in the sandcastle container, triggered by a `hive:plan` label, producing planning artifacts as a draft PR.
3. **Simulated manual testing.** Today `/test` writes/runs automated tests. Move: add a mode where the agent narrates a manual scenario step-by-step against the running implementation — for surfaces automated tests cannot cover.
4. **Execute → test/review handoff.** Today `/execute` ends at `integrate` (commit + push); operator runs `/test` or `/review` next. Move: per-story `terminal_handoff:` config so `/execute` can chain into `/test` and/or `/review` automatically.

The connective tissue: each move reduces an operator interrupt without breaking the trust scaffolding (memory: `[Visibility is trust proxy]` — tmux visibility was scaffolding; the north star is self-contained autonomous SDLC phases).

## §2 Proposed approach

### Slice A — Interactive Standup

Add a `--interactive` flag (and a `hive.config.yaml → standup.interactive_default: false`) to `/standup`. Interactive mode runs after Phase 1 (standup report) and before Phase 2 (planning):

- Present each open queue item with a routing prompt: `push-to-github` | `keep-local` | `defer`.
- Routing is driven by a **visibility heuristic** scored per story/triage-item:
  - high-visibility-need: UI work; first-time integrations with external services; security-sensitive paths; stories without metric.applies.
  - low-visibility-need: doc updates; mechanical refactors; well-scoped substrate work; stories with PASS-verified verdicts on a similar prior story.
- Heuristic emits a `visibility:` recommendation (`local|sandcastle|either`) — the operator confirms or overrides.
- `push-to-github` invokes the existing GitHub adapter to create the issue + apply `hive:ready` and the standard `hive:epic:* | hive:story:*` namespace.
- `keep-local` records intent in cycle-state so the standup report stops re-surfacing it next day.
- For existing GH issues not yet labeled (e.g. ones the operator filed manually), the interactive flow can apply `hive:ready` via the adapter to throw them onto the autonomous queue.

### Slice B — Sandcastle Planning

- Extend `.github/workflows/hive-dispatch.yml` to recognize a second trigger label: `hive:plan`. The `derive` job inspects the label and emits a `mode_decision: plan | execute` output.
- The `run` job branches: `mode_decision == execute` keeps current behavior; `mode_decision == plan` runs `/plan` inside the sandcastle container against the issue body as `$ARGUMENTS`.
- Sandcastle `/plan` writes the canonical artifacts under `.pHive/epics/<epic-id>/` and opens a **plan-output PR** titled `[plan] <epic-id>` containing only the planning artifacts and the epic dir. The PR is the human review surface — operator reviews the plan, merges if good. No story execution happens in this dispatch.
- Phase D (publish stories to tracker) inside sandcastle: gated by `task_tracking.adapter` and a new `planning.publish_in_sandcastle: true` knob. Default off — first cut produces files only.
- Stalled-plan recovery: same `if: failure() || cancelled()` label transitions as execute (`hive:plan → hive:plan-failed` on bridge crash).

### Slice C — Simulated Manual Testing

- New step file `hive/workflows/steps/test/simulated-manual.md` + `/test --simulated-manual <story-id|scenario-file>` mode.
- Scenario schema (`hive/references/test-scenario-schema.md`): `scenario.id`, `scenario.title`, `scenario.story`, `scenario.preconditions[]`, `scenario.steps[]` (each `{action, expected, actor?}`), `scenario.postconditions[]`. YAML files live at `tests/scenarios/<topic>.yaml` (or `.pHive/scenarios/` for tests outside the consumer test root).
- Executor: tester agent reads the scenario, narrates each step against the running implementation (or the spec when the implementation is not yet stood up), records pass/fail per step + an overall verdict.
- Scenario authoring: a new optional `scenario` step in the workflow YAML between `behavior-spec` and `test` (BDD) or between `implement` and `test` (classic). Authored only when the story carries a `cross_cutting: {concern: simulated-manual, action: ...}` entry — driven by the existing cross-cutting concern machinery.
- Verdict writes back to story YAML as a `manual_verdict:` block parallel to the existing `metric.verdict:` block.

### Slice D — Execute → Test/Review Handoff

- New per-story field `terminal_handoff: {next: test|review|both|none}` (default: `none`, preserves today's behavior).
- After the workflow YAML's terminal step (`integrate`) writes its episode marker, `/execute` reads `terminal_handoff.next` and invokes the named skill(s):
  - `test` — invokes `/test --story <story-id>` against the story's branch.
  - `review` — invokes `/review <branch>` (or `<#PR>` when the dispatch created one).
  - `both` — sequential: test first, review second (review will see test artifacts).
  - `none` — preserves current behavior.
- Epic-level default: `epic.yaml → execution.terminal_handoff_default:` sets the per-story default; story override wins.
- Handoff is observable: `/execute` emits a `phase_handoff` triple at the terminal-step boundary (`source_skill: execute`, `target_skill: test|review`) — the KG audit trail picks this up.

## §3 Risks

- **R1 — Standup interactivity adds session length.** Mitigation: `--interactive` is opt-in; default remains report-then-stop; the heuristic should be conservative (recommend `defer` when uncertain).
- **R2 — `hive:plan` label collisions.** Risk that an operator labels both `hive:plan` and `hive:ready`. Resolution: `derive` job rejects ambiguous label sets and fails fast with a clear error; documentation lists the supported labels explicitly.
- **R3 — Sandcastle `/plan` lacks operator gates.** Several gates in `/plan` are interactive (design discussion sign-off, structured outline sign-off). For sandcastle runs, escalate via PR review instead — the PR review IS the gate. Skill emits a `sandcastle_mode: true` marker so all "present to user" steps become "write artifact, continue".
- **R4 — Simulated manual testing depends on a running implementation.** The agent cannot click a button that does not exist. Mitigation: scenarios may declare `mode: spec-walk` (narrate against the design) vs `mode: implementation-walk` (narrate against running code); the executor refuses to run an `implementation-walk` until the story's `integrate` step has emitted its episode marker.
- **R5 — Auto-handoff to /test can produce slow loops.** A flaky test triggered from /execute could wedge the cycle. Mitigation: `terminal_handoff` runs are timeboxed (default 1200s) and emit `phase_handoff_timeout` rather than hanging.
- **R6 — Handoff to /review without a PR.** When the story is on a `feat/<epic-id>` branch but no PR exists yet, `/review` falls back to `git diff main..<branch>` — already supported by the argument parser; just document the path.
- **R7 — Cross-skill state coupling.** /execute writing handoff configs that /test/review must read deepens skill coupling. Mitigation: the handoff contract is one field on the story YAML; no shared in-process state.
- **R8 — Visibility heuristic over/under-confidence.** A bad heuristic erodes operator trust. Mitigation: ship the heuristic with confidence labels (`low|medium|high`) and require operator confirmation on every `low` recommendation. Tune off the post-cycle metrics retro.

## §4 Dependencies

- Slice A depends on the existing GitHub adapter (Epic C / sandcastle-ops-layer). Already merged.
- Slice B depends on Slice A only conceptually (the operator labeling an issue `hive:plan` is the trigger). No code dependency.
- Slice B depends on the existing per-epic-branch-pr-flow (pe-1..pe-5). Already merged.
- Slice C is standalone — no dependency on A/B/D.
- Slice D is standalone — depends on `/test` and `/review` existing; both do.
- All slices touch `hive.config.yaml` shipped baseline (new knobs). Bumps the documentation cross-cutting concern.

## §5 Open questions

1. Should the standup visibility heuristic write its recommendation back to the triage queue entry, or only to standup's ephemeral report?
2. Should sandcastle `/plan` ever auto-merge the plan-output PR, or always wait for human review?
3. Should simulated-manual scenarios live alongside Gherkin `.feature` files when BDD is the resolved methodology, or in a separate dir?
4. Should the `terminal_handoff` to `/test` create a separate test report PR comment, or just write to cycle-state?
5. Is `hive:plan` the right label, or should it be `hive:plan-ready` for symmetry with `hive:ready`?

## §6 Scale assessment

- Cross-stack: standup skill + plan skill + dispatch workflow + bridge + test skill + execute skill + new schemas + new config knobs.
- Multi-system: GitHub Actions workflow YAML + Node bridge + skill markdown + adapter code.
- Long-horizon: 4 independent vertical slices that can ship in series (or in parallel with discipline).

**Recommendation: Large.** Run Phase B2 (H/V) + Phase B3 (structured outline) before final story decomposition.
