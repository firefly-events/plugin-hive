# Artifact Lifecycle Research Brief

## Summary

The artifact-lifecycle audit found roughly 18 major artifact classes, with no generic cleanup, pruning, or age-based archival service on the branch today. Current behavior is a mix of allowlisted Git-tracked planning state, ignored or local runtime state, and forever-retained memory/KG data. The lifecycle design has three clear buckets: forever-retained, ephemeral, and age-archivable, plus an ambiguous set where product policy or stronger active-state signals are still needed. The key design tension is that many `.pHive` planning artifacts are intentionally Git-tracked, so "archive" may mean `git rm` from the working tree while Git history remains the archive, whereas untracked runtime artifacts need an actual move-to-temp sweep.

The raw findings also show that current "archive" behavior is local and specialized: test-swarm copies results into an in-tree archive, meta-team keeps historical archives in the repo, and ChromaDB/session-end cleanup removes only narrow sidecar or staged files. None of those patterns provides a reusable lifecycle service for the broader artifact set.

## Artifact Inventory by Bucket

### Forever-retained

| Artifact class | Path/glob | Writer | Lifecycle today | Classification |
| --- | --- | --- | --- | --- |
| Agent memories | `~/.claude/hive/memories/<agent>/<slug>.md` | Session-end promotion and Multica distill promotion | Outside repo; TTL is a staleness warning, not deletion | Forever-retained; hard-exclude |
| Project/team memories | `.pHive/team-memories/<team>/<slug>.md` | Team leads and Multica distill | Tracked through `.gitignore` allowlist; no TTL deletion | Forever-retained if project-scoped memories are covered by "memories forever" |
| SQLite KG | `~/.claude/hive/kg.sqlite` or `$HIVE_KG_SQLITE_PATH` | KG emit library | Outside repo; `valid_until` marks supersession rather than deletion | Forever-retained; hard-exclude |
| ChromaDB semantic index | Chroma collection data, plus sidecar-managed state | Chroma wrapper and sidecar scripts | Index persists; stop script only removes process sidecars | Index is forever-retained KG/memory layer |
| Compiled memory wiki | `~/.claude/hive/memory-wiki/**` | MemoryStore compile flow | Outside repo; derived from memories; no cleanup path found | Ambiguous but memory-adjacent; hard-exclude or regenerate |
| Test baselines | `.pHive/test-baseline/<project>/baseline-knowledge.md` | Test-swarm promotion | Project knowledge artifact; no cleanup path found | Likely retain as project knowledge |

### Ephemeral / OS-temp candidates

| Artifact class | Path/glob | Writer | Lifecycle today | Classification |
| --- | --- | --- | --- | --- |
| Chroma sidecar files | `~/.claude/hive/chromadb.{pid,port,lock,log}`, `chromadb.lockdir` | Chroma start/stop scripts | Stop script removes pid/port/lock files and lockdir; log/process state is not durable knowledge | Ephemeral |
| Context snapshot | `.pHive/context-snapshot.json` | Context snapshot CLI | Overwritten on `--write`; no cleanup | Ephemeral; should live in resolved state dir or OS temp |
| Claude transcripts and subagent sidecars | `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, subagent sidecars | Claude Code runtime; read by Hive hooks | Outside repo; Hive reads but does not own cleanup | Ephemeral or external-runtime retention; Hive should not move unless it owns copies |
| Interrupt records | `.pHive/interrupts/*.yaml` or `<state_dir>/interrupts/*.yaml` | Stop interrupt hook | Resolver-aware; no observed prune | Ephemeral after session-end acknowledgement |
| Staged insights | `.pHive/insights/<epic-id>/<story-id>/*.md` or legacy `.yaml` | Agents and session-end flow | Intended to be promoted/discarded, then removed; backlog can accumulate if session-end is skipped | Ephemeral until promoted; stale unprocessed items are ambiguous |
| Runtime-only scratch outputs | Scratch/temp outputs and unpromoted self-capture files | Agents and distill flows | No generic cleanup found | Ephemeral after promotion/discard or explicit acknowledgement |

### Age-archivable

| Artifact class | Path/glob | Writer | Lifecycle today | Classification |
| --- | --- | --- | --- | --- |
| Epic index files | `.pHive/epics/<epic-id>/epic.yaml` | `/plan`; read by `/ship` | Allowlisted per epic; never auto-cleaned | Age-archivable after all stories ship or epic closes |
| Story spec files | `.pHive/epics/<epic-id>/stories/*.yaml` | `/plan`; `/ship`; tester verdict updates | Allowlisted per epic; `status:` can be stale except `/ship` projection | Age-archivable after story `status: shipped` or equivalent closed signal |
| Planning docs | `.pHive/epics/<epic-id>/docs/*.md` | `/plan` phases and technical writers | Allowlisted per epic; never cleaned | Age-archivable after epic shipped/closed |
| Episode markers | `.pHive/episodes/<epic-id>/<story-id>/*.yaml` | Workflow agents and Multica episode sync | Marker-derived status is source of truth; no cleanup | Age-archivable after story shipped/closed; must remain while status derivation needs it |
| Episode sidecar transcripts | `.pHive/episodes/<epic-id>/<story-id>/*.messages.jsonl`, `multica-run.messages.jsonl` | Multica episode sync | Follows episode subtree allowlist/local tracking; no cleanup | Age-archivable with corresponding terminal episode markers |
| DAG run-state | `.pHive/runs/<run-id>/run_state.yaml` | DAG run-state store | Defaults to hardcoded `.pHive/runs`; no cleanup on branch | Age-archivable when terminal and older than threshold, excluding running/suspended and treating `failed` carefully |
| Metrics event streams | `.pHive/metrics/events/*.jsonl` or `<state_dir>/metrics/events/*.jsonl` | Metrics hooks, executor telemetry, scope drift, metrics core | Append-only; no retention path | Age-archivable after observation windows and post-run audit consumption |
| Metrics experiment envelopes | `.pHive/metrics/experiments/*.yaml` | Metrics core | Tracked; decisions become closed/immutable; no archival | Age-archivable after experiment/epic close and no active regression watch |
| KG metrics JSONL | `.pHive/metrics/kg/<cycle_id>.jsonl` | KG metrics writer | Tracked; append-only/idempotent; no cleanup | Age-archivable as metrics evidence; not the KG source |
| Audits and proof artifacts | `.pHive/audits/**`, `.pHive/specialist-phases/**`, `.pHive/upstream-watch/**` | `/plan`, gate-mode audit, specialist workflows | Selected trees tracked; no generic cleanup | Age-archivable after audited work closes or upstream watch resolves |
| Cycle state | `.pHive/cycle-state/<epic-id>.yaml`, `_standup.yaml` | Orchestrator and routing flows | Selected files tracked; routing entries self-expire but are not removed | Age-archivable after epic close and no active routing suppressions/handoffs |
| Triage queue closed entries | `.pHive/triage/queue.yaml` | Triage writer | Active and closed items share one file; default ignored unless tracked manually | Closed entries age-archivable only after queue splitting or entry-level compaction |
| Test artifacts | `.pHive/test-artifacts/<epic>/<story>/{screenshots,logs,results.yaml,archive/**}` | Test-swarm worker and promote steps | Explicitly not deleted; archive copy remains in tree | Age-archivable after story closes |
| Design artifacts | `.pHive/design/<topic>/{v*.png,wireframe.f0,wireframe.txt,brief.md,selected.txt}`, index | `/design` | Re-run overwrites latest for same topic; no cleanup | Age-archivable after linked story/epic ships |
| Meta-team historical archives | `.pHive/meta-team/archive/**` | Meta-team workflows | Already archived in-tree and tracked | Age-archivable only if policy allows moving committed historical evidence to temp/archive |
| Brand/logo explorations | `.pHive/brand/logo-explorations/**` | Logo/brand skills | Prompts/contact sheets tracked; generated PNGs ignored | Age-archivable after brand/story ships; generated PNGs ephemeral |

### Ambiguous

| Artifact class | Path/glob | Writer | Lifecycle today | Classification |
| --- | --- | --- | --- | --- |
| Release announcement artifacts | `.pHive/releases/<release-id>/{post.md,video-script.md,post-ideas.md}` | `/ship` via release post generator | No cleanup; likely durable release provenance | Ambiguous: permanent changelog/provenance vs age-archivable planning output |
| Project/team memories | `.pHive/team-memories/**` | Team leads and Multica distill | Tracked under `.pHive`; no TTL deletion | Ambiguous only until policy confirms project-scope memories are forever |
| Compiled memory wiki | `~/.claude/hive/memory-wiki/**` | MemoryStore compile flow | Derived memory cache | Ambiguous: derived/rebuildable but memory-adjacent |
| Triage queue | `.pHive/triage/queue.yaml` | Triage writer | Closed and active entries coexist in one file | Ambiguous until queue supports entry-level compaction or split storage |
| Failed DAG runs | `.pHive/runs/<run-id>/run_state.yaml` | DAG run-state store | Terminal/frozen semantics exist, but failed runs can be unfrozen for deliberate resume | Ambiguous: terminal by prototype language but resumable in current code |
| Standalone design artifacts | `.pHive/design/<topic>/**` | `/design` | No reliable story/epic link required | Ambiguous until linked to implementation or design-review status |
| Skill candidate mining output | `.pHive/meta/skill-candidates.yaml` | `/find-skills` | Output likely ignored; no cleanup | Ambiguous: ephemeral or age-archivable after candidate selection |
| Project profile and config | `.pHive/project-profile.yaml`, `.pHive/hive.config.yaml`, `.pHive/runtime/*.yaml`, `.pHive/multica/*.yaml`, `.pHive/teams/*.yaml` | Kickoff/init/config flows | Durable active configuration | Not an archival target unless superseded |

## The Central Design Fork: What "Archive" Means for Git-tracked Artifacts

Most `.pHive` planning artifacts are not disposable local files. The repository globally ignores `.pHive/*`, then allowlists selected epics, episodes, cycle-state, metrics, audits, fixtures, and other planning/control-plane trees. That means many artifact classes in the "age-archivable" bucket are Git-visible state.

For tracked artifacts, moving files to `$TMPDIR` creates a working-tree deletion. If that deletion is committed, Git history already retains the artifact content and may be the durable archive. In that model, "archive" means removing old planning artifacts from the current branch footprint with `git rm`, not preserving another copy under temp storage.

For untracked runtime artifacts, ignored append-only streams, process sidecars, and run-state directories that are not meant to remain in Git, archive still means a filesystem move to OS temp/archive, following the sdr-8 prototype shape. Those artifacts do not have Git history as a durable retrieval mechanism.

The design discussion should treat this as the central fork rather than an implementation detail: one lifecycle policy may need two mechanisms. Tracked artifact cleanup is a repository history/working-tree decision; untracked runtime cleanup is a local retention sweep decision.

This fork also affects review expectations. If tracked artifact cleanup is committed, reviewers can inspect deletions and recover content from Git history. If runtime cleanup moves ignored files to temp/archive, reviewers may only see the sweep code and logs, not the archived payload.

## The "Never Touch Active" Problem

Age alone is not a safe predicate because active-state signals differ by artifact class. The sweep needs per-class active guards that first prove a class is no longer in use, then apply age thresholds.

Story artifacts are especially risky. Story YAML `status:` is advisory and may lag reality, while episode markers and Git evidence drive derived status. `/ship` is the reliable writer for `status: shipped`, `shipped_at`, and `release_id`, so non-shipped YAML status should not be a sole terminal trigger.

Episode markers and sidecars are also active inputs, not just logs. Status derivation reads episode evidence, so archiving markers for in-review or in-progress work can corrupt current workflow state even when the files look old.

DAG run-state has its own vocabulary. `completed` freezes irrevocably, but `failed` and `suspended` can be unfrozen for deliberate resume. The sdr-8 language treats terminal run-state as an archival candidate, but current code makes `failed` a resumable state that needs a stronger guard.

Triage state mixes closed and active work in one `queue.yaml`. A file-level sweep cannot archive closed entries without also moving active items. This class likely needs queue compaction, entry-level archival, or storage splitting before a lifecycle sweep can safely touch it.

Cycle state, audits, metrics, and upstream watches also need specific terminal predicates. Routing suppressions can self-expire without being removed, metrics observation windows may outlive story shipping, and upstream watches need a resolved/closed signal before archival.

## Forever-retention Guardrails

The sweep must hard-exclude memory and KG roots regardless of age. This includes `~/.claude/hive/memories/**`, any configured memory root, `~/.claude/hive/kg.sqlite`, `$HIVE_KG_SQLITE_PATH`, and ChromaDB collection/index data.

Memory TTLs are warning signals only. The memory-store and agent-memory schemas describe stale-memory warnings and promotion/discard cleanup for staged insights, but not deletion of promoted memories.

ChromaDB has two separate lifecycle classes. The semantic index/collection is part of the retained memory/KG layer. Sidecar process state such as pid, port, lock, lockdir, and logs is ephemeral and can be cleaned independently.

`.pHive/team-memories/**` is the notable ambiguity. It lives under `.pHive`, which otherwise contains many age-archivable planning artifacts, but the schema defines it as project memory and the user requirement says memories are retained forever. Unless product policy says otherwise, this path should be a hard-exclude.

`.pHive/metrics/kg/*.jsonl` should not inherit KG forever-retention. The raw findings identify those files as metrics rows about KG writes, not the KG source itself.

## state_dir Coupling + sdr-8

The sweep should operate on resolved `paths.state_dir`, but resolver coverage is partial today. Shell hooks source `hooks/common.sh` and write metrics or interrupt records under the resolved state dir; `/ship` requires `${HIVE_STATE_DIR}`; release post generation honors `HIVE_STATE_DIR` or falls back to `.pHive`.

Several important writers still hardcode `.pHive` or use separate overrides. DAG run-state defaults to `.pHive/runs` unless a caller passes a root. Python metrics default to repo `.pHive/metrics` unless `METRICS_ROOT` is set, not `paths.state_dir`. Context snapshot, triage, design, plan, and test-swarm references still use literal `.pHive/...` paths.

The sdr-8 prototype is the mechanism to generalize: a suspend-aware weekly age-based sweep that moves terminal DAG run-state from `<state_dir>/runs/<run-id>` to `$TMPDIR` archive using Python `shutil.move`, while never touching active or suspended runs. The artifact-lifecycle design should preserve that safety model, expand it to more classes, and account for legacy hardcoded `.pHive` writers until state-dir-resolver lands.

The unresolved scan-scope decision matters because a resolver-only sweep can leave legacy `.pHive` buildup untouched, while a dual-root sweep can encounter duplicate or stale artifacts. The findings do not identify an existing arbiter for that choice.

## Open Questions

- What exact age thresholds should apply per class (DAG runs, episodes, metrics, audits, triage, design/test artifacts)?
- Should `.pHive/team-memories/**` be treated as "memories forever" despite project-scoped storage under `.pHive`?
- Are release announcement artifacts permanent release provenance or age-archivable planning output?
- What is the authoritative epic-level closed/shipped signal when an epic has no stories, partial ship, or legacy story records?
- Should failed DAG runs be archived automatically, given current resume semantics allow failed-state unfreeze?
- Should legacy in-repo archives such as `.pHive/meta-team/archive/**` be moved to OS temp/archive or left as historical committed evidence?
- Should the lifecycle sweep operate only on resolved `paths.state_dir`, or also scan legacy hardcoded `.pHive` when `paths.state_dir` points elsewhere?

## inconsistency_risk_signals

- Signal: stale status trigger | Where: `hive/references/story-yaml-schema.md:56-73` | Detail: Story YAML `status:` is advisory, but `/ship` writes `status: shipped`; sweep needs to distinguish reliable shipped projection from stale nonterminal status.
- Signal: tracked-state vs move-archive tension | Where: `.gitignore:1-216` | Detail: Many `.pHive` artifacts are intentionally tracked, so moving them to temp/archive can produce committed deletions or remove reviewable history.
- Signal: active/in-flight ambiguity | Where: `hive/references/status-lifecycle.md:19-65`; `hive/lib/dag_executor/run_state/store.py:179-257` | Detail: Story, triage, cycle, and DAG states use different terminal vocabularies and failed run-state may be resumable.
- Signal: state-dir coupling mismatch | Where: `hive/references/state-relocation.md:30-49` | Detail: Some writers honor `paths.state_dir`; others still hardcode `.pHive`, so a sweep over one root may miss live artifacts.
- Signal: forever memory inside archivable tree | Where: `.pHive/team-memories/**`; `hive/references/agent-memory-schema.md:21-33` | Detail: Team memories live in `.pHive`, which otherwise contains age-archivable project artifacts.
- Signal: OS-temp archive durability mismatch | Where: user requirement | Detail: "Archive" usually implies durable retrieval, but `$TMPDIR`/OS purge makes retention nondeterministic.
- Signal: mixed-file triage queue | Where: `hive/references/triage-queue-schema.md:15-37` | Detail: Closed and active triage entries coexist in one `queue.yaml`; file-level move cannot archive only closed entries.

## Constraints & Risks

Python-first is a hard implementation constraint from the issue brief. The lifecycle library and weekly sweep should be written in Python even though many current writers are JS or shell.

Active work must never be moved. The design needs per-class predicates for shipped stories, closed epics, terminal run-state, resolved triage entries, expired routing suppressions, consumed interrupts, and completed observation windows. Age thresholds are secondary to those active guards.

Memory and KG roots require explicit hard-exclude defaults. The exclusions must cover external memory roots, project/team memories under `.pHive`, KG sqlite paths and overrides, ChromaDB index data, and likely compiled memory wiki output.

Tracked-vs-move tension is the main repository risk. Moving allowlisted `.pHive` artifacts to temp/archive can produce Git deletions; if committed, Git history becomes the archive, but if not committed the working tree becomes noisy and reproducibility can suffer.

OS-temp archive durability does not match the normal meaning of "archive." `$TMPDIR` or OS temp purge can delete files nondeterministically, so the design must make retrieval expectations explicit.

Resolver coverage is incomplete. A sweep over only resolved `paths.state_dir` can miss artifacts still written to hardcoded `.pHive`; a sweep over both roots can touch stale or duplicate state unless the design defines scan scope clearly.

Failed DAG archival is risky. The prototype language includes terminal states, but current run-state code supports resuming `failed` runs, so `failed` needs either a longer threshold, an explicit no-resume marker, or exclusion until policy is settled.

Triage cannot be archived safely at the file level. Closed entries share `queue.yaml` with active entries, so lifecycle work for triage likely requires compaction or storage model changes before the generic sweep can apply.
