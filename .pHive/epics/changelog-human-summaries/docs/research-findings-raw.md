# Research Findings — changelog-human-summaries

Phase A research for: **Human-readable changelog entries**
Researcher: researcher agent
Date: 2026-06-12

---

## FINDINGS

### FILES_EXAMINED

- `CHANGELOG.md:1-841` — Full changelog history; all entries classified below.
- `skills/ship/SKILL.md:124-165` — Step 3 "Verify Planned Version Bump": checks `## [Unreleased]` exists and names the planned bump level. Does NOT mandate entry prose quality or content format.
- `skills/ship/SKILL.md:141-165` — Safety-net patch block: when gap detected, operator can authorize `/ship` to apply the bump and add a changelog entry. Template given at L156-165 is mechanical (epic ID + bump level + old→new version). No human-summary requirement.
- `skills/execute/SKILL.md:342-384` — Step 7e "Epic finalize — version bump and changelog": writes ONE entry under `## [Unreleased]`. Template (L360-365) is: `**{epic-id} release finalization.** /execute applied the planned {version_bump} version bump ({old} → {new}) and kept plugin version sources in lockstep.` This is version-accounting only; no feature prose.
- `hive/references/status-lifecycle.md:1-128` — No mention of CHANGELOG.md; lifecycle contract is silent on changelog authoring.
- `hive/references/release-post/post-template.md:1-17` — Template for `post.md` artifact. Has `{{highlights}}` and `{{story_trace}}` slots but these feed the release-post artifact, not CHANGELOG.md.
- `hive/lib/release_post.mjs:1-80` (partial) — Generates release artifacts (post.md, video-script.md, post-ideas.md) under `${HIVE_STATE_DIR}/releases/{release-id}/`. Does NOT write to CHANGELOG.md.

### PATTERNS_OBSERVED

- Pattern: chore(release) commits own changelog | Files: git log on CHANGELOG.md | Detail: All human-readable summaries entered via `chore(release)` commits: "chore(release): prepare v2.11.0 — version bump, changelog, status reconcile", "chore(release): amend 2.9.0 changelog with full multi-epic scope". These are manual operations outside any skill.
- Pattern: execute step 7e writes only version-accounting line | File: `skills/execute/SKILL.md:360-365` | Detail: The only automated CHANGELOG.md writer in a skill writes: `**{epic-id} release finalization.** /execute applied the planned {version_bump}...` — one mechanical line, no feature prose.
- Pattern: /ship verifies entry exists, not content | File: `skills/ship/SKILL.md:141-145` | Detail: Ship step 3 verifies `CHANGELOG.md` contains `## [Unreleased]` entry for the epic that "names the planned bump level" — purely structural/version gate, no prose quality check.
- Pattern: release-post artifacts are separate from CHANGELOG | Files: `hive/lib/release_post.mjs`, `hive/references/release-post/post-template.md` | Detail: Rich narrative (highlights, story trace, links) is generated for `post.md` / `video-script.md` but never flows back to CHANGELOG.md. The two surfaces evolve independently.
- Pattern: good entries authored at release time, not by skills | File: `CHANGELOG.md` | Detail: Versions 2.10.0 and 2.11.0 have strong prose taglines and bullet summaries that are clearly hand-crafted in the chore(release) commit. Skills don't produce these.

### ENTRY QUALITY CLASSIFICATION (CHANGELOG.md — all versions)

**Prose-summary (strong — tagline + detailed feature bullets):**
- 2.11.0 — bold tagline + 7 detailed bullets with PR refs and outcome descriptions
- 2.10.0 — bold tagline + 3 bullets with rationale and context
- 2.9.0 — opening paragraph + ### Added/Changed/Fixed with detailed bullets (each explains the *why*, not just the *what*)
- 2.5.0 — bold tagline paragraph + ### Added with detailed bullets
- 2.4.0 — bold tagline + ### Added with multi-sentence bullets
- 2.3.0 — bold tagline + ### Added with multi-sentence bullets
- 2.1.0 — bold tagline + ### Added with multi-sentence bullets
- 2.0.0 — Milestone note + brand framing paragraph + ### Added

**Mixed (PR-reference embedded in prose — tolerable but not great):**
- 2.8.0 — ### Added/Changed/Fixed structure; descriptions good but "(PR #220)" inline notations litter bullets
- 2.7.0 — ### Added/Changed/Notes; descriptions include feature rationale; PR refs embedded
- 2.6.0 — Short bullets with no PR refs but very terse ("Multica task-tracking adapter (s1)")
- 2.4.2 — Long single bullet with good detail; acceptable
- 2.4.1, 2.3.2, 2.3.1 — Fix-only patches; single bullets with good prose; acceptable

**PR-reference-dump / thin (weak):**
- 2.0.1 — "Patch release. Merges three nightly cycle ledger appends… No code or workflow changes — operational state only." ACCEPTABLE for patch-only but the bullet items are just ledger file paths with no outcome explanation.
- 1.2.2 — Very long paragraph; reasonable prose but reads like a diff summary, not a release note
- 1.2.1, 1.2.0, 1.1.4, 1.1.3, 1.1.2 — Reasonable prose with bullet items; quality degrades into long enumerated feature lists without outcome framing
- 1.1.1 — "cmux v2 API as native team execution backend." One-liner header + short bullets — weak
- 1.1.0 — "External model integration: cross-model execution with OpenAI Codex." Better tagline, then terse bullets
- 1.0.0 — Just an ### Added list with no version rationale
- 0.9.0–0.1.0 — Each is 1-3 sentence header + a few Added bullets; no prose outcome, no why, just *what* was added. Classic thin entries.

### VERBATIM WEAK EXAMPLES

**Example 1 — 0.x thin bullet pattern (0.5.0):**
```
## [0.5.0] - 2026-04-02

Agent infrastructure v2: config schema, memory architecture, planning, and portability.

### Added
- Agent config schema reference (`hive/references/agent-config-schema.md`)
- Workflow schema reference (`hive/references/workflow-schema.md`)
- Team config schema reference (`hive/references/team-config-schema.md`)
- Configurable model tiers in `hive.config.yaml`
- Portable plugin structure with `${CLAUDE_PLUGIN_ROOT}` path resolution
```
No outcomes, no why, no cross-feature narrative.

**Example 2 — 1.1.1 near-one-liner (typical 1.x minor entry):**
```
## [1.1.1] - 2026-04-18

cmux v2 API as native team execution backend.

### Added
- cmux team execution path (execute step 6b) — orchestrator manages parallel
  stories in cmux panes via v2 JSON-RPC API instead of TeamCreate
- `execution.interactive_panes` config toggle — controls whether cmux-spawned
  agents (Claude and Codex) launch in interactive or one-shot mode
```
Tagline is terse, bullets describe mechanism not outcome, no user impact framing.

**Example 3 — execute step 7e automated entry (current template):**
```
### Changed
- **`{epic-id}` release finalization.** `/execute` applied the planned `{version_bump}` version bump (`{old_version}` → `{new_version}`) and kept plugin version sources in lockstep.
```
Pure accounting. No features. This is the ONLY thing skills currently write to CHANGELOG.md automatically.

### CONSTRAINTS

- Constraint: CHANGELOG.md is append-only by convention | Source: `CHANGELOG.md` file format header ("Keep a Changelog") | Impact: Any new authoring step must prepend under `## [Unreleased]`, not touch prior entries.
- Constraint: `## [Unreleased]` section must exist for /ship step 3 to pass | Source: `skills/ship/SKILL.md:141-145` | Impact: Any changelog authoring requirement must land within the Unreleased block before /ship runs.
- Constraint: execute step 7e owns the version bump write | Source: `skills/execute/SKILL.md:342-384` | Impact: A prose-summary requirement for the Unreleased entry must either extend step 7e or be a separate earlier step in /execute or /plan; it cannot live in /ship (too late — /ship verifies, doesn't author).
- Constraint: /ship step 3 currently only checks for the entry, not its quality | Source: `skills/ship/SKILL.md:141-145` | Impact: Adding a quality gate here requires a new check on prose content, not just presence.
- Constraint: release_post artifacts are separate surfaces | Source: `hive/lib/release_post.mjs` | Impact: Rich post.md content is not automatically reusable for CHANGELOG without an explicit pull step; the two templates diverge.

### RISKS

- Severity: high | Risk: No skill today mandates authoring human-readable feature prose in CHANGELOG.md | Evidence: execute step 7e (L360-365) writes only the version bump accounting line; /ship verifies only structural presence. All good human-readable entries observed in CHANGELOG.md appear to be manually authored at release time via chore(release) commits.
- Severity: medium | Risk: release_post.mjs generates rich narrative (highlights, story_trace) that is never surfaced in CHANGELOG.md — potential to leverage this content but no bridge exists | Evidence: `hive/references/release-post/post-template.md`, `hive/lib/release_post.mjs` (both confirmed separate path from CHANGELOG.md)
- Severity: medium | Risk: Authoring requirement could conflict with the serial-commit-per-story convention — if the CHANGELOG entry must aggregate all story outcomes, it can only be written after all stories complete, which is already what step 7e does. A PRD must decide: one entry per story (noisy) vs one aggregate entry per epic release (current pattern, requires aggregation) | Evidence: `skills/execute/SKILL.md:342-384` (step 7e runs "after the last story's integrate step")
- Severity: low | Risk: If ship's step 3 quality gate is added, it may block releases on poorly-written AI-generated entries as much as missing entries | Evidence: no existing prose quality signal in /ship

### UTILITIES_AVAILABLE

- Utility: `release_post.mjs` generateReleasePostArtifacts | File: `hive/lib/release_post.mjs` | Relevance: Already generates narrative artifacts per release from story YAML; could provide a generation model or shared template for CHANGELOG prose. The `shippedStories` array includes `title`, `outcome`, `sourcePath` — exactly what a CHANGELOG entry needs.
- Utility: execute step 7e integration point | File: `skills/execute/SKILL.md:342-384` | Relevance: The canonical place to extend automated CHANGELOG authoring. Currently writes 1 mechanical line; can be extended to write a feature-narrative block before the version-bump line.
- Utility: /plan epic.yaml `version_bump` field | File: `skills/execute/SKILL.md:342` | Relevance: /plan records the bump level at plan time; this is already read by step 7e and could gate a CHANGELOG narrative prompt.

### EXTERNAL_REFERENCES

- Source: `https://keepachangelog.com/en/1.0.0/` (referenced in CHANGELOG.md header) | Relevance: Prescribes "Added/Changed/Deprecated/Removed/Fixed/Security" sections; human-readable prose bullets under each section are the explicit convention. | Key takeaway: The format already supports prose — the gap is authoring, not format.

### UNANSWERED_QUESTIONS

- Who is currently writing the bold taglines seen in 2.10.0 and 2.11.0? The chore(release) commits suggest a human maintainer or a release-specific step not captured in any skill SKILL.md. No skill step explicitly delegates "write the release tagline."
- Does the `/plan` skill capture story outcomes in any field that could seed the CHANGELOG entry prose? The story YAML `title` and `outcome` fields (seen in release_post.mjs) may be available — not confirmed from this research pass.
- Is there a `hive/workflows/steps/development-classic/step-08-integrate.md` that could add a CHANGELOG entry per-story? Not checked in this pass (outside declared scope).

### INCONSISTENCY_RISK_SIGNALS

- Signal: vocabulary mismatch | Where: `skills/execute/SKILL.md:360-365` vs `CHANGELOG.md:12-23` | Detail: Step 7e mandates a version-accounting line; the good entries in CHANGELOG (2.11.0, 2.10.0) never contain this mechanical line — suggesting either (a) the step 7e line gets edited out in the chore(release) commit, or (b) it's only added by the safety-net path in /ship, not the normal flow. If the entry is always overwritten, mandating quality here may create a ghost requirement.
- Signal: hidden assumption | Where: issue requirement vs `skills/ship/SKILL.md:141-145` | Detail: The requirement says "CHANGELOG.md is read by humans; each release entry needs a textual summary." Ship currently only checks structural presence, not prose. Any quality check added to /ship runs AFTER /execute and cannot retroactively improve entries written during development — it can only gate/reject, not produce better prose.
- Signal: unresolved tension | Where: `hive/lib/release_post.mjs` vs `CHANGELOG.md` | Detail: Two separate narrative generation surfaces (release_post artifacts vs CHANGELOG) cover the same release. If the fix is "generate CHANGELOG prose from story outcomes," the same logic as release_post could apply — but keeping them in sync as separate code paths creates drift risk.

---

## VALIDATION NOTE

Checked: No external libraries/SDKs/APIs involved — research is codebase-only.
Source: codebase-only
Confidence: high
Findings: All authoring callsites located via direct file reads. No web escalation needed. No version constraints or API gotchas apply.
