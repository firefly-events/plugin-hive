# Meta-Team Charter

The meta-team is an autonomous nightly system that analyzes the Hive plugin's own codebase and makes targeted, safe improvements. It runs unattended in the 3 AM CDT window and presents a morning summary for user review.

---

## Mission

Self-optimize the Hive plugin. Find real gaps, fix them, document what changed, and leave the system in a better state than it started. The meta-team is not a change-management committee — it ships.

---

## Objectives (Priority Order)

1. **Completeness** — all referenced files exist; no dangling cross-references
2. **Consistency** — schemas, paths, and terminology are uniform across all docs
3. **Clarity** — step files have unambiguous procedures; failure modes are named
4. **Coverage** — agent memory starter set grows with each cycle; gaps get filled
5. **Tooling** — skill files route correctly; the status command surfaces useful state

---

## Scope — What the Meta-Team May Change

| Domain | Allowed Actions |
|--------|----------------|
| `hive/references/` | Create new reference docs; add sections to existing docs |
| `hive/agents/` | Create new agent personas; add knowledge/skills entries to existing personas |
| `hive/workflows/` | Create new workflow YAMLs and step files |
| `skills/hive/agents/memories/` | Create new starter memory files; update existing ones |
| `skills/` (skill SKILL.md files) | Add new sections; extend procedures |
| `state/meta-team/` | Write cycle-state.yaml and ledger.yaml |
| `state/teams/` | Create or update team config YAMLs |

---

## Hard Constraints

- **No destructive operations.** No file deletions. No >50% content removal per file.
- **No breaking changes.** Schema changes must be additive (new optional fields only).
- **5-hour budget window maximum.** Abort and close cycle gracefully if limit is reached.
- **No secrets or credentials.** Memory files are plain text and may be exported.
- **Human confirmation required for:** changes to `hive/hive.config.yaml`, changes to agent tool lists, adding external service integrations.
- **Commit all changes** with descriptive messages prefixed `[meta-team]`.

---

## Out of Scope

- Changes to user project `state/` directories (epics, episodes, cycle-state)
- Modifying `.claude-plugin/plugin.json` or `marketplace.json`
- Pushing to remote
- Creating or modifying Linear/GitHub integrations

---

## Quality Bar

A change ships when:
1. It addresses a specific, named issue (not speculative improvement)
2. It doesn't break any existing cross-references
3. It doesn't remove existing functionality
4. The reviewer agent gives `passed` or `needs_optimization` verdict

A change is blocked when:
1. It would require >50% content removal from any file
2. It modifies config or tools lists without human confirmation
3. The reviewer gives `needs_revision` verdict

---

## Output Artifacts

After every cycle, the meta-team writes:
- `state/meta-team/cycle-state.yaml` — cycle ID, phases completed, changes made, issues found
- `state/meta-team/ledger.yaml` — running record of all cycles with outcome summaries

The morning summary (per `hive/references/meta-team-ux.md`) is surfaced via `/hive:status`.
