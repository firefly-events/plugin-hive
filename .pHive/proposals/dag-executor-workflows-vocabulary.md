# Proposal — DAG executor adopts Workflows vocabulary

**Status:** draft (pre-/plan)
**Author:** Don Matthews + co-pilot
**Date:** 2026-05-25
**Source:** spike `~/Code/spikes/claude-workflows/findings.md` (paper read of unannounced Claude Code Workflows tool)
**Scope:** vocabulary-only; zero implementation change

## Problem

Hive's DAG executor (10 episodes drafted under `.pHive/episodes/hive-dag-executor/`) defines its own orchestration vocabulary. Anthropic shipped an unannounced **Workflows** primitive in Claude Code 2.1.x with a well-shaped API: `phase()`, `pipeline()`, `parallel()`, `budget`, `agent()`, `schema`. Hive's executor reinvents the same shapes under different names.

When Workflows GAs (currently binary-gated beyond `CLAUDE_CODE_WORKFLOWS=1` env), zero-cost interop requires our vocabulary to match. Diverging now creates rename debt later.

## Target

Patch DAG executor episode YAMLs + design docs to use Workflows vocabulary verbatim where shapes overlap:

| Workflows | Hive equivalent |
|---|---|
| `phase(title)` | step group |
| `pipeline(items, ...stages)` | per-item streaming stages |
| `parallel(thunks)` | barrier fan-out |
| `agent(prompt, opts)` | leaf dispatch (Multica-routed) |
| `schema` (JSON Schema) | story AC contract |
| `budget.{total,spent,remaining}` | per-run token gate (see companion proposal) |

## Out of scope

- Implementation changes — orchestrator host stays Node + Multica HTTP; Workflows orchestrator host is sandboxed JS, fundamentally different layer
- Replacing Multica dispatch — Workflows' `'remote'` isolation exists in binary but disabled; not a substrate
- Full Workflows adoption as DAG executor — wrong size (Workflows = in-session ephemeral; Hive = persistent multi-session/multi-machine SDLC)

## Rationale

Per spike gap analysis:
- Workflows ≠ Hive at orchestration layer; cannot replace
- Workflows COULD slot in as leaf primitive inside Multica-dispatched Claude session post-GA
- Shared vocabulary is the only zero-cost adoption available today

Metric anchor: rename debt count at Workflows-GA day. Target = 0.

## Estimated cost

LOW. Documentation patch across 10 episode YAMLs + DAG executor design notes. No code, no test impact.
