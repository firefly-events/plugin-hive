---
name: ship
description: Reconcile completed work, verify the planned version bump, run the configured ship action, generate release artifacts, and mark stories shipped.
---

# Hive Ship

Close one or more epics by reconciling story status, verifying release readiness,
executing the configured ship target, generating release communications, and
advancing shipped stories.

**Input:** `$ARGUMENTS` contains zero or more epic IDs plus optional flags:

| Argument | Meaning |
|----------|---------|
| *(none)* | Infer the obvious single target epic. |
| `<epic-id>` | Ship one epic. |
| `<epic-id> <epic-id> ...` | Ship a multi-epic release. |
| `--partial` | Allow shipping only the stories that are already `complete` after reconciliation. |
| `--release-id <id>` | Use a stable release artifact ID. Default: `<project>-<YYYYMMDD-HHMMSS>`. |
| `--dry-run` | Stop after displaying the resolved ship plan. Do not execute, generate artifacts, or mark shipped. |
| `--campaign` | Opt in to the post-release marketing campaign step (step 9). Equivalent to `ship.campaign: true` in `hive.config.yaml`. Default: off. Consumer projects only. |

## State Directory Resolution

All state paths in this skill are written as `${HIVE_STATE_DIR}/...`. Resolve
`HIVE_STATE_DIR` from `paths.state_dir` in the root `hive.config.yaml`; fall
back to `.pHive` when unset. The shipped baseline at `hive/hive.config.yaml` is
only a fallback source and does not override the consumer root config.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md)
for initialization, persona/config loading, and memory loading.

This skill is release-action-shaped, so the kickoff gate is strict. If
`${HIVE_STATE_DIR}/project-profile.yaml` is missing, stop and tell the operator:

```text
Hive is not initialized for shipping. Run /hive:kickoff so ship_target is captured before /ship runs.
```

## Process

### 1. Resolve Target Epic Set

Parse `$ARGUMENTS` into `epic_ids[]` and flags.

If one or more epic IDs are supplied, validate that every
`${HIVE_STATE_DIR}/epics/{epic-id}/epic.yaml` exists. If any are missing, stop and
list the missing paths.

If no epic IDs are supplied, infer the obvious target:

1. Scan `${HIVE_STATE_DIR}/epics/*/epic.yaml`.
2. Exclude epics where every story is already `shipped`.
3. Prefer epics with at least one story whose derived status is `complete`.
4. If exactly one candidate remains, use it.
5. If zero candidates remain, stop:

   ```text
   No obvious epic to ship. Pass an epic ID, or run /status to inspect active epics.
   ```

6. If multiple candidates remain, stop and list them:

   ```text
   Multiple possible epics found. Re-run /ship with one or more epic IDs:
   - {epic-id} - {title}
   ```

For every story status read, call `deriveStoryStatus({ epic_id, story_id })` from
`hive/lib/story-status.mjs` when available. Treat derived `completed` as canonical
`complete` for compatibility with older episode markers. If the helper is
unavailable, read story YAML `status:` only as a compatibility fallback and warn
once that marker-derived status could not be used.

### 2. Pre-Flight Status Reconciliation

Walk every story in every target epic in deterministic order: epics in the order
provided, then stories in `epic.yaml` order.

For each story:

- `shipped`: exclude it from this release and show it as already shipped.
- `complete` or legacy `completed`: include it in the ship set.
- `in_review`: surface the story and ask the operator to choose:
  - `confirm-complete` - manual review already passed. Write `status: complete`
    to the story YAML projection and include it in the ship set.
  - `bounce-to-rework` - review did not pass or evidence is missing. Write
    `status: in_progress`, record the rework reason if provided, and exclude it.
- any other status (`pending`, `in_progress`, `blocked`, `failed`, missing):
  surface the story and ask the operator to choose:
  - `confirm-complete` - required work and review are actually done. Write
    `status: complete` and include it.
  - `bounce-to-rework` - work remains. Write `status: in_progress`, record the
    rework reason if provided, and exclude it.

The reconciliation prompt must show:

- epic ID and story ID;
- title;
- current derived status;
- latest episode marker path or "no episode marker found";
- the exact write that each choice will make.

This step is the only `/ship` path that may write `complete`, and only as a
manual-review reconciliation correction. It must never mark a story `shipped`.

After reconciliation:

- If any target story is not `complete` or `shipped` and `--partial` is absent,
  refuse to ship:

  ```text
  Ship refused: all target stories must be complete before release.
  Re-run /ship after rework, or pass --partial to ship only complete stories.
  ```

- If `--partial` is present, continue with only the reconciled `complete` stories
  and show the excluded stories.
- If the ship set is empty, stop. Do not run a ship action, generate release
  artifacts, or mark anything shipped.

### 3. Author the Unreleased Changelog Entry

Runs after reconciliation (so the ship set is final) and before version
verification (which reads the `## [Unreleased]` section this step writes).

All entry format rules — entry shape, bullet shape, the authoring source
chain, degraded-source marking, and the quality criteria — live in
[`hive/references/changelog-entry-format.md`](../../hive/references/changelog-entry-format.md).
That document is the mandatory single source; do not restate its rules here or
in operator prompts — link to it.

1. **Draft.** Build a draft `## [Unreleased]` entry from the reconciled ship
   set (the same shipped-story set later passed as `shippedStories` to
   `generateReleasePostArtifacts` in the Announce step — one data source, two
   consumers). Draft the tagline and one prose bullet per major change using
   the authoring source chain and degraded-source marking defined in the
   format reference (§3, §4). Drafting never blocks on missing story data and
   never invents outcomes — degrade down the chain instead.

2. **Check for existing manual prose.** If `## [Unreleased]` already contains
   a hand-written prose entry for a target epic, present it alongside the
   draft and ask the operator to choose `keep` (discard the draft for that
   epic) or `merge` (operator combines them). Never silently overwrite a
   manual entry.

3. **Operator review — this is the quality gate.** Present the draft (or the
   merge candidate) to the operator for approve/edit, judged against the
   quality criteria in the format reference (§5). There is no separate
   quality-check step later in `/ship`; approval here is final. The operator
   may edit freely. Degraded-source markers exist precisely so this review
   knows which bullets were synthesized from thin data.

4. **Write.** On approval, strip all degraded-source markers and write the
   approved entry under `## [Unreleased]` in `CHANGELOG.md`. The file is
   append-only: never modify previously released entries.

### 4. Verify Planned Version Bump

For each target epic, read `version_bump` from
`${HIVE_STATE_DIR}/epics/{epic-id}/epic.yaml`. Missing means `none`.

If every target epic has `version_bump: none`, report that no bump is required and
continue.

For each epic where `version_bump` is `major`, `minor`, or `patch`, verify that
`/execute` already applied the bump:

1. Inspect every JSON version source named in `/execute`:
   - `.claude-plugin/*.json`;
   - root `plugin.json` when present.
2. Parse JSON with a structured parser. Collect every recursive `version` field.
3. Verify all collected version values are in lockstep. If not, stop and report
   the mismatched path/key/value set.
4. Verify `CHANGELOG.md` contains an `## [Unreleased]` entry for the epic that
   names the planned bump level. The prose entry was just authored in-flow by
   step 3, so the section is expected to exist by now; the bump-level
   accounting line itself normally comes from `/execute` step 7e. Do not
   treat the step 3 prose entry as missing-bump evidence one way or the
   other — this check is about the version-accounting line.

If the version sources are lockstep and the changelog contains the epic bump
entry, report the verified version and continue.

If the planned bump appears missing, show the gap and offer a safety-net patch:

```text
Version bump gap detected for {epic-id}: planned {version_bump}, but /execute did not leave matching version/changelog evidence.
Patch the missing bump here before shipping? (yes/no)
```

When the operator answers `yes`, apply the same structured bump rules described
in `skills/execute/SKILL.md` step 7e:

- compute the next SemVer from the current lockstep version;
- update every discovered `version` field in every version source;
- add the version-accounting changelog line under `## [Unreleased]` (the
  human-readable prose entry was already authored in step 3);
- commit the version-source and changelog changes with:

  ```bash
  git commit -m "chore(release): apply ship-time version safety net for {epic-id}"
  ```

When the operator answers `no`, stop. `/ship` must not execute a release action
while the planned bump is unverified.

`/ship` is a verifier and safety net. The normal owner of the planned version bump
is still `/execute`.

### 4b. Cut the Changelog (stamp the release)

After the version is verified (step 4) and before the ship action runs, promote the
staged `## [Unreleased]` section in `CHANGELOG.md` to a dated version heading so the
released changelog reflects the version that actually ships. **Skipping this is what
strands release notes under `[Unreleased]` while `plugin.json` moves ahead** — the
newest *versioned* changelog entry then drifts behind the real version (this is
exactly how the 2.14.0 notes were left under `[Unreleased]` while `plugin.json` read
2.14.0).

Skip this step only for a pure none-bump run — when every target epic is
`version_bump: none` and no version is being cut. Then leave `[Unreleased]` in place
so the none-bump notes accumulate for the next versioned release.

When a version IS being cut:

1. Rename the current `## [Unreleased]` heading to `## [{version}] - {YYYY-MM-DD}`,
   using the verified version from step 4 and the ship date (UTC). The date is the
   release date, not the date the `[Unreleased]` content was first authored.
2. Insert a fresh, empty `## [Unreleased]` heading immediately above it so the next
   cycle's step 3 has a staging section to write into.
3. Never edit an already-released entry below — `CHANGELOG.md` stays append-only
   (`hive/references/changelog-entry-format.md` §1). This step only promotes the
   staging section to a versioned heading; it never rewrites released history.
4. Commit the stamp on the release branch (`develop`, per step 6a) so the promotion
   PR carries it to `main` and the public sync publishes the correctly-versioned
   changelog.

### 5. Resolve Ship Target And Dry Run

Read `${HIVE_STATE_DIR}/project-profile.yaml` and require a valid `ship_target`
block:

```yaml
ship_target:
  kind: app-store | vercel | github-release | npm | custom
  command: "<shell command>" # required only when kind == custom
  notes: "<optional human note>"
```

If the block is missing or invalid, stop and tell the operator to run
`/hive:kickoff` to capture the ship target.

Resolve the concrete action:

| Kind | Action |
|------|--------|
| `github-release` | `gh release create {release-id} --generate-notes` — default `release-id` is `<project>-<YYYYMMDD-HHMMSS>`; for a versioned release pass `--release-id v{version}` so the Git tag follows semver (e.g. `v2.10.0`) |
| `vercel` | `vercel deploy --prod` |
| `npm` | `npm publish` |
| `app-store` | Use `ship_target.command` when present; otherwise stop and ask the operator to add a store-specific command or switch to `custom`. |
| `custom` | Use `ship_target.command`; it must be non-empty. |

Before executing anything, print a dry-run plan:

```text
## Ship Dry Run

Release ID: {release-id}
Target epics: {epic_ids}
Stories to mark shipped after success:
- {epic-id}/{story-id} - {title}

Ship target:
- kind: {kind}
- command: {resolved command}
- notes: {notes or none}

Release artifacts:
- ${HIVE_STATE_DIR}/releases/{release-id}/post.md
- ${HIVE_STATE_DIR}/releases/{release-id}/video-script.md
- ${HIVE_STATE_DIR}/releases/{release-id}/post-ideas.md
```

If `--dry-run` is present, stop here.

Require explicit operator confirmation before executing the command:

```text
Execute this ship action now? Type "ship {release-id}" to continue.
```

For `custom` and `app-store` command-backed targets, also show:

```text
This command is project-defined and may have high blast radius.
```

Do not execute unless the typed confirmation exactly matches `ship {release-id}`.

### 6. Execute Ship Action

#### 6a. Release branch flow — promote develop → main (no backmerge)

For `github-release` (and any `main`-tagged target), the release tag must be cut
on `main`, and `main` must already contain the release commits authored in steps
2–4 (reconcile, changelog, version bump). Those steps write to the working branch,
which for a release is `develop`. Reach `main` with a **single promotion PR** — do
not backmerge afterward.

Canonical flow:

1. Ensure the version bump (step 4), the changelog entry (step 3) **stamped to its
   version heading (step 4b)**, and the story reconcile (step 2) are committed **on
   `develop`** (open a normal PR to `develop` if they are not already merged there).
2. Open **one** promotion PR with **`head=develop`, `base=main`**:

   ```bash
   gh pr create --base main --head develop \
     --title "release: promote develop → main (v{version})" \
     --body "Promotes v{version}: {epic list}. Merging makes main == develop — no backmerge."
   ```
3. Merge that PR. Because `head=develop`, merging leaves `main` and `develop`
   identical — **`develop` never falls behind, so no separate develop←main
   backmerge PR is required.**
4. Only then cut the tag/release on `main` (the resolved command below).

**Anti-pattern (do not do this):** cutting a throwaway `release/<v>` branch off
`develop` and merging it **only** to `main`. That leaves the version bump and
changelog on `main` but not `develop`, forcing a follow-up develop←main backmerge
PR (the debt this flow removes). Author on `develop`; promote `develop → main`.

Skip this sub-step for targets that do not tag `main` (e.g. `vercel`, `npm` from
the working branch, or `custom` commands that manage their own refs).

#### 6b. Run the ship command

Run the resolved command from the repository root.

If the command exits non-zero, stop and report the command, exit code, and the
first useful error output. Do not generate release artifacts and do not mark any
story shipped.

If the command succeeds, capture:

- command;
- exit code;
- timestamp;
- release ID;
- target epics;
- shipped story IDs.

### 7. Announce

Generate release artifacts under `${HIVE_STATE_DIR}/releases/{release-id}/`.

Use `hive/lib/release_post.mjs`:

```javascript
import { generateReleasePostArtifacts } from './hive/lib/release_post.mjs';

await generateReleasePostArtifacts({
  epicIds,
  releaseId,
  projectName,
  repoUrl,
  links,
  channels,
  repoRoot,
  shippedStories,
});
```

Pass `shippedStories` explicitly from the current ship set so the artifacts can be
created before the final `complete -> shipped` projection write. Each story entry
must include `epicId`, `storyId`, `title`, `outcome`, and `sourcePath`. The
generated highlights must trace to the shipped stories; do not invent features.

If artifact generation fails, stop and report the failure. Do not mark stories
shipped until the release artifacts exist.

### 8. Mark Shipped

Only after the ship action succeeds and release artifacts exist, advance every
story in the ship set from `complete` to `shipped`.

Write the story YAML projection:

```yaml
status: shipped
shipped_at: "<ISO 8601 timestamp>"
release_id: "<release-id>"
```

Do not change stories excluded by `--partial`, stories bounced to rework, or
stories already shipped in a previous release.

If task tracking is configured, project the same final status through the
task-tracking adapter using skill context `ship`. Adapter failure is recoverable:
local story YAML and episode markers remain the source of truth.

Finally, run `/status {epic-id}` or invoke the same read-only status derivation
path for every target epic and report the resulting shipped state. `/status`
itself must remain read-only; do not add status writes to it.

### 9. Launch Campaign (Consumer-Gated, Opt-In)

Runs after stories are marked shipped. Skipped unless ALL of the following are true:

1. **Consumer gate** — `project_type` in `${HIVE_STATE_DIR}/project-profile.yaml` equals `consumer-app`. If the project is Hive's own internal development work, skip this step silently.
2. **Opt-in gate** — at least one of:
   - `--campaign` flag was passed on the `/ship` invocation; **or**
   - `ship.campaign: true` is set in the root `hive.config.yaml` (consumer override layer; falls back to `hive/hive.config.yaml`; default `false`/absent = off).

When both gates pass, invoke `/marketing-campaign` in `--from-ship` mode, passing the changelog file as source material:

```text
/marketing-campaign --from-ship CHANGELOG.md
```

The changelog path is the same `CHANGELOG.md` written in step 3. `/marketing-campaign` owns its own user-review gate (decision gate after the creative pass) — `/ship` does not add a second prompt. `/ship` is done after handing off the changelog path; campaign output lands under `.pHive/campaigns/<topic>/` per the `/marketing-campaign` skill contract.

**Sequence note:** this step runs after mark-shipped (step 8) and is independent of any worktree-prune step that may follow. If a worktree-prune step exists (added by a parallel story), it runs after this campaign-hook step.

**Documenting the opt-in.** The `--campaign` flag is listed in the `/ship` argument table at the top of this skill, and `ship.campaign` is documented in this step. No other configuration schema changes are required for v1.

#### `--campaign` flag documentation

Add the following entry to the `/ship` **Input** flags table at the top of this skill when that table is maintained:

| `--campaign` | Opt in to the post-release marketing campaign step (step 9). Equivalent to `ship.campaign: true` in `hive.config.yaml`. Default: off. |

### 10. Prune Epic Worktree(s)

Runs after stories are marked shipped. Removes worktrees created for the shipped
epic so they do not accumulate under `.claude/worktrees/`.

**Enumerate candidates:**

```bash
# list worktrees, keep only this epic's under .claude/worktrees/
git worktree list --porcelain \
  | awk '/^worktree /{wt=$2} /^branch /{br=$2; print wt"\t"br}' \
  | grep -F ".claude/worktrees/" \
  | grep -E "refs/heads/feat/${EPIC_ID}$"
```

Repeat for every epic ID in the ship set.

**For each candidate worktree, apply hard guards in order:**

1. **Active cwd guard** — if the candidate path is a prefix of (or equal to)
   the current working directory, do NOT remove it. Report:
   ```text
   Worktree {path}: skipped — this is your active session directory. Remove manually after leaving it.
   ```

2. **Dirty guard** — run `git -C {path} status --porcelain`. If output is
   non-empty, do NOT remove. Report:
   ```text
   Worktree {path}: skipped — has uncommitted changes (dirty).
   ```

3. **Merged guard** — confirm the branch is fully merged into the ship target.
   Run `git branch --merged {ship-target-ref} --list {branch-name}` from the
   repo root. If the branch does not appear in the output, do NOT remove. Report:
   ```text
   Worktree {path}: skipped — branch {branch} is not fully merged into {ship-target-ref}.
   ```

4. **Remove** — all guards passed. Run:
   ```bash
   git worktree remove {path}
   ```
   Report:
   ```text
   Worktree {path}: removed.
   ```

After processing all candidates, run `git worktree prune` to clean up stale
administrative files for worktrees whose directories are already gone.

**Idempotency:** if no matching worktrees exist (already removed or never
created), this step is a silent no-op. No error is raised.

**`--dry-run` flag:** this step is skipped when `--dry-run` is active (step 5
stops before execution).

## Output

End with a compact release summary:

```text
## Shipped {release-id}

Ship target: {kind}
Command: {resolved command}
Epics: {epic_ids}
Stories shipped: {count}
Release artifacts:
- ${HIVE_STATE_DIR}/releases/{release-id}/post.md
- ${HIVE_STATE_DIR}/releases/{release-id}/video-script.md
- ${HIVE_STATE_DIR}/releases/{release-id}/post-ideas.md

Excluded stories:
- {epic-id}/{story-id} - {status/reason}

Worktree cleanup:
- {path}: removed
- {path}: skipped — {reason}
```

## Key References

- [`hive/references/status-lifecycle.md`](../../hive/references/status-lifecycle.md) - `/ship` owns `complete -> shipped` and the manual-complete reconciliation path.
- [`hive/references/kickoff-protocol.md`](../../hive/references/kickoff-protocol.md) - `ship_target` schema and allowed target kinds.
- [`hive/references/changelog-entry-format.md`](../../hive/references/changelog-entry-format.md) - mandatory single source for changelog entry format, authoring source chain, and quality criteria.
- [`skills/execute/SKILL.md`](../execute/SKILL.md) - primary version bump owner and ship-time safety-net patch rules.
- [`skills/status/SKILL.md`](../status/SKILL.md) - read-only status reporting and `deriveStoryStatus` usage.
- [`hive/lib/release_post.mjs`](../../hive/lib/release_post.mjs) - release artifact generator.
- [`skills/marketing-campaign/SKILL.md`](../marketing-campaign/SKILL.md) - post-release campaign skill invoked by step 9 (`--from-ship` mode); owns the user-review gate and campaign output.
