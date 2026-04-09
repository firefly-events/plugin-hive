# Phase 5: Testing (Sandbox Validation)

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT approve changes that exceed the destructiveness threshold
- Do NOT skip structural validation — parse every modified file
- Run ALL checks for each proposal independently
- Check budget at phase start — skip to Phase 8 if <90 min remaining
- STUBBED in baseline cycle (S3) — log "Phase 5 skipped — baseline cycle" and advance

## EXECUTION PROTOCOLS

**Mode:** autonomous

The tester runs the sandbox validation suite on each worktree. Every modified
file is checked against the charter's destructiveness threshold and structural
requirements.

## CONTEXT BOUNDARIES

**Inputs available:**
- Worktrees from Phase 4 (one per proposal)
- state/meta-team/charter.md — destructiveness threshold definition
- Original files on main branch (for comparison)

**NOT available:**
- Architect's rationale (independent evaluation)
- Developer's implementation notes

## YOUR TASK

Validate each proposal's implementation against safety and quality criteria.

## TASK SEQUENCE

For each worktree (proposal):

1. **Destructiveness check**
   - For each modified file:
     - `original_lines` = line count on main branch
     - `modified_lines` = line count in worktree
     - `removed_lines` = count of lines present in original but absent in modified (use `git diff --stat` or line-by-line comparison)
     - If `removed_lines > (original_lines * 0.5)`: FAIL — destructive (even if new lines were added to replace them)
     - If `modified_lines < (original_lines * 0.5)`: FAIL — destructive (catches pure deletions)
   - For each deleted file: FAIL — destructive

2. **Structural validation**
   - YAML files: `safe_load` must succeed
   - Markdown files: check for expected structure (headers, frontmatter if applicable)
   - Report any parse errors

3. **Heuristic analysis** (advisory, not blocking)
   - Scan diff for safety keyword removal: "constraint", "must not", "never",
     "required", "safety", "do not"
   - Flag charter constraint contradictions
   - Flag cross-file inconsistencies (best-effort)
   - Output: heuristic report with flags

4. **Metrics collection**
   - Lines added / removed
   - Files modified count
   - Structural validation result (pass/fail)
   - Heuristic flags count
   - Overall: PASS or FAIL

## OUTPUT FORMAT

```yaml
test_results:
  - proposal_id: "opt-{date}-{seq}"
    destructiveness: pass|fail
    structural: pass|fail
    heuristic_flags: [list of advisory flags]
    metrics:
      lines_added: N
      lines_removed: N
      files_modified: N
    overall: pass|fail
    notes: "any additional observations"
```

## PHASE TRANSITION

On success: advance to Phase 6 (Evaluation) with test results.
On all proposals failing: advance to Phase 8 (close), log all failures.
