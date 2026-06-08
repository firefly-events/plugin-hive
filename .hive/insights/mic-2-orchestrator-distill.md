---
name: orchestrator-distill-helper-is-plumbing
description: "Multica insight distillation helpers should collect and write inputs, while the orchestrator supplies the actual judgment and memory content."
type: codebase
agent: developer
last_verified: 2026-06-07
ttl_days: 60
source: agent
---

For `hive/lib/multica-story-dispatch`, keep the Multica insight distill layer as
plumbing rather than a hidden reasoning engine. The helper can read the agent
self-capture file, transcript sidecar, and git diff, then write team memory or
promote Hive memory. The actual distilled content should be supplied by the
orchestrator caller, because the story contract explicitly requires inline
orchestrator judgment with full cross-story context and forbids dispatching a
sub-agent or reduced-capability model for this step.
