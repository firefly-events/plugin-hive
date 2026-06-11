# Work Tranche Roadmap

Captured 2026-06-08 from maintainer brain-dump. Clustering + sequence locked in conversation.
This is a plan-to-plan: it groups rough ideas into epics and orders them. Each epic is
decomposed later via `/plan` (Multica-driven). D is tracked separately as its own product.

## Already moving
- **state-dir-resolver** — ✅ PLANNED this session (10 stories, PLU-247..256, `feat/state-dir-resolver`). Not yet executed.
- **Worktree + scratch cleanup** — operational task, not an epic. 8 git worktrees + ~16 scratch dirs (`closer-test-*`, `multica-bootstrap-*`, `node-compile-cache`). Do opportunistically.

## Dropped
- ~~Multica vs Hermes 0.15 agents/teams comparison~~ — maintainer already researched; out of scope. Multica stays the runtime substrate.

## Epics (sequenced)

### Cluster C — Language & tech-stack strategy  **(FIRST — research/decision, gates A & B's new code)**
Source items: "Do we have a CLAUDE.md? Nail down tech stack?" + "Why the JS/TS split? Path to pure-Python?"
- Audit current language split (JS/TS vs Python vs shell) and WHY it exists.
- Pure-Python feasibility + migration cost + recommendation (ADR).
- Tech-stack lock + CLAUDE.md decision.
- **Overlap:** directly ripples into state-dir-resolver — the 3-runtime resolver (shell+Node+Python, sdr-1) exists *because* of this split. A pure-Python direction would simplify that resolver and all future cross-runtime work.
- **Shape:** research spike → ADR first; only becomes a build epic if a migration is greenlit. Cheap, high-leverage, de-risks downstream.

### Cluster A — Artifact & state lifecycle / archival  **(SECOND)**
Source item: temp-dir + archival brain-dump.
- Ephemeral files → OS temp (auto-cleaned). Shipped epics/stories/docs → archive-to-temp with a lifecycle; OS purge reclaims.
- **Forever-retained:** memories + KG entries. Everything else (story YAMLs, epic files, planning docs) gets an eventual cleanup path.
- Shipped-epic archival migration → temp folder.
- **Overlap:** generalizes `sdr-8-runstate-archival-sweep` (already planned in state-dir-resolver). sdr-8 is the prototype slice; this epic extends the pattern to ALL hive artifacts. Do NOT double-build — fold sdr-8's mechanism in.
- **Depends on:** state-dir-resolver (resolver + relocate-to-temp lever).

### Cluster B — Autonomous planning queue + human-gate elevation  **(THIRD — biggest)**
Source item: planning-queue brain-dump.
- Tunable rough-idea queue that auto-feeds the kanban when it runs low. Consumption rate tunable (empty-always ↔ very-slow).
- Open-questions-during-planning → notify maintainer via **always-on agent** + `blocked-for-human` label/tag.
- **Visual tab inside Multica** for the queue.
- **Overlap:** this IS the gate-elevation + Hermes-as-always-on-orchestrator architecture explored this session (squad leader elevates gate → Hermes relays to Slack → answer posts back → work resumes). Reuses the `hermes-multica` plugin path.
- **Depends on:** C's runtime/language decision + state-dir-resolver shipped + the Hermes/Multica gate-elevation glue.

## Separate product (own repo, NOT a Hive epic)

### Cluster D — Cross-agent comms connector
Source item: cross-agent WebSocket connector.
- Standalone product complementary to Hive: lets agents from **Codex, Claude Code, Gemini CLI, Pi Coding Agent** (and others) communicate via WebSocket (or alt transport).
- Plugin/extension installed on each tool so they interoperate.
- Tracked in its own repo + planning track; informed by, but decoupled from, Hive.

## Sequence
1. **C** — language/tech-stack ADR (research-first).
2. **A** — artifact/state lifecycle (builds on shipped state-dir-resolver; folds in sdr-8).
3. **B** — planning queue + gate elevation (needs C + state-dir-resolver + Hermes glue).
4. **D** — separate product track, parallelizable, own repo.
