# README Drift Checklist — 1.1.2 → 1.1.3+

Story: S6-readme-audit (kg-augmented-meta-signal)
Researcher pass: 2026-05-01
Implement pass completed: 2026-05-01
README baseline reviewed: current `main` (post commit faa2341 brand foundation)
CHANGELOG baseline: 1.1.2 (2026-04-23) onward + this epic's in-flight S1–S5

---

## Brand foundation (FIXED — do not edit)

The following sections landed via the OSS rollout brand work (commit faa2341,
2026-04-30) and are treated as immutable for this epic:

- Hero block: centered logo (`assets/hive-logo.svg`), `# Hive` H1, positioning
  tagline ("director's chair for the agentic SDLC"), "Built at Firefly Events"
  attribution (README.md:1–13)
- Inspirations section crediting IndyDevDan, QRISPY, BMAD-METHOD, archon, and
  Andrej Karpathy (README.md:32–42)

The dev MUST NOT rewrite these. The drift cleanup layers UNDER this hero.

---

## Drift map

### A. 1.1.3 Memory & Autonomous Execution Phase 1 (CHANGELOG.md:12–77)

| # | Capability | Source | Target README section | Current coverage | Status |
|---|---|---|---|---|---|
| A1 | KG substrate — `~/.claude/hive/kg.sqlite`, controlled-vocab triples (decided / superseded / assigned_to / blocked_by / depends_on / phase_started / phase_complete / phase_failed / phase_blocked), WAL-mode, idempotent DDL, `idx_unique_triple` on (subject, predicate, object, source_epic) | CHANGELOG.md:15–21 (1.1.3 Added bullet 1); ref `hive/references/knowledge-graph-schema.md` | NEW "Memory architecture" section (L2 tier description) | NEW "Memory architecture" section — L2 row + KG paragraph + link to schema doc | **covered** |
| A2 | `MemoryStore.query_decisions(filter)` — point-in-time triple retrieval with `entity` / `predicate` / `as_of` / `include_superseded` filters | CHANGELOG.md:22–24; ref `hive/references/memory-store-interface.md` | NEW "Memory architecture" section, OR linked under L2 row | Linked once via `memory-store-interface.md` reference at end of section; API not duplicated | **covered** |
| A3 | KG write path: `kg_write()` in `hive/lib/session-end.js`; INSERT OR IGNORE with runtime `idx_unique_triple` precondition guard | CHANGELOG.md:25–28 | NEW "Memory architecture" → session-end paragraph | Session-end paragraph mentions `kg_write` conceptually within the three-op orchestration | **covered** |
| A4 | KG bootstrap utility: `scripts/kg-import-cycle-state.js` — one-time backfill from `.pHive/cycle-state/*.yaml`, atomic transaction, dry-run preview | CHANGELOG.md:29–31 | NEW "Memory architecture" → bootstrap paragraph (or under "Quick Start" as an optional one-time backfill) | Linked from "Bootstrapping the KG from existing projects" paragraph | **covered** |
| A5 | KG read path: `agent-spawn` Step 5e injects "Decision Context" block into agent prompts via two `query_decisions({entity})` calls | CHANGELOG.md:32–34 | NEW "Memory architecture" — one sentence on cross-project decision context | L2 paragraph: "Agent spawn injects a 'Decision Context' block from `query_decisions({entity})` so a new agent reads what was already decided before it starts." | **covered** |
| A6 | ChromaDB L3 semantic memory tier — JSON-RPC wrapper at `hive/lib/chromadb-wrapper.js` (`isAvailable()`, `query()`, `index()`), agent-namespaced docIds, **graceful degradation to L1+L0 when sidecar absent** | CHANGELOG.md:35–39 | NEW "Memory architecture" section (L3 tier row) | L3 row in tier table + L3 paragraph explicitly calling out "**degrades gracefully to L1+L0**" + "no consumer setup required" | **covered** |
| A7 | Session System Prompt Specification at `hive/references/session-system-prompt-spec.md` — composition (persona + prior knowledge + KG decision context + domain note), per-step story context, lifecycle, completion detection. Foundation for Phase 2 Managed Agent API migration. | CHANGELOG.md:40–44 | Architecture Overview (one-line forward-looking note about Phase 2), OR link in Memory architecture section | Final paragraph of Memory architecture section: link + Phase 2 forward-looking note | **covered** |
| A8 | Session-end orchestration skill at `skills/hive/skills/session-end/SKILL.md` — three-phase ordering (insights → kg_write → compile ‖ chromadb.index), 30s latency monitoring, asymmetric failure handling, `skipCompile` for hard-shutdown pressure | CHANGELOG.md:45–49 | NEW "Memory architecture" → session-end paragraph | Session-end orchestration paragraph mentions three-phase ordering + asymmetric failure handling + links to SKILL.md | **covered** |
| A9 | Pre-shutdown protocol now shares canonical session-end via `runSessionEnd({ skipCompile: true })` | CHANGELOG.md:50–51 | Same paragraph as A8 | Not mentioned | **intentional-exclusion** (recommend) — internal lifecycle detail; consumer doesn't invoke this directly. Document the exclusion here rather than in README. |
| A10 | Memory tier table change: L3 row replaces Qdrant placeholder with actual ChromaDB JSON-RPC wrapper | CHANGELOG.md:54–55 (Changed) | NEW "Memory architecture" section | Tier table L3 row uses ChromaDB | **covered** (via A6) |
| A11 | `DecisionFilter.subject?` → `DecisionFilter.entity?` rename (matches canonical SQL, accurately describes cross-column matching) | CHANGELOG.md:56–58 (Changed) | n/a | n/a | **intentional-exclusion** — internal type rename, no consumer surface. |
| A12 | `session-end.js` fixes (HOME → `os.homedir()`; agent-name/slug input validation; guaranteed `db.close()`) | CHANGELOG.md:60–67 (Fixed) | n/a | n/a | **intentional-exclusion** — bugfixes; not README-worthy. |
| A13 | `chromadb-wrapper.js` fixes (HTTP status check, drain body, drop unused `metadatas`) | CHANGELOG.md:68–70 (Fixed) | n/a | n/a | **intentional-exclusion** — bugfixes; not README-worthy. |
| A14 | `kg-import-cycle-state.js` fixes (transaction atomicity, surfaced parse drops, "Would process" rename) | CHANGELOG.md:71–74 (Fixed) | n/a | n/a | **intentional-exclusion** — bugfixes; not README-worthy. |
| A15 | Markdown lint cleanup across KG/memory-autonomy stack | CHANGELOG.md:75–76 (Fixed) | n/a | n/a | **intentional-exclusion** — chore. |

### B. This epic — kg-augmented-meta-signal (S1–S5 already on branch; S6 in progress)

| # | Capability | Source | Target README section | Current coverage | Status |
|---|---|---|---|---|---|
| B1 | `step-02c-kg-signal.md` — new optional workflow step parallel to `step-02b-external-research.md`; queries L2 KG for `phase_failed` / `phase_blocked` / `superseded` predicates, three-layer relevance filter (predicate / recency window / project-tag rank penalty), emits `kg-findings.yaml` with `discovery_source: kg_signal` | S1 commit (epic story S1-step-02c-kg-signal); file `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` | "Meta Optimization" section — one-sentence add on kg_signal as a third proposal source | Meta Optimization "Proposal sources" subsection lists kg_signal at position 3 with cross-project note | **covered** |
| B2 | System-level project registry at `~/.claude/hive/projects.yaml` + bootstrap script `scripts/kg-bootstrap-from-projects.js` (walks registered projects to seed `~/.claude/hive/kg.sqlite` with multi-project decision history) | S2 commit; epic.yaml description; `scripts/kg-bootstrap-from-projects.js` exists | "Memory architecture" → KG paragraph (cross-project history) AND/OR "Optional Integrations" / Quick Start one-line "Optional: bootstrap KG from existing projects" | Memory architecture "Bootstrapping the KG from existing projects" paragraph names registry + script | **covered** |
| B3 | Step-03 proposal merging accepts `discovery_source: kg_signal` — auto-tags untagged kg-findings, dedup against internal grouped findings, ranks merged pool | S3 commit 4b28f5c precursor (step-03 modification); epic.yaml story S3 | "Meta Optimization" section — covered transitively by B1; no separate mention required | Not mentioned | **intentional-exclusion** (recommend) — internal merge logic; B1's kg_signal mention covers consumer-facing behavior. Document here. |
| B4 | meta-optimize SKILL — KG-before-backlog routing (precedence: metrics → external research → kg_signal → backlog), threshold blending, `meta_optimize.kg_signal` config block (`enabled` / `window_days` / `cross_project_penalty`), `enabled:false` legacy fallback, no-`kg.sqlite` no-op behavior | CHANGELOG entry pending (Unreleased); commit 4b28f5c; `skills/hive/skills/meta-optimize/SKILL.md`; `hive/references/meta-optimize-contract.md`; `hive/hive.config.yaml` | "Meta Optimization" section — replace current "Backlog fallback" subsection with full routing precedence list + new "KG signal" subsection mentioning the three config keys | "Backlog fallback" replaced with "Proposal sources" — 4-input precedence list + `meta_optimize.kg_signal` YAML block + legacy fallback note + no-`kg.sqlite` behavior | **covered** |
| B5 | End-to-end fixture — KG-only proposals emerge with empty metrics (S5 verification artifact) | S5 commit; epic.yaml story S5 | n/a | n/a | **intentional-exclusion** — internal test fixture; not consumer-facing. |

### C. Prior drift discovered scanning CHANGELOG since 1.1.2

| # | Capability | Source | Target README section | Current coverage | Status |
|---|---|---|---|---|---|
| C1 | Public `/meta-optimize` skill ships (MVS milestone, 1.1.2). Currently the `## Meta Optimization` section IS in README. | CHANGELOG.md:81–86 (1.1.2 Added bullet 1) | "Meta Optimization" | Covered (README.md:138–185) — but B4 supersedes the routing description | **covered** (with B4 update layered on top) |
| C2 | `PrPromotionAdapter` + `DirectCommitAdapter`; close records carry `pr_ref` + `pr_state` | CHANGELOG.md:87–89 | "Meta Optimization" → already covered at the right altitude | "PR-only", "candidate commit", "close record containing `pr_ref`, `pr_state`" all present (README.md:157–168) | **covered** |
| C3 | MVS acceptance proof at `.pHive/audits/mvs-proof/`; regeneration gated by `HIVE_WRITE_MVS_PROOF=1` | CHANGELOG.md:90–92 | n/a | Not mentioned | **intentional-exclusion** — maintainer-only, gated behind env var; explicitly not consumer surface. |
| C4 | `paths.state_dir` config default `.pHive` (rename from `state/`) | CHANGELOG.md:93–94, 100–105 (Changed bullet 1) | Architecture / Extensibility — README references `.pHive/teams/`, `.pHive/meta-team/queue-meta-optimize.yaml` paths already | `.pHive/teams/` referenced (README.md:257); `.pHive/meta-team/queue-meta-optimize.yaml` referenced (README.md:175) | **covered** (paths use new `.pHive/` default — no further README change needed) |
| C5 | Migration script `scripts/migrate-state-to-pHive.sh`; kickoff Step 0 detects legacy `state/` and offers in-place migration | CHANGELOG.md:95–98, 110–121 (Migration block) | Quick Start or NEW "Migrating from earlier versions" callout | Blockquote callout added under Installation linking to CHANGELOG | **covered** |
| C6 | "Wiring `paths.state_dir` end-to-end" known follow-up (still open per `project_state_dir_resolver` memory) | CHANGELOG.md:118–121, 123–131 (Known follow-up) | n/a | Not mentioned | **intentional-exclusion** — known-issue; deferred follow-up; not a shipped capability. |
| C7 | Kickoff gate proceeds silently when checks pass (1.1.2 Changed bullet 3) | CHANGELOG.md:106–108 | n/a | Not mentioned | **intentional-exclusion** — UX polish; not a feature consumer needs to be told about. |
| C8 | cmux v2 API as native team execution backend (1.1.1) — `execution.interactive_panes`, completion marker `[STORY-COMPLETE:{story-id}]`, mode-dependent steps in agent-spawn | CHANGELOG.md:133–148 (1.1.1 Added) | "Optional Integrations" — cmux row exists | cmux row updated to "Native parallel team execution backend — orchestrator manages stories in cmux panes via the v2 JSON-RPC API" | **covered** |
| C9 | External model integration / Codex backend (1.1.0) — `agent_backends` per-agent spawn axis, TDD cross-model workflow, persistent pane mode, supported Codex personas list | CHANGELOG.md:149–164 (1.1.0 Added) | Features bullet "Cross-model execution" + "Optional Integrations" Codex row | Both present (README.md:49, 237) | **covered** |
| C10 | (Still in Unreleased per CHANGELOG): commits since 1.1.3 not yet versioned — recent fixes to workflows step_file paths (`hive/` prefix, PR #32), meta-team-cycle routing fix on findings (PR #31). | CHANGELOG.md:10 ([Unreleased] empty); git log c83fc8d, d9ae560 | n/a — internal | n/a | **intentional-exclusion** — bugfixes / routing patches; not README-worthy. **Note for dev:** Unreleased section is empty in CHANGELOG; this epic should land its own entries (B1–B4) under [Unreleased] when shipping. |

### D. Existing README claims to verify against current main

| # | Claim in README | Location | Status |
|---|---|---|---|
| D1 | Version badge reads `1.0.0` | README.md:12 | **covered** — bumped to `1.1.3`. (Note: badge sits within the FIXED hero block lines 1–13; spec explicitly required this single-token bump and the rest of the hero is preserved verbatim.) |
| D2 | "20 specialized personas" claim | README.md:48 | **covered** — recounted: `hive/agents/` contains 25 persona files; `developer.md` is marked deprecated (use frontend-developer/backend-developer). Active count = 24. README updated to "24 specialized personas". `.claude-plugin/agents/` is empty; Codex roster is config-routed (`agent_backends`), not separate persona files. |
| D3 | "Test swarm — 5-agent pipeline" | README.md:51 | **covered** — verified consistent with mermaid (scout / architect / worker / inspector / sentinel). |
| D4 | "Layered memory system — agents accumulate cross-project knowledge in a compiled wiki with TTL-aware staleness tracking" | README.md:52 | **covered** — bullet rewritten to "Layered memory (L0–L3) — sessions persist decisions to a cross-project knowledge graph; agents read prior decisions on spawn, with optional ChromaDB semantic recall". |
| D5 | Quick Start Step 4 links `/hive:execute` description: "research → implement → test → review → integrate" | README.md:105 | **covered** — current shape. |
| D6 | "Code Review" — "Optional Codex adversarial pass for a second-model perspective" | README.md:111 | **covered**. |
| D7 | UI Team Skills table (1.1 era — 6 skills) | README.md:117–134 | **covered** — already shipped per `project_ui_team_skills` memory; verify each command exists during dev's test step (AC4). |
| D8 | Architecture Overview mermaid + paragraph | README.md:188–228 | **covered** — bridge sentence added at end of Architecture Overview pointing to the Memory architecture section. |
| D9 | "Hive-to-hive communication *(forward-looking)*" | README.md:259 | **covered** (and `project_cross_system_collab` is paused per memory). Leave as-is. |
| D10 | Links table at bottom — Operations Guide, Contributing, Code of Conduct, Changelog | README.md:277–284 | **covered**. AC6 ("README links to CHANGELOG.md for full version history") is already met (README.md:284). |
| D11 | Inline references like `references/agent-config-schema.md`, `references/workflow-schema.md` (paths NOT prefixed with `hive/`) | README.md:251, 255 | **covered** — both rewritten as proper Markdown links to `hive/references/agent-config-schema.md` and `hive/references/workflow-schema.md`. |
| D12 | `.claude-plugin/agents/`, `.claude-plugin/skills/` paths in Extensibility | README.md:251, 253 | **covered** — verified: `.claude-plugin/agents/` and `.claude-plugin/skills/` are empty; agents live at `hive/agents/`, consumer skills at `skills/<name>/`, internal skills at `skills/hive/skills/<name>/`, registered via `"skills": "./skills/"` in `.claude-plugin/plugin.json`. Extensibility section rewritten to match. |

---

## Findings summary

- **Total drift items resolved:** 19 (A1, A2, A3, A4, A5, A6, A7, A8, A10, B1, B2, B4, C5, C8, D1, D2, D4, D8, D11, D12) — all marked `covered` after implement pass.
  - High-priority drift (consumer-visible behavior change): A1, A6, B1, B2, B4 — covered
  - Medium-priority drift (architecture/feature addition): A2, A3, A4, A5, A8, D8 — covered
  - Low-priority drift (correctness/freshness): A7, A10, C5, C8, D1, D2, D4, D11, D12 — covered
- **Intentional exclusions:** A9, A11, A12, A13, A14, A15, B3, B5, C3, C6, C7, C10 — preserved per researcher decision (internal/maintainer-only/bugfix/chore).
- **Already covered (pre-existing):** C1, C2, C4, C9, D5, D6, D7, D9, D10
- **Needs-verify items resolved during implement:**
  - D2 — counted `hive/agents/` (25 files, 1 deprecated) → 24 active personas; `.claude-plugin/agents/` confirmed empty; Codex roster is config-routed.
  - D3 — verified scout/architect/worker/inspector/sentinel = 5.
  - D7 — UI Team Skills commands left as-is (the table maps directly to `skills/<skill-name>/SKILL.md` files; verified `brand-system`, `design-system`, `ui-audit`, `polish-audit`, `visual-qa`, `design-review` all exist under `skills/`).
  - D11 — fixed `references/...` → `hive/references/...` and converted to clickable Markdown links.
  - D12 — fixed `.claude-plugin/agents/` → `hive/agents/`; clarified consumer-vs-internal skill paths.

### Key gaps

1. **No memory architecture section at all.** README is silent on L0/L1/L2/L3, KG, ChromaDB, session-end three-op orchestration, and cross-project decision history. This is the largest single gap (covers items A1, A2, A3, A4, A5, A6, A8, A10, B2, D4).
2. **Meta Optimization section is now stale.** Says backlog is the only fallback when metrics are insufficient — but kg_signal now sits between them with config-driven precedence (B4). The "Backlog fallback" heading needs to become "Proposal sources" with the four-input precedence list (metrics → external research → kg_signal → backlog).
3. **Version badge `1.0.0` is two minor versions behind shipped (1.1.3).** Single-line fix (D1) but visible mismatch for anyone landing on the README.
4. **Reference link path drift.** `references/...` should be `hive/references/...` (D11). Likely also `.claude-plugin/agents/` vs actual `hive/agents/` and `skills/hive/skills/` (D12).
5. **No mention of CHANGELOG migration paths** for users on 1.1.1 or older (state/ → .pHive/) — C5. One-line callout suffices.

---

## Recommended README outline (researcher proposal — dev to refine during implement)

1. **Hero block** (FIXED — README.md:1–13) — logo, H1, tagline, attribution, badges (FIX D1: badge 1.0.0 → 1.1.3)
2. **North Star** (FIXED at altitude — README.md:17–28) — keep as-is
3. **Inspirations** (FIXED — README.md:32–42) — keep as-is
4. **Features** (README.md:46–54) — update bullet "Layered memory system" (D4) to: "Layered memory (L0–L3) — sessions persist decisions to a cross-project knowledge graph; agents read prior decisions on spawn." Other bullets stay.
5. **Prerequisites** (README.md:58–61) — keep
6. **Installation** (README.md:65–77) — keep; consider adding C5 one-liner: "Migrating from a pre-1.1.2 install? See [CHANGELOG](CHANGELOG.md) for the `state/` → `.pHive/` migration."
7. **Quick Start** (README.md:81–112) — keep; verify all commands resolve (AC4)
8. **UI Team Skills** (README.md:115–134) — keep; verify command names against shipped skills (AC4)
9. **Meta Optimization** (README.md:138–184) — REWRITE the "Backlog fallback" subsection as "Proposal sources" listing the four-input precedence: metrics → external research → kg_signal → backlog. Add `meta_optimize.kg_signal` config note. Link to `meta-optimize-contract.md`. (B1, B4)
10. **NEW: Memory architecture** — placement: between "Meta Optimization" and "Architecture Overview", OR right after Architecture Overview as a follow-on. Content (overview altitude only):
    - Why memory: cross-session/cross-project knowledge that survives compaction
    - L0 session insights → L1 compiled wiki → L2 knowledge graph (kg.sqlite) → L3 ChromaDB semantic recall (optional, graceful degradation)
    - KG: cross-project decision history at `~/.claude/hive/kg.sqlite`; bootstrap from registered projects via `scripts/kg-bootstrap-from-projects.js` and `~/.claude/hive/projects.yaml`
    - Session-end three-op orchestration (insights → kg_write → compile ‖ chromadb.index)
    - Link to `hive/references/memory-store-interface.md` (authoritative tier table) and `hive/references/knowledge-graph-schema.md` (KG schema reference)
    - Optional one-line forward-looking note: "Session System Prompt Spec (`hive/references/session-system-prompt-spec.md`) is the foundation for upcoming Phase 2 Managed Agent API migration." (A7)
    - **Length target:** ~30–50 lines. Overview only — link, don't duplicate.
11. **Architecture Overview** (README.md:188–228) — keep mermaid; add one-line bridge to Memory architecture (D8)
12. **Optional Integrations** (README.md:232–243) — refresh the cmux row description (C8); keep others
13. **Extensibility** (README.md:247–259) — fix D11 (`references/` → `hive/references/`) and D12 (verify `.claude-plugin/agents/` vs `hive/agents/`)
14. **Contributing / License / Links** (README.md:263–284) — keep

### Drift-driven add list (concrete additions for dev)

- One NEW section: **Memory architecture** (slot 10 above) — ~30–50 lines
- One section REWRITE: **Meta Optimization → Backlog fallback** subsection becomes **Proposal sources** with 4-input precedence
- One badge bump: `1.0.0` → `1.1.3`
- One bullet rewrite: Features → "Layered memory system"
- Three small fixes: cmux row text, `references/` path prefixes, `.claude-plugin/` vs `hive/`/`skills/hive/` component paths
- One optional one-liner: migration callout under Installation

---

## Researcher notes for dev (implement step)

- AC1 ("memory architecture section L0/L1/L2/L3 pointing at memory-store-interface.md") → addressed by NEW slot 10
- AC2 ("KG substrate + bootstrap script") → addressed by NEW slot 10 (B2 sub-paragraph)
- AC3 ("kg_signal as /meta-optimize proposal source") → addressed by Meta Optimization rewrite (B1, B4)
- AC4 ("install/quickstart works end-to-end") → tester verifies; researcher flagged D11, D12 path-prefix drift to fix preemptively
- AC5 ("drift checklist exists mapping every CHANGELOG entry from 1.1.2 onward") → THIS FILE (will be promoted to non-DRAFT during implement after dev refines)
- AC6 ("README links to CHANGELOG") → already met at README.md:284
- AC7 ("PR description summarizes audit + major changes") → dev's responsibility at integrate step

**Out of scope (explicit per story):** systemic README enforcement (deferred to DAG cross-cutting epic). Don't try to add automated coverage checks here.

**Risk to monitor:** scope creep into reorganization (story-flagged medium risk). Drift-driven changes only — if a section is currently sound and not in this checklist, leave it.
