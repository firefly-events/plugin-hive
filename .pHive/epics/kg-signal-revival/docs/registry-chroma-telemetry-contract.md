# Registry, Chroma, and Telemetry Contract

Companion to [consumer-contracts.md](./consumer-contracts.md): that doc names predicate consumers; this doc fixes the storage and telemetry names those consumers read.

## (a) ChromaDB `decisions` Collection

The wrapper writes via `index(collectionName, docId, content, metadata)` with `ids`, `documents`, and `metadatas`; S3.2 fixes the concrete `decisions` collection shape below. Metadata mirrors the KG triple fields read by the S3/S5 consumers and the priority predicates named in `consumer-contracts.md`.

| field | type | purpose |
|-------|------|---------|
| `id` | string | Stable decision key passed as `docId`; shape: `decision:{source_epic}:{predicate}:{subject}:{object_hash}:{valid_from}`. S3.2 calls this `decision-key`; the expanded form prevents collisions across cross-project imports and reasserted decisions. |
| `document` | string | Indexed text passed as `content`; use the decision summary / lifecycle summary text, not serialized metadata. |

| metadata name | type | purpose |
|---------------|------|---------|
| `subject` | string | KG triple subject; required so Chroma hits can be resolved back to `query_decisions()` rows. |
| `predicate` | string | KG predicate. Priority values for S3/S5 are `phase_failed`, `phase_blocked`, and `superseded` per `consumer-contracts.md`; `decided` remains valid for imported decision rows. |
| `object` | string | KG triple object or decision value; used with `subject` and `source_epic` to identify the originating triple. |
| `source_epic` | string | Epic namespace that produced the triple. Cross-project imports use `{project_name}/{epic_id}` per S4 bootstrap specs. |
| `source_agent` | string | Agent or writer name; current backfill importer uses `orchestrator`. |
| `valid_from` | string | ISO 8601 timestamp used for recency filtering and S5 miss-reason discrimination. |
| `valid_until` | string \| null | ISO 8601 invalidation timestamp; `null` means current. Included for parity with `query_decisions()` even though S3.2 only listed `predicate`, `source_epic`, `source_agent`, and `valid_from`. |

Note: S3.2's story text lists only `metadata: {predicate, source_epic, source_agent, valid_from}`. Existing KG code and S5 recency/dedup consumers need `subject`, `object`, and `valid_until`, so this contract keeps the S3.2 fields and adds the KG identity fields.

## (b) Registry Row Shape

The existing readable registry at `~/.claude/hive/projects.yaml` and `hive/references/system-config.md` define the canonical row as `path` plus `name`. S4 stories add stricter semantics around canonical paths, duplicate prevention, and explicit naming for brand/path mismatches.

| field | type | purpose |
|-------|------|---------|
| `path` | string | Required absolute filesystem path to the project root. Stored as provided; may contain spaces, and S4.5 requires preserving `/Users/don/Documents/GitHub/Nail Tech Assitant` verbatim. |
| `name` | string | Required unique slug used as the `source_epic` prefix: `{name}/{epic_id}`. S4.4 and S4.5 require explicit names when repo/brand/path differ. |
| `canonical_path` | string | Optional normalized absolute path used for dedupe comparisons. Existing bootstrap code computes this from `path`; S4.1 may surface it in previews, but registry consumers must not require it to be stored. |
| `registered_at` | string | Optional ISO 8601 timestamp for auditability of `/hive:register-project` writes. Additive; current bootstrap must ignore it. |

Required dedupe behavior: reject duplicate `name` and duplicate resolved `path` / `canonical_path`. Consumers must continue accepting the minimal existing row `{path, name}`.

## (c) Telemetry Envelope

All KG signal telemetry must go through `metric_registry.py`; current registry code preserves known dimensions and records skipped unknown dimensions, so S5 must register these names before emission. Counter names follow S5.1 where explicit; the miss-reason counter resolves B0.2/S5.2's unnamed fourth-counter gap.

| name | labels | semantics |
|------|--------|-----------|
| `kg_writes_total` | `predicate` | Increment once per successful KG write. S5.1 says this exists from S1.1 and must be idempotently registered. |
| `kg_signal_findings_total` | `cycle_id` | Increment once for each step-02c KG signal finding emitted. |
| `kg_signal_proposals_total` | `cycle_id` | Increment once when a KG finding enters the step-03 proposal pool; this is the hit-rate join site. |
| `kg_signal_miss_reasons_total` | `cycle_id`, `miss_reason` | Increment once when a cycle emits no KG findings and S5.2 emits a `miss_reason`. Divergence note: S5.2 names the field and buckets but not the counter; B0.2 requires the fourth counter here. |

Hit-rate gauge: `hit_rate_5cycle` with dimensions `{cycle_id, window_cycles=5}`. At cycle close, value is `count(last 5 cycles where kg_signal_proposals_total > 0) / 5`; for fewer than 5 known cycles, emit over the available history and keep `window_cycles=5` so dashboards do not change shape.

| miss_reason | description |
|-------------|-------------|
| `empty_kg` | No triples exist in the query window. |
| `empty_predicate_filter` | Triples exist, but none match `phase_failed`, `phase_blocked`, or `superseded`. |
| `recency_cutoff` | Relevant priority predicates exist, but all are older than `window_days`. |
| `project_tag_cutoff` | All candidates are cross-project and rank penalty pushes them below threshold. |
| `dedup_eviction` | KG findings duplicated step-02 findings and were removed by proposal/finding dedup. |

S5.3 JSONL rows must include at least: `cycle_id`, `metric_name`, `value`, `labels`, `timestamp`, and, for empty cycles, `miss_reason`. The human rollup line renders the same envelope as `kg-signal: findings=N proposals=M hit_rate_5cycle=R miss_reason=X`.
