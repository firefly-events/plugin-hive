FINDINGS:

FILES_EXAMINED:
- .pHive/proposals/work-tranche-roadmap.md:11-27 - Cluster C asks for language/tech-stack strategy first because the multi-runtime split ripples into state-dir-resolver and future cross-runtime work.
- CLAUDE.md:1-71 - root file is context-mode routing rules only; it is not an architecture charter, project charter, or locked tech-stack document.
- .pHive/CONTEXT.md:1-82 - domain glossary and conventions; names Hive as a Claude Code plugin, documents backend/substrate concepts, and lists conventions, but does not lock a canonical implementation language.
- hive/references/configuration.md:1-128 - configuration reference; documents config layers, task tracking, sessions, and maintainer boundary, but not a single tech-stack charter.
- hive/hive.config.yaml:76-376 - shipped baseline comments reference budget gate, task-tracking, git_flow, sessions, and sandcastle mode; it is config documentation, not a stack declaration.
- hive/lib/multica-story-dispatch/index.mjs:1-360 - Multica issue dispatch, story brief serialization, agent/backend routing, and integration-contract rendering; runtime critical.
- hive/lib/multica-story-dispatch/episode-sync.mjs:1-340 - polls Multica task status, captures messages, writes episode markers, and runs distill; runtime critical for Multica dispatch closure.
- hive/lib/multica-story-dispatch/distill.mjs:1-220 - collects agent self-capture, transcript, and git diff, then writes team/persona memory; runtime critical after Multica task terminal state.
- hive/lib/git_flow.mjs:13-140 - resolves branch/PR flow from config and origin probing; runtime integration helper.
- hive/lib/task-tracking-dispatch/index.ts:1-180 - TypeScript ESM dynamic adapter loader, ABI validator, and no-adapter telemetry; runtime dispatch if task tracking is enabled.
- hive/adapters/github/index.ts:1-430 - TypeScript GitHub task adapter; shells out to gh for auth and uses fetch against GitHub REST.
- hive/adapters/linear/index.ts:1-680 - TypeScript Linear task adapter; uses fetch against Linear GraphQL.
- hive/adapters/multica/index.ts:1-410 - TypeScript Multica task adapter; uses fetch against Multica issue API.
- hive/lib/multica-bootstrap/index.mjs:1-180 - Node bootstrap/reconcile logic for Multica agents, squads, skills, and autopilots.
- hive/lib/multica-agents-config/index.mjs:1-130 - Node parser/resolver for agent config and instruction paths.
- hive/scripts/session-invoke.mjs:1-180 - Node CLI bridge from Hive workflow payloads into managed Anthropic sessions.
- hive/lib/session-client.js:1-430 - CommonJS Anthropic Sessions/Messages client wrapper; imports @anthropic-ai/sdk.
- hive/lib/session-sse-reader.js:1-110 - CommonJS SSE stream reader for sessions.
- hive/lib/messages-session.js:1-230 - Messages API session implementation; imports @anthropic-ai/sdk.
- hive/lib/session-registry.js:1-190 - CommonJS YAML-backed session registry.
- hive/lib/session-episode-writer.js:1-90 - CommonJS episode writer for sessions.
- hive/lib/session-prompt-builder.js:1-330 - CommonJS prompt builder for session invocations.
- hive/lib/session-turn-builder.js:1-95 - CommonJS message/tool-result turn builder.
- hive/lib/session-end.js:1-310 - CommonJS session-end KG and SQLite closeout; imports better-sqlite3.
- hive/lib/sandcastle-provider.js:1-360 - CommonJS Sandcastle provider factory; creates podman/docker sandbox provider using @ai-hero/sandcastle.
- hive/lib/sandcastle-provider-loader.mjs:1-80 - ESM preloader for Sandcastle ESM exports, bridging into the CJS provider factory.
- hive/lib/sandcastle-worker-runner.js:1-290 - CommonJS Sandcastle worker runner; imports Sandcastle sandbox factories lazily.
- hive/lib/sandcastle-worker-schema.js:1-80 - CommonJS zod result schema for Sandcastle worker results.
- hive/lib/sandcastle-log-redaction.js:1-160 - CommonJS log redaction for Sandcastle output.
- hive/scripts/gate-claudecode-sandcastle.mjs:1-125 - Node audit gate blocking Sandcastle claudeCode() usage while upstream issue 191 is open.
- hooks/common.sh:1-140 - shared shell resolver for paths.state_dir and paths.target_project; runtime critical for hooks.
- hooks/check-agent-misuse.sh:1-80 - Claude Code PreToolUse shell hook that blocks story-level Agent misuse.
- hooks/metrics-agent-spawn.sh:1-160 - shell metrics emitter for agent spawn events.
- hooks/metrics-human-escalation.sh:1-150 - shell metrics emitter for human escalation events.
- hooks/metrics-execute-boundaries.sh:1-160 - shell metrics emitter for execute-boundary events.
- hooks/metrics-stop-dispatch.sh:1-150 - shell stop-hook metrics dispatcher and transcript token aggregation.
- hooks/metrics-token-capture.sh:1-150 - shell helper for per-agent token capture.
- hooks/stop-interrupt-capture.sh:1-25 - shell stop hook writing interrupt records.
- hive/lib/config.js:1-90 - JS config reader for emit_lifecycle_at with js-yaml fallback.
- hive/lib/config.py:1-95 - Python equivalent config reader for emit_lifecycle_at with PyYAML fallback.
- hive/lib/dag_executor/graph/loader.py:1-150 - Python YAML workflow graph loader.
- hive/lib/dag_executor/executor/dispatcher.py:1-60 - Python node dispatcher.
- hive/lib/dag_executor/executor/walker.py:1-430 - Python DAG walker, scheduler, predicate evaluation, and telemetry flow.
- hive/lib/dag_executor/run_state/store.py:1-180 - Python run_state persistence, validation, and atomic writes.
- hive/lib/metrics/core.py:1-180 - Python metrics envelope/event substrate.
- hive/lib/kg_emit.py:1-130 - Python KG triple emission.
- hive/lib/kg_emit_cli.py:1-80 - Python CLI for KG emission.
- hive/lib/kg_why.py:1-110 - Python KG explanation query helper.
- hive/lib/kg_metrics_writer.py:1-90 - Python metric-to-KG writer.
- hive/lib/scope_drift.py:1-170 - Python scope drift scoring.
- hive/lib/scope_drift_reader.py:1-170 - Python drift trend reader.
- hive/lib/metric_increment_cli.py:1-70 - Python metric registry CLI wrapper.
- hive/lib/skill_candidate_mine.py:1-170 - Python recurring-pattern mining.
- hive/lib/skill_candidate_rank.py:1-170 - Python candidate ranking and handoff helper.
- hive/lib/meta-experiment/envelope.py:1-35 - Python narrow mutation wrapper for experiment envelopes.

PATTERNS_OBSERVED:
- Pattern: Total language footprint | File: repository inventory | Detail: exact counts are Python 157, .mjs 66, .js 58, .ts 11, shell 23. Python is the plurality, but JS/TS is concentrated in integration surfaces.
- Pattern: JS/TS inventory by subsystem | File: hive/lib/multica-story-dispatch/ | Detail: 5 files; role is Multica dispatch, terminal polling, episode sync, and insight distill. Runtime-critical, load-bearing.
- Pattern: JS/TS inventory by subsystem | File: hive/lib/task-tracking-dispatch/ | Detail: 7 files including tests/fixtures; role is TypeScript ESM adapter dispatch and ABI validation. Runtime when task_tracking.adapter is configured.
- Pattern: JS/TS inventory by subsystem | File: hive/adapters/{github,linear,multica}/ | Detail: 6 files total including tests; role is external task-tracking adapters. Runtime only when selected.
- Pattern: JS/TS inventory by subsystem | File: hive/lib/multica-bootstrap/ | Detail: 5 files including tests; role is Multica bootstrap/reconciliation for agents, squads, skills, autopilots. Operational/runtime setup.
- Pattern: JS/TS inventory by subsystem | File: hive/lib/multica-agents-config/ | Detail: 2 files including test; role is parsing agent config and resolving instruction paths.
- Pattern: JS/TS inventory by subsystem | File: hive/lib/misc JS helpers | Detail: 34 files; roles include git_flow, sessions, Sandcastle, config, KG JS wrapper, OpenAI image MCP server, backlog mutation, scenarios, issue closeout, and release posting.
- Pattern: JS/TS inventory by subsystem | File: hive/scripts/ | Detail: 6 Node scripts; session invoke, reverse sync, status backfill, episode audit, gate-mode audit, and Sandcastle usage gate.
- Pattern: JS/TS inventory by subsystem | File: skills/ | Detail: 4 .mjs skill runners/scaffolders: context-snapshot, triage, sandcastle-gh-init, register-project. Operational skill entrypoints.
- Pattern: JS/TS inventory by subsystem | File: scripts/ | Detail: 5 JS/MJS files including KG bootstrap/import scripts and their tests. Mostly tooling/data migration, not steady-state critical path.
- Pattern: JS/TS inventory by subsystem | File: hive/workflows/steps/meta-team-cycle/ | Detail: 6 .mjs files including tests; role is meta-team signal weights and external research provider tooling.
- Pattern: Shell inventory by subsystem | File: hooks/*.sh | Detail: 8 hook scripts; load-bearing for Claude Code hook lifecycle, metrics, path resolution, and misuse prevention.
- Pattern: Shell inventory by subsystem | File: hive/scripts/*.sh + scripts/*.sh | Detail: 5 shell scripts; ChromaDB lifecycle, Act I gate check, and state migration. Operational/tooling.
- Pattern: Python runtime maturity | File: hive/lib/dag_executor/** | Detail: 81 Python files in DAG executor; it owns graph loading, routing, dispatch, pause/signal/token, isolation, run state, and tests.
- Pattern: Python runtime maturity | File: hive/lib/metrics/** | Detail: 6 Python files; metrics core, paths, yamlish parser, errors, and tests.
- Pattern: Python runtime maturity | File: hive/lib/meta-experiment/** | Detail: 18 Python files; experiment envelope, compare, promotion, rollback watch, closure validation, and tests.
- Pattern: Cross-runtime duplicate | File: hive/lib/config.js and hive/lib/config.py | Detail: same emit_lifecycle_at config read exists in JS and Python, proving config logic is already duplicated to serve both runtime families.
- Pattern: JS reason - runtime/interop | File: hive/lib/multica-story-dispatch/index.mjs:302 | Detail: dispatchStoryToPersonas uses Node fetch/AbortSignal and formats Codex/Multica issue payloads; no npm blocker, but it sits in the Multica execution path.
- Pattern: JS reason - runtime/interop | File: hive/lib/multica-story-dispatch/episode-sync.mjs:127,291 | Detail: polls Multica task endpoints, gathers messages, and writes episode markers; no npm blocker, but every Multica dispatch depends on equivalent behavior.
- Pattern: JS reason - historical/incidental plus runtime | File: hive/lib/multica-story-dispatch/distill.mjs:192 | Detail: mostly filesystem/git subprocess/YAML-free logic; portable to Python, but runtime-critical until ported.
- Pattern: JS reason - Node-only dependency | File: hive/lib/sandcastle-provider.js:156; hive/lib/sandcastle-provider-loader.mjs:62 | Detail: @ai-hero/sandcastle is a JS/TS package and its sandbox factories are imported from ESM/CJS bridges. This is the strongest non-incidental JS dependency.
- Pattern: JS reason - Node-only dependency | File: hive/lib/sandcastle-worker-schema.js:68 | Detail: zod schema is a JS validation dependency; portable conceptually to pydantic/jsonschema, but call sites are Sandcastle JS-side.
- Pattern: JS reason - SDK availability but runtime seam | File: hive/lib/session-client.js:60; hive/lib/messages-session.js:208 | Detail: @anthropic-ai/sdk has Python alternatives, but current session implementation and SSE handling are Node CommonJS modules.
- Pattern: JS reason - Node native dependency | File: hive/lib/session-end.js:298; scripts/kg-import-cycle-state.js | Detail: better-sqlite3 is used for synchronous SQLite access; Python stdlib sqlite3/APSW can replace the storage role, but not as a drop-in API.
- Pattern: JS reason - parser dependency | File: hive/lib/config.js:1-90; hive/lib/session-registry.js:1-190 | Detail: js-yaml is the broadest JS parser dependency; Python has PyYAML and repo already uses it in Python modules.
- Pattern: TS reason - runtime/interop and tooling | File: hive/lib/task-tracking-dispatch/index.ts:84; hive/adapters/*/index.ts | Detail: adapters are TypeScript source executed via tsx in tests and package bin entries. They can be ported, but current ABI module loader is ESM/TS-native.
- Pattern: Shell reason - host hook interop | File: hooks/check-agent-misuse.sh:1-80 | Detail: Claude Code hook scripts are shell entrypoints consuming JSON on stdin and using jq/grep; pure Python would still need shell shims or hook command rewrites.
- Pattern: Python can host core runtime | File: hive/lib/dag_executor/executor/walker.py:396 | Detail: workflow graph execution, scheduling, predicates, telemetry, and run-state resume already run in Python.
- Pattern: Context/charter gap | File: .pHive/CONTEXT.md:3,17,30,58-61 | Detail: documents glossary and operating conventions such as Codex/Claude backend split, not a locked stack or architecture charter.

CONSTRAINTS:
- Constraint: Multica dispatch is currently JS runtime-critical | Source: hive/lib/multica-story-dispatch/index.mjs:302 and episode-sync.mjs:127,291 | Impact: pure-Python requires a full reimplementation of dispatch, polling, message capture, episode sync, brief serialization, and distill behavior before JS can be removed from the main execution path.
- Constraint: Sandcastle is JS-native in current integration | Source: hive/lib/sandcastle-provider.js:156; hive/lib/sandcastle-provider-loader.mjs:62; hive/scripts/gate-claudecode-sandcastle.mjs:1-15 | Impact: pure-Python cannot preserve current Sandcastle execution mode without either keeping a Node bridge or replacing Sandcastle with a Python-controlled sandbox substrate.
- Constraint: Claude Code hooks are shell entrypoints today | Source: hooks/*.sh | Impact: even a Python-first architecture likely retains shell shims unless the hook registration contract changes.
- Constraint: Task-tracking adapter ABI is TypeScript/ESM today | Source: hive/lib/task-tracking-dispatch/index.ts:1-90; adapter package.json files | Impact: porting requires a new adapter loading/execution contract or Python adapter ABI, not just file translation.
- Constraint: No root package.json or lockfile found | Source: package manifest inventory | Impact: npm runtime dependencies are implicit/local-install dependencies outside a single locked project manifest; dependency audit cannot infer exact installed versions from repo root.
- Constraint: Python YAML safety convention differs from JS fallback | Source: hive/lib/config.py:1-95 and PyYAML docs | Impact: Python ports should use yaml.safe_load, matching current config.py behavior; avoid unsafe yaml.load.
- Constraint: Existing config docs are settings reference only | Source: hive/references/configuration.md:1-128 | Impact: no single source of truth declares language ownership, allowed runtimes, dependency policy, or porting conventions.

RISKS:
- Severity: high | Risk: Sandcastle feature parity blocks literal pure-Python | Evidence: @ai-hero/sandcastle imports in hive/lib/sandcastle-provider.js, sandcastle-provider-loader.mjs, sandcastle-worker-runner.js, sandcastle-log-redaction.js; upstream watch references Sandcastle issue 191.
- Severity: high | Risk: Removing JS before replacing Multica dispatch breaks every Multica-routed story | Evidence: issue brief says multica-story-dispatch/index.mjs and episode-sync.mjs drive every Multica dispatch; code confirms dispatchStoryToPersonas and pollTaskUntilTerminal/writeMulticaRunEpisode.
- Severity: medium | Risk: Dependency versions are not centrally locked | Evidence: only package.json files are under adapters/task-tracking-dispatch and only declare tsx devDependency; no root package.json or lockfile was found.
- Severity: medium | Risk: TypeScript adapters blur runtime/tooling boundary | Evidence: package.json bin points directly at index.ts and tests run node --import tsx; production execution likely depends on a TS runner or executable environment.
- Severity: medium | Risk: Cross-runtime config parity can drift | Evidence: hive/lib/config.js and hive/lib/config.py implement similar but not identical parsers and validation behavior.
- Severity: medium | Risk: Hook migration is easy to undercount | Evidence: shell hooks source common.sh, read config, use jq/awk/grep, and are tied to Claude Code hook stdin/stdout/exit semantics.
- Severity: low | Risk: Some JS helpers are probably incidental but still referenced in tests/docs | Evidence: scripts/kg-bootstrap-from-projects.js, scripts/kg-import-cycle-state.js, logo-exploration-validator.js, release_post.mjs are outside the core dispatch path but may support maintenance workflows.

UTILITIES_AVAILABLE:
- Utility: Python DAG executor | File: hive/lib/dag_executor/** | Relevance: demonstrates Python can host graph loading, scheduling, dispatching, telemetry, and persisted run state.
- Utility: Python metrics substrate | File: hive/lib/metrics/core.py | Relevance: demonstrates Python can own append/envelope metrics behavior.
- Utility: Python KG helpers | File: hive/lib/kg_emit.py; hive/lib/kg_emit_cli.py; hive/lib/kg_why.py; hive/lib/kg_metrics_writer.py | Relevance: Python already owns KG emission/query support used by workflow closeout and signals.
- Utility: Python config reader | File: hive/lib/config.py | Relevance: existing port target for JS config.js behavior; already handles JSON/YAML and safe fallback.
- Utility: Python meta-experiment modules | File: hive/lib/meta-experiment/** | Relevance: Python already owns multi-step meta-improvement state mutation and rollback/promotion helpers.
- Utility: Python scope drift modules | File: hive/lib/scope_drift.py; hive/lib/scope_drift_reader.py | Relevance: Python owns scoring and trend reading from metrics JSONL.
- Utility: Shell path resolver | File: hooks/common.sh | Relevance: current cross-runtime path/state-dir resolution anchor; any migration must either preserve or replace this contract.
- Utility: JS Multica dispatch test suite | File: tests/multica-story-dispatch.test.mjs; hive/lib/multica-story-dispatch/__tests__/*.test.mjs | Relevance: candidate parity suite for a Python dispatch port.
- Utility: JS/TS adapter tests | File: hive/adapters/*/test/adapter.test.ts; hive/lib/task-tracking-dispatch/test/dispatch.test.ts | Relevance: candidate ABI parity suite for a Python adapter port.

EXTERNAL_REFERENCES:
- Source: https://github.com/WiseLibs/better-sqlite3 | Relevance: better-sqlite3 package role | Key takeaway: package is Node-specific SQLite binding; Python has sqlite3/APSW alternatives, but API is not drop-in.
- Source: https://pyyaml.org/wiki/PyYAMLDocumentation | Relevance: Python YAML equivalent for js-yaml | Key takeaway: PyYAML provides safe_load for simple Python objects and should be the Python-side parser pattern.
- Source: https://github.com/yaml/pyyaml/wiki/PyYAML-yaml.load%28input%29-Deprecation | Relevance: YAML safety gotcha | Key takeaway: plain yaml.load without Loader is deprecated/unsafe; Python ports should retain safe_load behavior.
- Source: https://tsx.hirok.io/ | Relevance: tsx role in TypeScript adapters | Key takeaway: tsx is a Node enhancement for running TypeScript/ESM; it is tooling/runtime support, not business logic.
- Source: https://www.npmjs.com/package/tsx | Relevance: package manifest devDependency | Key takeaway: repo uses tsx as dev/test runner for .ts adapter modules.
- Source: https://www.npmjs.com/package/%40anthropic-ai/sdk | Relevance: @anthropic-ai/sdk package role | Key takeaway: current JS session code uses Anthropic's TypeScript SDK; Python SDK alternatives exist but require a real client rewrite.
- Source: https://www.npmjs.com/package/js-yaml | Relevance: js-yaml package role | Key takeaway: JS YAML parsing dependency has mature Python equivalents.

UNANSWERED_QUESTIONS:
- Is @ai-hero/sandcastle intentionally in the supported public stack long-term, or is it an optional maintainer-only execution mode that can remain outside a pure-Python core?
- Where are npm dependencies installed/pinned for normal development? No root package.json or lockfile was found in this branch.
- Should task-tracking adapters remain CLI/process ABI modules, or can a Python-native adapter ABI replace the ESM dynamic-import contract?
- Does Multica platform require Node clients anywhere outside this repository, or can the current fetch-based JS code be ported directly to Python HTTP clients?
- Is "pure-Python" meant literally no Node process at runtime, or Python-first with shell hooks and optional JS bridges?

inconsistency_risk_signals:
- Signal: hidden assumption | Where: user requirement | Detail: "pure-Python" conflicts with currently JS-native Sandcastle execution mode unless Sandcastle is optional or replaced.
- Signal: runtime seam mismatch | Where: hive/lib/multica-story-dispatch/index.mjs + episode-sync.mjs | Detail: core Multica dispatch is JS despite Python already owning DAG execution.
- Signal: convention violation risk | Where: hooks/*.sh | Detail: shell hooks will remain shell-shaped even if internal logic is moved to Python.
- Signal: dependency governance gap | Where: package manifest inventory | Detail: runtime npm imports exist but no root lockfile records their versions.
- Signal: duplicate implementation drift | Where: hive/lib/config.js and hive/lib/config.py | Detail: config parsing exists in both languages with similar but not identical behavior.
- Signal: posture mismatch | Where: CLAUDE.md vs requested charter | Detail: root CLAUDE.md is operational context-mode routing, not the expected architecture/tech-stack charter.
- Signal: vocabulary mismatch | Where: .pHive/CONTEXT.md | Detail: "Backend" means execution backend (Claude/Codex), not language/runtime backend.

LANGUAGE_INVENTORY_BY_SUBSYSTEM:
- Python core: 157 files total. Major clusters: hive/lib/dag_executor (81), tests (35), hive/lib/meta-experiment (18), hive/lib/metrics (6), KG/scope/config helpers. Role: workflow execution, routing, run state, metrics, KG, scope drift, skill mining/ranking, meta-experiment logic.
- JS/MJS/TS runtime/tooling: 135 files total. Main clusters: hive/lib/misc JS helpers (34), tests JS/MJS (53), multica-story-dispatch (5), task-tracking-dispatch (7), adapters (6), multica-bootstrap (5), scripts (11), workflow meta-team helpers (6), skills runners/scaffolders (4).
- Shell: 23 files total. Main clusters: hooks (8), hive/scripts ChromaDB/Act I lifecycle (4), tests shell (8), state migration and fixtures. Role: Claude Code hooks, metrics emission, local sidecars, migration, tests.

WHY_JS_PER_CLUSTER:
- hive/lib/multica-story-dispatch: reason b/c. Runtime/interop critical because it drives Multica issue/task APIs and Codex brief injection; historical/incidental because implementation uses only Node standard APIs plus local modules. Load-bearing runtime.
- hive/lib/session-* and messages-session.js: reason a/b. Uses @anthropic-ai/sdk and Node SSE/HTTP patterns; Python equivalent SDK exists but not drop-in. Load-bearing when sessions/messages substrate is enabled.
- hive/lib/sandcastle-*: reason a/b. Uses @ai-hero/sandcastle, ESM/CJS interop, podman/docker sandbox factories, and JS-native Sandcastle abstractions. Load-bearing for Sandcastle execution mode.
- hive/lib/task-tracking-dispatch + adapters: reason b/c. ESM dynamic import and TypeScript ABI modules are JS-native today; adapter logic itself is HTTP/CLI and portable. Load-bearing only when task_tracking.adapter is configured.
- hive/lib/multica-bootstrap + multica-agents-config: reason b/c. Operational Multica bootstrap with Node child_process/fs/crypto; portable but currently Node setup path. Runtime/setup, not per-step dispatch once bootstrapped.
- hive/lib/git_flow.mjs: reason c. Historical/incidental; uses fs/path/child_process only. Runtime integration helper, trivial/medium port.
- hive/scripts/*.mjs: reason b/c. CLI scripts use Node fs/path/process and local JS libs; session-invoke is load-bearing when sessions are enabled, others are audit/backfill/tooling.
- scripts/kg-*.js: reason a/c. Uses js-yaml and better-sqlite3 for one-off KG import/bootstrap; tooling/migration, not steady-state runtime.
- skills/*/run.mjs and scaffold.mjs: reason b/c. Skill entrypoints are Node scripts using filesystem/process APIs; portable, mostly operational.
- hive/workflows/steps/meta-team-cycle/*.mjs: reason c. Meta-team calculation/provider helpers; portable tooling.
- hooks/*.sh: reason b. Claude Code hook entrypoint/host interop and shell environment; not JS, but a separate non-Python runtime that pure-Python must account for.

RUNTIME_SEAMS:
- Must be reimplemented to go literal pure-Python: hive/lib/multica-story-dispatch/index.mjs, episode-sync.mjs, distill.mjs; hive/lib/session-client.js/messages-session.js/session-sse-reader.js/session-registry.js/session-episode-writer.js/session-prompt-builder.js/session-turn-builder.js/session-end.js if sessions/messages remain; hive/lib/task-tracking-dispatch/index.ts plus selected adapters if task tracking remains; hive/lib/sandcastle-provider.js/sandcastle-provider-loader.mjs/sandcastle-worker-runner.js/sandcastle-worker-schema.js if Sandcastle remains.
- Could be ported after core migration: hive/lib/git_flow.mjs, multica-bootstrap, multica-agents-config, story-status, multica-issue-closer, reverse-sync/backfill/audit scripts, skill runners, meta-team signal helpers.
- Could remain as shell shims even in Python-first design: hooks/common.sh, check-agent-misuse.sh, metrics hooks, ChromaDB lifecycle scripts, state migration script.
- Build/tooling/test-only JS/TS: adapter tests/fixtures, multica-story-dispatch tests, Sandcastle tests, smoke scripts, workflow helper tests. These should follow whatever runtime owns the corresponding production code.

NPM_DEPENDENCY_AUDIT:
- @ai-hero/sandcastle | Imports: sandcastle-provider.js, sandcastle-provider-loader.mjs, sandcastle-worker-runner.js, sandcastle-log-redaction.js | Role: sandbox/worktree execution provider | Python equivalent: no direct equivalent found in codebase; would require replacement sandbox orchestration or Node bridge | Blocker: hard for literal pure-Python with Sandcastle feature parity.
- @anthropic-ai/sdk | Imports: session-client.js, messages-session.js | Role: Anthropic Sessions/Messages API client | Python equivalent: Anthropic Python SDK exists conceptually; repo does not include a Python implementation | Blocker: not hard, medium rewrite.
- better-sqlite3 | Imports: session-end.js, scripts/kg-import-cycle-state.js | Role: synchronous SQLite access | Python equivalent: sqlite3 stdlib or APSW | Blocker: not hard, but no drop-in API; medium rewrite for call sites and tests.
- js-yaml | Imports: config.js, dreaming-replay.js, external/github-issues-adapter.js, logo-exploration-validator.js, multica-bootstrap/index.mjs, session-client.js, session-episode-writer.js, session-registry.js, KG scripts | Role: YAML read/write | Python equivalent: PyYAML/ruamel.yaml; repo already uses PyYAML-style imports | Blocker: no.
- zod | Imports: sandcastle-worker-schema.js | Role: result schema validation | Python equivalent: pydantic, dataclasses + jsonschema, or manual validation | Blocker: no, but coupled to Sandcastle worker path.
- tsx | Manifests: hive/adapters/*/package.json, hive/lib/task-tracking-dispatch/package.json | Role: TypeScript runner for tests/adapter modules | Python equivalent: not applicable; disappears if adapters are ported | Blocker: no, tooling/runtime support only.
- openai | Dynamic require in hive/lib/openai-image-mcp-server.js | Role: optional logo/image MCP server client | Python equivalent: OpenAI Python SDK exists | Blocker: no for core Hive; optional feature rewrite.

PYTHON_SIDE_MATURITY:
- DAG executor is Python and mature enough to own workflow execution concerns: graph loader, validator, routing grammar/parser/evaluator, trigger rules, dispatcher, walker, handlers, telemetry, run IDs, run-state persistence, resume, pause, isolation/worktree, and tests.
- Metrics are Python and mature enough to own event/envelope behavior: core metrics, yamlish, paths, errors, tests.
- KG and signal helpers are Python: kg_emit, kg_emit_cli, kg_why, kg_metrics_writer, kg_signal, scope_drift, scope_drift_reader.
- Meta-experiment and meta-optimize support are Python: envelope, compare, promotion adapters, rollback watch, closure validator, baselines, metric registry, and run.py.
- Python config.py already mirrors part of JS config.js, showing Python can participate in shared runtime config.

CLAUDE_MD_CHARTER:
- Confirmed: root CLAUDE.md is context-mode-only. Evidence: title is "context-mode - MANDATORY routing rules"; sections are blocked commands, redirected tools, tool hierarchy, subagent routing, output constraints, and ctx commands.
- Other architecture/stack-adjacent docs: .pHive/CONTEXT.md is a glossary/conventions file; hive/references/configuration.md is a config reference; hive/references/test-swarm-architecture.md exists but is test-swarm specific; hive/hive.config.yaml documents shipped settings in comments.
- Gap: no single source declares supported implementation languages, runtime ownership by subsystem, npm/Python dependency policy, adapter ABI language contract, or migration conventions.

MIGRATION_COST_TIERS:
- trivial-port: hive/lib/git_flow.mjs; hive/scripts/audit-episode-markers.mjs; hive/scripts/gate-mode-audit.mjs; skills/context-snapshot/run.mjs; skills/triage/run.mjs; workflow meta-team signal helpers. Reason: fs/path/process/JSON/YAML logic with mature Python equivalents.
- medium: multica-bootstrap, multica-agents-config, session registry/episode/prompt/turn builders, config.js callers, JS KG scripts, logo/release/backlog/scenario helpers. Reason: mostly portable logic, but needs parity tests and cross-runtime config/path compatibility.
- hard: multica-story-dispatch, episode-sync, distill, task-tracking-dispatch + adapters, session-client/messages-session/SSE, session-end SQLite closeout. Reason: load-bearing runtime seams, external HTTP/SDK behavior, episode/message contracts, and adapter ABI compatibility.
- blocked/conditional: Sandcastle provider/loader/worker path. Reason: current execution mode is built around @ai-hero/sandcastle JS APIs; literal pure-Python either drops/replaces Sandcastle or keeps a Node bridge.

VALIDATION NOTE:
  Checked: better-sqlite3, js-yaml, PyYAML, tsx, @anthropic-ai/sdk, @ai-hero/sandcastle, zod, Python sqlite3/PyYAML equivalents, repo package manifests.
  Source: web (reason: context7 MCP tools were not available in this Codex session; web search/fetch fallback used) + codebase.
  Confidence: medium.
  Findings: no npm package besides @ai-hero/sandcastle appears to be a categorical language blocker; most dependencies have mature Python equivalents or are tooling-only. The decisive blocker is not data parsing or SQLite, but JS-native runtime integration around Sandcastle plus the need to reimplement load-bearing Multica/session/task-tracking seams before JS can be removed.
