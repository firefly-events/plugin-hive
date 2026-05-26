# Grill Record — multica-integration-fixes

**Source draft:** `.pHive/epics/multica-integration-fixes/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (6 signals from research-brief)
**Generated:** 2026-05-24T22:00:00Z

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 4 findings
- Unresolved tensions: 2 findings
- Convention violations: 3 findings
- Posture mismatches: 2 findings

## Vocabulary mismatches

- **V1** — "session" used in multiple senses across the draft without disambiguation.
  - Draft location: §2 "Multica session lifecycle", §4 "claude session ends abnormally", §1 "next Multica execute run"
  - Reference: research-brief inconsistency_risk_signals; CONTEXT.md does NOT define "session" (it's an unowned cross-domain term — Claude Code session, Multica task session, Anthropic API connection session all called "session")
  - Question for planner: pick a glossary in §0 or §2 — Claude Code "harness session" vs Multica "agent task session" vs Anthropic "API connection" — and use consistently in story specs so mi-02 brief unambiguously names which one it's diagnosing.

- **V2** — "spike" used for Wave 1 stories (mi-01/mi-02) without CONTEXT.md backing.
  - Draft location: §3 "Wave 1 — Investigation (parallel-safe, read-only)", "spike: read Multica source..."
  - Reference: CONTEXT.md Terminology has no "spike" entry; Hive vocabulary uses "research" + "story" + "wave"
  - Question for planner: acceptable as informal terminology (industry-standard) or normalize to "research story" / "investigation story"? Low-severity; the deliverable shape (~50-line brief) is more load-bearing than the label.

## Hidden assumptions

- **H1** — Draft assumes mi-01 and mi-02 spike stories will produce useful findings in a single agent invocation.
  - Draft location: §3 "Output: a written brief documenting whether plugins load via env..."
  - Why this matters: Multica source is Go; agent (developer persona is Sonnet 4.6) needs to navigate an unfamiliar codebase under a hard time budget. If the spike produces "couldn't determine, needs more time," Wave 2 mi-04 is blocked.
  - Question for planner: cap each spike at a concrete budget (e.g., ≤2 hours wall-clock OR ≤15 file reads) AND specify what counts as a "good enough" output (e.g., "name the function or config field that controls plugin loading, OR write 'not findable in 2h — recommend Multica-side question to upstream'"). Acceptance criterion needs explicit non-completion paths.

- **H2** — Draft assumes Multica source (`~/Code/spikes/multica` or `github.com/multica-ai/multica`) is the right reading target.
  - Draft location: §3 mi-01/mi-02 "read Multica source"
  - Why this matters: Multica daemon also bundles `cmux` and possibly other vendored deps. Plugin loading + session lifecycle might live in a vendored library, not Multica's own code.
  - Question for planner: spike stories should include a "verify the right source is on disk" pre-step that checks ~/Code/spikes/multica's go.mod / vendor tree, OR explicitly authorize the spike to fetch upstream if local clone is stale.

- **H3** — mi-04 acceptance criteria are deliberately under-specified ("apply mi-01's recommendation").
  - Draft location: §3 mi-04 + §4 [high] "mi-04 shape unknown until mi-01 returns"
  - Why this matters: violates agent-ready-checklist item #2 (Pre-made decisions — "agents can't negotiate, they need answers, not options"). Even with the 2-pass acknowledgment, an executing agent reading mi-04 alone won't know what to do.
  - Question for planner: either gate mi-04 explicitly on mi-01 completion (orchestrator re-spec mi-04 after mi-01 lands), OR ship mi-04 with three branches in the acceptance criteria (config-only / patch-needed / unfindable) and the agent picks based on mi-01's brief.

- **H4** — Draft assumes `multica repo checkout --ref <branch>` behaves as the help text implies.
  - Draft location: §3 mi-03 "call `multica repo checkout --ref <epic-branch>` explicitly before dispatch"
  - Why this matters: only verified via `--help` output, not by actual invocation. CLI might require the daemon's bare-clone cache to already have the branch fetched, or only work for issue-assigned tasks, or have side-effects on workspace state.
  - Question for planner: add a pre-implementation verification step to mi-03 — invoke `multica repo checkout --ref feat/multica-integration-fixes` against a throwaway issue + inspect resulting workdir BEFORE writing the skill patch. Cheap, prevents shape mismatch.

## Unresolved tensions

- **U1** — "Hive owns the half it can fix; Multica side requires upstream PRs" vs "We're trying to ship a fix epic that closes #62/#63/#64".
  - Draft location: §4 [med] "Multica upstream patches won't ship in this epic", §1 "Done looks like next Multica execute run completes end-to-end without orchestrator manual reconciliation"
  - Tension: "Done" definition can't be met if the primary failure (socket drops) is Multica-side and our deliverable is upstream-watch docs not patches. Either redefine "Done" to "Hive-side hardening + upstream-blocker docs filed" OR explicitly accept this epic ships partial closure.
  - Question for planner: rewrite §1 "Done" to match what this epic actually delivers — "Hive-side `execute-mode-multica` skill fails fast on missing clone + reconciliation pattern documented + upstream-blocker docs filed for socket drops + plugin loading" — instead of the maximalist "next run completes end-to-end."

- **U2** — §6 Q3 proposes including Hive-side workaround in mi-02's brief, but §3 mi-02 description is "spike — investigate" only. Workaround = code; investigation = doc.
  - Draft location: §3 mi-02 vs §6 Q3
  - Tension: if a workaround belongs in this epic, it needs its own story (e.g., mi-02b — implement retry-with-backoff). If it doesn't, mi-02 brief stays investigation-only.
  - Question for planner: pick one — either (a) split mi-02 into mi-02-investigation (brief) + mi-02-workaround (implementation), or (b) defer workaround to follow-on epic, mi-02 brief lists workaround options as appendix but doesn't implement.

## Convention violations

- **C1** — mi-04 may modify `.pHive/multica/agents.yaml`, which `skills/multica-init/SKILL.md` documents as single-writer.
  - Draft location: §4 [low] "Multica agents.yaml is single-writer (`/hive:multica-init`)"
  - Convention: skill-level invariant on agents.yaml (same posture as triage's queue.yaml single-writer)
  - Question for planner: explicit decision in mi-04 spec — does the fix (a) extend multica-init to handle the plugin install in its bootstrap (preserves invariant), or (b) accept multi-writer for agents.yaml and document the new convention? Recommend (a); (b) breaks a load-bearing pattern.

- **C2** — All Multica agents are `provider: claude`, which contradicts `feedback_codex_general_backend` policy (developer → codex).
  - Draft location: §6 Q4 "Codex provider in agents.yaml" + §4 [med] reference to agent_backends
  - Convention: `feedback_codex_general_backend` memo (2026-05-01 policy)
  - Question for planner: defer is acceptable if THIS epic adds the policy-deviation to upstream-watch (as a known gap, not a missed feature). Otherwise the deferral becomes silent debt. Either ship the codex-provider swap in mi-04 OR add explicit cycle-state entry documenting the deviation.

- **C3** — Per memory `feedback_codex_parallel_race`, parallel codex dispatches race. mi-01 + mi-02 both marked `parallel_rationale: read-only` in design discussion §3 — but if the agents end up routed through Codex (per agent_backends), the parallel race applies.
  - Draft location: §3 "Wave 1 in parallel (both stories independent, both read-only — safe for parallel-allowed:true + parallel_rationale:read-only)"
  - Convention: `feedback_codex_parallel_race` — "default to SERIAL Codex dispatch"
  - Question for planner: mark mi-01/mi-02 as `parallel_allowed: false` even though the work is read-only-shaped, OR confirm Multica-side execution avoids the codex-rescue race (parallel-gate applies pre-Multica dispatch, but inside Multica each task is one agent — so the race may not apply here). Verify which.

## Posture mismatches

- **P1** — §6 Q1 acknowledges "composable substrate posture says Hive should fail-fast + clear error messages, not work around Multica bugs" — but mi-02's Hive-side workaround proposal (retry-with-backoff) is a workaround.
  - Draft location: §6 Q1 + §3 mi-02 hint at workaround output
  - Posture reference: CONTEXT.md "composable substrate, user-directed"; `feedback_visibility_vs_trust` (north star is composable, not patchwork)
  - Question for planner: posture-aligned answer is "Hive surfaces the failure loudly + lets the user route to Multica fix." mi-02's deliverable should be diagnosis + upstream-fix-spec, NOT a retry shim that hides the issue. If transient drops are common enough that ops sanity demands a retry, file THAT as a separate posture-aware story (mi-02b) with explicit rationale for choosing patchwork over composable-fail.

- **P2** — Wave 3 (mi-05) ships docs not code, which is a "documentation as deliverable" shape that runs counter to ship-working-code orientation.
  - Draft location: §3 "Wave 3 — Capture upstream-PR ready findings: mi-05 write upstream-blocker docs"
  - Posture reference: Hive 2.0 milestone framing emphasizes shipping execution; mattpocock posture's atomic-skill ethos is "deliver a working unit"
  - Question for planner: either (a) accept that mi-05 is a doc-only story and frame it as "upstream-blocker brief = the deliverable" with clear acceptance criteria (file at path, contains repro + cause + suggested fix), or (b) defer mi-05 entirely — the docs naturally emerge from mi-01/mi-02 spike outputs and don't need a separate story. Recommend (b) — collapse mi-05 into mi-01/mi-02's deliverables; they ALREADY produce written briefs that can serve as upstream-blocker docs.

## Notes

- The draft's compressed planning posture is appropriate for this scope (Medium bug-fix epic) — H/V skip is justified.
- The 2-spike-then-implement shape is right for the unknown-rich Multica landscape; the risk is spike scope creep, addressed if H1 is resolved.
- The cmux MODULE_NOT_FOUND reframe (from primary cause to cosmetic noise) is solid recon work and is well-documented in the brief — no findings against that reframe itself.
- The upstream-blocker docs convention (`.pHive/upstream-watch/`) already has tracked precedent per .gitignore — using it for mi-05 (or absorbed-into-mi-01/02) is on-pattern.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
