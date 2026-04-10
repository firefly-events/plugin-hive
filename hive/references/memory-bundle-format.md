# MemoryBundle Format

A MemoryBundle is a portable, self-describing collection of agent memories. It enables sharing patterns, pitfalls, and accumulated knowledge across users or projects without requiring access to the source memory store.

## Bundle Structure

A bundle is a directory containing standard memory `.md` files organized by agent, plus a `manifest.yaml` at the root.

```
{bundle-label}/
├── manifest.yaml
├── developer/
│   ├── api-error-handling.md
│   └── go-channel-patterns.md
├── tester/
│   └── integration-test-pitfalls.md
└── architect/
    └── service-boundary-principles.md
```

- Memory files are standard format (see agent-memory-schema.md) — same frontmatter, same content
- Subdirectory names match agent names (e.g., `developer`, `tester`, `architect`)
- `manifest.yaml` is required; memory files without a corresponding manifest entry are ignored on import

## manifest.yaml Format

```yaml
# Required fields
label: "team-alpha-patterns-2026-q1"     # Human-readable bundle identifier; used as imported_from value
exported_by: "orchestrator"              # Agent name that ran the export, or "user"
exported_at: "2026-04-06"               # Date of export (YYYY-MM-DD)
memory_count: 4                         # Total number of memory files in the bundle

# Optional fields
source_project: "my-saas-platform"      # Label for the originating project

# Memory index (required)
memories:
  - file: "developer/api-error-handling.md"
    name: "API error handling with retry backoff"
    type: pattern
    agent: developer
    last_verified: "2026-03-20"

  - file: "developer/go-channel-patterns.md"
    name: "Go channel direction patterns"
    type: reference
    agent: developer
    last_verified: "2026-03-28"

  - file: "tester/integration-test-pitfalls.md"
    name: "Don't mock the database in integration tests"
    type: pitfall
    agent: tester
    last_verified: "2026-02-15"

  - file: "architect/service-boundary-principles.md"
    name: "Service boundary decision criteria"
    type: pattern
    agent: architect
    last_verified: "2026-03-10"
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Yes | Unique human-readable identifier for the bundle. Used as the `imported_from` value on all imported memories. Use kebab-case. |
| `exported_by` | string | Yes | Agent name or `"user"` — who triggered the export. |
| `exported_at` | string (YYYY-MM-DD) | Yes | Date the bundle was created. |
| `memory_count` | integer | Yes | Total number of `.md` files in the bundle. Used to verify bundle integrity on import. |
| `source_project` | string | No | Human-readable label for the project this bundle originated from. For reference only. |
| `memories` | array | Yes | Index of all memory files in the bundle. Each entry is validated against the actual file list on import. |
| `memories[].file` | string | Yes | Relative path to the memory file within the bundle directory. |
| `memories[].name` | string | Yes | Memory `name` value (from frontmatter). Used for conflict detection during import. |
| `memories[].type` | string | Yes | Memory type: `pattern`, `pitfall`, `override`, `codebase`, `reference`. |
| `memories[].agent` | string | Yes | Agent the memory belongs to. Determines destination directory on import. |
| `memories[].last_verified` | string (YYYY-MM-DD) | No | Date the exporting user last confirmed this memory's accuracy. |

## Provenance on Import

When a bundle is imported via `MemoryStore.import()`, every memory file receives updated frontmatter:

```yaml
source: "imported"
imported_from: "{manifest.label}"
```

These fields are written into the memory file on disk, overwriting any prior `source` value. This ensures the origin of every imported memory is traceable.

## Import and Wiki Recompilation

After import completes, the MemoryStore automatically calls `compile(affected_topics)` with the list of topics touched by newly imported memories. This ensures the compiled wiki reflects the new memory state before the next agent spawn.

Callers do not need to trigger recompilation manually — it is part of the import operation.

## Sharing Guidelines

**Safe to share cross-user:**
- `pattern` — general approaches that worked
- `pitfall` — lessons learned
- `reference` — accumulated knowledge lists

**Share with caution:**
- `codebase` — often contains project-specific file paths, internal API names, or proprietary patterns. Exclude with `by_type` filter when producing bundles for external recipients.
- `override` — references a prior memory by slug; may be meaningless without the original memory present in the recipient's store.

**Never share:**
- Memories containing secrets, credentials, or PII (see agent-memory-schema.md discard criteria). Review bundle contents before distributing.

## Example: Producing a Bundle

Using `MemoryStore.export()` with a filter:

```
export(filter: {
  by_type: ["pattern", "pitfall", "reference"],
  since_date: "2026-01-01",
  exclude_stale: true
})
```

This produces a bundle with only transferable memory types, recent enough to be relevant, and without TTL-expired entries.

## Example: Consuming a Bundle

```
import(bundle: "./team-alpha-patterns-2026-q1/", strategy: "skip-existing")
```

- Skips any memory whose slug already exists in the local store
- Writes provenance fields (`source: imported`, `imported_from: team-alpha-patterns-2026-q1`) to all new memories
- Triggers `compile()` for affected topics automatically
