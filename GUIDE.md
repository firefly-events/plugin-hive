# Hive — Maintainer Guide

## North Star

Hive is a composable preset for running an agentic SDLC inside Claude Code.
It packages teams, skills, workflows, review gates, memory, and task-tracking
adapters into a preset a maintainer can install into any project.

The substrate is deliberately separate from the preset. Plugin-hive defines
the operating system for planning, execution, and review; Multica provides the
user-directed substrate that runs implementation work without moving human
judgment out of the loop.

That reframe matters for maintenance:

- Hive stays composable. Skills and workflows remain small enough to replace,
  route around, or extend without rewriting the whole system.
- The user stays in charge. Human gates decide when plans are ready and when
  reviewed work is acceptable.
- Multica carries the execution substrate role. It owns the operational path
  for running implementation tasks while Hive keeps the workflow contract.

## Execution Model

The multica-substrate-adoption epic changed the default execution path without
changing the planning and review posture.

`/hive:plan` still runs interactively on the user's laptop. The planning team
reads the project, produces the design discussion and slice plan, and emits
agent-ready stories. The user remains present for the post-plan gate and can
approve, redirect, or ask for a rewrite before implementation starts.

`/hive:review` also remains interactive on the user's laptop. Review is still
the place where correctness, security, conventions, and domain fit are judged
before work is considered done. The post-review gate is preserved so the user
can accept the result, request fixes, or stop the run.

`/hive:execute` now routes through Multica. The command keeps Hive's execution
contract, but Multica becomes the substrate responsible for running the work
items that emerge from planning.

The practical model is:

- `/hive:plan` produces stories and waits at the post-plan human gate.
- `/hive:execute` dispatches approved work through Multica.
- `/hive:review` evaluates the result and waits at the post-review human gate.
- Task state stays attached to the issue or story that caused the run.

Multica uses a per-task workdir model. Each task gets an isolated working
directory so implementation context, generated files, logs, and recovery state
do not collide with adjacent tasks. Maintainers should treat that workdir as
the task's operational envelope rather than a shared global workspace.

Session resumption is part of the same model. A task can resume from its saved
session state instead of forcing the maintainer to reconstruct context from
scratch. That makes interruptions, rate limits, and staged review loops
recoverable without changing the story contract.

For repository state, Multica uses per-(agent, issue) clones. The clone key is
the pair of the executing agent and the issue or story it is serving. This
keeps parallel work from crossing streams and gives each agent a stable place
to continue its own task. When reviewing dispatch or clone behavior, start from
that pair rather than assuming a single shared checkout.

The two human gates are load-bearing:

- post-plan: approves the plan and story set before implementation starts.
- post-review: approves or redirects reviewed implementation work.

The migration moment for this model is the multica-substrate-adoption epic.
Earlier releases framed Sandcastle and GitHub Actions as the primary autonomous
execution path. In 2.6.0, Multica becomes the execution substrate, while the
older paths remain available as legacy options until their cleanup epic lands.

## First-time Setup

Run:

```text
/hive:multica-init
```

The command bootstraps Multica for the current project as a one-time setup
step. It is designed to be idempotent, so re-running it should refresh or
confirm the setup rather than corrupting local state.

Maintainers should point new adopters here before `/hive:kickoff`,
`/hive:plan`, or `/hive:execute` when they want the Multica substrate path.

## Legacy Execution Paths

Sandcastle and GH-Actions execution paths remain available for existing users
and for projects that already depend on them. Do not remove their docs or
runtime support as part of the Multica adoption story.

Those paths are now legacy primary-path framing. They are scheduled for
archival in the follow-on cleanup epic `sandcastle-adoption-followon`.

Until that cleanup completes, maintainers should:

- Keep Sandcastle and GH-Actions references accurate enough for existing users.
- Prefer Multica in new setup guidance.
- Avoid introducing new features that deepen the legacy path unless a release
  blocker requires it.

## References

- [README](README.md)
- [CHANGELOG](CHANGELOG.md)
- [.claude-plugin/plugin.json](.claude-plugin/plugin.json)
