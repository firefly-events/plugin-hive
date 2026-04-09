# Meta-Team Sandbox Pipeline

The sandbox pipeline lets the meta-team experiment with risky changes — ones that could break cross-references or alter existing behavior — without touching the live codebase until the change is validated.

---

## When to Use the Sandbox

Use sandbox mode when a proposal:
- Creates a new workflow step file that will be referenced by an existing workflow YAML
- Modifies an existing reference doc that other files link to by path
- Changes a schema field that affects multiple agent persona files
- Introduces a new agent persona that will be cross-referenced from `MAIN.md` or `GUIDE.md`

Skip sandbox mode for:
- New standalone files with no cross-references (e.g., a new starter memory, a new reference doc not yet linked anywhere)
- Additive changes to existing files where the added section has no dependents

---

## Sandbox Procedure

### 1. Create a sandbox copy
Before modifying the target file, create a copy at:
```
state/meta-team/sandbox/{proposal_id}/{target_filename}
```

Example:
```
state/meta-team/sandbox/proposal-3/vertical-planning.md
```

### 2. Write to the sandbox copy
All writes and edits go to the sandbox copy — not the live path.

### 3. Validate the sandbox copy
Run the same test checks that step-05 (testing) would run, but against the sandbox copy:
- Cross-reference integrity: does anything link TO this file? If so, verify the path is correct.
- Schema compliance: does the content follow the appropriate schema?
- Content safety: if modifying an existing file, is the line count > 50% of original?

### 4. Promote or discard
If validation passes:
- Copy the sandbox file to the live target path
- Delete the sandbox copy
- Record the change as promoted

If validation fails:
- Leave the sandbox copy in place (it serves as evidence for the failure report)
- Record the change as `blocked: sandbox_validation_failed` with details
- Do NOT copy to live path

---

## Sandbox Directory Structure

```
state/meta-team/sandbox/
├── proposal-1/
│   └── {filename}
├── proposal-2/
│   └── {filename}
└── proposal-3/
    └── {filename}
```

The sandbox directory is cleaned up during the close step (step-08). All sandbox files are deleted after the cycle closes, whether the proposal was promoted or not.

---

## Fast Path (No Sandbox)

For low-risk changes — new files with no cross-references — write directly to the live path:
```
hive/references/new-topic.md       ← write here directly
skills/hive/agents/memories/...    ← write here directly
```

The implementation step (step-04) determines which path to use based on the proposal's `risk_score`:
- `risk_score ≤ 2`: write directly to live path
- `risk_score ≥ 3`: use sandbox

---

## Sandbox Validation Checks

These are the same checks as step-05 but run on the sandbox copy:

| Check | Pass Condition |
|-------|---------------|
| Cross-reference integrity | All paths referenced in the new content exist in the live codebase |
| Schema compliance | Content follows the required schema for its file type |
| Content safety | Line count ≥ 50% of original (for modifications only) |
| Path validity | The file will be written to the correct domain per charter scope |

If all checks pass: promote.
If any check fails: discard sandbox, record failure.
