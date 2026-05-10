# Skill Prelude

Standard preamble cited by Hive skill files. Centralizes the three boilerplate sections — state-directory note, kickoff gate, and "Before Executing Any Skill" — so the catalog has one source of truth.

Skills cite this file with a one-line link near the top of their SKILL.md (after the H1 + intro, before custom gate-checks or argument parsing). They MAY also cite the extended root-first config block when their work depends on routing decisions (`agent_backends`, `model_overrides`).

`skills/kickoff/SKILL.md` is the canonical owner of the Kickoff Gate logic and does NOT cite this file (avoids citation cycle).

---

## State Directory Note

Skills that read or write state paths under `.pHive/...` should include this note (paraphrased per skill voice if helpful):

> **State Directory Note:** Paths shown as `.pHive/...` assume the default state directory. If you have relocated state via `paths.state_dir`, substitute your configured location. See [`state-relocation.md`](state-relocation.md) (or `hive/references/state-relocation.md` from repo root).

Skills that already use the `${HIVE_STATE_DIR}` placeholder convention (e.g., `execute`) should describe the resolution contract inline rather than citing this note — the placeholder makes the substitution explicit.

---

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `.pHive/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with the skill:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed silently — do not announce that the kickoff gate passed. Only surface this section when a check fails.

> **Note for read-only-shaped skills (status, review, test, standup, ui-audit):** when W1 of Epic A (catalog-hygiene-and-borrows) lifts the kickoff gate to a warning, those skills will print a "Hive not initialized — proceeding with reduced fidelity" warning instead of stopping. The hard-stop above remains the default for skills that genuinely cannot run without project profile data (plan, execute, kickoff itself).

---

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides). For skills that consult `agent_backends` or `model_overrides`, see the **Root-first config precedence** subsection below.
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.
4. **Load project CONTEXT (if present).** Read `.pHive/CONTEXT.md` if it exists. This is the project's single-file domain glossary — terms, paths, and conventions specific to this codebase. **Silent-on-absence:** if the file is missing, proceed without a warning or error. Schema spec: [`context-md-schema.md`](context-md-schema.md). This step lands after persona/config/memory so domain literacy comes BEFORE substantive work.

### Root-first config precedence (extended, opt-in)

Skills that consult routing-relevant keys (`agent_backends`, `model_overrides`, `planning.collaborative_review`, `execution.default_methodology`, `execution.parallel_teams`, `circuit_breakers.*`) MUST follow this contract:

- Read ROOT `hive.config.yaml` first for those keys.
- For any key missing from the root file, fall through to the shipped baseline at `hive/hive.config.yaml` (neutral consumer-safe defaults).
- **Graceful fallback:** if the root `hive.config.yaml` is absent or its `agent_backends:` key is missing, proceed with an EMPTY routing map — all personas default to direct TeamCreate, no backend routing applied. Do NOT crash and do NOT substitute values from the shipped baseline for `agent_backends` specifically (that would reintroduce the consumer-pollution bug Slice 0 fixed).
- Reference [`state-boundary.md`](state-boundary.md) for the two-file precedence contract.

This subsection is opt-in — skills that don't touch routing keys can rely on the basic step 2 above.
