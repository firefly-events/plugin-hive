---
name: vitest-root-outside-hive-lib
description: When adding a test file outside hive/lib/, change --root from .. to ../.. and update all paths accordingly.
applies_to: tester
---

The hive/lib/package.json test script uses `--root ..` (rooted at hive/), so test paths are relative to hive/ — not hive/lib/. Any test file outside the hive/ tree (e.g. skills/hive/skills/*/test/) is unreachable with `--root ..`. Fix: widen root to `../..` (repo root) and rewrite all existing paths as `hive/lib/test/...` / `hive/scripts/test/...`. Verify the full suite still passes before declaring done — the root change silently shifts path resolution for every listed file.
