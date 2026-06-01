# Phase 0 Capability Spike Findings

**Epic:** `cc-workflows-first-party`
**Story:** `cwfp-s1-1-phase0-capability-spike`
**Run timestamp:** `2026-06-01T05:39:42Z`
**Claude Code version:** `2.1.159`
**Verdict:** FAIL

## Spike Setup

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

**Invocation evidence:**

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

## Criterion (a): Integration-Branch Contract

**Verdict:** FAIL

The spike could not verify shell-snippet injection or CC-native worktree
compatibility because no `/workflows` run could be started. The tested command
surface only exposed history browsing, and print-mode invocation reported the
command unavailable in this environment.

| Story | Expected evidence | Observed evidence | Verdict |
| --- | --- | --- | --- |
| `stmc-1-create-marker` | `/workflows` accepts integration-branch prompt contract or uses a compatible CC-native worktree primitive; integration branch advances with >=1 story commit | No workflow run could be created; no branch advance occurred | FAIL |
| `stmc-2-append-line` | `/workflows` accepts integration-branch prompt contract or uses a compatible CC-native worktree primitive; integration branch advances with >=1 story commit | No workflow run could be created; no branch advance occurred | FAIL |

## Criterion (b): Codex File Lists And Serial Adapter Commits

**Verdict:** FAIL

The spike confirmed the intended test team includes `developer` as a
Codex-routed creator, but it could not observe Codex creator output shape or
adapter-side serial commits because the `/workflows` run never started.

| Story | Expected evidence | Observed evidence | Verdict |
| --- | --- | --- | --- |
| `stmc-1-create-marker` | Codex creator returns a file list; no agent writes `.git`; adapter commits serially to the integration branch | No Codex creator was dispatched by `/workflows`; no file list or adapter commit was produced | FAIL |
| `stmc-2-append-line` | Codex creator returns a file list; no agent writes `.git`; adapter commits serially to the integration branch | No Codex creator was dispatched by `/workflows`; no file list or adapter commit was produced | FAIL |

## Criterion (c): Completion Signal And Failure Modes

**Verdict:** FAIL

The available failure signal is recoverable at the operator level: no background
workflow was created, no worktree mutation occurred, and `claude agents --json`
reported no active background sessions. However, `/workflows` did not provide a
run-level completion event, partial-failure state, resume token, or restart path
for the test epic because no run could be created.

## Criterion (d): Plugin-Shipped Skill Auto-Load

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

## Verdict Block

| Criterion | Verdict | Evidence cite | Plan B branch |
| --- | --- | --- | --- |
| (a) integration-branch contract honored | FAIL | `/workflows` could not create a workflow run; no story commit evidence exists | Do not select Q2 shell-snippet path yet; retain serial-commit gate fallback and require a separate `/workflows` creation-surface spike |
| (b) Codex file lists + serial adapter commits | FAIL | Codex-routed creator was identified, but no `/workflows` dispatch occurred | Keep architect serial-commit gate as mandatory; do not allow direct Codex `.git` writes |
| (c) completion signal + recoverable failure modes | FAIL | Failure is recoverable because no background sessions or mutations exist, but no workflow completion/resume surface was observed | First-party adapter cannot proceed until run creation and completion state are observable |
| (d) plugin-shipped skill auto-load | PASS | `plugin-hive@plugin-hive` enabled; `/execute` and `/status` auto-loaded in CLI-interactive session | Primary Layer-5 auto-load path may proceed; Mode D-a remains second-party fallback, not required by this evidence |

## Recommendations

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
