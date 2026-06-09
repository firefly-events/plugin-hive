# Design Discussion — `multica-insight-capture`

## §0 Prelude
- Source: triage `t-001` (prioritized). Branch `feat/multica-insight-capture` off `develop`, per-epic.
- Found 2026-06-06 mid-execution of the `release-lifecycle` epic: Multica mode shipped 6 stories but captured zero distilled insights.

## §1 Goal
Close the insight/memory capture gap in Multica execution mode. Team/sequential/session modes run `hive/references/pre-shutdown-protocol.md` + `insight-capture.md` (via session-end/respawn). Multica mode runs none of it — Hive owns only dispatch→poll→episode-marker, keeping a raw `multica-run.messages.jsonl` transcript that nothing distills back into Hive memory. Learnings from Multica-run stories are lost.

## §2 Proposed approach
Two complementary surfaces (per t-001), wired into the existing lifecycle:

1. **Agent-side capture (brief injection).** `serializeStoryBrief` instructs the dispatched agent to write distilled insights to a known, contract-defined path before finishing. Cheap, gives the foreign agent a structured slot.
2. **Orchestrator distill (post-terminal, inline).** Agents self-record (surface 1) is primary input. After `writeMulticaRunEpisode`, the **orchestrator itself** distills — inline, full capability — reading the agent's self-captured insights (+ messages sidecar + story diff + its own cross-story context). Distillation requires reasoning forward and backward about how the work impacts future work; a cheap/sub-agent runner cannot hold that context. This is the "orchestrator self-captures at phase boundaries" rule (`feedback_execution_protocol`) applied to the Multica per-story terminal boundary.

**Decision (maintainer):** Agents DO record their own insights (surface 1). Distill runner = **inline orchestrator, full capability** — NOT a sub-agent, NOT haiku. The forward/backward impact reasoning needs the intelligence and the cross-story context.

Distill output target (maintainer): **team-memories** (epic-local, travels with repo) as primary; **promote durable cross-epic feedback to Hive memory** (`~/.claude/.../memory/`). Mirrors the session-end split.

## §3 Stories
| Story | Surface | Dep |
|---|---|---|
| mic-1 | `serializeStoryBrief` (index.mjs) — emit insight-capture instruction + known output path | — |
| mic-2 | post-terminal distill helper (episode-sync.mjs / new module) + read transcript+insights+diff → Hive memory | mic-1 |
| mic-3 | wire mic-1+mic-2 into `execute-mode-multica/SKILL.md` lifecycle prose + note Multica variant in `pre-shutdown-protocol.md` + constraint-summary row | mic-1, mic-2 |

## §4 Risks
- **R1 (med):** distill writes noisy/low-value memories. Mitigation: distill produces a single bounded note per story, gated on signal (skip when transcript yields nothing distillable); mirror insight-capture.md's quality bar.
- **R2 (low):** agent ignores the brief instruction (foreign runtime). Mitigation: surface 2 (orchestrator distill) works transcript-only; surface 1 is best-effort enrichment, not a hard dependency.
- **R3 (low):** insights path collides with agent work_dir conventions. Mitigation: contract-defined relative path under the task work_dir, documented in mic-1.

## §5 Open questions
1. Distill destination — Hive memory (`~/.claude/.../memory/`), repo `team-memories/`, or both? Sketch = team-memories (epic-local, travels with repo); promote to Hive memory only for cross-epic feedback.
2. Who runs the distill — a sub-agent (reviewer persona) or an inline orchestrator step? Sketch = inline orchestrator (cheap, no extra dispatch), escalate to sub-agent only if transcripts prove too large.
3. Should distill also emit a KG triple (insight provenance)? Sketch = out of scope; revisit if /hive:why wants it.

## §6 Scale
**Small–Medium.** 3 stories, 2 lib files + 2 doc files, no UI, no migration, surfaces already mapped. H/V skip justified (linear: capture → distill → wire). Proceeding to stories after sign-off.
