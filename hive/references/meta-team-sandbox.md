# Meta-Team Sandbox Pipeline — Retired (Historical Reference)

## Status

This document describes the retired file-copy sandbox model previously used for meta-team changes. It is preserved as historical context only.

This document is NOT the authoritative isolation guide for the active meta-improvement system. The successor reference is `hive/references/meta-experiment-isolation.md`, which reflects signed user decision Q4 (`Worktree default`).

Date of demotion: 2026-04-21.

File-copy sandboxing is NOT an acceptable default for self-modifying meta-swarm experiments. Worktree-based isolation is now the authoritative model.

This retired guide describes how operators previously isolated certain risky edits before the 2026-04-21 authority reset.

---

## When to Use the Sandbox

Under the retired model, operators used sandbox mode when a proposal:
- Creates a new workflow step file that will be referenced by an existing workflow YAML
- Modifies an existing reference doc that other files link to by path
- Changes a schema field that affects multiple agent persona files
- Introduces a new agent persona that will be cross-referenced from `MAIN.md` or `GUIDE.md`

Under that same retired model, operators skipped sandbox mode for:
- New standalone files with no cross-references (e.g., a new starter memory, a new reference doc not yet linked anywhere)
- Additive changes to existing files where the added section has no dependents

---

## Sandbox Procedure

### 1. Create a sandbox copy
Operators created a copy at:
```
.pHive/meta-team/sandbox/{proposal_id}/{target_filename}
```

Example:
```
.pHive/meta-team/sandbox/proposal-3/vertical-planning.md
```

### 2. Write to the sandbox copy
Under the retired model, all writes and edits went to the sandbox copy, not the live path.

### 3. Validate the sandbox copy
Operators then ran the same test checks that step-05 (testing) would have run, but against the sandbox copy:
- Cross-reference integrity: does anything link TO this file? If so, verify the path is correct.
- Schema compliance: does the content follow the appropriate schema?
- Content safety: if modifying an existing file, is the line count > 50% of original?

### 4. Promote or discard
If validation passed:
- Copy the sandbox file to the live target path
- Delete the sandbox copy
- Record the change as promoted

If validation failed:
- Leave the sandbox copy in place (it serves as evidence for the failure report)
- Record the change as `blocked: sandbox_validation_failed` with details
- Do NOT copy to live path

---

## Sandbox Directory Structure

```
.pHive/meta-team/sandbox/
├── proposal-1/
│   └── {filename}
├── proposal-2/
│   └── {filename}
└── proposal-3/
    └── {filename}
```

In that retired pipeline, the sandbox directory was cleaned up during the close step (step-08). All sandbox files were deleted after the cycle closed, whether the proposal was promoted or not.

---

## Fast Path (No Sandbox)

For low-risk changes in the retired model, operators wrote directly to the live path:
```
hive/references/new-topic.md       ← write here directly
skills/hive/agents/memories/...    ← write here directly
```

The implementation step (step-04) determined which path to use based on the proposal's `risk_score`:
- `risk_score ≤ 2`: write directly to live path
- `risk_score ≥ 3`: use sandbox

---

## Sandbox Validation Checks

These were the same checks as step-05, but run on the sandbox copy:

| Check | Pass Condition |
|-------|---------------|
| Cross-reference integrity | All paths referenced in the new content exist in the live codebase |
| Schema compliance | Content follows the required schema for its file type |
| Content safety | Line count ≥ 50% of original (for modifications only) |
| Path validity | The file will be written to the correct domain per charter scope |

If all checks passed: promote.
If any check failed: discard sandbox, record failure.
