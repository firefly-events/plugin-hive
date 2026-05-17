# UI Logo Generation Approach Recommendation

Date: 2026-05-17
Story: `mhg-6-ui-logo-capability-investigation`

## Executive Summary

Hive should stop asking `ui-designer` to produce production-grade logos directly. The current stack is optimized for wireframes, design specs, and inline SVG mock concepts, not for iterative brand-mark generation. The recommended path is a **hybrid pipeline**:

1. Hive produces the brand brief, constraints, and 2-3 logo directions.
2. A dedicated image-generation tool generates concept boards and editable iterations.
3. A human selects a direction and a follow-on step converts the chosen mark into the final vector/logo package.

Primary recommendation: **integrate OpenAI GPT Image as the first dedicated logo-generation backend**, exposed to Hive through an MCP server or a thin internal CLI wrapper.

Why this path:

- It is the smallest change to Hive's current UX.
- It supports both first-pass generation and iterative edits.
- It fits agent workflows better than a Figma-only or Midjourney-based path.
- It allows a later optional Figma review plugin without making Figma the critical path.

## 1. Current Capability

### What `ui-designer` does today

Local evidence:

- `hive/agents/ui-designer.md` defines `ui-designer` as a wireframe/design-brief agent centered on Frame0 CLI, layout specs, accessibility, and marketing assets.
- `skills/brand-system/SKILL.md` delegates brand creation to `ui-designer`.
- `hive/references/ui-prompts/brand-system.md` requires `ui-designer` to generate `3-5` inline SVG logo concepts inside `.pHive/brand/brand-guide.html`.
- `hive/references/html-preview-format.md` further constrains logos to inline SVG concepts rendered inside an HTML preview.

In practice, that means the current logo workflow is:

1. Model invents a brand direction from text.
2. The same model emits logo concepts as inline SVG or text-based lettermarks.
3. The HTML guide is the review surface.

This is reasonable for rough exploration, but not for a production identity system.

### What is missing

- No dedicated raster image generation tool in the logo loop.
- No iterative edit loop specialized for marks, typography, or symbol refinement.
- No vectorization/post-processing step after concept selection.
- No review workflow that separates "concept generation" from "final asset production."

## 2. Concrete Failure Modes

The recent OSS rollout brand work referenced in the story notes that "concept 4" was selected and shipped, which is consistent with the current system producing multiple rough concepts and relying on human taste to pick the least-bad option. The stronger issue is architectural:

- `ui-designer` is optimized for screen design and Frame0, not identity design.
- The brand-system prompt asks for multiple logo concepts, but only as inline SVG snippets in an HTML guide.
- The repo currently has no committed `.pHive/brand/` artifact set on this branch, which suggests logo output is not yet a dependable, reusable asset pipeline.

Observed failure modes from the current design:

- **Wordmark bias**: LLM-authored SVG tends toward generic wordmarks or monograms because they are easier to emit in text than strong symbolic marks.
- **Geometry fragility**: Inline SVG generated from prompt-only reasoning often has awkward spacing, inconsistent stroke logic, and weak optical balance.
- **Typography weakness**: The system can name fonts, but it does not truly design letterforms or logotype spacing.
- **Low iteration quality**: Changing one concept usually means regenerating a whole SVG idea, not editing a chosen mark with controlled deltas.
- **No production handoff**: Even the best concept still needs cleanup, vector refinement, export packaging, and usage variants.

## 3. Alternatives Evaluated

### A. Dedicated image-generation backend via API/MCP

#### Option A1: OpenAI GPT Image

Official sources:

- OpenAI image generation guide: <https://developers.openai.com/api/docs/guides/image-generation>
- OpenAI image API launch note: <https://openai.com/index/image-generation-api/>

Relevant capabilities as of 2026-05-17:

- OpenAI's latest image docs describe GPT Image models, including `gpt-image-2`, with both generation and editing flows.
- The docs explicitly position the Responses API for multi-turn editing and the Image API for direct generation/editing.
- The platform supports transparent backgrounds and iterative edits, which are useful for logo exploration and mark cleanup.

Access model:

- **API key** via OpenAI API.
- Possible org verification requirement for GPT Image access.
- Best Hive integration surface: MCP tool wrapper or repo-local CLI that accepts prompt + reference inputs and writes outputs to `.pHive/brand/`.

Pros:

- Strong instruction following.
- Good fit for iterative agent workflows.
- Easy to integrate into an MCP/CLI handoff.
- Supports edits, not just one-shot generations.

Cons:

- Output is still raster-first unless paired with later vectorization.
- Brand-grade originality still needs human review.
- Costs scale with iteration volume.

Rough effort:

- **2-4 days** for a first usable integration:
  - MCP/CLI wrapper
  - prompt templates
  - artifact storage convention
  - review HTML updates

#### Option A2: Black Forest Labs FLUX

Official sources:

- BFL docs home: <https://docs.bfl.ai/quick_start/introduction>
- FLUX MCP server docs: <https://docs.bfl.ai/api_integration/mcp_integration>
- FLUX model docs: <https://docs.bfl.ai/kontext/kontext_overview>

Relevant capabilities as of 2026-05-17:

- Black Forest Labs recommends FLUX.2 for new generation/editing work.
- The docs describe API access for image generation/editing and an MCP integration path.
- FLUX emphasizes prompt adherence, editing, and reference-aware workflows.

Access model:

- **API key** from BFL.
- Official **MCP integration** documentation exists.
- Some open-weight/local options exist, but not all are commercial-by-default.

Pros:

- Strong fit if Hive wants explicit MCP-native tooling.
- Good editing and reference-image story.
- Viable second-source provider or fallback.

Cons:

- More vendor surface area for the team to learn.
- Some model variants/licensing modes are more complex than a single hosted API path.
- Still does not remove the need for human finalization.

Rough effort:

- **3-5 days** for a polished integration, depending on whether Hive uses hosted API only or also wants local/open-weight options.

Assessment:

- Technically viable.
- Better as a fallback or secondary provider than the first integration, unless the maintainer strongly prefers BFL's MCP ecosystem.

### B. Midjourney-style pipeline

Official sources:

- Midjourney community guidelines: <https://docs.midjourney.com/hc/en-us/articles/32013696484109-Community-Guidelines>
- Midjourney plans: <https://docs.midjourney.com/docs/plans>

As of 2026-05-17, Midjourney's official guidance says it generally **does not provide an API**, and unauthorized automation or third-party scripts are prohibited.

Access model:

- Subscription account.
- No dependable official API route for Hive automation.

Pros:

- Good artistic exploration in human-driven workflows.

Cons:

- Poor fit for autonomous agent integration.
- Automation risk is explicitly called out in the official rules.
- Weakest option for a durable Hive-native pipeline.

Rough effort:

- **Not recommended for autonomous integration.**

Assessment:

- Reject as the primary path.

### C. Prompt-driven Figma or Frame0 pipeline

Official sources:

- Figma Dev Mode overview: <https://www.figma.com/dev-mode/>
- Figma MCP desktop setup: <https://developers.figma.com/docs/figma-mcp-server/local-server-installation/>
- Figma plugin network requests: <https://developers.figma.com/docs/plugins/making-network-requests/>
- Figma plugin image creation: <https://developers.figma.com/docs/plugins/api/properties/figma-createimage/>

What this option really means:

- Use Figma as the review/composition environment.
- Optionally build a plugin that calls an external image API and places generated images into the file.
- Or use Dev Mode MCP to bring design context into coding workflows.

Important limitation:

- Figma Dev Mode MCP is primarily for design context and code handoff, not for native logo generation.
- Dev Mode plugins are read-only with respect to document editing, so Dev Mode alone is not the right surface for creative mark generation.
- Standard Figma plugins can make network requests and create image assets, but the actual image generation still comes from an external model.

Access model:

- **Figma paid seat** for Dev Mode/MCP features.
- **Plugin manifest + network access configuration** for a custom plugin.
- Still requires **an external image API key**.

Pros:

- Excellent review and handoff surface.
- Good place for human selection, annotation, and composition.

Cons:

- Not a generator by itself.
- More product/UI work than the API-first path.
- Adds Figma dependency before the core logo-generation problem is solved.

Rough effort:

- **4-7 days** if done as a first-class plugin workflow.

Assessment:

- Good second-phase UX improvement, not the first implementation story.

### D. Hybrid: brief + external generation + human/vector finalize

This is the operational model behind the recommendation.

Flow:

1. Hive brand-system creates brand strategy, constraints, and named concept directions.
2. Dedicated image model generates 4-12 concept candidates plus edit rounds.
3. Human selects one direction.
4. Follow-on asset work turns the winner into final vector/logo variants.

Pros:

- Matches how brand work actually converges.
- Preserves Hive's strengths in concept framing and structured review.
- Avoids pretending the first generative output is the finished logo.

Cons:

- Requires an explicit "human approves before finalization" step.
- Final vector quality still needs either a designer or a vectorization follow-up tool.

Assessment:

- Best fit for reality and for Hive's current maturity.

## 4. Recommendation

### Recommended path

Adopt **Hybrid + OpenAI GPT Image first**.

Concretely:

- Keep `ui-designer` responsible for brand brief generation, concept naming, and review notes.
- Add a new dedicated logo-generation tool stage using **OpenAI GPT Image**.
- Store outputs under `.pHive/brand/logo-explorations/`.
- Update the brand-system flow so the HTML guide can embed generated explorations and record the chosen direction.
- Treat final vector/logo packaging as a separate follow-on step, not as something the initial generation prompt solves.

### Why this is the best first move

- It directly addresses the root problem: the current agent is not a logo generator.
- It uses an official, automatable API with both generation and editing semantics.
- It avoids the compliance/integration dead-end of Midjourney.
- It keeps Figma optional until Hive proves the core generation workflow is valuable.

### UX shift

Current UX:

- "Run brand-system, inspect inline SVG concepts in brand-guide.html."

Recommended UX:

- "Run brand-system to produce brand foundation + concept directions."
- "Run logo exploration to generate image-backed concepts."
- "Review a contact sheet / HTML board."
- "Select a winner."
- "Run finalization story for vector cleanup and brand package assets."

This is a better user contract. It makes clear that:

- concepting,
- selection, and
- final asset production

are different stages.

## 5. Integration Details

### Primary tool dependency

Tool: **OpenAI GPT Image**

Access model:

- API key in environment/config
- possible OpenAI org verification for image model access
- exposed to Hive through either:
  - an MCP server, or
  - a thin CLI wrapper invoked by an agent

Expected output artifacts:

- `.pHive/brand/logo-explorations/<timestamp>-contact-sheet.html`
- `.pHive/brand/logo-explorations/<timestamp>-*.png`
- `.pHive/brand/logo-explorations/<timestamp>-prompts.md`
- selection metadata appended into `.pHive/brand/brand-system.yaml` or adjacent YAML

Estimated implementation effort:

- **2-4 days** for first production-worthy pass

### No-cost / lower-commitment fallback

Tool: **Black Forest Labs FLUX hosted API or open-weight dev path**

Access model:

- BFL API key for hosted use
- or local/open-weight experimentation where licensing allows

Why it is the fallback:

- Official MCP guidance exists.
- It preserves the same architecture if OpenAI is not preferred.
- It is more integration-flexible than Midjourney.

## 6. Follow-on Story To Open After Endorsement

Proposed title:

`Add dedicated logo-exploration stage backed by OpenAI GPT Image`

Suggested scope:

- Add a new Hive skill or workflow step for logo exploration.
- Implement an MCP/CLI wrapper for OpenAI image generation and edits.
- Write prompt templates for logo concept board generation.
- Save image outputs and prompt provenance under `.pHive/brand/logo-explorations/`.
- Update brand-system reporting so the brand guide links to generated logo boards.
- Document human approval and final vectorization as required downstream steps.

## Conclusion

The current logo approach is weak because Hive is asking a wireframe-oriented agent to produce final-looking identity work through inline SVG concepts. The correct fix is not "better SVG prompting"; it is to split concept strategy from image generation and use a real image backend. As of 2026-05-17, the best first implementation path is a **hybrid pipeline using OpenAI GPT Image as the dedicated generation/edit backend**, with FLUX as the fallback and Figma as a later review enhancement rather than the foundation.
