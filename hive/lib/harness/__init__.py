"""Metric capture harness — instruments Hive runs to reconstruct the journey
of building an app (brownfield start -> shipped product) as visual aids:
wall time, human gate time, token cost, agent/skill flow, and before/after
file-tree structure.

Canonical Python per the project charter (new business logic). Layers:
- snapshot: git + file-tree baseline capture at run boundaries (this module set)
- collect:  roll metrics events + run_state + episodes into report.json (M3)
- render:   dashboard artifact + standalone exports (M4)
"""
