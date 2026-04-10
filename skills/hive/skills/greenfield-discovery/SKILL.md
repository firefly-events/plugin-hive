# Greenfield Product Discovery

Facilitate a deep product discovery conversation that transforms a raw idea into a structured discovery brief. This is NOT a requirements-gathering session — it's an exploratory, Socratic dialogue that helps the developer think through what they're building and why.

**Input:** `$ARGUMENTS` contains the user's initial idea or concept (may be vague or detailed). Also receives any context from kickoff-protocol.md GF Step 1.

## When to Use

- **Greenfield kickoff** — GF Step 1 delegates here instead of inline brainstorming
- **Analyst agent in creative/exploratory mode** — not requirements-analysis mode
- Any time a new product idea needs structured exploration before planning begins

## When NOT to Use

- Brownfield projects (existing codebase — use discovery phases instead)
- Requirements are already documented in a brief or PRD
- The user explicitly wants to skip discovery and go straight to planning

## Tone & Facilitation Style

**Be a curious collaborator, not an interrogator.** The goal is to help the developer think out loud — surface assumptions, explore possibilities, and arrive at clarity together.

- **Conversational:** Talk like a senior product thinker at a whiteboard, not a form processor
- **Socratic:** Ask follow-up questions that deepen thinking — "What happens if that assumption is wrong?" "Who else has this problem?"
- **Exploratory:** Follow interesting threads. If the user says something surprising, dig into it
- **Opinionated (gently):** Offer perspective — "In my experience, projects like this tend to underestimate X" — but defer to the user's judgment
- **Adaptive:** If the user has clearly thought through an area, don't belabor it. Spend time where there's genuine uncertainty

**Anti-patterns to avoid:**
- Rapid-fire question lists (feels like an interview, not a conversation)
- Asking all 7 areas sequentially like a form (weave naturally based on flow)
- Accepting vague answers without probing ("users will love it" — who specifically?)
- Being so open-ended that the conversation never converges
- Restating everything the user said back to them verbatim (summarize, don't parrot)

## Facilitation Protocol

Cover all 7 areas during the conversation. The order is flexible — follow the natural flow of discussion. Each area has seed questions to start with, but follow-up questions should emerge organically from the user's responses.

### Area 1: Problem Space Exploration

Understand the problem before the solution.

- "What problem are you trying to solve? Who has this problem today?"
- "How do people currently deal with this? What's painful about the status quo?"
- "How did you discover this problem? Personal experience, user research, market gap?"
- "How urgent is this problem? Is it a hair-on-fire problem or a nice-to-have improvement?"

**What you're listening for:** Is this a real problem with evidence, or a solution looking for a problem? How well does the developer understand the problem space?

### Area 2: Target User Definition

Get specific about who this is for.

- "Who specifically would use this? Paint me a picture of your primary user."
- "What's their context when they'd reach for this? What are they trying to accomplish?"
- "Are there different types of users with different needs? Who's the primary persona vs. secondary?"
- "What's the user's current workflow? Where does your product fit in?"

**What you're listening for:** Concrete personas vs. "everyone." Jobs-to-be-done framing. Whether the developer has talked to actual potential users.

### Area 3: Competitive & Alternative Landscape

Understand what already exists.

- "What else exists in this space? What are people using today?"
- "Have you tried the alternatives? What's good and bad about them?"
- "Why wouldn't someone just use [obvious alternative]?"
- "Is this a new category or a better mousetrap? Both are valid — but the strategies differ."

**What you're listening for:** Awareness of the competitive landscape. Whether the differentiation is real or assumed. Build vs. buy considerations.

### Area 4: Key Differentiators

What makes this worth building?

- "If this exists in 6 months, what's the one thing that makes someone choose it over alternatives?"
- "What's your unfair advantage? Technical insight, domain expertise, unique data, distribution?"
- "Is the differentiation sustainable or could a competitor copy it in a week?"
- "What would make someone switch from their current solution to yours?"

**What you're listening for:** A clear, defensible value proposition. Whether the differentiation is meaningful to users (not just technically interesting).

### Area 5: Success Metrics

How will you know it's working?

- "If this launches and is successful, what does that look like in 3 months? 12 months?"
- "What's the one metric that tells you this is working?"
- "What's the minimum bar for 'this was worth building'?"
- "Are there leading indicators you can track before full success is measurable?"

**What you're listening for:** Measurable outcomes vs. vanity metrics. Whether success is defined from the user's perspective or the builder's.

### Area 6: MVP Boundary Definition

The most critical area for scope. Spend extra time here.

- "If you had to ship something useful in 2 weeks, what would it do?"
- "What features feel essential but could actually wait for v2?"
- "What's the simplest version that would let you learn whether this idea works?"
- "Let's make an explicit 'NOT in v1' list — what are you deliberately excluding?"

**What you're listening for:** Scope discipline. Whether the developer can distinguish "must have for learning" from "nice to have for polish." The explicit exclusion list is as valuable as the inclusion list.

**Capture explicitly:**
- **v1 scope:** What's in the first release
- **v2+ backlog:** What's explicitly deferred (and why)
- **Hard exclusions:** What this product will never do (and why)

### Area 7: Technical Constraints Surfacing

Surface constraints that shape architecture decisions downstream.

- "Do you have a platform in mind? Web, mobile, API, CLI, desktop?"
- "Any performance requirements? Real-time, batch, high-throughput?"
- "Compliance or regulatory constraints? HIPAA, GDPR, SOC2, PCI?"
- "Infrastructure preferences or constraints? Cloud provider, self-hosted, serverless?"
- "Are there integration requirements? What other systems does this need to talk to?"

**What you're listening for:** Hard constraints vs. preferences. Platform decisions that cascade into architecture. Compliance requirements that affect data model design.

**Capture the project-type signal** (mobile/web/API/CLI/desktop/hybrid) — this feeds downstream tool selection and cross-cutting concern generation.

## Output Format

After the conversation, synthesize everything into a **Product Discovery Brief**. This is the structured input for GF Step 2 (Product Brief synthesis).

```markdown
## Product Discovery Brief

### Problem Statement
{1-3 sentences: the core problem, who has it, why it matters}

### Target Users
- **Primary persona:** {who, context, job-to-be-done}
- **Secondary persona(s):** {if any}
- **User evidence:** {how the developer knows these users exist — research, experience, assumption}

### Competitive Landscape
- **Existing alternatives:** {what people use today}
- **Key gaps in alternatives:** {why alternatives fall short}
- **Build rationale:** {why building new is better than using/extending existing}

### Value Proposition
- **Core differentiator:** {the one thing that makes this worth choosing}
- **Unfair advantage:** {what's hard to replicate}
- **Switching motivation:** {why someone would leave their current solution}

### Success Metrics
- **Primary metric:** {the one number that matters}
- **Secondary metrics:** {supporting indicators}
- **Minimum success bar:** {what "worth building" means}

### MVP Scope
**In v1:**
- {feature/capability — with user value}
- {feature/capability — with user value}

**Deferred to v2+:**
- {feature — reason for deferral}

**Hard exclusions (never):**
- {capability — rationale}

### Technical Constraints
- **Platform:** {web/mobile/API/CLI/desktop/hybrid}
- **Performance:** {requirements or "no special requirements"}
- **Compliance:** {requirements or "none identified"}
- **Infrastructure:** {preferences/constraints or "no constraints"}
- **Integrations:** {required external systems or "none"}

### Key Decisions Made
{Bulleted list of decisions reached during the conversation, with brief rationale}

### Open Questions
{Numbered list of unresolved questions that need answers before or during implementation}

### Session Notes
{Brief narrative summary of the conversation flow — what topics generated the most discussion, where the developer had strong convictions vs. uncertainty, any pivots in thinking}
```

Write the discovery brief to `state/planning/product-discovery-brief.md`.

## Conversation Flow Guidelines

1. **Start warm.** If `$ARGUMENTS` has a description, acknowledge it and ask the first natural follow-up. If not, open with: "Tell me about what you're thinking of building — even if it's rough, we'll shape it together."

2. **Don't ask all areas upfront.** Start with Problem Space (Area 1), then let the conversation flow naturally. Most conversations will naturally touch Users (Area 2) and Alternatives (Area 3) early. MVP (Area 6) and Constraints (Area 7) tend to come later.

3. **Track coverage silently.** Keep mental track of which areas you've covered. When the conversation is flowing well but hasn't touched an area, bridge to it naturally: "You mentioned X — that makes me curious about Y..."

4. **Converge explicitly.** When all areas are sufficiently explored, signal the transition: "I think I have a good picture. Let me synthesize what we've discussed into a discovery brief — take a look and tell me what I got wrong."

5. **Present the brief for validation.** After writing the discovery brief, present a summary and ask the user to confirm or correct before proceeding to GF Step 2.

6. **Capture the project-type signal.** The platform choice (Area 7) feeds directly into cross-cutting concern generation and tool selection. Make sure this is explicit in the output.
