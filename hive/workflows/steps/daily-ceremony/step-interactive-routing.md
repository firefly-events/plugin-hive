# Phase 1.5 — Interactive Routing

> **Stub — full behavior implemented in story A.2.**
> This step file exists so the `interactive-routing` workflow step resolves
> correctly when `--interactive` is passed or `standup.interactive_default: true`
> is set. A.2 will replace this content with the routing protocol.

## Purpose

Give the operator a structured pause between the standup report and the
planning short-list. Before planning commits to a work queue the operator
can:

- Redirect focus to a different epic or story set.
- Inject new context discovered since the last session.
- Defer or reprioritize items surfaced in Phase 1.

## Current behavior (stub)

1. Print a brief notice: `Phase 1.5 — Interactive Routing active.`
2. Pause and invite the operator to enter any redirects or priority changes.
3. If the operator provides input, record it in cycle state as
   `interactive_routing_notes` for Phase 2 to consume.
4. If the operator provides no input (empty or timeout), proceed silently.

## Next step

`planning-select-work` (Phase 2) reads `interactive_routing_notes` from
cycle state and factors it into the planning short-list.
