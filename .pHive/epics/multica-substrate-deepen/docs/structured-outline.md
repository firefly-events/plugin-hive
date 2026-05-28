# Structured Outline — Multica Substrate-Deepen

**Epic:** `multica-substrate-deepen`
**Scope:** Large (4 phases, 5 waves, ~22 stories estimated)
**Companions:** `research-brief.md`, `grill-record.md`, `design-discussion.md`, `horizontal-plan.md`, `vertical-plan.md`

## Part 1 — Detailed approach (recap + bind to waves)

### Phase 0 — Spikes (Wave W0)

Three feasibility findings, all read-only-shaped, parallel-eligible. Outputs land at `.pHive/epics/multica-substrate-deepen/docs/spike-findings/`.

- **W0.1 codex-provider spike.** Provider/runtime enum inspection from `~/Code/spikes/multica/cmd/cli/`. Single trivial-task dispatch attempt with codex agent. Verdict: `supported` / `not_supported` / `supported_with_caveats:<list>`.
- **W0.2 squad-read endpoint spike.** Inspect spike's `server/internal/handler/squad.go` (or equivalent) + REST surface. Output sketch of adapter methods needed: signatures + endpoint paths + JSON shapes.
- **W0.3 skill-import visibility spike.** Run `multica skill import` with a throwaway test skill. Verify visibility/privacy mechanism. Output: confirmed flag/default + cleanup procedure.

### Phase A — Persona port (Wave W1)

- **W1.1 Dispatchability classification.** Per-persona criterion: "produces useful output from one bounded task input without spawning subagents." Excludes orchestrator + team-lead + pair-programmer. Document at `docs/persona-dispatchability.md`.
- **W1.2 agents.yaml expansion.** Bump 3 → ~20 dispatchable personas. Apply 2026-05-01 routing policy gated on W0.1: creators get `provider: codex` if positive, else `claude`. Verifiers stay `claude opus`.
- **W1.3 reconcileAgents N-persona refactor.** Single `agent list`, diff, batched upserts. Tests cover idempotent re-bootstrap.
- **W1.4 serializeStoryBrief codexInstruction conditional.** Reads dispatching persona's effective provider. If codex-native, brief omits the rescue section. Else, brief keeps current shape.

### Phase B — Squads (Wave W2)

- **W2.1 Squad schema.** Field list, validation rules, example. `hive/references/multica-squads-schema.md`.
- **W2.2 squads.yaml.** Three squads (planning-team-squad / dev-team-squad / verify-team-squad) with leaders.
- **W2.3 reconcileSquads.** Idempotent create-or-patch against `multica squad create/update/member add`.
- **W2.4 Adapter ABI 1.1.0.** `getSquadActivity(issueId)` + `updateIssueStatus(issueId, status)`. ABI doc bumped. friction-notes.md updated.
- **W2.5 Squad-evaluation contract.** Substrate-signal-not-authority. Fired at PR-open / ticket-to-review moment. Documented at `hive/references/squad-evaluation-contract.md`.
- **W2.6 dispatch recordSquadEvaluation helper.** Called by /execute integrate step.
- **W2.7 execute integrate step extension.** After `git push` + PR-open, write squad-activity record + status transition.

### Phase C — Autopilots (Wave W3)

- **W3.1 Autopilot schema.** `hive/references/multica-autopilots-schema.md`.
- **W3.2 autopilots.yaml.** Two webhook autopilots: `metrics-check-post-merge` (fires `/metrics-check`, owner persona tpm or analyst — verified in W3 story) + `visual-qa-post-merge` (fires `/visual-qa`, owner ui-designer).
- **W3.3 reconcileAutopilots.** Bootstrap creates / patches autopilots from yaml.
- **W3.4 Deprecation list.** Document what local scheduling each autopilot replaces.

### Phase D — Skills export Mode D-a (Wave W4)

- **W4.1 Skills-export schema.** Manifest format: skill ref + substrate dependencies + visibility. `hive/references/multica-skills-export-schema.md`.
- **W4.2 skills-export.yaml.** Pilot manifest with `/metrics-check`.
- **W4.3 reconcileSkills.** Bootstrap materializes skill + bundled substrate into Multica's skill table per manifest. Uses W0.3 visibility flag.
- **W4.4 CI guard.** Drift detector: compares in-repo SKILL.md against Multica-stored copy. Fails the build on divergence.
- **W4.5 Pilot round-trip validation.** Story-level smoke test: export `/metrics-check`, verify presence + content in spike workspace.

## Part 2 — File manifest (estimate)

Per wave, expected new/modified files:

| Wave | New files | Modified files | Touch count |
|---|---|---|---|
| W0 | 3 spike findings | 0 | 3 |
| W1 | 1 doc (dispatchability) | 3 (agents.yaml, bootstrap, dispatch) + tests | ~10-15 |
| W2 | 3 docs (squad schema, eval contract, autopilots.yaml stub) + 1 yaml (squads.yaml) | adapter (2 new methods), friction-notes, bootstrap (reconcileSquads), dispatch (recordSquadEvaluation), execute skill + tests | ~15-25 |
| W3 | 2 docs (autopilot schema, deprecation) + 1 yaml (autopilots.yaml) | bootstrap (reconcileAutopilots) + tests | ~8-12 |
| W4 | 1 doc (export schema) + 1 yaml (skills-export.yaml) + 1 CI workflow | bootstrap (reconcileSkills) + tests + 1 pilot skill copy | ~15-20 |

Total epic touch: ~50-75 files. Each wave-PR comfortably under 150.

## Part 3 — Risk registry (post-grill, post-decision)

| Risk ID | Risk | Severity | Mitigation | Wave gate |
|---|---|---|---|---|
| R1 | W0.1 negative — codex not supported | High | Rescue dance stays; epic value reduces to ~70%; checkpoint with user before W1.4 | W0.1 |
| R2 | W0.2 negative — squad-read endpoint missing | Medium | Phase B downgrades to roster-namespace only; adapter ABI not bumped; W2.4-W2.7 cut | W0.2 |
| R3 | W0.3 negative — no visibility mechanism | Medium | W4 pilot deferred or restricted to private spike-workspace only; CI guard becomes spike-only | W0.3 |
| R4 | Dispatchable classification disputes | Low | Single doc, easily revised; not a blocker | W1.1 |
| R5 | Bootstrap reconcile state corruption | High | reconcileAgents/Squads/Autopilots/Skills all idempotent + dry-run-able; rollback via diff-only | W1.3, W2.3, W3.3, W4.3 |
| R6 | Squad-eval fires at wrong moment | Medium | PR-open hook well-defined (post `git push` + pre-merge); execute step file has explicit invocation point | W2.7 |
| R7 | CI drift guard false positives | Low | Drift detector normalized for whitespace/eol; tested on minor edits | W4.4 |
| R8 | Mode D-a export creates orphans in Multica skill table | Low | reconcileSkills also handles deletion of skills no longer in manifest | W4.3 |
| R9 | Autopilot owner persona is the wrong choice | Low | W3 doc-first; persona owner reviewable before reconcile fires | W3.2 |

## Part 4 — Cross-cutting concerns matrix

Per `.pHive/cross-cutting-concerns.yaml`, evaluate `documentation` and `versioning` per story at decomposition time:

| Wave | documentation? | versioning? |
|---|---|---|
| W0 | yes (writes new spike findings, also reference in GUIDE.md if W0.1 changes routing) | no (no consumer-visible change) |
| W1 | yes (agents.yaml + persona inventory + GUIDE.md Multica section) | conditional (consumer-visible IF Multica bootstrap is consumer-invoked, otherwise maintainer-only) |
| W2 | yes (adapter README, friction-notes, eval contract, GUIDE.md) | yes (adapter ABI 1.1.0 bump is consumer-visible) |
| W3 | yes (autopilot schema, deprecation, GUIDE.md) | conditional (consumer-visible IF autopilots fire for consumer projects) |
| W4 | yes (export schema, GUIDE.md Multica skills section) | yes (additive but consumer-visible new mechanism) |

## Part 5 — Methodology resolution

- `--methodology=<flag>` — not set.
- `epic.yaml methodology` — will set on this epic to `classic` (Multica integration is build-then-verify, not test-first).
- `hive.config.yaml methodology` — not set globally.
- Auto-detect — would resolve to TDD given `tests/` presence. Override via epic.yaml.

Resolution: **classic** (epic-yaml source).

## Part 6 — Persona routing

Per 2026-05-01 codex-routing policy, agents map to backends:

- **Codex (creators):** researcher (W0.1/W0.2/W0.3), developer + backend-developer (W1.2-W1.4, W2.4, W2.6, W3.3, W4.3, W4.4), technical-writer (all doc stories), architect (verifier on schema docs).
- **Claude opus (verifiers):** reviewer (every story), tester (W1.3, W2.3, W3.3, W4.3 — bootstrap reconcile tests), peer-validator (W2.5 eval-contract verification).
- **Claude sonnet (default):** any unmentioned persona, including specialists.

## Part 7 — Elicitation (team adversarial pass)

Stress-test answers — the planner's adversarial sweep on its own plan:

- **Q: Why not start with squads (W2) instead of personas (W1)?** A: Squad creation requires existing agents to add as members. Multica's `squad member add` references agents that must exist first. W1 → W2 is a hard dependency.
- **Q: Why is W4 (skills export) last instead of bundled with W1 (personas)?** A: Phase A personas don't need skill assignment to function in the rescue-dance fallback path. Skills export is novel mechanism + has the most posture risk per grill P2. Defer to validate pattern.
- **Q: What if W0.1 returns "supported with caveats"?** A: Checkpoint with user. Caveats might be acceptable (small extra config, dual-runtime registration) or might be deal-breaking (e.g., codex provider requires upstream Multica server patches). Material to user decision before W1.4 commits.
- **Q: What if Mode D-a CI drift guard flags every commit because the materializer adds metadata?** A: W4.4 story carries explicit "normalize before compare" acceptance criterion. If false-positive rate stays high after normalization, the guard becomes warning-only with a TODO to fix the normalizer.
- **Q: Is metricscheck-post-merge autopilot deduplicating against the local /metrics-check trigger?** A: W3.4 deprecation list resolves this — local `/metrics-check` is deprecated for projects-using-Multica when this autopilot lands. Document explicitly per project, not globally.
- **Q: How do we know dispatchability classification (W1.1) is correct?** A: Single-task test per excluded persona — try dispatching an orchestrator agent to a trivial task; observe failure mode. Document failure mode in classification doc. Personas not failing the test are reclassified to dispatchable.

## Part 8 — Decision points (recap for confirmation)

- DP1: Scope = Large ✓ (user-confirmed)
- DP2: Phase D mode = D-a ✓ (user-confirmed)
- DP3: Squad authority = substrate signal fired at PR-open ✓ (user-confirmed)
- DP4: Autopilot scope = conservative (metrics-check + visual-qa) ✓ (user-confirmed)
- DP5 (open): Persona dispatchability cut — confirm orchestrator/team-lead/pair-programmer excluded? Default = yes. Override at confirmation gate.
- DP6 (open): Phase 0 packaging — own wave (W0) ✓ Default. Alternative: inline per-phase. Default chosen.
- DP7 (open): Friction-note items 1-5 + 7 — defer to follow-on adapter-cleanup epic ✓ Default. Override at confirmation.
- DP8 (open): Methodology = classic (epic-yaml override). Confirm.
