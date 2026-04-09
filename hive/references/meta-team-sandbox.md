# Meta Team Sandbox Pipeline Reference

> Reference document for the Meta Team's sandbox pipeline. Defines worktree isolation,
> destructiveness enforcement, structural validation, heuristic analysis, promotion,
> rollback, and cleanup procedures.

## Overview

Every proposed change passes through the sandbox pipeline before reaching main.
The pipeline provides safety guarantees through multiple validation layers:

1. **Worktree isolation** — one worktree per proposal, no interaction between proposals
2. **Destructiveness enforcement** — programmatic check against charter threshold
3. **Structural validation** — parse all modified files to verify format integrity
4. **Heuristic analysis** — advisory flags for safety-sensitive changes
5. **Promotion** — cherry-pick from worktree to main with structured commit message
6. **Rollback** — per-commit revert capability with baseline tags

## Worktree Management

### Creation

Each proposal gets its own isolated worktree. Worktrees are created outside the
main repo tree to avoid polluting git status.

```
Path:    .claude/worktrees/meta-team-{proposal-id}
Branch:  meta-team/sandbox-{proposal-id}
Command: git worktree add .claude/worktrees/meta-team-{proposal-id} -b meta-team/sandbox-{proposal-id}
```

### Cleanup

After promotion, discard, or deferral, the worktree and branch are removed:

```
git worktree remove .claude/worktrees/meta-team-{proposal-id}
git branch -D meta-team/sandbox-{proposal-id}
```

### Boot Cleanup (Stale Worktree Detection)

On cycle boot, any existing `.claude/worktrees/meta-team-*` directories indicate
a crashed previous cycle. These are forcefully removed:

```
for wt in .claude/worktrees/meta-team-*; do
  git worktree remove "$wt" --force 2>/dev/null
done
# Also clean orphaned branches:
git branch --list 'meta-team/sandbox-*' | xargs -r git branch -D
```

## Destructiveness Enforcement

### Threshold (from charter)

A change is **destructive** if:
- It removes **>50% of content** (by line count) from a single file
- It **deletes a file** entirely

### Algorithm

```
For each modified file in the worktree diff:
  original_lines = wc -l <file on main branch>
  modified_lines = wc -l <file in worktree>

  if original_lines > 0 and modified_lines < (original_lines * 0.5):
    REJECT: "Destructive change — {file} lost >50% of content"
    REJECT: "  Original: {original_lines} lines, Modified: {modified_lines} lines"
    REJECT: "  Removal: {100 - (modified_lines/original_lines * 100)}%"

For each deleted file in the worktree diff:
  REJECT: "Destructive change — {file} deleted entirely"
```

### Edge Cases

- New files (additions only): always pass — no original content to compare
- Empty files (0 lines): skip comparison — division by zero guard
- Binary files: skip line counting — structural validation handles format

## Structural Validation

### YAML Files

- Parse with `safe_load` (or equivalent safe parser)
- Must succeed without errors
- Frontmatter in markdown files: parse YAML between `---` delimiters

### Markdown Files

- Check for expected structure based on file location:
  - Agent personas: must have `##` headers for key sections
  - Reference docs: must have `#` title
  - Step files: must have `# Phase/Step` title
- Check for broken internal links (best-effort)

### Validation Output

```yaml
structural_validation:
  - file: "hive/agents/researcher.md"
    format: markdown
    result: pass
    notes: null
  - file: "hive/workflows/meta-team-cycle.workflow.yaml"
    format: yaml
    result: pass
    notes: null
```

## Heuristic Analysis (Advisory)

Heuristic checks raise flags but do NOT block promotion. The reviewer uses
these flags when making the keep/discard/defer decision.

### Safety Keyword Scan

Scan the diff for removal of safety-related keywords:
- "constraint", "must not", "never", "required", "safety", "do not"
- "mandatory", "prohibited", "forbidden", "always"

If any safety keyword is in a removed line: flag as `safety-keyword-removal`.

### Charter Contradiction Check

Compare proposed changes against charter constraints:
- Does the change expand scope beyond charter-defined artifact types?
- Does the change weaken any of the 5 constraints?
- Does the change modify the charter itself? (always flag)

### Cross-File Consistency

Best-effort check for inconsistencies:
- If a persona references a skill, does the skill exist?
- If a workflow references an agent, does the persona exist?
- If a gate policy references an evaluator, does the evaluator pattern exist?

### Heuristic Output

```yaml
heuristic_analysis:
  flags:
    - type: "safety-keyword-removal"
      file: "hive/agents/researcher.md"
      line: 45
      keyword: "must not"
      context: "Removed line: '- Must not exceed the time budget for research phases'"
      severity: "warning"
  advisory_notes:
    - "Change removes a time constraint — verify this is intentional"
  overall: "1 flag raised — reviewer should verify safety keyword removal"
```

## Promotion Protocol

### Pre-Promotion

1. Verify baseline tag exists: `git tag -l 'meta-team/baseline-{date}'`
2. If not: `git tag meta-team/baseline-{date}`

### Cherry-Pick

```
git cherry-pick {commit-sha-from-worktree-branch}
```

Commit message format: `meta-team: {description} [opt-{id}]`

For user-approved deferred changes: `meta-team: {description} [opt-{id}] (user-approved)`

### Post-Promotion Verification

After cherry-pick succeeds:
- Parse all promoted files on main (structural validation)
- If parse fails: `git revert HEAD` immediately, log as discard

### Conflict Handling

If cherry-pick conflicts:
- `git cherry-pick --abort`
- Log: verdict: discard, reason: "merge conflict during promotion"
- Clean up worktree
- Do NOT attempt manual conflict resolution

## Rollback Protocol

### Trigger

Auto-rollback is triggered when the next cycle's boot phase detects
>10% degradation in any objective metric compared to the baseline.

### Procedure

1. Identify the most recent promotion commit(s) since baseline tag
2. `git revert {specific-commit-sha}` (per-commit granularity)
3. Write ledger entry: verdict update with rollback evidence
4. Re-queue the target with `attempted_count` incremented
5. Log: "Auto-rollback: {file} — {metric} degraded from {baseline} to {current}"

### Manual Rollback

To rollback to a specific baseline:
```
git log meta-team/baseline-{date}..HEAD --oneline
# Identify commits to revert
git revert {commit-sha}
```

## Deferred Change Preservation

When a change receives a `defer` verdict:

1. Generate patch file:
   ```
   git diff main..meta-team/sandbox-{id} > state/meta-team/deferred/{id}.patch
   ```
2. Include full context in patch (for clean later application)
3. Update queue entry: `status: needs-user-review`
4. Clean up worktree (patch preserves the change)

### Patch Application (via /meta-team review)

When a user approves a deferred change:
1. Create fresh worktree
2. Apply patch: `git apply state/meta-team/deferred/{id}.patch`
3. Run promotion protocol (same as nightly cycle)
4. On conflict: flag to user (don't force-apply stale patches)

## Ledger Integration

### On Keep (Promoted)

```yaml
- id: "opt-{date}-{seq}"
  verdict: "keep"
  promoted: true
  commit: "{git-sha}"
  reason: null
```

### On Discard

```yaml
- id: "opt-{date}-{seq}"
  verdict: "discard"
  promoted: false
  commit: null
  reason: "destructive|conflict|validation|test-failure"
```

### On Defer

```yaml
- id: "opt-{date}-{seq}"
  verdict: "defer"
  promoted: false
  commit: null
  reason: "subjective — needs user review"
```
