# Design Discussion — Multica Substrate-Deepen

**Epic:** `multica-substrate-deepen`
**Status:** Post-grill revision
**Author:** /plan (orchestrator-as-writer, inline)
**Date:** 2026-05-27
**Grill-record:** `.pHive/epics/multica-substrate-deepen/docs/grill-record.md` (13 findings: 2V/4H/2U/3C/3P)

## §0 Prelude — git_flow + prior-decisions

- Base branch: `develop` (per `hive.config.yaml` git_flow resolver, source=plugin).
- Branch strategy: per-epic. All stories commit on `feat/multica-substrate-deepen`.
- Prior decisions (`/hive:why` pre-flight): zero direct hits. Adjacent KG triples confirm 2026-05-01 codex routing policy and the parallel-dispatch race feedback.
- **Revision summary** — this draft has been revised against grill-record findings. Each grill finding is either resolved in the body (with the finding ID cited) or annotated as an explicit deviation in §7. Vocabulary now uses CONTEXT.md terms; load-bearing assumptions are gated on Phase 0 spikes; posture mismatches are surfaced as explicit user-decision points.

## §1 Goal

Move plugin-hive from Multica-as-issue-tracker to Multica-as-substrate. Concretely:

1. **Replace the inner-session `/codex:rescue` indirection** with Multica agents whose runtime is codex-native, *if* Multica's agent runtime supports a codex provider. Gated on Phase 0 spike (see §2 pre-flight).
2. **Use Multica's primitive set deliberately, not opportunistically.** Squads, autopilots, and native skills each map onto an existing plugin-hive construct (roster, scheduler, skill discovery) — each adoption is a posture choice, not a free add (resolves grill P1/P2/P3).
3. **Port plugin-hive's persona inventory subset that survives `dispatchable` classification.** Not all 25. See §2 Phase A for the criterion (resolves grill H3).

The north star: when `/execute` dispatches a story, the right persona — backed by the right LLM — claims the task without rescue indirection, *and* the plugin still ships to consumers who do not adopt Multica (resolves grill U2).

## §2 Proposed approach

### Phase 0 — Spikes (gate the rest of the plan)

Per `feedback_test_offtheshelf_before_rewriting`, three spikes run before any persona port or autopilot creation. Each is a single bounded session producing a written finding. If any spike returns a blocking negative, the dependent phase is re-scoped or deferred.

- **S0.1 Codex-provider support spike.** Create one `developer-codex` agent in the Multica spike workspace via `multica agent create --name developer-codex --runtime-id <codex-runtime>` (or whatever shape codex runtime registration takes). Dispatch a trivial story (e.g., "echo hello to stdout"). Observe whether the daemon claims, runtime starts, task completes. Output: written finding stating "codex supported" / "codex not supported" / "supported with caveats." Gates Phase A's provider routing.
- **S0.2 Squad-read adapter shape spike.** Determine whether `squad activity` data (squad-leader evaluation on an issue) is readable via the existing Multica REST surface — i.e., is `GET /api/issues/{id}` extended with squad fields, or is there a separate `/api/squads/{id}/activity` endpoint? Output: a sketch of the adapter method(s) Phase B would add (resolves grill H1).
- **S0.3 Skill import + visibility flag spike.** Confirm `multica skill import` accepts a privacy/visibility mechanism (flag, default behavior, post-import patch). Import one trivial test skill to confirm. Output: written finding on visibility (resolves grill C2).

Phase 0 is its own wave of stories; downstream waves do not start until S0.1/S0.2/S0.3 are written.

### Phase A — Persona port + provider routing

- **Dispatchable classification.** Before any agents.yaml expansion, write a one-pass classification at `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md` listing each of the 25 personas against the criterion: "Produces useful output from one bounded task input without spawning subagents." Personas that fail the criterion (orchestrator, team-lead, pair-programmer) are excluded from `agents.yaml`; they remain in the plugin-hive harness only. The expected dispatchable set is ~20 personas, not all 25 (resolves grill H3).
- **agents.yaml expansion.** Expand `.pHive/multica/agents.yaml` from 3 → the dispatchable subset. Apply 2026-05-01 routing policy gated on S0.1: creators get `provider: codex` if S0.1 was positive, else `provider: claude` + the `codexInstruction` rescue stays. Verifiers stay `provider: claude` + `model: claude-opus-4-7` regardless of S0.1.
- **Bootstrap reconcile.** Update `hive/lib/multica-bootstrap/reconcileAgents` for N-persona batch operations — single `agent list`, diff, batched upserts. Today optimized for 3.
- **codexInstruction conditional.** Drop the flag from `serializeStoryBrief` IFF S0.1 was positive AND the creator persona's `agents.yaml` entry routes to codex provider. Otherwise leave intact (resolves grill U3's residual ambiguity by tying it to the spike result).

### Phase B — Squads (gated on S0.2 + Q3)

This phase only enters story decomposition if Open Question 3 (squad-leader vs orchestrator authority) is resolved by the user at the design-discussion gate. If Q3 is answered "orchestrator wins, squads do not write evaluations," Phase B reduces to *squad-as-roster-namespace* only — no evaluation wire-up.

- **Squad creation as roster namespace.** Three Multica squads mirror plugin-hive's planning-routing layout (resolves grill V1 — using CONTEXT.md term *planning team* / *specialist team*):
  - `planning-team-squad` (researcher + architect + writer + tpm, leader=tpm)
  - `dev-team-squad` (developer + backend-developer + frontend-developer + reviewer, leader=reviewer)
  - `verify-team-squad` (tester + test-architect + test-scout + peer-validator + security-reviewer, leader=peer-validator)
- **Adapter ABI 1.1.0 — squad-read methods (if Q3 = squads-win).** Adapter gains `getSquadActivity(issueId)` returning `{leader, evaluation, timestamp}`. Bumped ABI version published in `friction-notes.md` + adapter README.
- **Evaluation signal contract (if Q3 = squads-win).** The squad-leader evaluation is a *substrate signal*, not an authority surface (resolves grill P1). `/execute` consumes it as one input among many. The user (or the orchestrator on the user's behalf) retains the final scope-drift verdict. Documented at `hive/references/squad-evaluation-contract.md`.
- **Scope-drift positioning (resolves grill V2).** The squad-leader signal is *not* a scope-drift emit. It is a separate signal type: `squad_leader_evaluation`. Scope-drift retains its three emit sites unchanged.

### Phase C — Autopilots (gated on Q4 + the multi-persona skill question)

- **Multi-persona skill realism check** (resolves grill H2). For each candidate scheduled skill, document its persona footprint:
  - `/standup` → tpm-led, multi-persona internally. Autopilot fires tpm; tpm internally orchestrates via roster spawn. tpm becomes (effectively) an orchestrator in this context — accept or reject this collapse explicitly.
  - `/metrics-check` → single-persona (a process-discipline skill; tpm or analyst owns). Clean fit.
  - `/meta-optimize` → multi-persona. Same collapse problem as `/standup`.
  - `/visual-qa` → ui-designer-led with optional accessibility-specialist sidecar. Borderline single-persona.
- **Decision rule.** Only skills that pass the single-persona check OR explicitly accept the orchestrator-collapse become autopilots in this epic. Skills that fail (or whose owner rejects the collapse) stay on local scheduling.
- **Three autopilots if all pass.** `standup-daily`, `metrics-check-post-merge` (webhook), `visual-qa-post-merge` (webhook). `meta-optimize-weekly` is deferred to follow-on epic pending the multi-persona resolution.

### Phase D — Native skills layer (gated on Q5 + S0.3 + Q6)

**Posture decision required (resolves grill P2 + U2 + C1).** Phase D scope is one of three explicit modes, picked by the user at the design-discussion gate:

- **Mode D-a: Read-only export.** Plugin-hive skills remain authoritative in-repo. Phase D writes a one-way sync that exports a *runtime copy* into Multica's `skill` table per epic. Consumers without Multica are unaffected. Substrate-first is partial — Multica gets skills, but as exports, not as source-of-truth.
- **Mode D-b: Dual-source.** Skills exist both in `skills/{name}/SKILL.md` (consumer-facing) and in Multica (substrate-facing). Maintenance burden: every skill edit must be re-imported. Phase D builds the import tooling + a CI guard to keep them in sync.
- **Mode D-c: Migrate.** Skills move to Multica's `skill` table. In-repo `skills/` becomes stubs that defer to Multica. Consumers without Multica lose access. Breaking change requiring a major version bump per `versioning` cross-cutting concern.

This draft RECOMMENDS Mode D-a (read-only export). Mode D-c is the most aggressive substrate-first move but breaks consumer distributability. Mode D-b is the worst-of-both-worlds. User confirms at scope gate.

**Skill imports must bundle substrate (resolves grill H4).** Whichever mode is chosen, imported skills cannot ship without their dependencies (`skill-prelude.md`, related references). Phase D defines a bundling contract: imported skills carry a manifest of substrate files, which the importer materializes alongside the SKILL.md.

### Cross-phase: friction-note-6 (labels) resolution

Path 3 from the research brief stands: **abandon labels for substrate-first equivalents.** `hive:ready` becomes "squad has been assigned this issue"; `hive:blocked-by:*` uses Multica's `parent_issue_id` already-supported by the adapter; `hive:epic:*` becomes squad-bound namespace. No server patch attempted in this epic. (Open Q7 still asks whether to bundle the other 6 friction items.)

### Cross-phase: PR file-count guard (resolves grill C3)

File-count estimate per phase (target <150 per `feedback_pr_file_count_limit`):

- Phase 0 (spikes): ~5 files (three docs + light scratch).
- Phase A (persona port): ~10-15 files (`agents.yaml` edit, dispatchability classification doc, bootstrap reconcile + tests, dispatch flag changes).
- Phase B (squads): ~15-25 files (adapter ABI 1.1.0 if Q3=squads, three squad creation, contract doc, /execute wiring).
- Phase C (autopilots): ~10 files (autopilot definitions, deprecation list, persona-footprint doc).
- Phase D (skills, mode TBD): ~20-50 files depending on mode (D-a smallest, D-c largest).

Total well under 150 per phase. If any single phase brushes the limit during decomposition, sub-PRs with base-retargeting per the memo.

## §3 Risks

- **Codex provider unsupported.** S0.1 spike result is the single biggest gate. Negative result preserves ~70% of the epic via squads + autopilots + skills, but the headline "delete the rescue dance" value evaporates. **Mitigation:** S0.1 runs first; negative result triggers a checkpoint with user before Phase A starts.
- **Squad-evaluation read endpoint may not exist.** S0.2 spike could return "the data isn't exposed via REST." **Mitigation:** if negative AND Q3 = squads-win, Phase B downgrades to roster-namespace only.
- **Skill-substrate bundling complexity.** Imported skills depend on prelude + references + sometimes agents. If the bundling manifest grows past trivial, Phase D explodes. **Mitigation:** pilot with ONE skill first (`/metrics-check` is the simplest candidate — single-persona, low dependency).
- **`/standup` and `/meta-optimize` autopilot collapse.** Forcing multi-persona skills into single-agent autopilots may produce confused output. **Mitigation:** Phase C explicitly rejects the collapse; only single-persona skills become autopilots in this epic.
- **D-a export drift.** If skills are exported one-way and edits happen in Multica's UI (or vice-versa), they diverge silently. **Mitigation:** Mode D-a includes a CI guard that fails the build if the Multica skill content diverges from `skills/{name}/SKILL.md`.
- **Friction-note-6 routing-around may produce label-shaped emergent need later.** If autopilots or squads grow a use-case that wants labels, we'll have routed around a gap that turns out to matter. **Mitigation:** none — accept the bet; revisit if it bites.
- **Cross-cutting `versioning` concern fires on Phase D.** Mode D-c is breaking; Mode D-a is additive. **Mitigation:** mode picked at scope gate; versioning evaluation per story.

## §4 Dependencies

- Multica spike server running locally; `multica daemon` healthy.
- Spike source at `~/Code/spikes/multica` available for inspecting codex-runtime registration + squad-read endpoints.
- 2026-05-01 codex-routing policy in `hive.config.yaml` `agent_backends:` (already wired).
- `hive/lib/multica-bootstrap/reconcileAgents` — extension for N-persona batch.
- `hive/lib/multica-story-dispatch/serializeStoryBrief` — `codexInstruction` flag conditional on S0.1 outcome.
- Adapter ABI version bump (1.1.0) gated on Phase B outcome.

## §5 Open questions (numbered)

1. **Phase 0 packaging.** Three spikes (S0.1/S0.2/S0.3) as their own wave, or inlined as pre-flight inside Phases A/B/D respectively? Wave-as-own gives cleaner re-plan checkpoints; inline saves a wave.
2. **Persona dispatchability cut.** Confirm the rough split — exclude orchestrator/team-lead/pair-programmer from `agents.yaml`. Peer-validator is dispatchable as a verifier (resolves grill H3 internal contradiction). Confirm or override.
3. **Squad-leader vs orchestrator authority.** Substrate signal (squad evaluation is one input among many) or authority surface (squad evaluation gates `/execute` close)? Substrate-signal recommended (preserves user-directed posture per CONTEXT.md North Star). Confirm or override.
4. **Autopilot scope.** Three (standup + metrics-check + visual-qa) or one (metrics-check only, the cleanest fit)? Deferring `/meta-optimize` either way pending multi-persona collapse decision.
5. **Phase D mode.** D-a (read-only export, recommended) / D-b (dual-source) / D-c (migrate, breaking).
6. **Skill import visibility.** Pinned to S0.3 spike result. No user input until S0.3 completes.
7. **Friction-note bundling.** Items 1-5 + 7 — bundle into Phase B's adapter ABI 1.1.0 bump, or defer to a follow-on adapter-cleanup epic?
8. **Scope.** Large (all four phases including Phase D-a) or Medium (Phase 0 + A + B only, defer C + D)?

## §6 Scale assessment

**Recommended scale: Large.**

Rationale:
- Multi-system: Multica server, plugin-hive adapter, bootstrap, dispatch, /execute skill, autopilot scheduling, native skills layer.
- Migration: deprecates rescue indirection (if S0.1 positive) and partially replaces local scheduling.
- Long-horizon: four phases plus a pre-flight wave (Phase 0), with sequential dependencies (D depends on C depends on B depends on A depends on S0.1).
- Risk-laden: three open gates (Q3 squad authority, Q4 autopilot scope, Q5 Phase D mode) before story decomposition can complete.

Large scope triggers Phase B2 (H/V) + Phase B3 (structured outline). Alternative: **Medium** by deferring Phase C + D, keeping Phase 0 + A + B.

## §7 Accepted deviations from grill findings

Grill findings carried into the design without resolution, with rationale:

- **None at this draft.** Every grill finding has been routed to either: a §2 design revision (V1/V2/H1/H2/H3/H4/U1/U2/C1/C2/C3/P1/P2/P3 all addressed inline), an explicit §5 Open Question (Q3/Q4/Q5/Q6/Q7), or a §3 Risk with mitigation. No deviations are accepted-without-justification in this revision.

If the user prefers to override any grill resolution at the design-discussion gate, those become accepted deviations listed here in the next iteration.
