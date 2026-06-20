FINDINGS:

FILES_EXAMINED:
- .gitignore:1-216 -- Blanket-ignores `.pHive/*`, then allowlists specific state subtrees, metrics, audit fixtures, and the new artifact-lifecycle epic. Relevant because tracked vs ignored state affects whether age-archival by move creates Git deletions.
- hooks/common.sh:1-149 -- Shared resolver for `paths.state_dir` and `paths.target_project`. Relevant because hooks that use this can write outside `.pHive`, but many skills still hardcode `.pHive`.
- hive/references/state-relocation.md:30-49 -- Documents current resolver coverage and explicitly says many skills/workflows still reference `.pHive/` directly.
- skills/plan/SKILL.md:25-32,44-69,77-113,160-204,794-809,946-1049,1052-1099 -- Planning writer contract for project-profile placeholder, gate-lift metrics, epic docs, story YAML, `.gitignore` allowlisting, post-run audits, and scope-drift events.
- skills/ship/SKILL.md:23-29,48-75,124-170,251-290 -- Ship contract for resolving `${HIVE_STATE_DIR}`, identifying target epics/stories, release artifacts, and final `status: shipped` writes.
- hive/lib/story-status.mjs:1-21,91-95,118-131,174-245,258-287 -- Derived story status helper. Relevant because YAML `status:` is advisory and stale by design.
- hive/references/episode-schema.md:5-30,46-71,73-120 -- Episode marker path/schema, marker-derived story status, and Multica marker/message sidecar requirements.
- hive/references/story-yaml-schema.md:12-18,28-34,56-73,117-145,476-555,556-619 -- Story/epic schema, advisory status warning, manual verdict block, epic index, version bump, and test scenario link.
- hive/references/status-lifecycle.md:19-65,84-127 -- Canonical story lifecycle and transition ownership. Relevant terminal story state is `shipped`, owned by `/ship`.
- hive/references/cycle-state-schema.md:5-12,95-132,185-237,238-283,322-349,351-389 -- Cycle state storage, phase records, routing decisions with 7-day suppression, terminal handoff log, run-state split, and autonomous cycle block.
- hive/lib/dag_executor/run_state/store.py:1-17,52-58,84-145,179-257 -- DAG run-state writer. Defaults to `.pHive/runs`, writes atomically, terminal statuses freeze, suspended/failed are resumable but completed is not.
- hive/lib/dag_executor/executor/telemetry.py:1-23,76-88,91-159 -- Executor telemetry writer to metrics events via `resolve_metrics_path`.
- hive/lib/metrics/paths.py:9-40 -- Metrics root resolver. Defaults to repo `.pHive/metrics`, not `paths.state_dir`; can be overridden only by `METRICS_ROOT`.
- hive/lib/metrics/core.py:71-90,94-122,268-275 -- Metrics events/envelope writer; append-only JSONL under `events/` and YAML envelopes under `experiments/`.
- hooks/metrics-stop-dispatch.sh:1-9,64-84,155-225 -- Stop-hook metrics writer under resolved `<state_dir>/metrics/events/stop-<session>.jsonl`.
- hooks/metrics-token-capture.sh:1-29,77-84,123-160,269-328 -- Token capture writer under resolved `<state_dir>/metrics/events/token-<session>.jsonl`, reading Claude session JSONL and subagent sidecars from `~/.claude/projects/...`.
- hooks/metrics-agent-spawn.sh:1-16,67-76,153-160 -- Agent-spawn metric writer under resolved `<state_dir>/metrics/events/<run_id>-spawn.jsonl`.
- hooks/metrics-human-escalation.sh:1-18,65-72,148-152 -- Human escalation metric writer under resolved `<state_dir>/metrics/events/human-escalation.jsonl`.
- hooks/metrics-execute-boundaries.sh:1-18,72-81,143-219 -- Execute boundary metric writer under resolved `<state_dir>/metrics/events/<run_id>-execute-boundaries.jsonl`.
- hive/lib/scope_drift.py:93-165 -- Scope-drift score writer; appends a metrics event through `hive.lib.metrics.core.append_event`.
- hive/lib/kg_metrics_writer.py:13-15,50-108,126-151 -- KG metrics buffer/flush writer to `.pHive/metrics/kg/<cycle_id>.jsonl` and optional report rollup line.
- hive/scripts/gate-mode-audit.mjs:1-6,42-73,110-136 -- Reads metrics events and writes `.pHive/meta-team/gate-mode-recommendation.md`.
- skills/triage/run.mjs:14-26,28-36,138-159,399-421,430-518 -- Triage queue writer and state-machine transitions for `.pHive/triage/queue.yaml`.
- hive/references/triage-queue-schema.md:1-12,63-91 -- Triage queue schema, canonical states, warning-only creation, and single-writer invariant.
- hive/lib/multica-story-dispatch/episode-sync.mjs:8-10,127-210,291-376 -- Multica task polling and episode marker/messages sidecar writer under `${hiveStateDir}/episodes/<epic>/<story>/`.
- hive/lib/multica-story-dispatch/distill.mjs:75-118,120-190,192-237 -- Distill reads self-capture/transcripts/diffs and writes `.pHive/team-memories/<epic>/<story>.md` plus promoted agent memories under `~/.claude/hive/memories`.
- skills/context-snapshot/run.mjs:1-12,68-83 -- Context snapshot CLI writes `.pHive/context-snapshot.json` when `--write` is used; currently passes repo root as `stateDir`.
- hive/lib/release_post.mjs:20-25,105-133,240-279 -- Release artifact generator honors `HIVE_STATE_DIR` env or `.pHive` default and writes `.pHive/releases/<release-id>/{post.md,video-script.md,post-ideas.md}`.
- hive/lib/kg_emit.py:15-18,35-95,98-164 -- KG writer to `~/.claude/hive/kg.sqlite` or `HIVE_KG_SQLITE_PATH`, plus best-effort KG metrics buffering.
- hive/lib/chromadb-wrapper.js:1-10,24-34,37-73,168-206 -- ChromaDB wrapper reads sidecar port under `~/.claude/hive/chromadb.port`, ensures collection, and upserts documents to the Chroma sidecar.
- hive/scripts/chromadb-start.sh:1-13,18-23,107-145 -- ChromaDB sidecar lifecycle state writer under `~/.claude/hive/{chromadb.lock,pid,port,log,lockdir}`.
- hive/scripts/chromadb-stop.sh:1-10,23-45 -- ChromaDB sidecar cleanup removes lock/pid/port files and lockdir, but does not purge indexed collection data.
- hive/references/knowledge-graph-schema.md:1-4,17-43,98-131,168-194 -- KG SQLite schema, controlled predicates, valid_until convention, bootstrap DDL, and best-effort write behavior.
- hive/references/memory-store-interface.md:19-25,30-43,47-63,67-80,123-139,155-163 -- MemoryStore read/write/compile/staleness/KG/query contract; stale memories are warnings, not auto-deletions.
- hive/references/agent-memory-schema.md:5-33,87-100,153-171,172-233,303-377 -- Agent memory, team memory, TTL warning, staged insight, promotion, cleanup, and loading paths.
- hive/references/insight-capture.md:1-13,17-37,51-63,110-118 -- Agent insight staging format under `.pHive/insights/<epic>/<story>/`.
- skills/design/SKILL.md:27-35,47-52,72-104,141-147 -- Design artifacts under `.pHive/design/<topic>/` and index handoff. Re-running overwrites latest.
- hive/workflows/steps/test-swarm/step-03-worker.md:5-10,38-45,57-83,92-141,153-160 -- Test artifact writer contract for `.pHive/test-artifacts/<epic>/<story>/` logs/screenshots/results.
- hive/workflows/steps/test-swarm/step-08-promote.md:1-10,53-103,105-140 -- Test baseline promotion and local archive copy under `.pHive/test-artifacts/<epic>/<story>/archive/`.
- hooks/stop-interrupt-capture.sh:1-21 -- Stop interrupt writer under resolved `<state_dir>/interrupts/<timestamp>.yaml`.

PATTERNS_OBSERVED:
- Pattern: State-dir resolver coverage is partial | File: hooks/common.sh:125-137; hive/references/state-relocation.md:30-49 | Detail: Shell hooks and docs know about `paths.state_dir`; several Python/JS modules still default directly to `.pHive`.
- Pattern: Git-tracked state is allowlist-based | File: .gitignore:1-216 | Detail: `.pHive/*` is ignored globally, then selected epics/episodes/cycle-state/metrics/audits are re-included. New archival moves can create Git-visible deletions for allowlisted classes.
- Pattern: Story status is derived from episodes/git, not story YAML | File: hive/lib/story-status.mjs:11-21; hive/references/episode-schema.md:60-71 | Detail: `status:` in story YAML is intentionally advisory and can lag real progress.
- Pattern: `/ship` is the only shipped writer | File: skills/ship/SKILL.md:280-290; hive/references/status-lifecycle.md:49-65 | Detail: The reliable terminal signal for archiving shipped stories is `/ship` writing `status: shipped`, `shipped_at`, and `release_id` to story YAML after release artifacts exist.
- Pattern: Runtime JSONL metrics append without retention | File: hooks/metrics-stop-dispatch.sh:155-225; hooks/metrics-token-capture.sh:269-328; hive/lib/metrics/core.py:71-79 | Detail: Metrics are append-only JSONL carriers with no TTL/prune path found.
- Pattern: DAG run-state has terminal/frozen semantics | File: hive/lib/dag_executor/run_state/store.py:179-257 | Detail: `completed` freezes irrevocably; `failed` and `suspended` can be unfrozen for deliberate resume, so an archival sweep must not treat all frozen states equally.
- Pattern: Multica episodes include transcript sidecars | File: hive/lib/multica-story-dispatch/episode-sync.mjs:303-352 | Detail: `multica-run.yaml` and `multica-run.messages.jsonl` are written together; docs/verdict completion depends on committed artifacts plus terminal task state.
- Pattern: Memories are forever-by-design despite TTL fields | File: hive/references/agent-memory-schema.md:87-100; hive/references/memory-store-interface.md:67-80 | Detail: TTL surfaces staleness warnings only; stale memories are not auto-deleted.
- Pattern: Existing archive is manual/in-repo, not lifecycle sweep | File: hive/workflows/steps/test-swarm/step-08-promote.md:91-103; .pHive/meta-team/archive paths observed | Detail: Test-swarm copies results into an `archive/` subdir; meta-team has dated archives, but there is no generic age-based move-to-temp archival code.

ARTIFACT_INVENTORY:
- Artifact class: Epic index files | Path/glob: `.pHive/epics/<epic-id>/epic.yaml` | Writer: `/plan` emits epic index, `skills/plan/SKILL.md:1010-1024`; `/ship` reads it, `skills/ship/SKILL.md:48-75` | Lifecycle today: allowlisted per epic in `.gitignore`; never auto-cleaned | Classification: age-archivable after all stories shipped/epic closed.
- Artifact class: Story spec files | Path/glob: `.pHive/epics/<epic-id>/stories/*.yaml` | Writer: `/plan` story template, `skills/plan/SKILL.md:946-1008`; `/ship` writes shipped projection, `skills/ship/SKILL.md:280-290`; tester may update `manual_verdict`, `hive/references/story-yaml-schema.md:117-145` | Lifecycle today: allowlisted per epic; `status:` can be stale except `/ship` projection | Classification: age-archivable after story `status: shipped` or equivalent closed signal.
- Artifact class: Planning docs | Path/glob: `.pHive/epics/<epic-id>/docs/*.md` | Writer: `/plan` Phase A/B/A2/H/V/outline docs, `skills/plan/SKILL.md:188-204,1036-1049` | Lifecycle today: allowlisted per epic; never cleaned | Classification: age-archivable after epic shipped/closed.
- Artifact class: Episode markers | Path/glob: `.pHive/episodes/<epic-id>/<story-id>/*.yaml` | Writer: workflow agents per schema, `hive/references/episode-schema.md:5-30`; Multica writer, `hive/lib/multica-story-dispatch/episode-sync.mjs:291-352` | Lifecycle today: tracked only for allowlisted episode subtrees; marker-derived status is source of truth; no cleanup | Classification: age-archivable after story shipped/closed, but do not archive active/in-review stories because status derivation reads them.
- Artifact class: Episode sidecar transcripts | Path/glob: `.pHive/episodes/<epic-id>/<story-id>/multica-run.messages.jsonl`, `*.messages.jsonl` | Writer: Multica episode sync, `hive/lib/multica-story-dispatch/episode-sync.mjs:303-352`; schema requires docs/verdict tasks include sidecar, `hive/references/episode-schema.md:115-120` | Lifecycle today: local/tracked follows episode subtree allowlist; no cleanup | Classification: age-archivable with corresponding episode marker after shipped/closed.
- Artifact class: DAG run-state | Path/glob: `.pHive/runs/<run-id>/run_state.yaml` | Writer: `hive/lib/dag_executor/run_state/store.py:136-145` | Lifecycle today: default hardcoded `.pHive/runs`; no cleanup in branch; prototype sdr-8 will add terminal weekly archival | Classification: age-archivable when terminal `completed|failed|cancelled` older than threshold, but exclude running/suspended and be cautious with resumable `failed`.
- Artifact class: Metrics event streams | Path/glob: `.pHive/metrics/events/*.jsonl` or `<state_dir>/metrics/events/*.jsonl` | Writers: metrics hooks, executor telemetry, scope drift, metrics core; examples `hooks/metrics-stop-dispatch.sh:155-225`, `hooks/metrics-execute-boundaries.sh:143-219`, `hive/lib/dag_executor/executor/telemetry.py:76-88`, `hive/lib/scope_drift.py:148-165` | Lifecycle today: most metrics dir tracked except runtime stop/spawn ignores in `.gitignore:117-127`; append-only; no cleanup | Classification: age-archivable after observation windows / post-run audit consumption; ambiguous thresholds.
- Artifact class: Metrics experiment envelopes | Path/glob: `.pHive/metrics/experiments/*.yaml` | Writer: `hive/lib/metrics/core.py:82-122,268-275` | Lifecycle today: tracked; decisions become closed/immutable after required fields, no archival | Classification: age-archivable after associated experiment/epic closed and no active regression watch.
- Artifact class: KG metrics JSONL | Path/glob: `.pHive/metrics/kg/<cycle_id>.jsonl` | Writer: `hive/lib/kg_metrics_writer.py:50-108` | Lifecycle today: tracked; append-only/idempotent; no cleanup | Classification: age-archivable as metrics evidence after cycle/epic close, not forever-retained KG source.
- Artifact class: Audits and proof artifacts | Path/glob: `.pHive/audits/**`, `.pHive/specialist-phases/**`, `.pHive/upstream-watch/**` | Writers: `/plan` post-run audits, `skills/plan/SKILL.md:794-809`; gate-mode audit reads events and writes recommendations, `hive/scripts/gate-mode-audit.mjs:110-136`; specialist skills write verdicts per tracked tree | Lifecycle today: selected audit trees tracked; no generic cleanup | Classification: age-archivable after audited epic/story shipped or upstream watch resolved; `upstream-watch` may need explicit closed/resolved signal.
- Artifact class: Cycle state | Path/glob: `.pHive/cycle-state/<epic-id>.yaml`, optional `_standup.yaml` | Writer: orchestrator per schema, `hive/references/cycle-state-schema.md:135-146`; interactive routing appends entries, `hive/references/cycle-state-schema.md:185-237`; terminal handoff appends entries, `hive/references/cycle-state-schema.md:238-283` | Lifecycle today: selected files tracked; routing entries self-expire but are not removed | Classification: age-archivable after epic shipped/closed and no active routing suppressions/handoffs.
- Artifact class: Triage queue | Path/glob: `.pHive/triage/queue.yaml` | Writer: `skills/triage/run.mjs:138-159,399-421,430-518`; schema states single writer, `hive/references/triage-queue-schema.md:84-91` | Lifecycle today: default ignored unless manually tracked; closed items remain in queue; no prune | Classification: age-archivable by closed entries only, but current storage is a single mixed active/closed file, so entry-level compaction or queue splitting is needed before move-archive.
- Artifact class: Staged insights | Path/glob: `.pHive/insights/<epic-id>/<story-id>/*.md` or legacy `.yaml` | Writer: agents per `hive/references/insight-capture.md:1-13,51-63`; session-end evaluates/cleans per `hive/references/agent-memory-schema.md:221-233` | Lifecycle today: staging is supposed to be cleaned after promotion/discard, but backlog may accumulate if session-end is skipped | Classification: ephemeral until promoted; stale unprocessed insights are ambiguous and should not be swept without promotion/discard decision.
- Artifact class: Project/team memories | Path/glob: `.pHive/team-memories/<team>/<slug>.md` | Writer: team leads and distill, `hive/references/agent-memory-schema.md:21-33,364-377`; `hive/lib/multica-story-dispatch/distill.mjs:120-128` | Lifecycle today: tracked via `.gitignore:13-14`; no TTL deletion | Classification: forever-retained per user requirement if treated as memories, despite project-scope.
- Artifact class: Agent memories | Path/glob: `~/.claude/hive/memories/<agent>/<slug>.md`; bootstrap templates under `skills/hive/agents/memories/<agent>/*.md` | Writer: session-end promotion, `hive/references/agent-memory-schema.md:221-233`; distill promotion, `hive/lib/multica-story-dispatch/distill.mjs:159-190` | Lifecycle today: outside repo; TTL warnings only; not auto-deleted | Classification: forever-retained; hard-exclude.
- Artifact class: Compiled memory wiki | Path/glob: `~/.claude/hive/memory-wiki/**` | Writer: MemoryStore compile contract, `hive/references/memory-store-interface.md:47-63` | Lifecycle today: outside repo, derived cache from memories; no cleanup | Classification: ambiguous; derived/rebuildable but part of memory system, hard-exclude or regenerate rather than archive.
- Artifact class: SQLite KG | Path/glob: `~/.claude/hive/kg.sqlite` or `$HIVE_KG_SQLITE_PATH` | Writer: `hive/lib/kg_emit.py:35-95,98-164`; schema `hive/references/knowledge-graph-schema.md:1-4,98-131` | Lifecycle today: outside repo; valid_until marks supersession, not deletion; no prune | Classification: forever-retained; hard-exclude.
- Artifact class: ChromaDB semantic index and sidecar state | Path/glob: Chroma collection data (sidecar-managed) plus `~/.claude/hive/chromadb.{pid,port,lock,log}` and `chromadb.lockdir` | Writer: wrapper upserts docs, `hive/lib/chromadb-wrapper.js:168-206`; lifecycle scripts write pid/port/log/locks, `hive/scripts/chromadb-start.sh:6-13,107-145` | Lifecycle today: stop script deletes pid/port/lock files only, `hive/scripts/chromadb-stop.sh:23-45`; index data persists | Classification: Chroma index forever-retained KG/memory layer; pid/port/lock/log ephemeral.
- Artifact class: Claude session transcripts and subagent sidecars | Path/glob: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-*.{jsonl,meta.json}` | Writer: Claude Code runtime; Hive readers in hooks, `hooks/metrics-token-capture.sh:127-160`, and stop dispatch, `hooks/metrics-stop-dispatch.sh:86-106` | Lifecycle today: outside repo; no Hive cleanup | Classification: ephemeral/OS-temp candidate or external runtime retention; Hive should not move without owning writer.
- Artifact class: Interrupt records | Path/glob: `.pHive/interrupts/*.yaml` or `<state_dir>/interrupts/*.yaml` | Writer: `hooks/stop-interrupt-capture.sh:15-21`; read/cleanup described in session-end flow | Lifecycle today: resolver-aware; no observed automatic prune | Classification: ephemeral/age-archivable after session-end has acknowledged them.
- Artifact class: Test artifacts and baselines | Path/glob: `.pHive/test-artifacts/<epic>/<story>/{screenshots,logs,results.yaml,archive/**}`, `.pHive/test-baseline/<project>/baseline-knowledge.md` | Writer: test-swarm step 3, `hive/workflows/steps/test-swarm/step-03-worker.md:38-141`; promote/archive step 8, `hive/workflows/steps/test-swarm/step-08-promote.md:53-103` | Lifecycle today: artifacts explicitly not deleted; archive copy remains in tree | Classification: test logs/screenshots/results age-archivable after story closed; test-baseline is knowledge-like project memory and should be retained or separately classified.
- Artifact class: Design artifacts | Path/glob: `.pHive/design/<topic>/{v*.png,wireframe.f0,wireframe.txt,brief.md,selected.txt}`, `.pHive/design/index.yaml` | Writer: `/design`, `skills/design/SKILL.md:47-52,72-104` | Lifecycle today: re-run overwrites latest for same topic; no cleanup | Classification: age-archivable after linked story/epic shipped; if standalone, ambiguous until design-review/implementation link exists.
- Artifact class: Release announcement artifacts | Path/glob: `.pHive/releases/<release-id>/{post.md,video-script.md,post-ideas.md}` | Writer: `/ship` via `hive/lib/release_post.mjs:240-279`; dry-run lists same paths, `skills/ship/SKILL.md:197-216` | Lifecycle today: no cleanup; likely durable release provenance | Classification: ambiguous; likely age-archivable with shipped epic docs only if release records are not meant as permanent changelog.
- Artifact class: Context snapshot | Path/glob: `.pHive/context-snapshot.json` | Writer: `skills/context-snapshot/run.mjs:78-83` | Lifecycle today: overwritten on `--write`; no cleanup | Classification: ephemeral; should go to OS temp or be overwritten in resolved state dir.
- Artifact class: Meta-team control-plane state | Path/glob: `.pHive/meta-team/{queue-*.yaml,cycle-state.yaml,ledger.yaml,analysis-cache.yaml,archive/**,worktrees/**}` | Writer: meta-team skills/workflows and scripts such as `scripts/run_first_live_cycle.py:24-29,526-527` | Lifecycle today: tracked and manually archived in-tree; no generic sweep | Classification: mixed: active queues/ledger/cycle-state are in-flight control state; dated `archive/**` is already archived but still in repo, so this epic should decide whether to move old archives to temp/archive.
- Artifact class: Brand/logo exploration artifacts | Path/glob: `.pHive/brand/logo-explorations/**`, generated PNG candidates ignored | Writer: logo/brand skills per `.gitignore:171-183` | Lifecycle today: prompts/contact sheets tracked, PNG candidates ignored | Classification: age-archivable after brand/story shipped; generated PNGs are ephemeral/regenerable.
- Artifact class: Skill candidate mining output | Path/glob: `.pHive/meta/skill-candidates.yaml` | Writer: `/find-skills` contract, `skills/find-skills/SKILL.md:47-66` | Lifecycle today: only `.gitkeep` tracked; output likely ignored; no cleanup | Classification: ephemeral or age-archivable after candidate selection; ambiguous.
- Artifact class: Project profile and config | Path/glob: `.pHive/project-profile.yaml`, `.pHive/hive.config.yaml`, `.pHive/runtime/executor-graduated-workflows.yaml`, `.pHive/multica/*.yaml`, `.pHive/teams/*.yaml` | Writer: kickoff/init/config flows; `.gitignore:120-149` tracks selected runtime config | Lifecycle today: durable config, no cleanup | Classification: not an artifact-lifecycle target for archival; retain as active configuration unless superseded.

CLASSIFICATION:
- Forever-retained: agent memories under `~/.claude/hive/memories/**`; project/team memories under `.pHive/team-memories/**` if memory policy includes project-scope memories; SQLite KG `~/.claude/hive/kg.sqlite`; ChromaDB semantic index/collections; likely compiled memory wiki as derived memory cache; test baselines if treated as project knowledge.
- Ephemeral / should move to OS temp now: ChromaDB pid/port/lock/log sidecar files; context snapshots; temporary session transcripts/agent sidecars if Hive ever owns copies; stop interrupt records after acknowledgement; scratch/temp outputs; unpromoted self-capture files after distill; runtime-only metrics stop/spawn files may also fit once audits have consumed them.
- Age-archivable: shipped epic/story YAML and planning docs; episode markers and messages for shipped/closed stories; completed terminal DAG run-state; metrics events/envelopes/kg JSONL after observation windows; audits after audited work closes; cycle-state after epic closes; closed triage entries after queue is split/compacted; design/test/release artifacts after linked work ships.
- Ambiguous: release artifacts (release provenance vs tree bloat); project/team memories (project-scoped memory but user says memories forever); compiled memory wiki (derived but memory-adjacent); meta-team archives already in repo; triage single-file closed entries; failed DAG runs (terminal but resumable by design); standalone design artifacts not linked to a story.

EXISTING_CLEANUP_ARCHIVAL:
- No generic age-based archival sweep exists on this branch. Searches for `archive`, `cleanup`, `prune`, `ttl`, `retention`, `shutil.move`, `tempfile`, `mkdtemp`, `$TMPDIR` found manual archive/copy patterns and state-dir docs, not a reusable lifecycle service.
- Existing in-tree archive patterns:
  - Test-swarm copies results into `.pHive/test-artifacts/<epic>/<story>/archive/results-<timestamp>.yaml` and explicitly says not to delete artifacts, `hive/workflows/steps/test-swarm/step-08-promote.md:91-103,142-147`.
  - Meta-team historical state lives under `.pHive/meta-team/archive/2026-04-19/` and remains tracked, per observed files and `.gitignore:9-10`.
- Existing cleanup patterns:
  - ChromaDB stop removes lifecycle sidecars only, `hive/scripts/chromadb-stop.sh:23-45`.
  - Session-end documentation says promoted/discarded staged insights are deleted from staging, `hive/references/agent-memory-schema.md:221-233`.
  - Memory TTL warns only and does not delete, `hive/references/agent-memory-schema.md:87-100`.
- sdr-8 prototype pattern is not present on this branch; issue brief describes it as a future/parallel state-dir-resolver prototype: suspend-aware weekly age-based sweep that moves terminal DAG run-state from `<state_dir>/runs/<run-id>` to `$TMPDIR` archive using `shutil.move`, never touching active/suspended runs.

SHIPPED_CLOSED_SIGNAL:
- Story shipped signal: `/ship` writes `status: shipped`, `shipped_at`, and `release_id` only after ship action succeeds and release artifacts exist, `skills/ship/SKILL.md:280-290`; status lifecycle confirms `/ship` owns `complete -> shipped`, `hive/references/status-lifecycle.md:49-65`.
- Story complete signal before ship: `deriveStoryStatus()` returns `completed` from episode markers or merged branch evidence, `hive/lib/story-status.mjs:206-245`, but status lifecycle distinguishes `completed` marker vocabulary from canonical `complete`, `hive/references/status-lifecycle.md:41-47`.
- Reliability warning: raw story YAML `status:` is advisory and can lag reality, `hive/references/story-yaml-schema.md:56-73`; archival must not use non-shipped YAML status as a sole terminal trigger.
- Epic shipped/closed signal: no single explicit epic-level shipped/closed field found. `/ship` operates on target epics and story sets, but the durable terminal evidence appears to be all in-scope stories marked `shipped` plus release artifacts/release_id.
- Triage closed signal: queue state `closed` with `closed_at`, `closed_reason`, and state_history, `hive/references/triage-queue-schema.md:63-91`; writer enforces `--close`, `skills/triage/run.mjs:501-518`.
- DAG terminal signal: run-state status enum supports `completed`, `failed`, `suspended` and running; store terminal mutators freeze status, `hive/lib/dag_executor/run_state/store.py:179-257`. Issue brief prototype says include terminal `completed|failed|cancelled`, but current store has no `cancelled` mutator in examined file.

FOREVER_RETENTION_GUARDRAILS:
- Hard-exclude `~/.claude/hive/memories/**` and any configured memory root. These are outside `.pHive` and use TTL only for stale warnings, not deletion, `hive/references/agent-memory-schema.md:87-100`.
- Hard-exclude `.pHive/team-memories/**` unless product policy says project-scoped memories are not covered by "memories forever"; schema defines them as project memories, `hive/references/agent-memory-schema.md:21-33`.
- Hard-exclude `~/.claude/hive/kg.sqlite` or `$HIVE_KG_SQLITE_PATH`; valid_until is historical supersession, not deletion, `hive/references/knowledge-graph-schema.md:38-43`.
- Hard-exclude ChromaDB collection/index data. Sidecar process state (`chromadb.pid`, `chromadb.port`, locks/log) is ephemeral and can be cleaned independently.
- Do not infer forever-retention from `.pHive/metrics/kg/*.jsonl`: those are metric rows about KG writes, not the KG itself, `hive/lib/kg_metrics_writer.py:50-108`.

STATE_DIR_COUPLING:
- Resolver-aware:
  - Shell hooks source `hooks/common.sh` and write under resolved `<state_dir>`: metrics hooks and interrupt capture, e.g. `hooks/metrics-stop-dispatch.sh:64-84`, `hooks/stop-interrupt-capture.sh:15-21`.
  - `/ship` skill requires `${HIVE_STATE_DIR}` by contract, `skills/ship/SKILL.md:23-29`.
  - `release_post.mjs` honors `HIVE_STATE_DIR` env or `.pHive` default, `hive/lib/release_post.mjs:20-25`.
- Hardcoded / partial:
  - `hive/lib/dag_executor/run_state/store.py` defaults runs root to `.pHive/runs` unless a caller passes root, `store.py:52-58`.
  - Python metrics paths default to repo `.pHive/metrics` unless `METRICS_ROOT` is set, `hive/lib/metrics/paths.py:9-17`; this does not read `paths.state_dir`.
  - `skills/context-snapshot/run.mjs` writes `.pHive/context-snapshot.json` directly, `skills/context-snapshot/run.mjs:78-83`.
  - `skills/triage/run.mjs` defaults to repo `.pHive/triage` with only `HIVE_TRIAGE_QUEUE_DIR` test override, `skills/triage/run.mjs:20-25`.
  - `/design`, `/plan`, test-swarm docs, and many workflow references use literal `.pHive/...` paths.
- Implication: archival service should be Python-first per ADR and should operate on resolved `paths.state_dir`, but must also guard against legacy hardcoded `.pHive` writers until state-dir-resolver finishes.

CONSTRAINTS:
- Constraint: New lifecycle/archival code must be Python-first | Source: issue brief | Impact: lifecycle library/sweep should not be implemented in JS/bash even though many current writers are JS/bash.
- Constraint: Memories and KG entries retained forever | Source: issue brief; memory/KG docs | Impact: archival sweeps need explicit hard-exclude defaults for memory roots, KG sqlite, and Chroma indexes.
- Constraint: Active/in-flight work must never be moved | Source: issue brief; run-state status model | Impact: sweep needs reliable per-class active predicates, not just age.
- Constraint: `.pHive` contains both tracked durable planning state and ignored runtime files | Source: `.gitignore:1-216` | Impact: move-archive can affect Git status for tracked artifacts; planner must decide whether archive is a committed deletion or local-only maintenance.
- Constraint: `status:` in story YAML is advisory except `/ship` projection | Source: `hive/references/story-yaml-schema.md:56-73` | Impact: archival trigger should prefer `/ship` fields or derived marker/git status plus release metadata.
- Constraint: Triage closed entries share one file with open entries | Source: `hive/references/triage-queue-schema.md:7-12,84-91` | Impact: archival cannot simply move `queue.yaml` without losing active items.
- Constraint: state-dir resolver is partial | Source: `hive/references/state-relocation.md:30-49` | Impact: lifecycle implementation must account for writers still creating hardcoded `.pHive` artifacts.

RISKS:
- Severity: high | Risk: Archiving based on stale story YAML status can move active work | Evidence: `story-yaml-schema.md:56-73` and `story-status.mjs:11-21` make markers/git authoritative over YAML.
- Severity: high | Risk: Sweep touches forever-retained memory/KG data | Evidence: agent memory and KG paths live outside repo but team memories live under `.pHive/team-memories/**`; user explicitly says memories and KG retained forever.
- Severity: high | Risk: Moving tracked planning artifacts creates Git deletions and breaks branch reproducibility | Evidence: `.gitignore` allowlists many `.pHive/epics/**`, `.pHive/episodes/**`, metrics, audits, and cycle state.
- Severity: medium | Risk: Failed DAG runs are terminal in prototype language but resumable in current store | Evidence: `unfreeze_for_resume()` allows failed state resume, `hive/lib/dag_executor/run_state/store.py:241-257`.
- Severity: medium | Risk: Single-file triage queue prevents class-level archival of closed items | Evidence: triage schema has mixed states in one `items` list and single writer, `hive/references/triage-queue-schema.md:15-37,84-91`.
- Severity: medium | Risk: Metrics observation windows may outlive story shipping | Evidence: story metric schema supports future windows like `next-3-cycles`, `hive/references/story-yaml-schema.md:249-282`.
- Severity: medium | Risk: OS temp purge nondeterminism can erase archives earlier than operators expect | Evidence: issue goal says archive to temp/archive so OS purge reclaims; no code currently communicates durability expectations.
- Severity: low | Risk: Context snapshots and sidecars continue accumulating under hardcoded `.pHive` even after resolver-aware sweep | Evidence: `skills/context-snapshot/run.mjs:78-83`, `skills/triage/run.mjs:20-25`, and state relocation doc gap.

UTILITIES_AVAILABLE:
- Utility: state dir resolver | File: hooks/common.sh:125-137 | Relevance: Existing shell resolver semantics should be mirrored or called from Python lifecycle code.
- Utility: DAG run-state narrow mutation API | File: hive/lib/dag_executor/run_state/store.py:55-145 | Relevance: Provides safe run-state path/status loading and atomic write conventions.
- Utility: Story status derivation | File: hive/lib/story-status.mjs:174-245 | Relevance: Existing terminal/completion logic for story artifacts; archival planner may need Python equivalent or a call boundary.
- Utility: Metrics path boundary guard | File: hive/lib/metrics/paths.py:20-40 | Relevance: Shows path traversal/boundary guard pattern for writing under a root, but does not use `paths.state_dir`.
- Utility: KG emit path override | File: hive/lib/kg_emit.py:17-18,58-60 | Relevance: Identifies KG hard-exclude path and environment override.
- Utility: Chroma sidecar lifecycle scripts | File: hive/scripts/chromadb-start.sh:6-13; hive/scripts/chromadb-stop.sh:23-45 | Relevance: Existing explicit cleanup for ephemeral process sidecars.

EXTERNAL_REFERENCES:
- Source: none | Relevance: Internal codebase research only; issue explicitly said context7/web not required. | Key takeaway: No external sources were needed to answer artifact inventory/lifecycle questions.

UNANSWERED_QUESTIONS:
- What exact age thresholds should apply per class (DAG runs, episodes, metrics, audits, triage, design/test artifacts)?
- Should `.pHive/team-memories/**` be treated as "memories forever" despite project-scoped storage under `.pHive`?
- Are release announcement artifacts permanent release provenance or age-archivable planning output?
- What is the authoritative epic-level closed/shipped signal when an epic has no stories, partial ship, or legacy story records?
- Should failed DAG runs be archived automatically, given current resume semantics allow failed-state unfreeze?
- Should legacy in-repo archives such as `.pHive/meta-team/archive/**` be moved to OS temp/archive or left as historical committed evidence?
- Should the lifecycle sweep operate only on resolved `paths.state_dir`, or also scan legacy hardcoded `.pHive` when `paths.state_dir` points elsewhere?

inconsistency_risk_signals:
- Signal: stale status trigger | Where: `hive/references/story-yaml-schema.md:56-73` | Detail: Story YAML `status:` is advisory, but `/ship` writes `status: shipped`; sweep needs to distinguish reliable shipped projection from stale nonterminal status.
- Signal: tracked-state vs move-archive tension | Where: `.gitignore:1-216` | Detail: Many `.pHive` artifacts are intentionally tracked, so moving them to temp/archive can produce committed deletions or remove reviewable history.
- Signal: active/in-flight ambiguity | Where: `hive/references/status-lifecycle.md:19-65`; `hive/lib/dag_executor/run_state/store.py:179-257` | Detail: Story, triage, cycle, and DAG states use different terminal vocabularies and failed run-state may be resumable.
- Signal: state-dir coupling mismatch | Where: `hive/references/state-relocation.md:30-49` | Detail: Some writers honor `paths.state_dir`; others still hardcode `.pHive`, so a sweep over one root may miss live artifacts.
- Signal: forever memory inside archivable tree | Where: `.pHive/team-memories/**`; `hive/references/agent-memory-schema.md:21-33` | Detail: Team memories live in `.pHive`, which otherwise contains age-archivable project artifacts.
- Signal: OS-temp archive durability mismatch | Where: user requirement | Detail: "Archive" usually implies durable retrieval, but `$TMPDIR`/OS purge makes retention nondeterministic.
- Signal: mixed-file triage queue | Where: `hive/references/triage-queue-schema.md:15-37` | Detail: Closed and active triage entries coexist in one `queue.yaml`; file-level move cannot archive only closed entries.

VALIDATION NOTE:
  Checked: Internal Hive artifact writers and state/lifecycle schemas; no third-party library, SDK, or API approach required validation.
  Source: codebase-only
  Confidence: medium-high
  Findings: No generic cleanup/retention sweep exists on this branch. Resolver coverage is partial. Strong guardrails exist for memory/KG forever-retention and story status staleness, but epic-level closed signal and per-class retention thresholds remain open.
