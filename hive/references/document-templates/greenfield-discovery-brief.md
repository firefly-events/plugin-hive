# Greenfield Discovery Brief — schema

Output schema for the analyst's greenfield-discovery facilitation mode. The analyst conducts the conversation (see `hive/agents/analyst.md` "Greenfield Discovery Facilitation" section) and writes the populated brief to `.pHive/planning/product-discovery-brief.md`.

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

## Field requirements

- **Problem Statement** — 1-3 sentences, must include who has the problem
- **Target Users.Primary persona** — concrete description, not "everyone"; jobs-to-be-done framing
- **Target Users.User evidence** — explicit (research / personal experience / assumption)
- **Value Proposition.Core differentiator** — singular, defensible
- **Success Metrics.Primary metric** — measurable; numeric target preferred over directional ("more" / "better")
- **MVP Scope.In v1** — every entry includes user value
- **MVP Scope.Hard exclusions** — explicit "never" list with rationale
- **Technical Constraints.Platform** — single project-type signal that feeds downstream tool selection

## Used by

- `hive/agents/analyst.md` — greenfield-discovery facilitation mode
- `hive/references/kickoff-protocol.md` — GF Step 1 produces this; GF Step 2 (Product Brief synthesis) consumes
- Greenfield kickoff flow — see kickoff-protocol.md for the full discovery → brief → planning chain
