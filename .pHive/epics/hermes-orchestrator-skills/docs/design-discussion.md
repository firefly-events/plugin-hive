# Design Discussion — Hermes Orchestrator Skills

**Epic:** hermes-orchestrator-skills
**Scale assessment (recommended):** **Medium** (multi-artifact, single substrate, well-understood contract — no new runtime, no migration)

## §0 Prelude

Grounding: **plan off repo bridge.** `hive/lib/multica-story-dispatch/cli.mjs` + `hive/references/cycle-reconciler.md` are the contract of record. The live Studio fork surface (MCP tool existence, daemon auth) is reconciled at `/execute`, not assumed from upstream Multica docs.

Deliverable home: **Hermes-side.** Artifacts land in the Hermes agent (`~/Code/hermes-agent` on Studio). plugin-hive stays the substrate and the source of the orchestrator contract. plugin-hive's `skills/` dir is NOT where these live.

## §1 Goal

Codify "how the Hive orchestrator works" into a stable, versioned set of Hermes-side skills, so a persistent Hermes cron can run the software factory toward the lights-on north star: **human gates planning and review; Hermes + agents own the rest.**

Today the orchestrator is not a real agent. In-session it's skill code + plugin-hive's preferences, re-derived each run, inconsistent. When Hermes "wants to get familiar with the stories first," that's the absence of a codified orchestrator posture. This epic gives Hermes a fixed contract instead of improvised behavior.

## §2 Why now / what exists

`cycle-reconciler.md` already proves the pattern: a runbook markdown pasted as a per-tick cron system prompt, driving the `multica_*` MCP tools. PR #305 shipped the `cli.mjs` reconciler CLI + `hermes_reconciler` cross-tick state. So **reconcile-tick is ~80% built.** The gap is (a) the *sibling* flows (monitor, kickoff-plan, kickoff-exec, watch-cron) are not codified in the same pattern, and (b) the set isn't packaged as Hermes-owned skills with a clear human-gate contract.

## §3 Proposed approach

**Pattern (one per skill): runbook doc + tool bindings.** Each Hermes-side skill = a markdown runbook (the orchestration logic / state machine) + a declared set of `cli.mjs`-backed MCP tool calls it is allowed to make. Mirrors `cycle-reconciler.md`. No new runtime language; the logic is prompt + tool-call contract.

**The 5 skills (create-story deliberately dropped — see §6):**

| Skill | Human gate | Wraps | State |
|---|---|---|---|
| **monitor-epic** | none | `epic-status` + `context-snapshot` + `poll` | read-only |
| **reconcile-tick** | **review verdict** | cycle-reconciler 7-position machine | exists ~80%; formalize |
| **kickoff-plan** | **plan approval** | `/plan` (multica mode) | new runbook |
| **kickoff-exec** | none (work pre-approved) | reconciler loop start over an approved epic | new runbook |
| **watch-cron** | none | routine/daemon status | new runbook |

**Human-gate contract (the north-star spine):**
- Hermes may **read** anything (monitor-epic, watch-cron) with no gate.
- Hermes may **advance approved work** (reconcile-tick, kickoff-exec) with no gate UNTIL a review-terminal verdict — there it **stops and surfaces to the human.**
- Hermes may **start planning** (kickoff-plan) but planning's own gates (design review, outline sign-off, confirm) are owned by the human and are never auto-advanced by Multica/Workflow completion.
- Hermes **never creates stories.** Backlog authorship is human-gated via `/plan` or `/triage --hand-off` only.

**`gate_state: pre_approved` is the load-bearing latch.** reconcile-tick / kickoff-exec only proceed when the epic's `hermes_reconciler.gate_state == pre_approved`. That flag is written by a human approval action (post-plan). This is the mechanism that keeps "lights-on autonomy" bounded by "human approved this epic to run."

## §4 Skill-by-skill

**monitor-epic** — given an epic handle, emit a status digest: phase positions per story, in-flight task + age vs watchdog, recent episodes, open triage, metric verdicts. Pure compose over `epic-status` + `context-snapshot.mjs` + `poll`. The "what's happening" surface for a human glance or a cron heartbeat.

**reconcile-tick** — formalize `cycle-reconciler.md` as a Hermes skill. One tick: read state → pick action by phase position → dispatch/poll/harvest → `write-state`. The review-terminal verdict branch is the human gate: on `review_terminal`, surface verdict + stop (do not auto-advance to done or auto-loop a revision without the approved posture). Carries the watchdog/rescue + "never trust 'pushed', verify ff-merge" lessons.

**kickoff-plan** — trigger `/plan` in multica mode for a fresh requirement. Hermes' role is to *start* it and route the human to the gates; it does not answer design questions or sign off. Output is a planned epic (still `gate_state: null` until human approval).

**kickoff-exec** — start the reconcile loop over an already-approved epic (`gate_state: pre_approved`). Refuses if not pre-approved. This is the "go" button for autonomous execution of planned work.

**watch-cron** — monitor the RemoteTrigger routines (meta nightly, standup loop) + `multica daemon status`. Surfaces failures/stalls. Read-only; alerting only.

## §5 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `multica_*` MCP tools may not exist in fork | med | plan-off-repo-bridge: execute-time reconcile; candidate story wraps `cli.mjs` as MCP tools if absent |
| Hermes auto-advances a human gate | **high** | gate contract §3 is explicit + tested; Multica/Workflow completion ≠ sign-off (existing /plan invariant) |
| Watchdog breaks on placeholder timestamps | med | carry cycle-reconciler's "omit `dispatched_at` if no clock" rule into the skill verbatim |
| "pushed" over-claim → phantom progress | med | reconcile verifies ff-merge, not agent claim (memory-known) |
| Hermes skill format mismatch on Studio | med | confirm `~/Code/hermes-agent` consumption pattern (open Q1) before authoring |
| Epic selection ambiguity (which epic to tick) | low | epic-of-record pointer; monitor-epic scans open epics |

## §6 Why create-story was dropped

Original set had a `create-story` skill (one issue into an existing epic, no ceremony). User directive: **Hermes must not mint stories on its own** — that requires approval + planning in most cases. Single small-work creation is a `/triage --hand-off` job (itself gated). So story authorship stays entirely human-gated; Hermes orchestrates only *already-planned* work. This sharpens the north star rather than weakening autonomy: the human owns *what work exists*; Hermes owns *moving approved work through.*

## §7 Dependencies

- `cli.mjs` subcommands (exist).
- `cycle-reconciler.md` runbook (exists — becomes reconcile-tick source).
- `context-snapshot.mjs` (exists).
- Studio Multica fork + daemon (exists; auth caveats known).
- `~/Code/hermes-agent` repo on Studio (exists; consumption format = open Q).

## §8 Open questions (human-in-loop)

1. **MCP wrappers:** do `multica_dispatch_story` / `multica_poll_task` / `multica_epic_status` / `multica_write_state` already exist in the Studio fork, or does this epic add a story to expose `cli.mjs` subcommands as MCP tools?
2. **Hermes skill format:** is the artifact the "paste-as-system-prompt runbook" (cycle-reconciler pattern), or does Hermes-agent have a native skill/tool registry we author into? Changes the shape of every story.
3. **Epic-of-record:** how does a Hermes tick choose which epic to reconcile — a single pointer the human sets at approval, or scan-all-open-epics?
4. **Review-verdict surfacing:** how does Hermes present a review-terminal verdict to the human and wait? Dashboard (127.0.0.1:9119)? Discord (deferred)? A `gate_state` transition the human flips?
5. **Scope of this epic:** ship all 5 skills, or MVP = reconcile-tick formalization + monitor-epic first (the read + advance core), with kickoff-plan/exec/watch-cron as a follow-on?

## §9 Scale assessment

**Medium.** Multi-artifact (5 runbooks + bindings + tests), single substrate (no new runtime), contract already understood (one major piece pre-built). Recommends H/V planning to slice correctly, then stories. Not Large — no migration, no multi-system change, bounded surface.
