# Phase 0 Capability Spike Findings

**Epic:** `cc-workflows-first-party`
**Story:** `cwfp-s1-1-phase0-capability-spike`
**Latest run:** `2026-06-02T00:28:00Z` (Run 2)
**Claude Code version:** `2.1.159`
**Latest verdict:** PASS (all 4 criteria)

This document records two spike runs. Run 1 (2026-06-01) failed because the
`/workflows` slash command was a history browser only and the `Workflow` tool
runner was unavailable in the tested environment. Run 2 (2026-06-02) succeeded
after the maintainer enabled the `Workflow` tool runner surface, which is the
actual workflow-creation/invocation primitive the spike measures.

The Run 1 section is retained verbatim for audit. Run 2 is the authoritative
verdict for the maintainer gate.

---

# Run 2 — 2026-06-02 (Workflow tool runner enabled)

## Run 2 Setup

**Test epic:** `smoke-test-execute-multica-codex` (same as Run 1).

| Story | Title | Intended change |
| --- | --- | --- |
| `stmc-1-create-marker` | Create `smoke-marker.txt` with a known timestamp | Create marker file |
| `stmc-2-append-line` | Append a known line to `smoke-marker.txt` | Append marker line |

**Persona team composition under test:**

| Persona | Surface | Role |
| --- | --- | --- |
| `developer` | `Workflow.agent({ agentType: "codex:codex-rescue" })` — Codex-routed | Codex-routed creator |
| `reviewer` | `Workflow.agent()` default Claude subagent | Review / verification |

Codex-routed creator persona present. Architect+TPM unified C1/C2 mitigation requirement satisfied.

**Invocation surface clarification:**

Run 1 measured the `/workflows` *slash command*, which Anthropic documents as
"Browse dynamic workflow history (running and completed)" — a browser, not a
runner. The actual workflow runner is the `Workflow` *tool* (deterministic
script orchestrator with `agent()`/`pipeline()`/`parallel()`/`phase()`). Run 2
measures the `Workflow` tool surface.

**Run 2 invocation evidence:**

- Pre-flight probe `Workflow({ script: <single agent echo> })` returned
  `{ dispatch_works: true, raw: "WORKFLOW_DISPATCH_OK_2026-06-02" }` —
  run ID `wf_72912ba7-4f9`, 1 subagent, 74,671 tokens, 2.7 s.
- Spike script `cwfp-phase0-spike-rerun` dispatched
  (run ID `wf_e37e0168-ef6`): 4 phases, 4 subagents, 8 tool uses, 40.8 s.
- Codex agents constrained via prompt: "Do NOT run any git command. Adapter
  commits serially after you return." Both returned structured
  `{ files: [...], timestamp: ... }` payloads.
- Claude reviewer agents read the file and returned structured
  `{ verdict, observed, notes }` payloads.
- Adapter-side serial commits authored after the Workflow run returned:
  `15614a1 [stmc-1-create-marker] feat(smoke): create smoke-marker.txt` and
  `916c2c1 [stmc-2-append-line] feat(smoke): append marker line`.

## Run 2 — Criterion (a): Integration-Branch Contract

**Verdict:** PASS

The `Workflow` tool's `agent()` API accepts arbitrary prompts including the
integration-branch shell-snippet contract. Codex agents respected the
"no git commands" constraint and returned file-list-only payloads. The
orchestrator (this Claude main loop) acted as the adapter, performing two
serial commits to the integration branch `feat/cc-workflows-first-party` after
the Workflow run returned. The integration branch advanced exactly once per
story, in dependency order (stmc-1 → stmc-2).

| Story | Expected evidence | Observed evidence | Verdict |
| --- | --- | --- | --- |
| `stmc-1-create-marker` | `Workflow` accepts integration-branch prompt contract; integration branch advances with >=1 story commit | Codex agent honored no-git constraint; returned `{files:[{path:".pHive/smoke/smoke-marker.txt",change:"created"}],...}`; adapter committed `15614a1` to `feat/cc-workflows-first-party` | PASS |
| `stmc-2-append-line` | `Workflow` accepts integration-branch prompt contract; integration branch advances with >=1 story commit | Codex agent honored no-git constraint; returned `{files:[{...change:"appended"}],...}`; adapter committed `916c2c1` to `feat/cc-workflows-first-party` after stmc-1 commit landed | PASS |

## Run 2 — Criterion (b): Codex File Lists And Serial Adapter Commits

**Verdict:** PASS

Codex creators returned structured file lists rather than performing direct
`.git` writes (no agent ran git commands). The Workflow script awaited each
story's review before moving to the next, and the orchestrator committed each
story serially after the Workflow returned — exactly the architect Q3+Q4
unified serial-commit gate mechanism. This pattern bypasses the
`feedback_codex_sandbox_commit_block` constraint (Codex sandbox can't write
`.git/index.lock`) by design: the adapter (orchestrator) owns the commit role.

| Story | Expected evidence | Observed evidence | Verdict |
| --- | --- | --- | --- |
| `stmc-1-create-marker` | Codex creator returns a file list; no agent writes `.git`; adapter commits serially to integration branch | File list returned in structured JSON; zero git tool uses by agent; adapter authored commit `15614a1` after run returned | PASS |
| `stmc-2-append-line` | Codex creator returns a file list; no agent writes `.git`; adapter commits serially to integration branch | File list returned in structured JSON; zero git tool uses by agent; adapter authored commit `916c2c1` after stmc-1 commit landed | PASS |

## Run 2 — Criterion (c): Completion Signal And Failure Modes

**Verdict:** PASS

The `Workflow` tool returns a `<task-notification>` event on completion with:
structured `<result>` payload (typed JSON when `schema:` is set), `<status>`
(completed/failed), `<usage>` block (agent_count, subagent_tokens, tool_uses,
duration_ms), per-run `<output-file>` path, and a transcript directory under
`~/.claude/projects/.../subagents/workflows/<run-id>/`. The runner also returns
a `resumeFromRunId` token at dispatch — completed agents return cached results,
so a script edit + resume re-runs only the edited/new calls.

Recoverability surface confirmed: completion event observable in-band, resume
token persists, per-agent transcripts persist for post-mortem. No background
workflow stranded; `TaskStop` cancels in flight.

## Run 2 — Criterion (d): Plugin-Shipped Skill Auto-Load

**Verdict:** PASS (unchanged from Run 1)

`plugin-hive@plugin-hive` version `2.9.0` enabled at user scope; `/execute`
and `/status` auto-load under CLI-interactive Claude Code 2.1.159. Verdict
carries forward from Run 1 — no Run 2 re-validation required since the auto-
load surface is independent of the Workflow tool surface.

## Run 2 — Verdict Block

| Criterion | Verdict | Evidence cite | Plan B branch |
| --- | --- | --- | --- |
| (a) integration-branch contract honored | PASS | Codex agents honored no-git constraint; adapter committed `15614a1` then `916c2c1` serially to `feat/cc-workflows-first-party` | Q2 path RESOLVED as (a) shell-snippet — `Workflow.agent()` prompts carry the contract verbatim |
| (b) Codex file lists + serial adapter commits | PASS | Codex agents returned structured file lists with zero git tool uses; adapter authored commits serially after run returned | Architect Q3+Q4 unified serial-commit gate MECHANISM CONFIRMED — adapter owns commit role, sandbox-commit-block bypass works |
| (c) completion signal + recoverable failure modes | PASS | `<task-notification>` event with structured result + usage block; resume token at dispatch; per-agent transcripts persist | First-party adapter unblocked — completion signal observable, resume surface present |
| (d) plugin-shipped skill auto-load | PASS | `plugin-hive@plugin-hive 2.9.0` enabled; `/execute` and `/status` auto-loaded in CLI-interactive 2.1.159 (carry-forward from Run 1) | Layer-5 auto-load primary path remains green |

## Run 2 — Recommendations

1. Maintainer-gate signature can be recorded — Slices 2-6 unblock pending
   maintainer review. Cycle-state `spike_outcome.maintainer_gate.status`
   set to `pending` for explicit maintainer sign-off.
2. Slice 2 work (`cwfp-s2-1`/`s2-2`/`s2-3`/`s2-4`/`s2-6`) should treat
   `Workflow` tool — not `/workflows` slash command — as the first-party
   execution substrate. Update vocabulary in `cwfp-s6-2-context-md-posture-and-vocab`
   to disambiguate "CC Workflow tool" vs "CC /workflows browser".
3. The adapter-side serial-commit pattern is the canonical mechanism: agents
   never write `.git`; the orchestrator commits after each story's review
   passes. This is the contract for `cwfp-s2-3-execute-mode-cc-workflows-skill`.
4. The `agentType: "codex:codex-rescue"` routing is the available Codex creator
   surface inside `Workflow`. `cwfp-s3-1-persona-dispatchability-under-cc-workflows`
   should formalize this as the Codex creator path and document the seam
   between the persona name (`developer`) and the routing target (`codex-rescue`).
5. Smoke epic commits (`15614a1`, `916c2c1`) land on `feat/cc-workflows-first-party`
   per maintainer election (2026-06-02). They are evidence-only and may be
   reverted if undesired in the eventual PR.

---

# Run 1 — 2026-06-01 (archive)

**Verdict:** FAIL (a/b/c FAIL, d PASS)

**Why Run 1 failed:** The spike measured the `/workflows` slash command, which
in Run 1's environment exposed only a workflow-history browser and reported
"isn't available in this environment" under print-mode invocation. The actual
runner — the `Workflow` tool — was not exercised. Run 2 re-measures against
the runner surface and produces a PASS verdict.

## Run 1 Setup

**Test epic:** `smoke-test-execute-multica-codex`

This is a real existing hive epic with two stories, satisfying
`gate_3_decisions.D6`'s preference for a real epic within the <=5-story bound.

| Story | Title | Intended change |
| --- | --- | --- |
| `stmc-1-create-marker` | Create `smoke-marker.txt` with a known timestamp | Create marker file |
| `stmc-2-append-line` | Append a known line to `smoke-marker.txt` | Append marker line |

**Persona team composition under test:**

| Persona | Backend from `hive.config.yaml` | Role |
| --- | --- | --- |
| `developer` | `codex` | Codex-routed creator |
| `reviewer` | `claude` | Review / verification |

The team includes one Codex-routed creator persona, satisfying the
architect+TPM requirement that the spike exercise Codex creator behavior.

**Run 1 invocation evidence:**

- `claude --version` returned `2.1.159 (Claude Code)`.
- Interactive `claude` showed `/workflows` as a built-in command described as
  "Browse dynamic workflow history (running and completed)".
- Selecting `/workflows` opened the Dynamic workflows dialog, which reported
  "No dynamic workflows in this session."
- `claude -p "/workflows" --output-format json --max-budget-usd 0.50
  --permission-mode dontAsk` returned:
  `/workflows isn't available in this environment.`
- `claude agents --json --cwd <plugin-hive-worktree>` returned `[]`.

The spike could not start a CC `/workflows` run. The command surface available
locally is a workflow-history browser, not a documented or scriptable workflow
creation/invocation primitive. Because no workflow run could be created, the
two-story test epic did not execute through `/workflows`.

## Run 1 — Criterion (a): Integration-Branch Contract

**Verdict:** FAIL

The spike could not verify shell-snippet injection or CC-native worktree
compatibility because no `/workflows` run could be started. The tested command
surface only exposed history browsing, and print-mode invocation reported the
command unavailable in this environment.

| Story | Expected evidence | Observed evidence | Verdict |
| --- | --- | --- | --- |
| `stmc-1-create-marker` | `/workflows` accepts integration-branch prompt contract or uses a compatible CC-native worktree primitive; integration branch advances with >=1 story commit | No workflow run could be created; no branch advance occurred | FAIL |
| `stmc-2-append-line` | `/workflows` accepts integration-branch prompt contract or uses a compatible CC-native worktree primitive; integration branch advances with >=1 story commit | No workflow run could be created; no branch advance occurred | FAIL |

## Run 1 — Criterion (b): Codex File Lists And Serial Adapter Commits

**Verdict:** FAIL

The spike confirmed the intended test team includes `developer` as a
Codex-routed creator, but it could not observe Codex creator output shape or
adapter-side serial commits because the `/workflows` run never started.

| Story | Expected evidence | Observed evidence | Verdict |
| --- | --- | --- | --- |
| `stmc-1-create-marker` | Codex creator returns a file list; no agent writes `.git`; adapter commits serially to the integration branch | No Codex creator was dispatched by `/workflows`; no file list or adapter commit was produced | FAIL |
| `stmc-2-append-line` | Codex creator returns a file list; no agent writes `.git`; adapter commits serially to the integration branch | No Codex creator was dispatched by `/workflows`; no file list or adapter commit was produced | FAIL |

## Run 1 — Criterion (c): Completion Signal And Failure Modes

**Verdict:** FAIL

The available failure signal is recoverable at the operator level: no background
workflow was created, no worktree mutation occurred, and `claude agents --json`
reported no active background sessions. However, `/workflows` did not provide a
run-level completion event, partial-failure state, resume token, or restart path
for the test epic because no run could be created.

## Run 1 — Criterion (d): Plugin-Shipped Skill Auto-Load

**Verdict:** PASS

`claude plugin list` showed `plugin-hive@plugin-hive` version `2.9.0` installed
at user scope and enabled. In a fresh interactive Claude Code session under
2.1.159, plugin-hive commands including `/execute` and `/status` appeared in
slash-command completion. A print-mode `/execute` probe loaded the plugin-hive
skill and returned plugin-specific execution preflight output rather than an
unknown-command error.

This verifies plugin-hive command auto-load for the locally installed
plugin-hive plugin under CLI-interactive 2.1.159. The tested version is newer
than the required 2.1.157 floor.

## Run 1 — Verdict Block

| Criterion | Verdict | Evidence cite | Plan B branch |
| --- | --- | --- | --- |
| (a) integration-branch contract honored | FAIL | `/workflows` could not create a workflow run; no story commit evidence exists | Do not select Q2 shell-snippet path yet; retain serial-commit gate fallback and require a separate `/workflows` creation-surface spike |
| (b) Codex file lists + serial adapter commits | FAIL | Codex-routed creator was identified, but no `/workflows` dispatch occurred | Keep architect serial-commit gate as mandatory; do not allow direct Codex `.git` writes |
| (c) completion signal + recoverable failure modes | FAIL | Failure is recoverable because no background sessions or mutations exist, but no workflow completion/resume surface was observed | First-party adapter cannot proceed until run creation and completion state are observable |
| (d) plugin-shipped skill auto-load | PASS | `plugin-hive@plugin-hive` enabled; `/execute` and `/status` auto-loaded in CLI-interactive session | Primary Layer-5 auto-load path may proceed; Mode D-a remains second-party fallback, not required by this evidence |

## Run 1 — Recommendations (superseded by Run 2)

1. Keep Slices 2-6 blocked at the maintainer gate. Criteria (a)-(c) failed
   because `/workflows` could not be invoked as an execution substrate in this
   environment.
2. Add a follow-up spike or maintainer-provided instruction for the actual CC
   dynamic-workflow creation primitive. The observed `/workflows` command is
   history-only.
3. Preserve the architect-v2 serial-commit gate as a non-negotiable design
   invariant. The spike produced no evidence that direct `/workflows` fan-out
   can safely honor Hive's integration-branch contract.
4. Treat plugin-hive CLI skill auto-load as validated for the installed
   plugin-hive plugin on Claude Code 2.1.159.
