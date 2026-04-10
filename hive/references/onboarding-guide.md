# Memory System Onboarding Guide

This guide covers how new users bootstrap memories, how the wiki compiles on first run, and how to share memories across users via the federation (export/import) workflow.

## Two-Path Architecture

Hive memories live in two locations:

| Path | Purpose | Authoritative? |
|------|---------|---------------|
| `skills/hive/agents/memories/{agent}/` | **Bootstrap templates** — ship with the plugin. Seed content for new users. | No — templates only |
| `~/.claude/hive/memories/{agent}/` | **Live memories** — system-level, cross-project. Updated by session-end promotion. | Yes — canonical source |

The bootstrap path is a starting point. The live path is the source of truth.

## First-Run Flow

1. **Kickoff protocol** runs on first project setup
2. For each agent: copies bootstrap templates from `skills/hive/agents/memories/{agent}/` to `~/.claude/hive/memories/{agent}/`
3. Migration is idempotent — existing files at the live path are never overwritten
4. After migration, the live path has starter memories ready for use

## First-Session Wiki Compilation

After the first session's execution completes:

1. Session-end step 8 evaluates any staged insights
2. Step 4d triggers wiki compilation (see `wiki-compilation-guide.md`)
3. Since this is the first compilation, ALL memories are processed (full build)
4. The wiki at `~/.claude/hive/memory-wiki/` is created with:
   - `index.md` — master topic index
   - `topics/` — synthesized articles from starter memories
   - `agents/` — per-agent digests
   - `meta/compiled-at.md` — compilation timestamp
5. Subsequent sessions use incremental compilation (only changed topics)

**Note:** First compilation takes longer than incremental runs. This is expected.

## Export Workflow (Sharing Your Memories)

To share memories with other users or teams:

1. **Select what to export:** Use `export(filter)` from the MemoryStore interface
   - Filter by type: `pattern`, `pitfall`, `override` are generally portable
   - **Exclude `codebase` type** for cross-user sharing (project-specific, rarely useful to others)
   - Filter by agent, date range, or TTL status as needed

2. **Produce a MemoryBundle:** The export creates a directory with:
   - Individual `.md` memory files (standard frontmatter format)
   - `manifest.yaml` describing the bundle (see `memory-bundle-format.md`)

3. **Share the bundle:** Zip and send, commit to a shared repo, or host on a URL

### Privacy Considerations

- `codebase` memories may reference proprietary file paths or architecture
- The discard criteria already prevent secrets/PII from entering memories
- Review the bundle before sharing — the manifest lists all included files

## Import Workflow (Receiving Memories)

To import memories from another user or team:

1. **Receive the MemoryBundle** directory
2. **Run import:** `import(bundle, strategy)`
   - `skip-existing` (default): safe import — doesn't overwrite your memories
   - `merge`: updates local memories if imported version is newer
   - `overwrite`: replaces local with imported (destructive — use for full resets only)

3. **Provenance tracking:** All imported memories automatically receive:
   - `source: "imported"` — marks them as external
   - `imported_from: "{manifest.label}"` — traces back to the source bundle

4. **Wiki recompilation:** Import automatically triggers `compile()` for affected topics

## New Team Member Onboarding

When a new developer joins the team:

1. **Team lead exports** a curated bundle: `export({by_type: ['pattern', 'pitfall', 'override']})`
2. **New member imports** the bundle: `import(bundle, 'skip-existing')`
3. **Kickoff runs** on their machine — creates directories, doesn't overwrite imported memories
4. **First session-end** compiles the wiki from imported + any new memories

The new member starts with the team's accumulated knowledge instead of a cold start.

## Extended Discovery Schemas

Kickoff Phase 2b adds three sub-phases that populate extended schema sections. These are defined as data contracts in `kickoff-protocol.md` and are optional with sensible defaults until detection logic is implemented.

| Schema Section | File | Populated By | Default |
|---------------|------|-------------|---------|
| `code_quality` | project-profile.yaml | Phase 2b-iii | `{linters: [], formatters: [], pre_commit: {framework: null, hooks: []}, code_snippets: []}` |
| `integrations` | project-profile.yaml | Phase 2b-i | `{cli_tools: {}, mcp_servers: {}, vaults: {}}` |
| `project_maturity` | project-profile.yaml | Phase 2b-iii | `"not_detected"` |
| `developer` | hive.config.yaml | Phase 2b-ii | `{pr_style: null, commit_granularity: null, review_depth: null, notes: null}` |

These sections do not affect existing kickoff behavior. They are placeholder contracts consumed by downstream stories (integration-preflight, developer-discovery, cross-cutting-concerns).
