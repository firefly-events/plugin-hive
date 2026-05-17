---
name: logo-exploration
description: Generate 8-12 image-backed logo candidates across 2-3 concept directions via the openai-image MCP tool, render a contact-sheet for human review, and (with --refine) iterate the selected mark. Produces .pHive/brand/logo-explorations/<timestamp>/.
---

# Hive Logo Exploration

Atomic skill that orchestrates the hybrid logo flow: brand brief in → image-backed candidates out, rendered as a contact-sheet for human selection. Composable — invokable directly or from `/brand-system`, `/design-system`, or a maintainer.

**Input:** `$ARGUMENTS` is a free-form string parsed for these flags:

- `--brief <path>` — path to a brand brief YAML (defaults to `.pHive/brand/brand-system.yaml`)
- `--directions "<dir1>|<dir2>|<dir3>"` — 2-3 concept directions, pipe-separated (overrides brief-derived directions)
- `--refine <timestamp>` — refinement mode: read `selected.yaml` in the named exploration dir and produce 2-3 edit variants
- `--variants <N>` — candidates per direction (default 4; openai-image tool clamps to 4-8 for generate, 2-3 for edit)

If `$ARGUMENTS` is empty, the skill runs the first-pass flow against the default brief path.

## Before Executing Any Skill

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate, persona / config / memory loading, project CONTEXT.md load.

## Gate Check

**No standalone gate.** Logo-exploration requires a brand brief on disk (or passed via `--brief`); if neither resolves to a readable file, error out at step 1 of the Process with the message specified below.

## Output

A populated timestamp directory under `.pHive/brand/logo-explorations/` following the [logo-exploration artifact contract](../../hive/references/logo-exploration-artifacts.md) (defined by story `ulo-4-artifact-conventions`):

```
.pHive/brand/logo-explorations/<UTC-timestamp>/
  contact-sheet.html          # human review surface
  prompts.md                  # exact prompts used (provenance)
  direction-1/
    1.png 2.png 3.png 4.png   # 4 candidates for direction 1
  direction-2/
    1.png 2.png 3.png 4.png
  [direction-3/ ...]
  selected.yaml               # written by HUMAN after review
                              # shape: { direction: <N>, candidate: <N>, notes: "" }
  edits/                      # populated only by --refine runs
    direction-<N>-candidate-<N>-edit-<N>.png
```

Timestamp format: ISO-8601 UTC compact, e.g., `20260517T143022Z` (matches `date -u +%Y%m%dT%H%M%SZ`).

The skill echoes the contact-sheet path on completion. It does NOT vectorize, package, or sign off — those steps live downstream (see [`hive/references/logo-finalization-flow.md`](../../hive/references/logo-finalization-flow.md), story `ulo-5-downstream-flow-docs`).

## Process

### 1. Resolve the brand brief

Parse `--brief` from `$ARGUMENTS`; default to `.pHive/brand/brand-system.yaml`. Read the file. If it does not exist or is empty, abort with **exactly**:

> no brand brief found — run /brand-system first or pass --brief <path>

The brief is consumed verbatim as the `brand_brief` argument to the MCP tool — pass the relevant `personality`, `colors.primary.usage`, and any narrative text. Trim to a focused paragraph (the OpenAI prompt template will frame it).

### 2. Resolve concept directions

In priority order:

1. `--directions "<a>|<b>|<c>"` from `$ARGUMENTS` (split on `|`, trim each, require 2-3 entries).
2. A `concept_directions:` array in the brief YAML (not currently in the schema — future-friendly).
3. Inferred from `personality.tone` + `personality.statement` — synthesize 2-3 distinct stylistic directions (e.g., "geometric minimal", "organic wordmark", "monogram emblem"). Surface the inferred list back to the user before generating.

If fewer than 2 or more than 3 directions resolve, abort with a clear error naming what was found.

### 3. Create the exploration directory

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
EXPLORATION_DIR=".pHive/brand/logo-explorations/${TS}"
mkdir -p "${EXPLORATION_DIR}"
```

Record the timestamp — it appears in `contact-sheet.html` and is the handle for `--refine` runs.

### 4. Generate candidates per direction

For each resolved direction `N` (1-indexed):

1. `mkdir -p "${EXPLORATION_DIR}/direction-${N}"`
2. Invoke the openai-image MCP tool `generate_logo_concepts` with:
   - `brand_brief`: the trimmed brief from step 1
   - `concept_direction`: the direction string
   - `output_dir`: `"${EXPLORATION_DIR}/direction-${N}"`
   - `variants`: from `--variants` if set, else 4
3. The tool returns an `images` array of `{ kind: "file", value: <path> }` entries and the literal `prompt` string. Rename the decoded PNGs to `1.png`, `2.png`, … (the tool writes `generate-<runid>-N.png` by default — normalize to sequential indices for the contact-sheet).
4. Capture `prompt` for the provenance file in step 6.

Total candidate count must land in 8-12 (2-3 directions × 4 default variants). If any per-direction generation fails, fail the whole run — do not ship a partial contact-sheet.

**MCP tool ergonomics.** The openai-image server is wired in `.mcp.json` and exposes `generate_logo_concepts` + `edit_logo_concept` (see `hive/lib/openai-image-mcp-server.js`). Both tools error early on missing `OPENAI_API_KEY` and surface `403` as "API access may require a verified OpenAI organization" — propagate these messages verbatim to the user.

### 5. Render the contact-sheet HTML

Write `${EXPLORATION_DIR}/contact-sheet.html` with:

- `<h1>` showing the project name + timestamp
- A brief-excerpt block (first ~400 chars of the brand brief, in a `<pre>` for readability)
- One `<section>` per direction with `<h2>direction-N — &lt;label&gt;</h2>`
- A CSS grid (4 columns) inside each section, each cell `<img src="direction-N/M.png">` with a small caption (`M`)
- A footer noting: timestamp, total candidate count, "next: edit `selected.yaml` to pick a winner, then re-run `/logo-exploration --refine <timestamp>`"

Inline minimal CSS — no external deps. Use relative image paths so the file opens correctly from disk.

Skeleton (adapt; do not import from a helper unless the inline approach gets unwieldy — the story marks `hive/lib/logo-contact-sheet.js` as optional):

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Logo Exploration {{TS}}</title>
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:24px;color:#222}
  h1{margin:0 0 4px}
  .ts{color:#888;font-size:12px;margin-bottom:24px}
  pre.brief{background:#f6f8fa;padding:12px;border-radius:6px;white-space:pre-wrap;max-width:900px}
  section{margin:32px 0}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .grid figure{margin:0;text-align:center}
  .grid img{width:100%;height:auto;background:#fafafa;border:1px solid #eee;border-radius:4px}
  .grid figcaption{color:#666;font-size:12px;margin-top:4px}
  footer{margin-top:48px;color:#666;font-size:12px;border-top:1px solid #eee;padding-top:12px}
</style></head>
<body>
  <h1>Logo Exploration</h1>
  <div class="ts">{{TS}} · {{TOTAL}} candidates · {{N_DIRECTIONS}} directions</div>
  <h3>Brand brief excerpt</h3>
  <pre class="brief">{{BRIEF_EXCERPT}}</pre>
  {{SECTIONS}}
  <footer>
    Edit <code>{{EXPLORATION_DIR}}/selected.yaml</code> with
    <code>{direction: N, candidate: N, notes: ""}</code>, then run
    <code>/logo-exploration --refine {{TS}}</code> for 2-3 edit variants.
    Prompts used: <a href="prompts.md">prompts.md</a>.
  </footer>
</body></html>
```

### 6. Write provenance

Write `${EXPLORATION_DIR}/prompts.md` capturing, for each direction:

- the direction label
- the literal `prompt` returned by `generate_logo_concepts` (the tool returns the final prompt string — do not reconstruct)
- the variant count and the generation timestamp

This is the audit trail downstream consumers and humans use to understand what was asked for.

### 7. Hand off to the human

Print, verbatim:

```
Logo exploration complete.

Contact sheet: <EXPLORATION_DIR>/contact-sheet.html
Candidates:    <TOTAL> across <N_DIRECTIONS> directions
Prompts:       <EXPLORATION_DIR>/prompts.md

Next:
  1. open <EXPLORATION_DIR>/contact-sheet.html
  2. write <EXPLORATION_DIR>/selected.yaml with: { direction: N, candidate: N, notes: "..." }
  3. /logo-exploration --refine <TS>     # optional: 2-3 edit variants of the winner
```

The skill exits here on a first-pass run. Selection is durable on the filesystem — humans may take hours or days to choose.

### 8. Refinement (`--refine <timestamp>`)

When invoked with `--refine <TS>`:

1. Resolve `EXPLORATION_DIR=".pHive/brand/logo-explorations/${TS}"`. If absent, abort with "exploration dir not found: <path>".
2. Read `${EXPLORATION_DIR}/selected.yaml`. Required shape: `{ direction: <int>, candidate: <int>, notes: <string> }`. If missing or malformed, abort with the shape spec and an example.
3. Resolve the source image: `${EXPLORATION_DIR}/direction-<direction>/<candidate>.png`. If missing, abort.
4. Synthesize an `edit_instruction` from `notes` (if non-empty) plus a default ("Refine the selected mark — tighten geometry, improve balance, maintain identity"). Surface the final instruction so the human sees what was sent.
5. `mkdir -p "${EXPLORATION_DIR}/edits"`.
6. Invoke `edit_logo_concept` with:
   - `source_images`: `["${EXPLORATION_DIR}/direction-<direction>/<candidate>.png"]`
   - `edit_instruction`: the synthesized string
   - `output_dir`: `"${EXPLORATION_DIR}/edits"`
   - `variants`: 3 (clamped 2-3 by the tool)
7. Rename outputs to `direction-<direction>-candidate-<candidate>-edit-<N>.png` for traceability.
8. Append a new `<section>` to `contact-sheet.html` titled "Edits of direction-<N> candidate-<N>" containing the new variants. Also append a "Refined on <TS>" entry to `prompts.md` with the literal edit prompt the tool returned.
9. Print the edit count + paths.

## What this skill is NOT

- **Not a vectorizer.** PNGs in, PNGs out. Raster→vector conversion is documented in [`hive/references/logo-finalization-flow.md`](../../hive/references/logo-finalization-flow.md) (story `ulo-5`).
- **Not a brand-package builder.** Final color/mono/favicon/social variants are downstream of human selection + vectorization.
- **Not a quality judge.** The skill produces candidates; humans pick. No automated scoring or ranking.
- **Not a long-poll watcher.** Selection lives on the filesystem; re-invoke with `--refine` when the human is ready.

## Atomic-skill invariants

- **Top-level skill** at `skills/logo-exploration/SKILL.md` (auto-discovered).
- **Composable** — invokable directly or as a step inside `/brand-system`, `/design-system`, etc. No coupling to a specific caller.
- **Stateless across invocations** — each first-pass run writes a fresh timestamp dir; `--refine` is keyed by an existing timestamp. No global state.
- **Filesystem hand-off** for human-in-the-loop selection — survives sessions, machines, and weeks of delay.
- **Single MCP dependency** — relies on the `openai-image` server already wired in `.mcp.json` (story `ulo-1`). No additional installs or wiring.

## Risks + mitigations

- **gpt-image-2 requires a verified OpenAI org.** The MCP tool surfaces `403` as "API access may require a verified OpenAI organization". Propagate verbatim — do not retry, do not mask.
- **Contact-sheet HTML may look rough on first paint.** Acceptable — the artifact is for human review, not production publishing. Iterate the inline CSS only when actual users complain.
- **Stale exploration dirs accumulate.** A future story may add a `--cleanup` flag; for now, the dir is the human's record and worth keeping.

## See also

- [`hive/lib/openai-image-mcp-server.js`](../../hive/lib/openai-image-mcp-server.js) — MCP tool implementation (story `ulo-1`)
- [`hive/references/logo-exploration-artifacts.md`](../../hive/references/logo-exploration-artifacts.md) — on-disk artifact contract (story `ulo-4`)
- [`hive/references/logo-finalization-flow.md`](../../hive/references/logo-finalization-flow.md) — downstream vector + brand-package flow (story `ulo-5`)
- [`hive/references/brand-system-schema.yaml`](../../hive/references/brand-system-schema.yaml) — upstream brand-brief shape
- [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble
- `.pHive/research/ui-logo-approach-may2026.md` — research that motivated this hybrid flow
