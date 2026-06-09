---
name: dispatch-skill-flag-passthrough
description: When cloning a dispatch skill for a new workflow, carry skill-specific flags through to the mode atoms via the invocation contract.
applies_to: developer
---

design-review-dispatch carries `--skip` and `--artifact-target` in its invocation contract (see `skills/hive/skills/design-review-dispatch/SKILL.md` Inputs section) because design-dispatch (the clone source) is flag-agnostic. Any workflow dispatch skill that wraps a pipeline with user-facing skip/variant flags must declare those flags in the invocation contract and document pass-through semantics explicitly — otherwise the receiving mode atom (e.g. `design-review-mode-cc-workflows`) has no spec authorizing it to forward them and may silently drop them.
