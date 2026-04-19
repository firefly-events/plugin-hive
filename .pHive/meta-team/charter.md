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
| `.pHive/meta-team/` | Write cycle-state.yaml and ledger.yaml |
| `.pHive/teams/` | Create or update team config YAMLs |

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

- Changes to user project `.pHive/` directories (epics, episodes, cycle-state)
- Modifying `.claude-plugin/plugin.json` or `marketplace.json`
- Pushing to remote
- Creating or modifying Linear/GitHub integrations (unless `github_forwarding` is enabled — see below)

## GitHub Issue Forwarding (Opt-In)

By default, the meta-team only optimizes locally — findings stay in `.pHive/meta-team/` and the morning summary. Plugin-level issues that fall outside the meta-team's charter scope are logged as skipped findings.

When `hive.config.yaml → meta_team.github_forwarding: true`, the meta-team may file GitHub issues for findings that:
1. Are **out of charter scope** but represent genuine plugin-level bugs or gaps
2. Affect plugin consumers (not just the local project)
3. Have clear reproduction steps or evidence from the analysis

Issues are filed via `gh issue create` with the `[meta-team]` prefix and the `meta-team-auto` label. The meta-team does NOT fix these issues — it only reports them.

**When forwarding is disabled (default):** Out-of-scope findings are logged in cycle-state.yaml with `reason: out_of_scope` and surfaced in the morning summary under "What Was Found (Not Fixed This Cycle)." No external actions are taken.

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
- `.pHive/meta-team/cycle-state.yaml` — cycle ID, phases completed, changes made, issues found
- `.pHive/meta-team/ledger.yaml` — running record of all cycles with outcome summaries

The morning summary (per `hive/references/meta-team-ux.md`) is surfaced via `/hive:status`.
