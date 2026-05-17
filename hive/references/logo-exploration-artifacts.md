# Logo Exploration Artifact Contract

Shared on-disk contract for the hybrid logo flow described in
`.pHive/research/ui-logo-approach-may2026.md`. Defines exactly what
`/logo-exploration` (story `ulo-2-logo-exploration-skill`) writes and what
`/brand-system` (story `ulo-3-brand-system-handoff`) and downstream
finalization steps consume. Centralizing the layout here prevents the
wrapper (`hive/lib/openai-image-mcp-server.js`), the skill, and the
brand-system from each inventing their own conventions.

This document is the single source of truth for the layout. The
machine-checkable subset is implemented in
`hive/lib/logo-exploration-validator.js`.

---

## Storage Root

All exploration artifacts live under:

```
.pHive/brand/logo-explorations/
```

Each invocation of `/logo-exploration` creates exactly one timestamped
subdirectory under that root.

---

## Timestamp Format

Each exploration directory is named with an ISO-8601 UTC compact timestamp:

```
YYYYMMDDTHHMMSSZ
```

Example: `20260517T143022Z` (2026-05-17 14:30:22 UTC).

Why this format:

- **Sortable** — lexical sort matches chronological sort.
- **Filesystem-safe** — no colons, no spaces, no slashes.
- **Unambiguous timezone** — the trailing `Z` fixes the time at UTC.

Generators MUST use UTC. Consumers MAY assume the directory name matches
`^[0-9]{8}T[0-9]{6}Z$`.

---

## Directory Layout

```
.pHive/brand/logo-explorations/
  <UTC-timestamp>/
    contact-sheet.html          # human review surface (REQUIRED)
    prompts.md                  # exact prompts used (REQUIRED)
    direction-<N>/              # one dir per concept direction (REQUIRED, >=1)
      <N>.png                   # 4 candidates per direction (file names 0..3.png)
    selected.yaml               # written by human after review (OPTIONAL until selection)
    edits/                      # populated only by --refine runs (OPTIONAL)
      <selected-candidate>-edit-<N>.png
```

A directory is **complete** once `contact-sheet.html`, `prompts.md`, and at
least one `direction-<N>/` subdirectory exist. `selected.yaml` and `edits/`
are added later in the lifecycle and their absence is not an error.

### File and directory purposes

| Path | Purpose | Written by |
|------|---------|------------|
| `contact-sheet.html` | Self-contained HTML grid of every candidate, grouped by direction. The human review surface. Follows `hive/references/html-preview-format.md`. | `/logo-exploration` |
| `prompts.md` | Provenance log: the exact brand brief excerpt, each direction's prompt, model parameters (model name, size, variants), and generation timestamp. Lets a future reader reproduce or audit the run. | `/logo-exploration` |
| `direction-<N>/` | One subdirectory per concept direction in the brand brief. `<N>` is a 1-indexed integer matching the direction's position in the brief. | `/logo-exploration` |
| `direction-<N>/<i>.png` | Logo candidate raster, `<i>` is 0-indexed in `[0..3]`. Four candidates per direction per the `generate_logo_concepts` MCP tool contract. | `/logo-exploration` (via `hive/lib/openai-image-mcp-server.js`) |
| `selected.yaml` | Human-authored selection record (schema below). Absent until a human picks a winner. | Human reviewer |
| `edits/` | Refinement outputs from `/logo-exploration --refine`. Each filename encodes which selected candidate was the basis (`<direction>-<candidate>-edit-<N>.png`, e.g. `2-1-edit-0.png` for candidate `1.png` from `direction-2/`). | `/logo-exploration --refine` |

Anything not listed above is unexpected; the validator surfaces it as a
warning so consumers can decide whether to fail or proceed.

---

## `selected.yaml` Schema

Written by the human reviewer after they examine `contact-sheet.html` and
pick a winner. Required keys: `direction` and `candidate`. Optional `notes`
captures rationale that downstream finalization may want to read.

```yaml
# .pHive/brand/logo-explorations/<timestamp>/selected.yaml
direction: 2      # integer, matches direction-<N>/ subdir
candidate: 1      # integer, 0..3, matches <i>.png inside that direction
notes: |          # optional free text
  Direction 2 candidate 1 had the strongest optical balance and read
  cleanly at favicon scale. Direction 1 candidates 0 and 3 were close
  runners-up — keep them around for the edits round.
```

Constraints enforced by the validator (when the file exists):

- `direction` MUST be a positive integer that has a corresponding
  `direction-<direction>/` subdirectory.
- `candidate` MUST be a non-negative integer naming an existing
  `direction-<direction>/<candidate>.png`.
- `notes` MUST be a string if present (any length, including empty).

Unknown top-level keys are surfaced as warnings. The file MUST be valid
YAML; a parse error is a hard validation failure.

---

## Gitignore Policy

The directory structure is tracked in git so contributors can see what
explorations exist and read the prompts/selection rationale. The PNG
candidates themselves are ignored — they are large binaries, fully
reproducible from `prompts.md`, and would bloat the repo over time.

Concretely, the repo `.gitignore`:

- Un-ignores `.pHive/brand/` and `.pHive/brand/logo-explorations/`.
- Tracks `.html`, `.md`, `.yaml`, and `.gitkeep` files inside any
  timestamp directory.
- Ignores `*.png` everywhere under `.pHive/brand/logo-explorations/`.

To keep an otherwise PNG-only `direction-<N>/` subdirectory trackable, the
generator writes a `.gitkeep` into each direction directory. The validator
does not require `.gitkeep` — it is a git-tracking convenience only.

---

## Validator

`hive/lib/logo-exploration-validator.js` exposes
`validateExplorationDir(dirPath)`. It returns:

```js
{
  valid: boolean,        // true when no errors
  errors: string[],      // hard failures: missing required files, malformed selected.yaml
  warnings: string[],    // soft notices: unexpected files, missing optional pieces
}
```

The validator is purely structural — it does NOT open PNGs or render the
HTML. It is safe to run against in-progress directories.

See `tests/logo-exploration-validator.test.js` for the contract examples.
