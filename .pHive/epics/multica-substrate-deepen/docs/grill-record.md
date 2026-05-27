# Grill Record — multica-substrate-deepen

**Source draft:** `.pHive/epics/multica-substrate-deepen/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (5 signals in research-brief §5)
**Generated:** 2026-05-27

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 4 findings
- Unresolved tensions: 2 findings
- Convention violations: 3 findings
- Posture mismatches: 3 findings

## Vocabulary mismatches

- **V1** — Draft uses "team" and "squad" interchangeably in §2 Phase B ("Map plugin-hive team concepts onto Multica squads"). CONTEXT.md does not define "team" as a roster construct; the closest terms are *roster*, *planning team* (as used by `planning-routing`), and *specialist team* (escalation-triggered). Conflating these with Multica squads erases meaningful distinctions.
  - Draft location: §2 Phase B opening sentence ("Map plugin-hive team concepts onto Multica squads.")
  - Reference: `.pHive/CONTEXT.md` Terminology — roster / persona / planning team / specialist team are distinct
  - Question for planner: Which plugin-hive construct maps to a Multica squad — `planning team` (formed per /plan run), `specialist team` (escalation-triggered), or something new? Pick one and rewrite §2 Phase B with that scoped term.

- **V2** — Draft uses "scope-drift" three different ways: "scope-drift gate" (§2 Phase B), "scope-drift signal" / "scope-drift emit" / "scope-drift authority" (§3 risks). Per `feedback_scope_drift_emit_sites`, scope-drift is a fire-and-forget emit at three callsites (`plan:phase-c`, `execute:story`, `review:complete`) — it is not a *gate*, and there is no *authority* attached to it.
  - Draft location: §2 Phase B ("Wire the squad-leader evaluation surface into /execute's scope-drift gate"); §3 risk 3 ("Squad-leader evaluation drift from local scope-drift signal")
  - Reference: `feedback_scope_drift_emit_sites` (memory)
  - Question for planner: Is the squad-leader evaluation intended to (a) emit an additional `scope_drift_score` triple at story-close, or (b) replace the existing `execute:story` emit, or (c) something else entirely (e.g., a separate squad-evaluation signal that is NOT scope-drift)? The current draft is ambiguous across all three readings.

## Hidden assumptions

- **H1** — Draft §2 Phase B Step 2 says "the squad leader writes an evaluation that hive reads as the post-merge signal." This assumes a read path exists. The Multica adapter today (per research-brief §2) implements only `capabilities` / `createStory` / `updateStory` / `addComment` / `getStory` — no squad endpoints. There is no method to read squad-leader evaluations from inside `/execute`.
  - Draft location: §2 Phase B Step 2
  - Why this matters: If the adapter has to grow squad-read methods, that is its own story (likely its own ABI bump to 1.1.0) and gates Phase B entirely.
  - Question for planner: Is squad-evaluation read part of Phase B scope, or assumed-already-shipped? If in scope, the adapter extension is its own story under Phase B.

- **H2** — Draft §2 Phase C says "autopilots use `autopilot create --agent <agent-name>` flag — pinned to a specific persona that owns the skill." This assumes plugin-hive skills can be cleanly bound to single personas. `/standup` today coordinates tpm + analyst + writer; `/metrics-check` runs against multiple metric carriers; `/meta-optimize` is multi-persona by design. One-agent-per-autopilot does not fit these multi-persona skills.
  - Draft location: §2 Phase C ("autopilots use the autopilot create --agent <agent-name> flag — pinned to a specific persona that owns the skill")
  - Why this matters: If the autopilot fires a single agent, that agent must internally orchestrate the multi-persona workflow — which means the agent IS an orchestrator, contradicting the orchestrator-on-Claude routing policy AND the substrate-first posture.
  - Question for planner: For each scheduled skill (`/standup`, `/metrics-check`, `/meta-optimize`, `/visual-qa`), which single persona owns it? If no single owner is honest, the autopilot design needs a different shape (e.g., autopilot creates an issue and a squad picks it up).

- **H3** — Draft §3 risk 2 mitigation says "classify personas as `dispatchable` vs `harness-only`" but provides no classification criteria. The 25-persona list is split implicitly (developer + researcher + reviewer + writer + architect + specialists = dispatchable; orchestrator + team-lead + pair-programmer + peer-validator = harness-only) but the boundary is fuzzy. `peer-validator` is named as a verifier in §2 Phase A — but the risk mitigation excludes it as harness-only. Internal contradiction.
  - Draft location: §2 Phase A (peer-validator listed as Phase A verifier) vs §3 risk 2 mitigation (peer-validator implied harness-only)
  - Why this matters: If peer-validator is harness-only, Phase A's verifier list is wrong. If peer-validator is dispatchable, the risk mitigation classification is wrong.
  - Question for planner: Audit each of the 25 personas against a written `dispatchable` criterion (e.g., "produces output from one bounded input without spawning subagents"). Publish the list in §2 Phase A before story decomposition.

- **H4** — Draft §2 Phase D says "import plugin-hive's user-facing skills as Multica skills via `multica skill import`." Assumes those skill files can run standalone in Multica's runtime without the plugin-hive scaffolding (skill-prelude, kickoff-gate, planning-routing, agent-spawn). Per CONTEXT.md, skill-prelude is *substrate* — skills depend on it.
  - Draft location: §2 Phase D opening sentence
  - Why this matters: Importing `/standup`'s SKILL.md into Multica's `skill` table does NOT import the substrate it depends on. The skill will fail to run, or worse, run with a broken prelude.
  - Question for planner: Are imported skills bundled with their substrate (skill-prelude, references), or do we maintain a stripped-down skill variant per imported skill, or is this whole phase blocked until substrate-as-skill is solved?

## Unresolved tensions

- **U1** — Squad-leader evaluation vs orchestrator scope-drift authority (§3 risk 3). Draft acknowledges the dual-emitter problem and surfaces it as Open Question 3, but the §2 Phase B design proceeds *as if* the squad-leader signal is canonical. If the question's answer is "orchestrator wins, squads do not write evaluations," then Phase B's §2 design needs major surgery.
  - Draft location: §2 Phase B Step 2 vs §3 risk 3 vs §5 Open Q3
  - Tension: Draft commits to a design in §2 that the open question in §5 has not yet resolved.
  - Question for planner: Resolve Q3 before story decomposition. If "orchestrator wins," strike the §2 Phase B Step 2 evaluation-wire. If "squads win," document the orchestrator-side deprecation.

- **U2** — Substrate-first posture vs consumer distributability. Plugin-hive ships to consumers via the marketplace; user-invocable skills like `/standup` are part of the consumer surface. Phase D imports those skills into Multica's `skill` table. Consumers without Multica lose access to those skills entirely (or the plugin must dual-ship: in-repo + in-Multica). Draft does not address consumer experience.
  - Draft location: §2 Phase D vs CONTEXT.md (plugin auto-discovers skills from `skills/{name}/SKILL.md`)
  - Tension: Substrate-first inside Firefly's spike vs ship-to-marketplace plugin-hive.
  - Question for planner: Is Multica adoption optional for consumers (skills remain in-repo, Multica-imported is a parallel surface) or required (in-repo skills become stubs that defer to Multica)? Affects every Phase D story.

## Convention violations

- **C1** — Draft Phase D imports skills into the spike workspace's `skill` table. The `versioning` cross-cutting concern (in `.pHive/cross-cutting-concerns.yaml`) gates consumer-visible changes — moving the runtime for `/standup` from in-repo to Multica is a consumer-visible posture change. Draft does not mention a version bump or migration path.
  - Draft location: §2 Phase D (entire phase)
  - Convention: `.pHive/cross-cutting-concerns.yaml` `versioning` concern
  - Question for planner: Phase D stories must each evaluate the `versioning` concern. If consumers lose `/standup` when they don't have Multica, this is a breaking change requiring a major version bump.

- **C2** — Draft §3 mitigation says "all imports use `--visibility private` (or whatever the equivalent flag is — to be verified)." Per `feedback_test_offtheshelf_before_rewriting`, verification is supposed to happen *before* the design commits to a path. Draft commits to Phase D imports while the visibility-flag question is open.
  - Draft location: §3 risk 5 mitigation
  - Convention: `feedback_test_offtheshelf_before_rewriting`
  - Question for planner: Add an explicit Phase D pre-flight spike: verify `multica skill import` accepts a visibility flag (or equivalent privacy mechanism) before the import stories run.

- **C3** — Draft does not estimate file count against the `<150 PR files` convention (`feedback_pr_file_count_limit`). 22 new persona entries in `agents.yaml` is one file change. Bootstrap reconcile refactor is N files. Squads + autopilots + skills imports each add N more. Large-scope epic without a file-count guard is exactly the failure mode the convention exists to prevent.
  - Draft location: §6 Scale assessment
  - Convention: `feedback_pr_file_count_limit`
  - Question for planner: Add an explicit file-count estimate per phase. If any phase exceeds 150, break into sub-PRs with base-retargeting (per the memo).

## Posture mismatches

- **P1** — Draft §2 Phase B Step 2 wires Multica squad-leader auto-evaluation into `/execute`'s post-merge signal. This shifts authority from *user-directed* (CONTEXT.md North Star) to *Multica-leader-evaluated*. A squad-leader writing an evaluation that hive consumes without user mediation is exactly the director-chair workflow the 2.0 posture rejects.
  - Draft location: §2 Phase B Step 2
  - Posture reference: `.pHive/CONTEXT.md` (North Star: "composable substrate, user-directed — not a director-chair workflow")
  - Question for planner: Is the squad-leader evaluation a substrate signal (one of many the user can consume) or an authority surface (Multica says it's done, hive accepts)? If authority, justify the posture deviation explicitly.

- **P2** — Draft §2 Phase D moves the skill-discovery mechanism for imported skills from filesystem (`skills/{name}/SKILL.md` auto-discovery) to Multica DB (`skill` table). Per CONTEXT.md, the auto-discovery convention is foundational. Moving discovery to a remote DB is a fundamental posture change with no explicit justification.
  - Draft location: §2 Phase D
  - Posture reference: `.pHive/CONTEXT.md` Terminology — Skill: "auto-discovered capability at `skills/{name}/SKILL.md`"
  - Question for planner: Is the goal to (a) replace filesystem discovery with Multica DB discovery, (b) augment filesystem with Multica DB (dual-source), or (c) only export read-only copies of filesystem skills into Multica for runtime materialization? Each has different consequences.

- **P3** — Draft §2 Phase C autopilots bundle schedule + skill + agent into one autopilot record. Per CONTEXT.md and `feedback_check_readme_first`, the plugin-hive posture separates schedule (CronCreate / /loop) from skill (skills/) from persona (hive/agents/). Autopilots recombine all three into one configuration unit — a posture compression worth surfacing.
  - Draft location: §2 Phase C
  - Posture reference: Plugin-hive composability — three orthogonal axes (schedule, skill, persona) kept separate
  - Question for planner: Is the recombination intentional (autopilots are the deliberate consolidation point for scheduled work) or accidental (we're using autopilots because they're the available Multica primitive without considering the posture cost)? Document the choice.

## Notes

- The draft is internally consistent on the codex-provider spike (Phase A pre-flight gates the rest), which the `inconsistency_risk_signals` flagged as the biggest unknown. That's well-handled.
- The Open Questions section (§5) is unusually load-bearing — Q3, Q4, Q5, Q6 each gate a different phase. Phase B is gated on Q3; Phase C is gated on Q4; Phase D is gated on Q5 + Q6. The plan cannot proceed to story decomposition until all four are answered, not just the scale question.
- "Friction-note items 1-5 + 7" deferral (Open Q7) is rational but worth surfacing as its own decision — if the adapter is being touched anyway in Phase B (for squad endpoints), bundling friction fixes is cheap.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
