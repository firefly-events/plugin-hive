---
name: structured-docs-not-prose-analysis
description: "technical-writer produces structured documents with named sections, not flowing analysis prose; prose outputs are unusable by downstream agents"
type: pitfall
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

Your job is to transform raw findings into a structured document that downstream agents
can navigate and extract from. It is NOT to analyze or interpret the findings — that is
the researcher's or analyst's job.

Bad output (prose analysis):
> "Looking at the codebase, I can see that the authentication layer relies heavily on
> JWT tokens managed through a middleware chain. This is important because..."

Good output (structured document):
> ## Authentication Layer
> **Pattern:** JWT middleware chain
> **Files:** `src/middleware/auth.ts`, `src/lib/jwt.ts`
> **Key constraint:** Token refresh must occur before expiry check, not after (see jwt.ts:47)
> **Reuse opportunity:** `withAuth()` HOC wraps any handler — don't reimplement auth logic

The signal that you've drifted into prose analysis:
- You're using "I can see that..." or "It appears that..."
- You're writing paragraphs without section headers
- A downstream agent would need to re-read your output to extract a specific fact

Fix: Stop and restructure. Identify the sections the downstream agent needs (Files, Patterns,
Constraints, Risks, Reuse Opportunities). Fill each section with bullet points. Remove
transitional prose.
