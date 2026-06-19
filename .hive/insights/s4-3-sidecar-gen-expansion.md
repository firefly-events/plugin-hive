# Insights: s4-3-sidecar-gen-expansion

## lib/html-sidecar-gen.js required no changes

The existing `generateSidecar(markdownPath)` already handled Mermaid fenced blocks and
`<figure>` pass-through generically. H/V docs and structured-outline docs use the same
constructs, so "extend if needed" resolved to "no extension needed." The interface
contract (single mdPath arg, non-blocking Promise) was already correct for all three
doc types.

The takeaway: when a skill says "extend if needed", verify the lib code before assuming
extension is required — the existing implementation may already be general enough.

## Telemetry gate: no data to evaluate

`state/telemetry/doc-tokens.jsonl` did not exist in the repo at time of this story.
The format evaluation gate (markdown-embedded-HTML token cost vs HTML-primary) could not
be run. Future agents: if this file still doesn't exist when you need it, the telemetry
probe from doc-token-telemetry.js writes there on each doc write — run a /plan to
generate some data first.

## planning-format-contract.md: stubs vs. live rows

The doc-type table had `(S4+)` markers in rows that were stubs for this slice. When a
slice ships its feature, remove the stub marker and rewrite the cell to be concrete and
present-tense (not "added in S4", just "uses Mermaid `graph TD` per §3"). Also update
the preamble version list — it still said "S4+" alongside "S5+".

## Sidecar instruction placement in SKILL.md

Follow the design-discussion pattern exactly: sidecar invocation goes BETWEEN the write
instruction and the telemetry call, not after both. This matters because telemetry is
also non-blocking — readers scanning for the sidecar call expect it right after the
write, not buried after telemetry boilerplate.
