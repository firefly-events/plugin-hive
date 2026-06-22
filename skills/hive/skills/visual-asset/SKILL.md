---
name: visual-asset
description: Shared visual-asset render skill. Takes a structured visual spec (prompt + medium) and produces an asset via the appropriate backend — Frame0 CLI for vector/wireframe, openai-image MCP for raster/photographic/ad-creative. Writes output to a caller-supplied directory and returns the path(s).
use-when: "Invoke when an agent needs to render a visual asset from a spec. Pass medium=vector for wireframes and UI layouts; pass medium=raster for generated images, ad creatives, and photographic assets."
---

# Hive Visual-Asset Render Skill

Atomic sub-skill (agent-facing, not a top-level user command). Routes a visual spec to the correct render backend and returns the output path(s). Callers own the spec; this skill owns the tool plumbing.

**Adaptable by:** ad-creative (b3), ui-designer, logo-exploration, marketing-campaign (b5), and any future agent that needs rendered visual output. Callers pass their own medium and output directory — no marketing-specific paths are hard-coded here.

## Invocation contract

**Inputs** (passed by the calling agent):

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | Visual description of the asset to produce |
| `medium` | `vector` \| `raster` | Render backend selector |
| `output_dir` | string | Caller-supplied absolute or repo-relative directory for output files |
| `name` | string | Base filename (without extension) for the output asset |
| `frame0_page_type` | string (optional) | Frame0 device type — `phone`, `tablet`, `desktop`, `browser`, `watch`, `tv` (default: `desktop`). Only used when `medium=vector`. |
| `variants` | int (optional) | Number of image variants to generate (raster only; default 1, clamped 1–4 by the MCP tool). |

**Outputs:** An asset record:

```yaml
medium: vector | raster
paths:
  - <output_dir>/<name>.f0        # vector
  - <output_dir>/<name>-0.png     # raster (0-indexed, one entry per variant)
fallback_used: true | false
fallback_content: <text>          # only present when fallback_used=true
```

Echo the asset record to the caller on completion.

## Before Executing

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate, persona/config/memory loading.

## Process

### 1. Validate inputs

- `prompt` must be non-empty. If absent, abort: `visual-asset: prompt is required`.
- `medium` must be `vector` or `raster`. If absent or invalid, abort: `visual-asset: medium must be "vector" or "raster"`.
- `output_dir` must be non-empty. If absent, abort: `visual-asset: output_dir is required`.
- `name` must be non-empty. If absent, abort: `visual-asset: name is required`.
- Create `output_dir` if it does not exist: `mkdir -p "<output_dir>"`.

### 2. Route by medium

#### 2a. medium=vector → Frame0 CLI

**Tool check:** Run `which cli-anything-frame-zero` (or equivalent discovery).

**If Frame0 is available:**

1. Create the Frame0 project in `output_dir`:
   ```bash
   cli-anything-frame-zero project new --name "<name>" --output-dir "<output_dir>"
   ```
   This produces `<output_dir>/<name>.f0`.

2. Add a page and a device frame:
   ```bash
   cli-anything-frame-zero --project <output_dir>/<name>.f0 page add --name "Main"
   # Get page ID from: cli-anything-frame-zero --project <output_dir>/<name>.f0 page list
   cli-anything-frame-zero --project <output_dir>/<name>.f0 shape frame --page <PAGE_ID> --type <frame0_page_type|desktop> --left 0 --top 0
   ```

3. Translate `prompt` into Frame0 shape commands — text blocks, rectangles, icons — following the layout described in the prompt. Use the Frame0 quick-reference in `hive/agents/ui-designer.md` for correct flag names.

4. If Frame0 desktop app is running (`--live` available), export PNG:
   ```bash
   cli-anything-frame-zero --live export page --page <PAGE_ID> --format png --output <output_dir>/<name>.png
   ```

5. Return the `.f0` path (and `.png` path if exported). Set `fallback_used: false`.

**If Frame0 is unavailable** (fallback):

- Produce a text-based layout spec and ASCII mockup from `prompt`. Write it to `<output_dir>/<name>.txt`.
- Set `fallback_used: true` and `fallback_content` to the produced text.
- Emit clearly: `Frame0 CLI not available — produced text layout spec instead of .f0 file`.

#### 2b. medium=raster → openai-image MCP

**Tool check:** Confirm the `openai-image` MCP server is wired and the `generate_logo_concepts` (or equivalent generate) tool is available via MCP.

**If openai-image MCP is available:**

1. Invoke the MCP generate tool with:
   - `brand_brief` / `prompt`: the caller-supplied `prompt`
   - `output_dir`: `<output_dir>`
   - `variants`: caller-supplied (default 1)

2. Rename output files to `<name>-0.png`, `<name>-1.png`, … (0-indexed) for consistent downstream reference.

3. Return the list of output paths. Set `fallback_used: false`.

   **Error propagation:** If the MCP tool returns a 403 / "API access may require a verified OpenAI organization", propagate the message verbatim — do not retry, do not mask.

**If openai-image MCP is unavailable** (fallback):

- Write the prompt(s) to `<output_dir>/<name>-prompts.md` so the caller can submit them for manual generation.
- Set `fallback_used: true` and `fallback_content` to the prompt file path.
- Emit clearly: `openai-image MCP not available — wrote prompt(s) to <output_dir>/<name>-prompts.md for manual generation`.

### 3. Return asset record

Echo the asset record (YAML block, as specified in the invocation contract) so the calling agent can reference paths in its own deliverable.

## Backend summary

| medium | Primary backend | Required tool | Fallback |
|--------|----------------|---------------|---------|
| `vector` | Frame0 CLI | `cli-anything-frame-zero` | ASCII/text layout spec |
| `raster` | openai-image MCP | `openai-image` MCP server | Prompt file for manual generation |

## Invariants

- **Caller supplies output dir.** No path is hard-coded. ui-designer passes `.pHive/wireframes/`; ad-creative passes its campaign doc dir; logo-exploration passes its timestamp dir. The skill is output-location agnostic.
- **Fallbacks are explicit.** The skill never silently degrades — `fallback_used` is always set and a visible message is emitted.
- **No persona coupling.** This skill does not import persona-specific config. It reads only the inputs passed at invocation time.
- **One asset per call.** For multi-asset flows, callers invoke this skill once per asset (or once per direction for raster generation with `variants > 1`).

## Callers

- **ad-creative (b3):** Passes `medium=raster`, image-gen prompts it produces, and its campaign doc dir as `output_dir`.
- **marketing-campaign (b5):** Passes `medium=raster` or `medium=vector` depending on the asset type requested.
- **ui-designer:** Passes `medium=vector`, a layout prompt, and `.pHive/wireframes/` as `output_dir`.
- **logo-exploration:** Passes `medium=raster`, a brand-brief-derived prompt, and its timestamp exploration dir as `output_dir`.

## See also

- `hive/agents/ui-designer.md` — Frame0 CLI quick-reference and vector backend conventions
- `skills/logo-exploration/SKILL.md` — raster backend usage (openai-image MCP flow)
- `hive/agents/ad-creative.md` — primary invoker for raster ad assets (b3)
- `hive/lib/openai-image-mcp-server.js` — MCP tool implementation
