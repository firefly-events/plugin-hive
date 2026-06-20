# Artifact Lifecycle Design Discussion
## 1. Goal

The goal is to make Hive's artifact footprint self-bounding.

A project should be able to run Hive for months without `.pHive` accumulating
unbounded planning state, runtime logs, metrics, sidecars, audits, test output,
and workflow leftovers.

The win condition is strict: active work is never touched, memories and KG live
forever, and old shipped or closed artifacts leave the current working tree after
their class-specific retention window.

Age alone is not a safe trigger. Every artifact class needs a positive inactive
predicate first, then an age threshold.

I think the design turns on one fork: Git-tracked artifacts and untracked runtime
artifacts need different archive semantics.

For Git-tracked planning state, archival should mean `git rm` from the working
tree. Git history is the durable archive. This matches the research finding that
`.gitignore` globally ignores `.pHive/*`, then allowlists selected epics,
episodes, metrics, audits, cycle-state, fixtures, and related control-plane
trees.

For untracked runtime state, archival should mean moving inactive artifacts to
OS temp, following the sdr-8 pattern. That is useful for local cleanup, but it is
not durable archival because OS temp can be purged.

Done looks like a Python-first lifecycle library operating over resolved
`paths.state_dir`, with a per-class registry, a sweep entrypoint supporting
`--dry-run`, manual and weekly execution, and hard-exclude defaults for forever
classes.

## 2. Proposed Approach

I would build one Python lifecycle library, likely under
`hive/lib/artifact_lifecycle/`, rather than spreading cleanup behavior across
skills and hooks.

The library should expose a registry of lifecycle classes, a planner that
produces candidate actions, an executor that applies either `git rm` or
move-to-temp, and a CLI/scheduler entrypoint for manual and weekly sweeps.

Each registry entry should define a class id, globs, tracked/untracked/mixed
classification, active predicate, retention threshold, archive action, and hard
exclusions.

The default hard exclusions should include `~/.claude/hive/memories/**`,
`.pHive/team-memories/**`, KG sqlite paths, ChromaDB collection/index data, and
probably `~/.claude/hive/memory-wiki/**` until policy says derived memory caches
can be regenerated safely.

Chroma sidecars are separate from the Chroma index. `chromadb.pid`, port, lock,
lockdir, and log files are ephemeral process state; the semantic index is part
of the forever memory/KG layer (`hive/scripts/chromadb-start.sh`,
`hive/scripts/chromadb-stop.sh`).

### Archive semantics split

Tracked artifacts should use `git rm` after their active predicate and threshold
pass. Candidate classes include shipped epic indexes, shipped story specs,
planning docs, episode markers, episode message sidecars, cycle state, tracked
metrics, KG metrics JSONL, audits, proof artifacts, and selected design/test
artifacts.

The reason is simple: moving allowlisted `.pHive` files to temp still creates
Git deletions. If the deletion is committed, Git history is already the archive;
an OS-temp copy is less reliable.

Untracked runtime artifacts should move to OS temp. Candidate classes include
untracked DAG run-state, runtime metrics streams after consumers finish, context
snapshots, acknowledged interrupts, promoted or discarded staged insights,
Chroma sidecars, scratch outputs, and ignored generated candidates.

The OS-temp archive should be described as transient cleanup, not long-term
records retention.

### Per-class active predicates

Story specs: archive only after `/ship` writes `status: shipped`, `shipped_at`,
and `release_id`. Non-shipped YAML `status:` is advisory and can be stale
(`hive/references/story-yaml-schema.md`, `hive/lib/story-status.mjs`).

Epic docs and `epic.yaml`: archive only after epic close. No explicit epic
terminal field exists, so derive close from all in-scope stories being
`/ship`-written shipped with `release_id`; add an explicit terminal epic field if
empty, partial, or legacy epics make derivation unreliable.

Episode markers and sidecars: archive only after the owning story ships. These
files feed status derivation, so they are active inputs until then
(`hive/references/episode-schema.md`, `hive/lib/story-status.mjs`).

DAG run-state: archive `completed` runs after threshold; never archive
`suspended`; do not automatically archive `failed` in the first pass because
current code can unfreeze failed runs for resume
(`hive/lib/dag_executor/run_state/store.py`).

Metrics events and experiment envelopes: archive only after observation windows,
post-run audits, and regression watches are done. Shipping a story is not always
enough because metric windows can extend beyond the current cycle.

KG metrics JSONL: archive as metrics evidence after cycle or epic close. Do not
treat `.pHive/metrics/kg/*.jsonl` as KG source data
(`hive/lib/kg_metrics_writer.py`).

Audits, specialist phases, and upstream watches: archive after the audited work
ships or the watch has a resolved/closed signal. If a class lacks a closed
signal, leave it report-only.

Cycle state: archive after epic close and after routing suppressions, handoffs,
and autonomous-cycle blocks are no longer active
(`hive/references/cycle-state-schema.md`).

Triage queue: do not file-move `.pHive/triage/queue.yaml`. Closed and active
entries share one file, so triage needs entry-level compaction or split storage
before lifecycle archival (`hive/references/triage-queue-schema.md`).

Design and test artifacts: archive after the linked story or epic ships.
Standalone designs stay ambiguous. Test baselines look like project knowledge
and should be retained unless policy says otherwise.

Release artifacts: retain by default as release provenance unless product policy
classifies them as age-archivable planning output.

### Weekly automation and scan scope

The CLI should support dry-run, apply, and class-scoped execution; cron or
launchd should call the Python CLI weekly, while the CLI owns all safety logic.

The sweep should default to resolved `paths.state_dir`. Because resolver coverage
is partial, I would add an explicit compatibility mode that also scans legacy
repo `.pHive` and reports duplicates or skipped legacy classes. Findings show
hooks and `/ship` are resolver-aware, while DAG runs, Python metrics, context
snapshot, triage, design, plan, and test-swarm still have hardcoded `.pHive`
defaults in places.

## 3. Risks

**High: stale status can archive active story work.** Use `/ship`-written
`status: shipped`, `shipped_at`, and `release_id`; do not trust old nonterminal
story YAML status.

**High: tracked cleanup creates Git deletions.** That is acceptable only if the
design states that Git history is the archive and deletion commits are
reviewable.

**High: memory or KG deletion would violate the requirement.** Hard-exclude
memory/KG roots by default, including `.pHive/team-memories/**`.

**High: episodes are active inputs.** Status derivation reads episode markers and
sidecars, so archiving them before story shipment can break workflow state.

**Medium: OS-temp archival is nondurable.** This is fine for untracked runtime
cleanup, but wrong for artifacts whose retrieval matters.

**Medium: failed DAG runs are resumable.** Exclude them initially, or require an
explicit no-resume marker before archival.

**Medium: resolver coverage is incomplete.** Resolved-only scans miss legacy
`.pHive`; dual-root scans can touch stale duplicates. Diagnostics need to make
that visible.

**Medium: triage is a mixed file.** Closed-entry cleanup needs compaction or
split storage, not a generic file move.

**Medium: metrics consumers may outlive story shipment.** Observation windows and
audits need their own terminal predicates.

**Low: existing in-repo archives muddy vocabulary.** Test-swarm and meta-team
already use in-tree archive folders; policy must decide whether those are
permanent evidence or tracked state eligible for `git rm`.

## 4. Dependencies

State-dir-resolver is the main dependency. The lifecycle service should operate
on resolved `paths.state_dir`, but the research brief shows partial writer
coverage (`hive/references/state-relocation.md`).

`/ship` is the shipped writer for story and epic cleanup
(`skills/ship/SKILL.md`, `hive/references/status-lifecycle.md`).

Story-status derivation matters because episode evidence is active input, not
disposable log data (`hive/lib/story-status.mjs`).

The `.gitignore` allowlist decides whether an archive action is a Git deletion
or a local move.

sdr-8 provides the prototype shape: suspend-aware weekly sweep, terminal guard,
move-to-temp, dry-run, and manual operation.

Triage storage and release artifact policy remain dependencies. Until closed
triage entries can be compacted and release provenance policy is settled, those
classes should be conservative or report-only.

## 5. Open Questions

1. What exact age thresholds should apply per class? Recommended answer: start
   conservative: 30 days for completed DAG runs and consumed interrupts, 60 days
   for metrics after observation windows, 90 days after shipped story or closed
   epic for episodes, design, test, audits, and planning docs. Rationale: active
   predicates carry safety; thresholds should reduce rollout surprise.

2. Should `.pHive/team-memories/**` be treated as "memories forever" despite
   project-scoped storage under `.pHive`? Recommended answer: yes, hard-exclude
   it. Rationale: the schema calls these project memories, and the requirement
   says memories survive forever.

3. Are release announcement artifacts permanent release provenance or
   age-archivable planning output? Recommended answer: retain as release
   provenance by default. Rationale: `/ship` writes them as release artifacts and
   no cleanup policy says they are disposable.

4. What is the authoritative epic-level closed/shipped signal when an epic has no
   stories, partial ship, or legacy story records? Recommended answer: derive
   closed from all in-scope stories shipped with `release_id`, then add an
   explicit epic terminal field if edge cases appear. Rationale: no current epic
   terminal field exists, but `/ship` gives a reliable story-level signal.

5. Should failed DAG runs be archived automatically? Recommended answer: no, not
   in the first sweep. Rationale: failed runs are resumable in current code, so
   they fail the "never touch resumable work" rule.

6. Should legacy in-repo archives such as `.pHive/meta-team/archive/**` move to
   OS temp/archive or remain historical committed evidence? Recommended answer:
   leave them as committed evidence until maintainers classify them as removable
   tracked state. Rationale: they are already archives; OS temp weakens
   retrievability.

7. Should the sweep operate only on resolved `paths.state_dir`, or also scan
   legacy hardcoded `.pHive` when `paths.state_dir` points elsewhere? Recommended
   answer: default to resolved `paths.state_dir`, with an explicit compatibility
   scan for legacy `.pHive`. Rationale: this follows the future contract without
   ignoring current writer gaps.

## 6. Scale Assessment

Recommendation: Large; this needs a structured outline before story
decomposition.

The inventory has roughly 18 artifact classes, but the hard part is proving
inactivity for each class and choosing the right archive action.

Files affected: likely 8-15. Subsystems: state-dir, DAG runs, ship/status,
episodes, metrics, audits, cycle-state, triage, scheduler, and memory/KG
exclusions. Full rollout needs migration, but dry-run/report-only can ship first.

Rationale: class count, per-class predicates, tracked-vs-temp archive split,
weekly automation, and legacy scan scope are too broad for direct story
decomposition from this discussion alone.
