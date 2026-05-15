# Security Pre-Exec Plan Audit — kg-signal-revival

**Auditor:** security-reviewer (OWASP-Top-10 framing, adapted to plan-audit scope)
**Scope:** R3 cross-project contamination + boundary semantics for S4.1–S4.5
**Date:** 2026-05-14
**Inputs reviewed:** epic.yaml, design-discussion.md §3 + §10, structured-outline.md Part 4 + Part 6, horizontal-plan.md L3, S4.1–S4.5 stories, cycle-state/kg-signal-revival.yaml, scripts/kg-bootstrap-from-projects.js, scripts/kg-import-cycle-state.js, hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md, hive/workflows/steps/meta-team-cycle/step-03-proposal.md, and ground-truth `.pHive/cycle-state/` content from all three source projects.

## Review Verdict: needs_changes

Two structural defects in the R3 mitigation chain require pre-exec fixes before S4 ships. Both are low-effort to land at planning time but invisible-then-painful once execution starts. No vulnerabilities in the OWASP-Top-10 sense (no injection, auth, or secrets-handling defects); the gaps are information-hygiene and mitigation-wiring.

## Findings

### 1. Information flow between projects

**Actual content samples (3 lines, from `/Users/don/Documents/GitHub/ffe-social-engine/.pHive/cycle-state/security-hotfix-p0.yaml`, legacy format → `object` field after import):**

```
"Use security-reviewer agent for review step (in addition to default reviewer)"
"Pattern B (getUserIdentity gate) over story spec's internalMutation conversion"
"HMAC-sign args for C8a/C8b/C9 (NOT thread Clerk token through ~30 callsites)"
```

Rationale text (not imported as `object`, but is the `rationale` body in source files) names env var identifiers (`FLAYR_CREDITS_HMAC_SECRET`, `CONVEX_INTERNAL_SECRET`), implementation file paths (`clientProfiles.ts:397`, `flayr-credits-deduct.ts`), and a branch name (`hotfix/security-public-mutation-auth`).

**Sensitivity assessment:** low-to-medium. No secret VALUES leak (the script imports `decision:` text, not `rationale:` text for legacy format — confirmed at `scripts/kg-import-cycle-state.js:177`). Env var NAMES, file paths, and remediation-pattern shorthand (C1–C9) are not secrets, but they are vulnerability-remediation context attached to a project (Signal Flayr) under active security work. They would land in plugin-hive's `kg.sqlite` and surface inside step-02c findings as the `evidence.representative_triples[].object` field (step-02c §6) without further redaction.

**Concern:** Once `cross_project_signal`-tagged findings flow into step-03 and become proposals, the cross-project rationale text shows up in plugin-hive's proposal pool. Anyone reviewing plugin-hive's `/meta-optimize` run sees Signal Flayr's remediation playbook in cleartext. This is acceptable for a single-user single-machine workflow (the trust boundary is `~/.claude/hive/`), but worth flagging.

**Recommendation:** S1 (table). Acceptance criterion on S4.4: confirm that no Signal Flayr rationale strings (`rationale:` field text) appear in plugin-hive's KG. (They shouldn't, per the import logic, but verify empirically post-backfill.)

### 2. Namespace isolation

**Assessment:** clean.

`scripts/kg-import-cycle-state.js:161,175,188` sets `source_epic = "${SOURCE_EPIC_PREFIX}/${epicId}"`. `scripts/kg-bootstrap-from-projects.js:130-150` passes `--source-epic-prefix ${project.name}` per registered project. The KG schema's `idx_unique_triple(subject, predicate, object, source_epic)` makes `source_epic` part of the uniqueness composite key, so two different projects emitting the same `subject/predicate/object` produce two distinct triples — no merge, no overwrite.

The bootstrap script's dedupe-on-load (`scripts/kg-bootstrap-from-projects.js:130-150`) rejects duplicate `name` AND duplicate `path.resolve()`-canonicalized paths, preventing one project from being imported under two namespaces (which would double-count) or two projects from collapsing under one name (which would lose triples).

**Concern:** none at storage level.

**Recommendation:** none.

### 3. Hard-tag mitigation surface

**This is the strongest finding.**

The `[cross-project: <name>]` hard tag is referenced in 6 plan locations (design-discussion.md L102, structured-outline.md L180+L303, vertical-plan.md L260+L497, S4.3 + S4.4 acceptance criteria). It is the headline R3 mitigation.

**It is not wired anywhere in the consumer-contract chain.**

- `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` §6 finding shape emits a STRUCTURED field `tag: cross_project_signal` and a structured `evidence.source_epic` field. The `description` field is `{one-line description e.g. "3 phase_failed triples in epic memory-redesign within 30d window"}` — no `[cross-project: <name>]` prefix.
- `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` §2c preserves `discovery_source: kg_signal` but does not prepend, append, or otherwise inject `[cross-project: <name>]` into the proposal `description` or `rationale` string.
- Searching the workflow tree for the literal string `[cross-project:` returns zero hits outside epic planning docs.

The result: when a human reviewer reads `kg-findings.yaml` or the merged proposal pool, they see structured fields they may or may not surface to the eye, NOT the human-visible hard tag the plan promises.

**Concern:** R3 mitigation is documented but not implemented in step-02c or step-03. S4.3/S4.4 acceptance say "step-02c emits ≥1 finding with [cross-project: shindig] hard-tag" — that AC will fail when run, because step-02c as currently specced does not emit the literal string.

**Recommendation:** S2 (table). Amend step-02c §6 to set `description: "[cross-project: <name>] <one-line>"` for `cross_project_signal`-tagged findings, AND add the same rule to step-03's proposal render contract so cross-project findings carry the tag forward into the proposal description string. Add to S4.3, S4.4, S4.5 acceptance criteria: "kg-findings.yaml contains literal `[cross-project: <name>]` string in description field for any cross-project-tagged finding."

### 4. /hive:register-project input validation

**Assessment:** sufficient for trust boundary; minor hardening recommended.

S4.1 validates path-exists + `.pHive/` directory present + warns on empty cycle-state. No symlink resolution; no path-allow-list. An attacker with shell access could symlink `~/evil/.pHive → /etc` to make `/etc/passwd` reachable, but the import only walks `.pHive/cycle-state/*.yaml` so the actual blast radius is limited to YAML files inside a `.pHive/cycle-state/` directory. The realistic threat model (single-user single-machine workflow) does not warrant a defense.

**Concern:** symlinks to legitimate-looking `.pHive/cycle-state/` directories outside the user's project tree could be imported silently, and the canonical path stored in `projects.yaml` is the un-resolved symlink target.

**Recommendation:** S3 (table). Informational: S4.1 should call `fs.realpathSync()` on the input path before storing the canonical entry, so dedupe-by-canonical-path actually catches symlink-aliased duplicates. No allow-list needed.

### 5. Backfill on someone else's machine

**Assessment:** low risk; trust boundary is explicit.

`~/.claude/hive/projects.yaml` and `~/.claude/hive/kg.sqlite` live outside the plugin-hive checkout (in `$HOME`). Cloning the plugin-hive repo on a fresh machine does NOT carry the cross-project KG with it. Leakage requires the user to explicitly share their `~/.claude/hive/` directory.

**Concern:** the trust boundary (`~/.claude/hive/` = local-only) is not documented in S4.1's skill output or in any README touched by S4. A user could reasonably expect "my hive project state" to be in the repo and inadvertently rsync `~/.claude/hive/` to a shared box.

**Recommendation:** S4 (table). Informational: S4.1 SKILL.md docstring states `~/.claude/hive/projects.yaml` is local-only and lists projects.yaml + kg.sqlite in `.gitignore`-equivalent guidance. No code change.

### 6. Pre-canon decision content (security-themed epics)

**Assessment:** mitigation is partially broken at the legacy-format read path.

The `--since 2026-04-28` filter in S4.2 is the R4 mitigation. For:
- **canonical** format (`key`/`value`): `valid_from = decision.timestamp || fileMtime` (`scripts/kg-import-cycle-state.js:169`)
- **v2** format (`id`/`value`/`captured_at`): `valid_from = captured_at || locked_at || timestamp || fileMtime` (line 191)
- **legacy** format (`decision`/`rationale`): `valid_from = fileMtime` (line 178). **The `set:` field is NOT read.**

Signal Flayr's `security-hotfix-p0.yaml` decisions are legacy-format with `set: 2026-05-07` fields. These dates would be IGNORED — `valid_from` is the file's mtime on disk. If the user `git pull`'s or rsyncs the Signal Flayr repo today, every legacy decision file gets a `valid_from` of today regardless of when the decision was actually made. The `--since` filter (whichever date) would either pass-all or fail-all depending on mtime, not the semantic decision date.

**Concern:** R4 mitigation can silently fail. Pre-canon decisions can either flood in (if mtimes are recent) or be excluded en-masse (if mtimes are old) regardless of intent.

**Recommendation:** S5 (table). S4.2 should extend `scripts/kg-import-cycle-state.js` to read `decision.set` (and stringify ISO when present) into `valid_from` for the legacy format. Add to S4.2 acceptance: "legacy-format decisions with `set:` field use `set:` value for `valid_from`, not file mtime."

Also: Signal Flayr has TWO security-themed epics (`security-audit-2026-05-07.yaml`, `security-hotfix-p0.yaml`) with `created: 2026-05-07`. They post-date the canon (2026-04-28) and WILL flow into plugin-hive's KG on backfill. Content reviewed — see §1, sensitivity low-to-medium, no secret values, but vulnerability-remediation context surfaces in cleartext.

### 7. Authorization / opt-out

**Assessment:** no opt-out exists; minor concern.

`/hive:register-project` takes any path containing `.pHive/`. A user could register a directory they share with collaborators, then their collaborators' decisions enter THEIR plugin-hive KG. A project owner has no way to mark their `.pHive/` as "do-not-bootstrap-from."

**Concern:** edge case; relevant if plugin-hive ever expands beyond single-user workflows.

**Recommendation:** S6 (table). Informational: add an optional `~/.claude/hive/projects.yaml` entry field `consent_required: true` (or equivalent), where bootstrap skips projects whose `.pHive/.bootstrap-consent` marker file is absent. Defer to a follow-on epic; not a blocker for v1.

## Recommendations (pre-exec, before S4 ships)

| ID | Severity | Recommendation | Stories affected |
|---|---|---|---|
| S1 | informational | Add acceptance criterion to S4.4 (and S4.3, S4.5 for symmetry): verify no `rationale:`-field text from source-project legacy decisions appears in plugin-hive KG after backfill (sanity check that import respects field semantics). | S4.3, S4.4, S4.5 |
| S2 | **needs-fix** | Wire the `[cross-project: <name>]` hard tag in step-02c §6 finding shape AND step-03 §2c proposal render. Without this, R3 mitigation is documentation-only and S4.3/S4.4 ACs will fail at test time. | S4.1 (skill docs reference tag), S4.3, S4.4, S4.5 — and `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` + `step-03-proposal.md` need amendments. Consider adding a S4.0 story for the workflow-step wiring, or extend S2.2 (the last priority-predicate emit story) since it also touches finding shape. |
| S3 | informational | S4.1 skill resolves symlinks via `fs.realpathSync()` before storing canonical path; dedupe operates on resolved path. | S4.1 |
| S4 | informational | S4.1 SKILL.md docstring states `~/.claude/hive/{projects.yaml, kg.sqlite}` are local-only and SHOULD NOT be checked into repos or shared. | S4.1 |
| S5 | **needs-fix** | S4.2 extends `scripts/kg-import-cycle-state.js` to read `decision.set` into `valid_from` for legacy format (currently uses fileMtime). Without this, R4 `--since` mitigation silently fails for legacy-format YAMLs after any file touch. Add acceptance criterion. | S4.2 |
| S6 | informational | Document the no-opt-out posture in a follow-on / lessons-learned section; do not build opt-out for v1. | (follow-on) |

## Open questions for execution team

- **Workflow-step amendment ownership:** S2 above requires changes to `step-02c-kg-signal.md` and `step-03-proposal.md`. These files are touched by S2 (priority predicates) and S1 (emit foundation), not S4. Suggest either (a) add an S4.0 story for the hard-tag wiring before S4.3, or (b) fold the hard-tag spec into S2.2 acceptance criteria. TPM call.
- **valid_from semantics for legacy decisions (S5):** is reading `decision.set` into `valid_from` an in-scope S4.2 change, or does it belong in a separate KG schema-hygiene story? Touches `kg-import-cycle-state.js`, which is the same file S4.2 already opens.
- **Sensitivity threshold:** is the cleartext flow of Signal Flayr's vulnerability-remediation context (decision strings like "HMAC-sign args for C8a/C8b/C9") into plugin-hive's KG acceptable, or should the security-themed epic namespaces (`security-*`) be excluded from bootstrap by name-pattern? Suggest acceptable as-is given single-user trust model, but TPM/user-final-call.
