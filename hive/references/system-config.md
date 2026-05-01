# System Config

This reference documents Hive system-level configuration that lives under `~/.claude/hive/` (per machine, per user) — distinct from per-project state under `<project>/.pHive/`.

System-level config exists when the resource it describes is itself global. The L2 Knowledge Graph at `~/.claude/hive/kg.sqlite` is one global resource, so the registry of which projects feed into it lives alongside it rather than inside any one project.

## Project Registry

**Path:** `~/.claude/hive/projects.yaml`
**Override:** `HIVE_PROJECTS_REGISTRY=<path>` env var (used by CI and fixture tests)
**Consumed by:** `scripts/kg-bootstrap-from-projects.js`

The project registry lists Hive-enabled projects on this machine. The bootstrap utility reads the registry, walks each registered project's `.pHive/cycle-state/`, and seeds the global KG with multi-project decision history.

### Schema

```yaml
projects:
  - path: /absolute/path/to/project
    name: short-project-slug
  - path: /Users/you/Documents/another-project
    name: another-project
```

Required fields per entry:

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Absolute filesystem path to the project root. The bootstrap looks for `.pHive/cycle-state/` inside this path. |
| `name` | string | Short slug identifying the project. Used as the `source_epic` prefix when importing triples (`{name}/{epic_id}`). Must be unique across registry entries. |

Entries missing either field are dropped with a logged warning rather than failing the whole bootstrap.

### Why the name field is namespacing-critical

The KG enforces uniqueness via the `idx_unique_triple(subject, predicate, object, source_epic)` index. Without a per-project prefix on `source_epic`, two projects that share an epic ID (e.g., both have a `memory-redesign` epic) would have project B's triples silently dropped by `INSERT OR IGNORE`. The bootstrap passes `--source-epic-prefix=<name>` to `kg-import-cycle-state.js` so each project's triples are namespaced as `{name}/{epic_id}` and never collide across projects.

When you later query the KG via `query_decisions({ entity })`, pass either the bare epic ID or the namespaced `{name}/{epic_id}` form depending on whether you want cross-project or single-project scope.

### YAML parser fallback

The bootstrap uses `js-yaml` if available, falling back to a minimal regex parser otherwise. The fallback handles the narrow registry schema (`projects[]` of `{path, name}` entries) but does NOT handle multi-line strings, anchors, or other advanced YAML features. Install `js-yaml` if you author registry files by hand and want full coverage:

```
npm install js-yaml
```

The fallback emits a startup warning when active so the parser-in-use is never silent.

## Adding a project to the registry

1. Make sure your project has a `.pHive/` directory with at least one `.yaml` file under `.pHive/cycle-state/`. If not, run `/hive:kickoff` in the project first.
2. Append an entry to `~/.claude/hive/projects.yaml`:

   ```yaml
   projects:
     # ... existing entries ...
     - path: /Users/you/Documents/your-new-project
       name: your-new-project
   ```

3. Preview the impact:

   ```
   node scripts/kg-bootstrap-from-projects.js
   ```

4. Apply when satisfied:

   ```
   node scripts/kg-bootstrap-from-projects.js --apply
   ```

The bootstrap is idempotent — re-running with `--apply` after the first successful run inserts no new triples (verified via `INSERT OR IGNORE` against the `idx_unique_triple` index).

## Other system-level resources

The following live alongside the registry and are documented here for orientation. Each has its own canonical reference.

| Resource | Path | Reference |
|----------|------|-----------|
| L2 Knowledge Graph | `~/.claude/hive/kg.sqlite` | `hive/references/knowledge-graph-schema.md` |
| Agent memories | `~/.claude/hive/memories/{agent}/` | `hive/references/agent-memory-schema.md` |
| Memory wiki | `~/.claude/hive/memory-wiki/` | `hive/references/memory-store-interface.md` |
| ChromaDB store (optional) | `~/.claude/hive/chromadb/` | `hive/references/knowledge-layer.md` |

The project registry is unique among these in that it describes *which projects feed into* the system-level resources, rather than being a system-level resource itself. New consumers added in future epics should follow the same pattern: live under `~/.claude/hive/` only when the resource is itself per-machine, and keep per-project state in `<project>/.pHive/`.
