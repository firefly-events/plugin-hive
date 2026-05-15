---
name: register-project
description: Register a Hive-enabled project root for /hive:register-project so KG bootstrap can import cross-project cycle history.
---

# Register Project Skill

Register a Hive-enabled project root in the local Hive project registry at
`~/.claude/hive/projects.yaml`. Quote paths containing spaces.

`~/.claude/hive/{projects.yaml, kg.sqlite}` are local-only, do not check into repos.

**Input:** `$ARGUMENTS` contains an absolute project path. Optionally pass
`--name <registry-slug>` when the registry name should differ from the folder name.

## When to Use

- Adding a project to the system-level KG bootstrap registry
- Registering cross-project targets before running KG backfill
- Re-registering after manually deleting a stale registry row

## When NOT to Use

- For projects that do not have a `.pHive/` directory
- For repo-local configuration that should be committed
- To import cycle-state directly; registration only updates the project registry

## Procedure

### 1. Parse the target path

Use the path from `$ARGUMENTS`. Shell quoting is required for paths containing
spaces:

```bash
node skills/hive/skills/register-project/register-project.mjs "/Users/don/Documents/GitHub/Nail Tech Assitant" --name nail-tech-assistant
```

Shell-escaped spaces are also acceptable:

```bash
node skills/hive/skills/register-project/register-project.mjs /Users/don/Documents/GitHub/Nail\ Tech\ Assitant --name nail-tech-assistant
```

### 2. Validate the project root

The helper validates:

1. The target path is absolute.
2. The target path exists and is a directory.
3. The target path contains `.pHive/`.
4. `.pHive/cycle-state/` contains at least one file; if it is missing or empty,
   the helper prints a warning and proceeds.

The helper canonicalizes the target with `fs.realpathSync()` before writing so
symlink-aliased duplicates resolve to the same stored path.

### 3. Write the registry row

Invoke:

```bash
node skills/hive/skills/register-project/register-project.mjs "$TARGET_PROJECT_PATH" --name "$REGISTRY_NAME"
```

The helper appends this row shape to `~/.claude/hive/projects.yaml`:

```yaml
projects:
  - name: example-project
    path: /absolute/canonical/path
    registered_at: "2026-05-14T00:00:00.000Z"
```

It blocks duplicate `name` values and duplicate canonical paths with clear
messages. Duplicate names would collapse projects into the same `source_epic`
namespace, while duplicate canonical paths would import the same project twice.

### 4. Report the next bootstrap step

After registration, run the dry-run bootstrap preview:

```bash
node scripts/kg-bootstrap-from-projects.js --dry-run
```

Review the preview before applying imports.
