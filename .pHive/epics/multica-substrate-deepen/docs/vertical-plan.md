# Vertical Plan — Multica Substrate-Deepen

**Epic:** `multica-substrate-deepen`
**Status:** Post-grill, post-user-decision
**Slicing convention:** Each wave completes leaves the system in a working state. Plugin remains shippable to consumers between waves. Multica integration ratchets up one capability per wave.

## Wave summary

| Wave | Name | Outcome at wave-end | Gate to next |
|---|---|---|---|
| W0 | Phase 0 spikes | Three written findings (S0.1/S0.2/S0.3) on disk; nothing else changed | Findings reviewed; codex-provider verdict locked |
| W1 | Persona port | Dispatchable subset (~20 personas) bootstrapped in Multica workspace; rescue-instruction dropped IFF S0.1 positive | Multica daemon claims story tasks with new personas |
| W2 | Squads | Three squads created in Multica; adapter ABI 1.1.0 ships `getSquadActivity` + `updateIssueStatus`; `/execute` writes squad evaluation at PR-open | Squad evaluation visible on closed Multica issues |
| W3 | Autopilots | Two autopilots created (metrics-check post-merge webhook, visual-qa post-merge webhook); local equivalents deprecated | Autopilots fire on test webhook event |
| W4 | Skills export (Mode D-a) | Skill-export tooling pilot-shipped with one skill (`/metrics-check`); CI guard prevents drift | One round-trip export succeeds in Multica spike workspace |

## Wave-by-wave detail

### W0 — Phase 0 spikes

**Stories:** three feasibility findings.

- W0.1 — S0.1 codex-provider spike
- W0.2 — S0.2 squad-read endpoint spike
- W0.3 — S0.3 skill-import visibility spike

**Working-state invariant:** None of the spikes modify production code. The system before W0 = system after W0, plus three docs on disk. If any spike returns blocking-negative, the dependent wave is re-planned at checkpoint.

**Parallel-eligible:** all three. Independent investigations, no overlap. `parallel_rationale: read-only`.

### W1 — Persona port

**Stories:** dispatchability classification + agents.yaml + bootstrap reconcile + dispatch flag conditional.

- W1.1 — Persona dispatchability classification doc (`docs/persona-dispatchability.md`)
- W1.2 — `agents.yaml` expansion to dispatchable subset
- W1.3 — `reconcileAgents` N-persona batch refactor
- W1.4 — `serializeStoryBrief` codexInstruction conditional (gated on W0.1 outcome)

**Working-state invariant:** After W1, Multica still dispatches stories successfully. If a future story is assigned to a new persona, that persona's task claims work. If still assigned to `developer`, behavior is unchanged from pre-W1.

**Dependencies:** W1.4 blocked-by W0.1. W1.2 blocked-by W1.1 (need classification before expanding). W1.3 blocked-by W1.2 (need new agents.yaml to test N-persona batch).

**Parallel-eligible:** W1.1 alone in its sub-wave; W1.2 + W1.3 run sequential.

### W2 — Squads

**Stories:** schema + squads.yaml + bootstrap reconcile + adapter ABI 1.1.0 + dispatch eval-write + execute integration.

- W2.1 — Squad schema doc (`hive/references/multica-squads-schema.md`)
- W2.2 — `.pHive/multica/squads.yaml` with three squads
- W2.3 — `reconcileSquads` in bootstrap
- W2.4 — Adapter ABI 1.1.0: `getSquadActivity` + `updateIssueStatus` (gated on W0.2)
- W2.5 — Squad-evaluation contract (`hive/references/squad-evaluation-contract.md`)
- W2.6 — Dispatch: `recordSquadEvaluation` helper
- W2.7 — Execute mode multica: integrate-step fires squad-eval at PR-open

**Working-state invariant:** After W2, stories assigned to a squad-bound issue still complete via the normal dispatch loop. The squad evaluation is additive — its absence does not break old issues, its presence does not gate merge.

**Dependencies:** W2.4 blocked-by W0.2. W2.2 blocked-by W2.1. W2.3 blocked-by W2.2. W2.6 blocked-by W2.4. W2.7 blocked-by W2.5 + W2.6.

**Parallel-eligible:** W2.1 + W2.5 (both docs, independent). W2.3 + W2.4 (different layers, independent given schemas exist).

### W3 — Autopilots

**Stories:** schema + autopilots.yaml + bootstrap reconcile + two autopilot definitions + deprecation list.

- W3.1 — Autopilot schema doc (`hive/references/multica-autopilots-schema.md`)
- W3.2 — `.pHive/multica/autopilots.yaml` with metrics-check + visual-qa
- W3.3 — `reconcileAutopilots` in bootstrap
- W3.4 — Deprecation list — which local schedules migrate (`docs/autopilot-deprecation.md`)

**Working-state invariant:** After W3, new Multica autopilots fire on test events. Local `/loop` and CronCreate scheduling continues unchanged for anything not on the W3.4 migration list.

**Dependencies:** W3.2 blocked-by W3.1. W3.3 blocked-by W3.2.

**Parallel-eligible:** W3.1 + W3.4 (docs, independent).

### W4 — Skills export (Mode D-a)

**Stories:** export schema + manifest + bundler + CI guard + pilot with `/metrics-check`.

- W4.1 — Skills-export schema doc (`hive/references/multica-skills-export-schema.md`)
- W4.2 — `.pHive/multica/skills-export.yaml` with pilot skill (`/metrics-check`)
- W4.3 — `reconcileSkills` in bootstrap (uses S0.3 visibility flag finding)
- W4.4 — CI guard: drift detection between in-repo and Multica
- W4.5 — Pilot round-trip — export, import to spike workspace, verify content match

**Working-state invariant:** After W4, plugin-hive skills remain authoritative in-repo. Consumers without Multica see no change. Multica spike workspace gains one runtime copy of `/metrics-check`.

**Dependencies:** W4.3 blocked-by W0.3. W4.5 blocked-by W4.3.

**Parallel-eligible:** W4.1 + W4.2 + W4.4 (docs + manifest + CI, no execution overlap).

## Cross-wave invariants

- **Adapter ABI version** — bumps once at W2.4 from 1.0.0 → 1.1.0. Friction-note items 1-5 + 7 are NOT bundled per Q7 default-defer; if revisited, that becomes a follow-on epic.
- **Consumer impact** — zero through W3. W4 (Mode D-a) is also additive. Consumers without Multica are unaffected for the entire epic. `versioning` cross-cutting concern fires on W4 only (minor bump for additive surface).
- **Codex routing** — established by W1.4 conditional on W0.1. If W0.1 negative, codexInstruction stays AND the rescue dance stays.
- **PR file count** — each wave's stories target one or two PRs per wave. Wave-PRs stack on `feat/multica-substrate-deepen`. No single wave brushes the 150-file convention threshold.

## Slicing rationale

- W0 first because feasibility precedes design commitments.
- W1 second because persona port is the highest-ROI standalone delivery — the rescue-dance kill happens here if S0.1 positive, regardless of whether W2-W4 ship.
- W2 third because squads only make sense after personas exist as agents.
- W3 fourth because autopilots depend on persona ownership (autopilot `--agent` flag points at a persona name).
- W4 last because skills-export is the most novel mechanism and most posture-laden — better validated after the simpler waves prove the pattern.

Each wave is independently shippable. Pause after any wave is acceptable.
