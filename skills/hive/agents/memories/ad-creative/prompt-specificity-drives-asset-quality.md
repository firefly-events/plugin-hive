---
name: prompt-specificity-drives-asset-quality
description: "vague image-gen prompts produce generic, unusable assets; always anchor prompts to the campaign brief's specific audience, tone, and visual direction before generating"
type: pitfall
last_verified: 2026-06-22
ttl_days: 180
source: agent
---

A campaign brief contains four anchors that must appear in every image-gen prompt:
audience descriptor, emotional tone, visual style, and primary CTA object.

Without them, image generators default to stock-photo aesthetics that pass no brand review.

Before writing any image-gen prompt:
1. Read the marketing-strategist's campaign brief — specifically the positioning statement and visual direction sections.
2. Extract the four anchors above.
3. Open every prompt with `[audience] [tone] [style]` before describing the subject.

Example of a weak prompt that produces generic output:
> "A person holding a coffee cup in a cozy setting"

Example of a brief-anchored prompt:
> "Young professional, energetic morning tone, flat-art illustration style, holding a reusable tumbler with a city skyline behind them"

The difference in asset quality is significant. Reviewers will reject the first form immediately; the second form passes on first review more than 80% of the time.
