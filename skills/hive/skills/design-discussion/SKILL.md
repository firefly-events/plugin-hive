# Design Discussion

Produce a ~200-line design discussion document from raw research findings. This is a developer brain dump — informal, comprehensive, and opinionated. The reader should walk away understanding what the agent thinks it's about to do, what worries it, and what it doesn't know yet.

**Input:** Raw research findings from the researcher agent, plus the original user request.

## Tone

Write like a senior developer talking through their plan at a whiteboard. Direct, informal, opinionated. Use "I think", "my concern is", "the tricky part is". Not a formal spec — a conversation starter.

## Document Structure

### 1. What Are We Doing? (~20 lines)

State the goal in plain language. What does the user want? What problem does this solve? What does "done" look like? Be specific — "add caching to the event API" not "improve performance."

### 2. What I Found (~40 lines)

Summarize the key research findings that shape the approach:
- Relevant files and their roles (cite paths)
- Existing patterns we should follow
- Conventions that constrain our choices
- Prior art in the codebase (has something similar been done before?)

Don't dump the raw research — distill it. Every finding should connect to a decision or risk.

### 3. My Proposed Approach (~40 lines)

Walk through how you'd implement this, step by step:
- What changes first, what depends on what
- Which files get modified and roughly how
- Which existing utilities/patterns to reuse
- Where new code goes and why there

Be concrete: "I'd add a `cache` middleware in `src/middleware/cache.ts` that wraps the existing `eventService.list()` call" — not "add caching somewhere."

### 4. What Could Go Wrong (~30 lines)

Risks, cascading effects, and things that make you nervous:
- Files or systems that might break from these changes
- Assumptions that might be wrong
- Performance, security, or compatibility concerns
- Migration or backward-compatibility issues
- Edge cases you're not sure about

Rate each: **high** (could block us), **medium** (needs attention), **low** (worth noting).

### 5. Dependencies and Constraints (~20 lines)

What this work depends on or is blocked by:
- External dependencies (libraries, APIs, services)
- Internal dependencies (other stories, other teams' work)
- Environment constraints (CI, deployment, feature flags)
- Time-sensitive factors (deprecations, API changes, release windows)

### 6. Open Questions (~20 lines)

Things you don't know and need answered before (or during) implementation:
- Ambiguities in the request
- Design decisions that could go either way
- Information you couldn't find in the codebase
- Questions for the user about intent or priority

Number each question so the user can reference them in feedback.

### 7. Verification Strategy (~20 lines)

How will we verify this work actually works? Be specific about tools and approach, not test code:

- **What tools/frameworks** — Maestro for mobile E2E, Playwright for browser, pytest for backend, Jest for frontend unit tests, etc. Name the actual tools based on what the project uses.
- **What platforms** — Android and iOS for KMP, Chrome/Firefox/Safari for web, specific API environments for backend
- **What types of verification** — unit tests, integration tests, E2E flows, performance testing, manual verification steps
- **What's the verification scope** — which acceptance criteria get automated tests vs manual checks
- **What's NOT being verified** — explicitly call out anything we're skipping and why (e.g., "not load testing for this change — scope is too small")

```
VERIFICATION PLAN:
  Tools: {list of test frameworks/tools}
  Platforms: {list of target platforms}
  Automated: {what gets automated tests}
  Manual: {what needs manual verification}
  Not verifying: {what we're skipping and why}
```

This section gives the user early visibility into the verification approach so they can course-correct before implementation begins — "you're not testing iOS" or "you need performance testing here" or "that manual step should be automated."

### 8. Scale Assessment (~30 lines)

Evaluate the scope of this work:

**Size indicators:**
- How many files will be modified?
- How many subsystems are affected?
- Are there migration or data changes?
- Is there cross-team or cross-service coordination?
- Are there unknowns that could expand scope?

**Recommendation:** Based on the above, recommend whether this request needs a full Structured Outline before story decomposition, or if this Design Discussion provides sufficient context to proceed directly.

```
SCALE ASSESSMENT:
  Files affected: ~{N}
  Subsystems: {list}
  Migration required: yes/no
  Cross-team coordination: yes/no
  Unknowns: {count}

  RECOMMENDATION: [Proceed to stories | Needs structured outline]
  RATIONALE: {why}
```

## Output Guidelines

- Write the finished document to `.pHive/epics/{epic-id}/docs/design-discussion.md`
- Target ~200 lines (150-250 is fine)
- Every claim references a specific file, pattern, or finding from the research
- Open questions are numbered for easy reference
- The scale assessment is the last section — it's the decision point for what happens next
- Do NOT include implementation code — this is a discussion, not a PR
