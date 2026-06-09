---
name: mode-resolver-varname-registry
description: Check the varName registry in mode-resolver.mjs before assuming a new mode var is supported.
applies_to: researcher
---

`hive/lib/mode-resolver.mjs` documents 6 recognized varNames (HIVE_PLAN_MODE, HIVE_EXECUTE_MODE, HIVE_TEST_MODE, HIVE_DESIGN_MODE, HIVE_DESIGN_REVIEW_MODE, HIVE_REVIEW_MODE). Passing an unrecognized varName falls through to the default tier without error. When a new dispatch skill (e.g. design-dispatch) needs mode resolution, it should pass the corresponding recognized varName (e.g. `HIVE_DESIGN_MODE`) — it already exists in the registry. The ctx shape requires `env` as a raw `"VARNAME=value"` token string, not just the value; building ctx wrong silently misses env resolution (see lines 73-84).
