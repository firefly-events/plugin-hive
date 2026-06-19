# S2.1 — design-discussion structural split insights

## The review-doc guard is the backwards-compat mechanism

Full-mode callers pass the epic id alone (`design-discussion {epic-id}`). The routing table dispatches produce-doc then review-doc in sequence. `review-doc` self-exits when `planning.collaborative_review: false`. This means adding the two-step dispatch is safe without touching any caller — the existing behavior is preserved by the guard, not by a separate wrapper.

## $ARGUMENTS already carried the epic id — keyword routing prepends, not replaces

The pre-split skill received `$ARGUMENTS = {epic-id}`. After the split, lite callers send `$ARGUMENTS = produce-doc {epic-id}`. The parse rule (first token is keyword if it matches produce-doc or review-doc, rest is epic id) threads this needle cleanly. No caller needs to change their epic-id passing convention.

## Caller enumeration: only one active invocation site

All callers found in `skills/`:
- `skills/plan/SKILL.md` — the primary caller (Phase B step 4, Phase A2 revision pass). Both invocations send the epic id as `$ARGUMENTS` without a keyword. After S2.2 lands, the lite-mode path will prepend `produce-doc`; the full-mode path stays as-is.
- `skills/hive/skills/planning-routing/SKILL.md` — references the skill by name in prose/annotations only; not an invocation site.
- `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` — references by name in prose; not an invocation site.
- `skills/hive/skills/horizontal-plan/SKILL.md` — references design-discussion as INPUT, not as a skill it calls.
- `skills/hive/skills/design-mode-multica/SKILL.md` — references design-discussion §6 in a comment; not an invocation site.
- `skills/grill/SKILL.md` — says "Phase A2 calls design-discussion with the grill-record path as input" — this is the revision pass invocation, still in plan/SKILL.md, not grill itself calling design-discussion.

## The "both happen in one invocation" assumption was correct for produce-doc only

Despite the story framing, the original skill ONLY produced the document. The collaborative review (now review-doc) was already in plan/SKILL.md step 4b, not in design-discussion/SKILL.md. The structural split consolidates the review logic INTO the skill so it becomes addressable — moving ownership, not splitting something that was truly unified.

## S2.2 MUST update plan/SKILL.md step 4b

After S2.1, plan/SKILL.md step 4b's collaborative review gate description duplicates review-doc's new content. S2.2 should replace step 4b with a single call to `design-discussion review-doc {epic-id}` (or rely on the full-mode dispatch via `design-discussion {epic-id}`). If S2.2 doesn't clean this up, the review gate will be described in two places with risk of drift.
