# Design Discussion — Marketing Team

## §0 Prelude
- **Epic:** `marketing-team`
- **Base:** `develop` · **Branch:** `feat/marketing-team` · **Strategy:** per-epic
- **Scale:** Medium (multi-persona, cross-cutting wiring into planning, new entry skill, docs)
- **Methodology:** classic
- Helper note: `git_flow` resolved via `hive/lib/git_flow.mjs` → `base_branch: develop`.

## §1 Goal
Add a **marketing / advertising team** to Hive: a set of personas that generate a
**post-release launch campaign from the changelog** for **consumer-facing projects**
(e.g. Shindig, Firefly client work). After `/ship` releases, the team turns "what
shipped" into a campaign (copy + creative). Hive itself has no marketing surface, so
the team is gated OFF for the hive plugin's own work, exactly as `ui-designer` is
excluded from hive work today.

User decision (planning gate): **full team**, not a single agent.

## §2 Proposed approach

### Team composition (3 personas)
Mirror the UI-team precedent (`ui-designer` persona + `/design` skill, later a 6-skill
team). Marketing core:

| Persona | Role | Primary outputs |
|---|---|---|
| `marketing-strategist` | Team lead. Positioning, segmentation, go-to-market, channel strategy, campaign brief. | Campaign brief, positioning statement, channel plan |
| `marketing-copywriter` | Persuasive copy across surfaces. | Ad copy, landing/email/social copy, taglines, CTAs |
| `ad-creative` | Visual ad concept + creative direction (distinct from `ui-designer`, which is product UI). | Ad creative concepts, creative briefs, asset direction |

`marketing-strategist` is the lead; copywriter and ad-creative consume its brief
(strategist → copy + creative handoff), the same flow `/design` uses.

### Plug-in points
1. **Persona files** — `hive/agents/marketing-strategist.md`, `…/marketing-copywriter.md`,
   `…/ad-creative.md`. Authored against the **verified, current agent-config specs**
   for both runtimes (see §3 Grounding) — full config, not just frontmatter.
2. **Post-ship hook (PRIMARY)** — `/ship`, after generating the changelog + marking
   stories shipped, runs a consumer-gated, opt-in (default off) step invoking
   `/marketing-campaign --from-ship <changelog>`. Co-edits `skills/ship/SKILL.md` with
   Epic A's `a2` (worktree prune) — coordinate the insertion point.
3. **Planning selection + specialist-triggers — DEFERRED (not v1).** Joining the marketing
   personas into `/plan` via keyword detection, and any `specialist-triggers` catalog
   entry, are out of scope for v1; the trigger is post-ship/changelog only.
4. **Entry skill** — `/marketing-campaign` (analogous to `/design`): runs the strategist→copy→creative
   ceremony, emits a `.pHive/marketing-campaigns/<topic>/` directory + handoff index. Callable
   standalone or atomically from `/plan` on marketing-detected stories.
5. **Docs** — README Quick Start + operations-guide entry (a new persona surface is not
   "done" without user docs).

## §3 Grounding the agent template (REQUIRED — per maintainer directive)
The three persona files MUST be authored against the **full agent configuration spec
of the latest Codex and Claude Code versions**, not just frontmatter. Hive dispatches a
persona either through the Claude Code **Agent tool** (persona injected at spawn) or
through the **Codex backend** (`agent_backends` routing), so each persona must be valid
for both runtimes.

Two research agents were dispatched at plan time to capture verified specs:
- **Claude Code subagent contract** — frontmatter (`name`/`description`/`tools`/`model`)
  semantics, tool-omission = inherit, model values, body/system-prompt conventions,
  file precedence (project vs user vs plugin).
- **Codex CLI agent contract** — `AGENTS.md` role/precedence, `config.toml` + profile
  keys (`model`, `model_provider`, `model_reasoning_effort`, `approval_policy`,
  `sandbox_mode`, MCP), and the persona-injection mechanism (`codex exec` / profile /
  prompt).

Their findings are synthesized into
`.pHive/epics/marketing-team/docs/agent-config-grounding.md`, which B1–B3 cite as the
authoring contract. The existing Hive persona schema (see `hive/agents/ui-designer.md`:
`name`/`description`/`model`/`color`/`knowledge`/`skills`/`tools`/`required_tools`/`domain`)
is the superset Hive injects; the grounding doc maps each Hive field onto what each
runtime actually consumes so the personas degrade cleanly on either backend.

## §4 Risks
| Sev | Risk | Mitigation |
|---|---|---|
| medium | `ad-creative` overlaps `ui-designer` (both visual). | Scope `ad-creative` to ad/marketing creative concepts only; product UI stays with `ui-designer`. Document the boundary in both personas. |
| medium | Team fires on hive's own work (false positive). | Hard `project_type` consumer gate; hive excluded. Mirror the `feedback_hive_has_no_ui` precedent. |
| medium | Persona frontmatter drifts from runtime spec → silent dispatch failure. | §3 grounding doc + B1–B3 cite verified specs; reviewer checks against it. |
| low | Scope creep into a full 6-skill suite. | Ship 3 personas + 1 entry skill (`/marketing-campaign`) now; further skills deferred, like the UI team grew incrementally. |

## §5 Dependencies
- `hive/agents/ui-designer.md` — mirror template + consumer-gating precedent.
- `hive/references/specialist-triggers.md` — catalog contract for new triggers.
- `/plan` Phase 0 conditional-persona selection + `planning-routing` skill.
- `/design` + `skills/design/SKILL.md` — entry-skill pattern for `/marketing-campaign`.
- The two agent-config research findings (§3).

## §6 Resolved decisions (maintainer, plan-time)
1. **Skill name = `/marketing-campaign`** (dir `skills/marketing-campaign/`).
2. **Trigger = post-ship, changelog-driven (REFRAME).** The campaign is generated AFTER a
   release ships, using the release **changelog** as the strategist's source material
   (what shipped → why it matters → audience → channels). b4 adds a consumer-gated,
   **opt-in (default off)** post-release step to `/ship` that invokes
   `/marketing-campaign --from-ship <changelog>`. NO specialist-trigger (post-ship is a
   `/ship` lifecycle step, not an `/execute` phase). The earlier planning-time
   keyword-selection path is **deferred** — not v1.
3. **Visual creative = a shared, multi-agent skill (b7).** ad-creative v1 emits creative
   concepts + image-gen **prompts** (text). The actual render capability — Frame0 CLI +
   image generation (the `openai-image` MCP / `logo-exploration` path) — is extracted as a
   standalone skill (`b7`) that ad-creative, ui-designer, and logo-exploration can each
   adapt, rather than baked into one persona.
4. **No `/marketing-review` skill — review is a human/user gate.** `/marketing-campaign`
   ends by presenting brief/copy/creative for the user to review; no automated marketing
   review persona/skill in v1.

## §7 Scale assessment
**Medium.** Three persona files (variation authoring), one cross-cutting wiring story,
one new skill, one docs story. No migration, no long-horizon system change. H/V planning
not required; straight to story decomposition after this discussion.
