# Research Brief: KG Repair + Activation

## Summary
KG is alive but anemic: required audit headline is 81 triples, 2 live predicates, and 1 source agent; raw density math says current throughput is 1.35 triples/day against a 6/day target (`.pHive/epics/kg-repair-activation/docs/research-raw.md:44`). Multiple unknown emit sites exist in the DAG walker, handoff, escalation-backfill, meta-team proposal supersede, and plan story-spec supersede paths, so "no emits" is wrong; the right framing is "emits exist but produce thin signal" (`.pHive/epics/kg-repair-activation/docs/research-raw.md:7`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:9`). Consumer surface `/hive:why` has a real ChromaDB fallback bug path at `kg_why.py:213` (`.pHive/epics/kg-repair-activation/docs/research-raw.md:36`).

## Current state (audit)
Audit state: 81 current triples, 2 live predicates, 1 source agent; import hard-codes `source_agent: orchestrator` (`scripts/kg-import-cycle-state.js:189`, `scripts/kg-import-cycle-state.js:198`, `scripts/kg-import-cycle-state.js:211`). Declared schema has `triples(subject,predicate,object,valid_from,valid_until,source_epic,source_agent)` and a `predicates` table (`hive/references/knowledge-graph-schema.md:172`, `hive/references/knowledge-graph-schema.md:183`). Declared predicates are 9, but only `decided`, `phase_failed`, and `phase_blocked` have confirmed live/import paths; `superseded` has helpers and doc callsites but user-provided DB state says none written (`.pHive/epics/kg-repair-activation/docs/research-raw.md:21`).

## Write surface - what exists
| emit site | file:line | predicate emitted | trigger condition | live? |
|---|---:|---|---|---|
| `kg_emit_cli` helper | `hive/lib/kg_emit_cli.py:25` | caller-supplied | CLI wrapper around event/supersede emit | Helper live |
| plan wait gate | `skills/plan/SKILL.md:247` | `phase_blocked` | structured-outline/design/H/V waiting gates | Documented path |
| plan story overwrite | `skills/plan/SKILL.md:326` | `superseded` via `story-spec` | story spec overwrite | Documented-only |
| escalation backfill | `skills/hive/skills/escalation-backfill/SKILL.md:56` | `phase_blocked` | canonical escalation story after backfill | Documented path |
| daily ceremony approval | `hive/workflows/steps/daily-ceremony/step-06-approve-plan.md:20` | `phase_blocked` | before approval wait | Documented path |
| meta-team proposal replace | `hive/workflows/steps/meta-team-cycle/step-03-proposal.md:52` | `superseded` via `proposal` | grouped proposal replaces prior proposal | Documented-only |
| direct emit helper | `hive/lib/kg_emit.py:65` | caller-supplied | `INSERT OR IGNORE` | Helper live |
| direct supersede helper | `hive/lib/kg_emit.py:138`, `hive/lib/kg_emit.py:149` | `superseded` | update prior triple, insert supersession | Helper live |
| DAG walker skip/failure | `hive/lib/dag_executor/executor/walker.py:944`, `hive/lib/dag_executor/executor/walker.py:1199` | `phase_blocked`, `phase_failed` | skip/trigger false or failure | Actually fires |
| handoff dispatch | `hive/lib/handoff/dispatch.mjs:90` | `phase_handoff` | handoff completion/timeout | Bugged: undeclared |

## Read surface - consumers
| consumer | file | what it reads | bug status |
|---|---|---|---|
| `kg_why` / `/hive:why` | `hive/lib/kg_why.py:74`, `hive/lib/kg_why.py:138` | sqlite strict/freeform plus optional ChromaDB rows | ChromaDB `RuntimeError` can propagate at `kg_why.py:213` |
| meta-optimize step-02c | `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md:79` | `phase_failed`, `phase_blocked`, `superseded` | Narrow predicate set |
| memory-loading | `skills/hive/skills/memory-loading/SKILL.md:79` | decision-context triples | No bug found |
| session-prompt-builder | `hive/lib/session-prompt-builder.js:35` | sqlite by `source_epic` | No bug found |
| miss-reason | `hive/lib/kg_signal/miss_reason.py:102` | current triples | No bug found |
| register-project/bootstrap | `skills/hive/skills/register-project/SKILL.md:66`, `scripts/kg-bootstrap-from-projects.js:209` | project registry, then cycle-state import | Registry-only write before bootstrap |

## Predicate inventory - gap analysis
| declared | has write path | actually emits | proposed status |
|---|---|---|---|
| `decided` | yes, importer | yes | keep |
| `superseded` | yes, helper/docs | not in provided DB state | wire-up |
| `assigned_to` | no | no | wire-up |
| `blocked_by` | no | no | wire-up |
| `depends_on` | no | no | wire-up |
| `phase_started` | no | no | wire-up |
| `phase_complete` | no | no | wire-up |
| `phase_failed` | yes, DAG walker | yes | keep |
| `phase_blocked` | yes, DAG walker/docs | yes | keep |

`phase_handoff` is emitted by `hive/lib/handoff/dispatch.mjs:90` but is not declared in the schema list at `hive/references/knowledge-graph-schema.md:183`, creating silent failures or constraint violations (`.pHive/epics/kg-repair-activation/docs/research-raw.md:9`).

## Density math
Current density is 1.35/day; target is 6/day, requiring +4.65/day or 4.44x (`.pHive/epics/kg-repair-activation/docs/research-raw.md:44`). Three levers: wire dormant write paths for `assigned_to`, `blocked_by`, `depends_on`, `phase_started`, and `phase_complete` (`.pHive/epics/kg-repair-activation/docs/research-raw.md:21`); add non-orchestrator source-agent emits for reviewer/tester/developer with new predicates `validated`, `tested`, `implemented` (`.pHive/epics/kg-repair-activation/docs/research-raw.md:40`); invoke existing supersede helpers on plan/proposal/memory replacements (`skills/plan/SKILL.md:321`, `hive/workflows/steps/meta-team-cycle/step-03-proposal.md:49`, `hive/lib/session-end.js:69`).

## /hive:why bug
Known crash: `RuntimeError: dictionary changed size during iteration` at `hive/lib/kg_why.py:213` inside `query_chromadb`; raw research found no local mutation in `query_chromadb` and notes records are list-converted in `_extract_chroma_response` (`.pHive/epics/kg-repair-activation/docs/research-raw.md:36`). The crash likely propagates from the ChromaDB provider called at line 213; bounded fix shape is catch `RuntimeError` and return `[]` in `_extract_chroma_response` or wrap the call site, about one file and about three lines (`.pHive/epics/kg-repair-activation/docs/research-raw.md:36`).

## inconsistency_risk_signals
- "Add more emit sites" vs scope_drift_emit_sites memory (memory clarified: was about scope_drift, NOT KG - tension may evaporate)
- Pin ~/.claude/hive vs paths.state_dir resolver
- Repair ChromaDB vs sqlite-only fallback path for /hive:why
- phase_handoff undeclared predicate bug
- "100% orchestrator" import is hardcoded - schema examples show architect/other source agents

## Recommendation seed (for design-discussion phase, not final)
1. Minimal repair - fix `/hive:why` bug + declare `phase_handoff` + wire superseded callers. About 3 stories. Density barely moves.
2. Repair + activate - minimal + add reviewer/tester/developer predicates + wire missing lifecycle emits. About 6-8 stories. Density hits target.
3. Repair + activate + co-locate - bundle 2 with optional graphify side-by-side stretch. About 9-11 stories.

Don't pick; design-discussion does that. This only frames the menu.

## Sources
Primary raw findings: `.pHive/epics/kg-repair-activation/docs/research-raw.md:5`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:7`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:9`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:13`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:17`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:21`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:36`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:40`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:44`, `.pHive/epics/kg-repair-activation/docs/research-raw.md:48`.

Original source anchors: `hive/lib/kg_emit_cli.py:25`, `hive/lib/kg_emit.py:65`, `hive/lib/kg_emit.py:149`, `hive/lib/dag_executor/executor/walker.py:944`, `hive/lib/dag_executor/executor/walker.py:1199`, `hive/lib/handoff/dispatch.mjs:90`, `hive/lib/kg_why.py:213`, `hive/references/knowledge-graph-schema.md:172`, `hive/references/knowledge-graph-schema.md:183`, `scripts/kg-import-cycle-state.js:189`, `scripts/kg-import-cycle-state.js:198`, `scripts/kg-import-cycle-state.js:211`.
