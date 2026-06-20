# b7 — Shared Visual-Asset Skill Insights

## The two-backend split is load-bearing

Frame0 and openai-image are not interchangeable: Frame0 produces structured `.f0` project files (JSON shape hierarchy) that only Frame0 desktop can render; openai-image produces raster PNGs via a model call. The `medium` field is the only correct discriminator — do not try to infer it from the prompt text.

## Callers own the output path, skill owns the tool plumbing

The hardest design question was whether to centralise path conventions or let callers choose. Centralising would have forced a single output structure on ui-designer, logo-exploration, and ad-creative — each of which has its own artifact contract already established. Caller-supplied `output_dir` was the right call: each caller passes its own dir and the skill writes there without knowing or caring what convention the caller uses.

## ad-creative (b3) was wired before the skill existed

The `hive/agents/ad-creative.md` persona was written in story b3 with `skills: - path: hive/skills/visual-asset` already in its frontmatter, pointing forward to this story. No change to ad-creative was needed — the wiring was speculative and correct.

## logo-exploration and ui-designer are NOT rewritten by this story

The scope guard was explicit: this story creates the shared surface; it does not rewrite logo-exploration's process or ui-designer's step files. Those agents can adopt the skill in follow-on stories. The "See also" and "Callers" sections in SKILL.md document the intended adoption path without forcing it now.

## Fallbacks must be visible

Both backends have a fallback path (ASCII spec for Frame0 unavailable; prompt file for MCP unavailable). The key invariant: never silently degrade. The `fallback_used` flag in the return record lets callers detect and surface the degraded path to the user rather than presenting a missing asset as success.

## openai-image error propagation

The MCP tool returns a 403 as "API access may require a verified OpenAI organization". This must propagate verbatim — masking it leads to confusion about whether the call succeeded. Established in logo-exploration (ulo-1); carried forward here.
