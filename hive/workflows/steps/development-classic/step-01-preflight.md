# Step 1: Preflight

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT proceed to any other step if preflight fails — mark story as blocked
- Do NOT skip build verification even if the story seems simple
- Run the ACTUAL build command — do not assume it passes from prior sessions
- If cross-platform: verify EACH platform independently

## EXECUTION PROTOCOLS

**Mode:** autonomous

Run all checks sequentially. Gate on any failure. Report results.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (for platform targets and build context)
- Project CLAUDE.md (for build commands)

**NOT available:**
- Implementation code (doesn't exist yet)
- Research brief (not produced yet)

## YOUR TASK

Verify the project builds cleanly before any code changes begin.

## TASK SEQUENCE

### 0. Check for existing progress
Check `.pHive/episodes/{epic-id}/{story-id}/` for existing episode files.
If `preflight` episode exists with `status: completed`, skip to next step.

### 1. Identify build commands
Read the project's CLAUDE.md or equivalent config for:
- Build command (e.g., `./gradlew assembleDebug`, `npm run build`, `cargo build`)
- Test command (e.g., `./gradlew test`, `npm test`)
- Lint command (e.g., `./gradlew spotlessCheck`, `npm run lint`)

### 2. Run build
Execute the build command. Capture output.
- If build succeeds: record success, continue
- If build fails: STOP. Record the error. Mark story as **blocked**.

### 3. Verify critical config files
Check that files referenced in the story's `context.key_files` and `files_to_modify` exist.
Missing files = potential setup issue. Report but don't block unless they're creation targets.

### 4. Cross-platform check (if applicable)
If story spec indicates multiple platforms (e.g., iOS + Android for KMP):
- Build each platform independently
- Report per-platform status

### 5. Produce preflight report
```
PREFLIGHT REPORT:
  Build: {pass | FAIL — error message}
  Platforms: {per-platform status if cross-platform}
  Config files: {all present | missing: list}
  Status: {READY | BLOCKED — reason}
```

### 6. Surface story domain booleans (executor cutover, hde-10)

Read `story.metadata.needs_backend` and `story.metadata.needs_frontend`
from the story spec (see `hive/references/story-spec-schema.md`).
Default both to `false` when the field is missing.

These two booleans are surfaced as named outputs (`needs_backend`,
`needs_frontend`) on this preflight step so downstream
`backend-implement` and `frontend-implement` nodes can route via the
strict-Archon `when:` predicates against
`$preflight.output.needs_backend` / `$preflight.output.needs_frontend`.
The grammar has no `$story.metadata.X` form — the booleans must come
off a node's output graph.

## OUTPUT FORMAT

The orchestrator-narrated path consumes the prose preflight report.
The executor path additionally requires the following structured
fields on this step's output graph:

```yaml
preflight_status: string         # "READY" | "BLOCKED — <reason>"
needs_backend: bool              # whether backend implementation work is required
needs_frontend: bool             # whether frontend implementation work is required
```

**Emit these for the DAG executor by WRITING them to
`.pHive/dag-outputs/outputs.yaml`** (create the directory) in your working
copy, as a flat `key: value` YAML map — e.g.:

> **Write it in YOUR OWN working directory, every run, no exceptions.** The path
> is `.pHive/dag-outputs/outputs.yaml` RELATIVE to your current repo checkout
> (after any `git checkout`). Do NOT search other workspaces, do NOT `cat` or
> reuse an `outputs.yaml` from another task's work_dir, and do NOT skip the write
> because a file "already exists" somewhere else — the executor harvests ONLY the
> file in the work_dir of THIS task. A stale sibling file from a previous run is
> NOT yours. If you do not create this file here, the run fails as an under-run.

```yaml
preflight_status: READY
needs_backend: false
needs_frontend: true
```

The executor reads this file from your work_dir and merges it onto this step's
output graph; downstream `when:` predicates
(`$preflight.output.needs_frontend == true`) gate on it. Determine the booleans
from the story: prefer explicit `story.metadata.needs_backend` /
`needs_frontend` when present, otherwise INFER from the story's acceptance
criteria and domain:

- A browser/UI/HTML/CSS/DOM/component story needs **frontend**.
- An API/database/server/endpoint story needs **backend**.
- **Pure logic, algorithm, data-model, library, module, or utility code with no
  DOM and no server (e.g. a `game.js` rules module, a parser, a calculator) is
  BACKEND** — `needs_backend: true`. "Backend" here means non-UI implementation
  code, not just servers. Do not leave such a story with both booleans `false`.

**Critical invariant: any story that writes or modifies implementation code MUST
set at least one of `needs_backend` / `needs_frontend` to `true`.** Both `false`
means NO implement node runs — the code never gets written, the test/review/
integrate phases run against an empty implementation, and the story silently
ships nothing. Only a pure docs / config / metadata story (no code at all) may
have both `false`. When in doubt for a code story, set `needs_backend: true`.

Missing/omitted booleans default to `false` (predicate evaluator's fail-closed
semantics), which causes the corresponding implement node to skip. That default
is correct ONLY for a genuinely empty domain — never for a code-writing story.

## SUCCESS METRICS

- [ ] Build command executed (not assumed)
- [ ] Build passes on all target platforms
- [ ] Critical config files verified
- [ ] Preflight report produced

## FAILURE MODES

- **Assuming build passes from prior session:** The codebase may have changed. Always run.
- **Continuing after build failure:** Wastes time implementing on a broken foundation.
- **Not checking cross-platform builds:** Story may pass on one platform but fail on another.

## NEXT STEP

**Gating:** Preflight status is READY. If BLOCKED, halt story execution.
**Next:** Load `workflows/steps/development-classic/step-02-research.md`
**If gating fails:** Mark story as blocked with preflight error. Do not continue.
