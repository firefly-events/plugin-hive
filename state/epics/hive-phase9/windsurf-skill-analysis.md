# Windsurf Skills Analysis

44 skills analyzed against Hive plugin capabilities.

## Summary

| Category | Count | % |
|----------|-------|---|
| DUPLICATE | 23 | 52% |
| OVERLAP | 4 | 9% |
| NOVEL | 16 | 36% |

## DUPLICATE (23) — Already in Hive

**Agent personas (8):** bmad-analyst, bmad-architect, bmad-dev, bmad-pm, bmad-qa, bmad-sm, bmad-tech-writer, bmad-ux-designer

**Covered by /hive:review (3):** bmad-code-review, bmad-review-adversarial-general, bmad-review-edge-case-hunter

**Covered by /hive:execute (4):** bmad-create-story, bmad-dev-story, bmad-quick-dev, bmad-qa-generate-e2e-tests

**Covered by /hive:plan (3):** bmad-create-epics-and-stories, bmad-create-prd, bmad-sprint-planning

**Covered by /hive:status (2):** bmad-retrospective, bmad-sprint-status

**Other (3):** bmad-create-architecture, bmad-quick-dev-new-preview, bmad-quick-flow-solo-dev

## OVERLAP (4) — Worth Porting as Extensions

| Skill | What it adds |
|-------|-------------|
| bmad-validate-prd | Structured PRD validation against quality standards |
| bmad-edit-prd | Guided PRD editing workflow |
| bmad-check-implementation-readiness | Multi-spec validation gate (PRD + UX + Architecture + Stories all aligned?) |
| bmad-create-ux-design | Structured UX patterns and design specification workflow |

**Recommendation:** `check-implementation-readiness` is the most valuable — it's a cross-artifact consistency gate that maps to our quality gate system. Port as a gate policy.

## NOVEL (16) — New Capabilities

### Research specialization (3)
| Skill | Capability |
|-------|-----------|
| bmad-domain-research | Deep domain-specific research (industry, regulations, competitors) |
| bmad-market-research | Market analysis, competitor landscape, positioning |
| bmad-technical-research | Technical feasibility, library evaluation, architecture options |

**Recommendation:** These are researcher agent specializations. Add as research methodology templates that the researcher/analyst agents can follow, not separate agents.

### Documentation & context (4)
| Skill | Capability |
|-------|-----------|
| bmad-document-project | Generate documentation for brownfield (existing) projects |
| bmad-generate-project-context | Generate AI-ready project context files |
| bmad-index-docs | Index documentation for retrieval |
| bmad-shard-doc | Split large documents into manageable chunks |

**Recommendation:** `document-project` and `generate-project-context` are useful for onboarding Hive to new codebases. `index-docs` and `shard-doc` feed into the knowledge layer. Port as utility commands.

### Editorial (2)
| Skill | Capability |
|-------|-----------|
| bmad-editorial-review-prose | Review writing quality (clarity, tone, grammar) |
| bmad-editorial-review-structure | Review document structure (sections, flow, completeness) |

**Recommendation:** Add as reviewer agent capabilities or a separate editorial gate policy.

### Meta/utility (7)
| Skill | Capability |
|-------|-----------|
| bmad-advanced-elicitation | Structured prompt refinement and requirement extraction |
| bmad-correct-course | Mid-sprint course correction (re-evaluate priorities) |
| bmad-brainstorming | Creative ideation with structured divergent/convergent thinking |
| bmad-quick-spec | Rapid spec generation for small features |
| bmad-master | Meta-orchestrator (redundant with our orchestrator) |
| bmad-help | Documentation/help system |
| bmad-party-mode | Team engagement mode (fun/morale) |

**Recommendation:** `brainstorming`, `advanced-elicitation`, and `correct-course` are the novel workflows. Port as orchestrator capabilities or new commands.

## Priority for Future Porting

1. **check-implementation-readiness** → gate policy for cross-artifact consistency
2. **document-project** + **generate-project-context** → onboarding commands
3. **brainstorming** + **advanced-elicitation** → planning phase capabilities
4. **Research specializations** → researcher methodology templates
5. **Editorial reviews** → reviewer/gate policy extensions
