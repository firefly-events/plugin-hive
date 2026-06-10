---
name: dag-edge-keyed-by-step-id-not-step-file
description: When a story spec names step_file paths in a depends_on AC, reconcile to the workflow's step id keys before flagging spec violation
applies_to: reviewer
---

`hive/workflows/test-swarm.workflow.yaml` keys edges by step `id`
(e.g. `validate-coverage`, `execute-platform-a`), not by `step_file`
(`step-04-inspector.md`, `step-03-worker.md`). t-1a's AC-2 named the
step_files; the implementation correctly used the bound step ids.
Verify the id↔step_file mapping in the workflow YAML before treating
a naming mismatch as a spec violation — it is usually reconciliation,
not regression.
