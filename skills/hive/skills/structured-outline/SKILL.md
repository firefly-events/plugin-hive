# Structured Outline

Produce a ~1000-line structured outline from a design discussion and user feedback. This is the detailed plan — specific enough that story decomposition becomes mechanical rather than creative. The document ends with adversarial elicitation questions that force the user to stress-test the plan before committing.

**Input:** The design discussion document, user feedback/corrections on the design discussion, and the original research findings.

## Tone

Precise and structured but still readable. This is an engineer's blueprint, not a legal contract. Use headers, bullet points, and short paragraphs. Code examples where they clarify intent — but this is a plan, not an implementation.

## Document Structure

### Part 1: Executive Summary (~50 lines)

Synthesize the design discussion and user feedback into a clear statement of:
- What we're building and why
- How the user's feedback changed or confirmed the original approach
- Key decisions that are now locked (cite which feedback confirmed them)
- The overall implementation strategy in 3-5 sentences

**Product Goals (optional sub-section)** — include when the plan has explicit success metrics, stakeholders, or scope boundaries worth documenting. Omit for internal tooling or single-developer stories where this produces empty boilerplate.

```
PRODUCT GOALS (optional):
  Success metrics: [measurable outcomes — e.g., "P95 search latency < 200ms", "zero auth regressions"]
  Non-goals: [explicit out-of-scope — e.g., "venue search is not in this epic"]
  Stakeholders: [who is affected or needs to sign off — e.g., "mobile team, API consumers"]
```

### Part 2: Detailed Approach (~300 lines)

Break the implementation into phases or stages. For each phase:

```
## Phase N: {Name}

**Goal:** What this phase accomplishes
**Depends on:** Which phases must complete first

### Changes

1. **{file-path}**
   - What changes and why
   - Key functions/methods affected
   - Expected behavior before and after
   - Edge cases to handle

2. **{file-path}**
   ...

### Interfaces

If this phase introduces or modifies interfaces (APIs, function signatures, data formats):
- Define the contract explicitly
- Show input/output types
- Document error conditions

### Validation

How to verify this phase is correct before moving on:
- What to test (specific scenarios, not "write tests")
- What to check manually
- What could silently break
```

### Part 3: Verification Plan (~100 lines)

Expand the design discussion's verification strategy into a detailed plan. This is one of the most critical sections — the user needs to see exactly how work will be verified before committing to implementation.

**Per-phase verification:**

For each phase in Part 2, specify how that phase's work is verified:

```
Phase 1 verification:
  Automated:
    - Unit test: SearchService returns expected results for dummy data (Jest)
    - Component test: SearchResultCard renders all fields (React Testing Library)
  Manual:
    - Visual check: search UI matches wireframe on iPhone 15 and Pixel 8
  Tools: Jest, React Testing Library
  Platforms: iOS simulator, Android emulator

Phase 2 verification:
  Automated:
    - Integration test: GET /api/search returns real user results (pytest)
    - E2E test: type query → see real results (Maestro on device)
  Manual:
    - Verify API response time < 200ms for typical queries
  Tools: pytest, Maestro
  Platforms: iOS device (UDID from config), Android emulator
```

**Verification coverage matrix:**

```
| Acceptance Criterion | Test Type | Tool | Phase |
|---------------------|-----------|------|-------|
| Search returns users | Integration + E2E | pytest + Maestro | 2 |
| Search returns events | Integration + E2E | pytest + Maestro | 3 |
| Results render correctly | Component + Visual | RTL + manual | 1 |
```

**What's NOT being verified and why:**
- List anything explicitly excluded from verification with rationale
- The user can push back here ("actually we DO need load testing")

### Part 3b: Cross-Cutting Concerns (~80 lines)

Address concerns that span multiple phases:
- **Error handling strategy** — how errors propagate, what gets caught where
- **Migration plan** — if data or schema changes, how to migrate safely
- **Rollback plan** — if this fails in production, how to revert
- **Performance implications** — any changes that affect latency, memory, or throughput
- **Documentation impact** — will this change require updates to README, GUIDE, reference docs, or API docs? Flag which docs are likely affected so the post-implementation doc check has a head start
- **Security considerations** — new attack surfaces, auth changes, data exposure

### Part 4: File Change Manifest (~150 lines)

Complete list of every file that will be created, modified, or deleted:

```
FILES:

CREATE:
  - path/to/new/file.ts — purpose
  - path/to/new/test.ts — tests for above

MODIFY:
  - path/to/existing.ts — what changes (brief)
  - path/to/config.yaml — add new field

DELETE:
  - path/to/deprecated.ts — replaced by new/file.ts

UNCHANGED (but affected):
  - path/to/consumer.ts — imports from modified file, verify still works
```

### Part 5: Risk Registry (~100 lines)

Expand on the design discussion's "What Could Go Wrong" with mitigation strategies:

| # | Risk | Severity | Likelihood | Mitigation | Owner |
|---|------|----------|------------|------------|-------|
| 1 | {risk} | high/med/low | high/med/low | {specific action} | {which agent/phase} |

For high-severity risks, include a detailed mitigation plan (not just "be careful").

### Part 6: Dependency Map (~50 lines)

```
INTERNAL DEPENDENCIES:
  Phase 2 depends on Phase 1 (interface defined in Phase 1 consumed in Phase 2)
  Story X depends on Story Y (shared utility created in Y, used in X)

EXTERNAL DEPENDENCIES:
  Library: {name}@{version} — {what we need from it}
  Service: {name} — {what API we call, what happens if it's down}

BLOCKING QUESTIONS:
  - {any unresolved questions that block specific phases}
```

### Part 7: Elicitation — Stress-Testing This Plan (~200 lines)

The agent team answers these adversarial questions about its own plan. This is self-critique, not homework for the user. The user reads the answers to evaluate whether the team's thinking is sound — if an answer is weak or wrong, that's a signal to push back before committing.

#### Why Won't This Work?

Identify the 3-5 most likely failure modes for this plan. For each, the agent provides:
- **Failure:** What specifically goes wrong
- **Trigger:** What condition or assumption causes it
- **Impact:** What breaks if this happens
- **Signal:** How we'd detect this during implementation (not after deployment)
- **Our answer:** Why we believe this won't happen, or what we'll do if it does

#### What Assumptions Are We Making?

List every assumption the plan depends on. The agent marks each as:
- **VERIFIED** — confirmed by research or user feedback (cite the source)
- **ASSUMED** — reasonable but not confirmed (explain why we're comfortable proceeding)
- **RISKY** — could be wrong and would change the plan significantly (explain what changes if wrong)

#### What's the Simplest Version?

The agent identifies what's core vs what's optional if scope needs to shrink:
- **Must have:** {capabilities that define "done" — explain why each is essential}
- **Should have:** {capabilities that improve quality — explain value vs cost}
- **Could cut:** {capabilities we included but could defer — explain what we'd lose}

#### What Will We Wish We Had Thought Of?

The agent projects forward 2 weeks after implementation and identifies the most likely regrets:
- Technical debt we're knowingly taking on — and why the trade-off is acceptable now
- Edge cases we're deferring — and why they're safe to defer
- Integration points we haven't fully validated — and what we'll do if they break
- User workflows we haven't considered — and why we believe coverage is sufficient

#### Where Are We Over-Engineering?

The agent honestly evaluates whether any part of the plan is more complex than needed:
- Abstractions that only have one consumer — why we still want them (or don't)
- Error handling for unlikely scenarios — why it's worth it (or isn't)
- Configurability that wasn't requested — why we added it (or should remove it)
- Backward compatibility for things with few consumers — whether to keep or drop

### Part 8: Decision Points for Sign-Off (~50 lines)

Summarize the key decisions the user needs to approve:

```
DECISIONS REQUIRING SIGN-OFF:

1. [APPROACH] {decision} — {the two options considered, which we chose, why}
   → Affirm / Change direction

2. [SCOPE] {what's in vs out} — {rationale}
   → Affirm / Adjust scope

3. [RISK ACCEPTANCE] {risk we're accepting} — {mitigation}
   → Accept / Require mitigation

4. [TRADE-OFF] {what we're trading for what} — {rationale}
   → Affirm / Reconsider
```

### Part 9: Multi-Epic Coordination (optional — only when plan spans multiple epics)

Omit this section entirely for single-epic plans. Only produce Part 9 when the structured outline describes work that crosses epic boundaries or depends on outputs from other epics.

```
## Part 9: Multi-Epic Coordination

### Cross-Epic Dependency Table

| This Epic | Depends On | Dependency Type | Blocking? |
|-----------|-----------|-----------------|-----------|
| {epic-id} | {other-epic-id} | {shared data / API contract / file / infra} | yes / no |

### Shared State Conventions

Files, paths, or data formats shared across epics — each consumer needs to coordinate on these:
- {path or resource}: {what it is, who writes, who reads}

### Handoff Points

What must Epic A deliver before Epic B can start:
- {Epic A deliverable} → unblocks → {Epic B work item}
- {e.g., "auth-service API contract finalized"} → unblocks → {e.g., "mobile-client auth integration"}
```

## Output Guidelines

- Write the finished document to `.pHive/epics/{epic-id}/docs/structured-outline.md`
- Target ~1000 lines (800-1200 is fine)
- Every file reference must be a real path from the research findings
- The elicitation section (Part 7) is the most important — it's what differentiates this from a generic spec
- Decision points (Part 8) must be numbered and actionable — the user responds with "1: affirm, 2: adjust to X, 3: accept"
- Do NOT include implementation code beyond short interface examples
- The structured outline consumes the design discussion — don't repeat it, build on it
