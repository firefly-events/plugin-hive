---
name: artifact-lifecycle-needs-status-adapter-layer
description: "Artifact archival cannot share one terminal-state check; each artifact class has a different owner and terminal vocabulary."
type: codebase
agent: researcher
last_verified: 2026-06-08
ttl_days: 60
source: agent
---

Hive lifecycle planning needs a per-artifact adapter layer rather than a single "is terminal" predicate. Story YAML has advisory `status:` except `/ship`'s shipped projection; episodes are marker-derived; DAG run-state freezes completed/failed/suspended with failed still resumable; triage keeps closed and active entries in one queue file; metrics have future observation windows. A generic age sweep should ask each artifact class for `active`, `terminal`, `eligible_after`, and `hard_exclude` instead of parsing filenames or raw status strings globally.
