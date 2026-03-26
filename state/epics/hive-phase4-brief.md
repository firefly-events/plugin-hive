# Phase 4 Brief: Agent Roster Expansion + UI Agent + Fixes

**Status:** Ready to plan
**Date:** 2026-03-25
**Prerequisites:** Phases 1-3 complete

---

## 1. Fixes from Phases 1-3

### Fix skill routing
The `/hive:hive` catch-all skill still gets matched by Claude's skill matcher even after
removing SKILL.md. ORCHESTRATOR.md in `skills/hive/` may be getting picked up. Need to
either rename it to something the plugin system ignores, or restructure so `skills/hive/`
isn't scanned as a skill directory.

### Add episode record writing
Execution currently creates files but doesn't write episode YAML records to
`state/episodes/`. The execute command and subagents need to follow the episode protocol
defined in `skills/hive/references/episode-schema.md`. Without episodes, `/hive:status`
can't track progress.

---

## 2. New Agent Personas (from Hive blueprints)

### Architect
- Source: `/Users/don/Documents/project-hive/blueprints/planning-team/architect.yaml`
- Role: System design, technology evaluation, API design, scalability patterns
- Used in: planning phases, architecture review, technology decisions
- File: `skills/hive/agents/architect.md`

### Analyst / PM
- Source: `/Users/don/Documents/project-hive/blueprints/planning-team/pm.yaml` and `analyst.yaml`
- Role: Requirements decomposition, scope management, stakeholder communication
- May combine PM + analyst into one persona or keep separate
- File: `skills/hive/agents/analyst.md` (or `pm.md`)

### Hive Orchestrator
- NEW — no Hive blueprint source, design from scratch
- Role: Meta-agent that understands the full Hive system. Coordinates complex
  multi-epic work, decides when to parallelize, routes work to the right agents,
  manages cross-epic dependencies.
- This is the "team lead" persona for agent teams — the prompt that the lead
  session uses when coordinating teammates.
- File: `skills/hive/agents/orchestrator.md`

---

## 3. UI Agent (NEW — most complex piece)

### Role
A visual design agent that handles all UI-related work:
- **Wireframing** — moderate fidelity wireframes via Frame0 CLI
- **Marketing materials** — social media graphics, landing page mockups
- **Advertising creatives** — ad banners, promotional assets
- **App store assets** — screenshots, feature graphics
- **Brand collateral** — pitch decks, one-pagers
- **Icons and illustrations** — via available image generation tools

### Tool Discovery
The UI agent's first action is to discover which visual tools are available:
- `cli-anything-frame-zero` — wireframing (check PATH: `/Library/Frameworks/Python.framework/Versions/3.13/bin/cli-anything-frame-zero`)
- Image generation MCP tools (check session's available MCP tools)
- Any other visual/design tools in the environment

Source location: `~/Documents/WorkFlow/frame-zero/`

### Frame0 CLI Reference
```
cli-anything-frame-zero [OPTIONS] COMMAND [ARGS]...
  --json          Output in JSON format
  --project PATH  Path to .f0 project file
  --port INTEGER  Frame0 API port
  --live          Send commands to running Frame0 (live canvas updates)

Commands:
  shape    Shape creation and manipulation
  page     Page management (add, list, rename, delete, duplicate)
  export   Export wireframes as images (requires Frame0 running)
  icon     Search and browse the Lucide icon library
  image    Embed an image from a file
  link     Set navigation links on shapes
  align    Align or distribute shapes
  project  Project management (new, open, save, info)
  session  Session management (status, undo, redo)
```

### Wireframe Workflow with Human Touchpoints

1. **Research** — Read story spec, identify UI requirements (screens, components, flows)
2. **Discover tools** — Check for Frame0 CLI, image generation APIs, etc.
3. **Generate renditions** — Create N wireframe versions (default 1, configurable via `--renditions N` on the execute command)
4. **Export** — Export all renditions as PNG: `cli-anything-frame-zero --live export page --page-id {id} --format png --output /path/to/wireframe-v{N}.png`
5. **TOUCHPOINT 1: Wireframe approval** — Present all renditions to the user. User picks one, requests changes, or asks for more options. If changes requested, iterate (back to step 3 with feedback).
6. **Finalize** — Lock the approved wireframe
7. **TOUCHPOINT 2: Story brief sign-off** — Present the wireframe brief and CLI references that will be embedded in the story file. User confirms before downstream agents see it.
8. **Append to story** — Add to the story YAML file:
   - Wireframe image path(s)
   - CLI export commands for downstream agents to pull images into context
   - Design brief summarizing the wireframe decisions

### Renditions Config
- Default: 1 rendition
- User specifies: `--renditions 3` on `/hive:execute` or in story config
- Each rendition is a variation (different layout, different component arrangement)
- User picks the winner at Touchpoint 1

### Story File Additions (appended by UI agent)
```yaml
wireframes:
  approved: /path/to/wireframe-approved.png
  brief: |
    Single-screen event detail view with hero image, date block, RSVP buttons,
    and social proof section. Compact layout for bottom sheet context.
  export_command: |
    cli-anything-frame-zero --live export page --page-id "kKlkBtzPfoSV7KmkW50Do" --format png --output /tmp/wireframe.png
  renditions:
    - /path/to/wireframe-v1.png
    - /path/to/wireframe-v2.png
    - /path/to/wireframe-v3.png
  selected: 1
```

---

## 4. UI-Aware Planning

### Change to `/hive:plan`
When decomposing a requirement, the plan command should detect when stories involve
net-new UI (new screens, new components, visual redesigns) and automatically:
1. Add a `ui-design` step BEFORE the implementation step in those stories
2. Assign the UI agent to that step
3. Include wireframe approval touchpoints in the step definition
4. The UI step's output (wireframe references) feeds into the implementation step

### Detection Heuristics
Stories likely need UI work when they mention:
- "screen", "view", "page", "modal", "dialog", "sheet"
- "button", "form", "input", "component"
- "redesign", "layout", "visual", "UI", "UX"
- "marketing", "landing page", "ad creative", "banner"

---

## 5. Estimated Stories

1. **fix-skill-routing** — resolve /hive:hive matcher issue (low)
2. **episode-writing** — add episode records to execution flow (medium)
3. **architect-agent** — port architect blueprint (low)
4. **analyst-agent** — port PM/analyst blueprint (low)
5. **orchestrator-agent** — design Hive orchestrator meta-agent (medium)
6. **ui-agent** — create UI agent with tool discovery + Frame0 integration (high)
7. **ui-touchpoints** — human approval flow for wireframes with rendition support (medium)
8. **ui-aware-planning** — update plan command to detect and inject UI steps (medium)
9. **ui-marketing** — extend UI agent for marketing/advertising materials (medium)

Dependency graph:
```
fix-skill-routing (independent)
episode-writing (independent)
architect-agent (independent)
analyst-agent (independent)
orchestrator-agent (independent)
ui-agent ──→ ui-touchpoints ──→ ui-aware-planning
         └──→ ui-marketing
```

---

## References

- Hive blueprints: `/Users/don/Documents/project-hive/blueprints/`
- Frame0 CLI: `/Library/Frameworks/Python.framework/Versions/3.13/bin/cli-anything-frame-zero`
- Frame0 source: `~/Documents/WorkFlow/frame-zero/`
- Shindig wireframe examples: `~/Documents/KMP/Shindig/_bmad-output/planning-artifacts/wireframes/`
- Existing Hive plugin: `/Users/don/Documents/herd/skills/hive/`
- Episode schema: `skills/hive/references/episode-schema.md`
