# Insights — al-4-backfill-terminal-signal

## Two-signal architecture keeps the shipped path strictly separate

The primary `/ship`-written signal (`status: shipped` + `release_id`) is checked first and **short-circuits** before any git subprocess is spawned. This matters because the legacy merged+age check does I/O (git subprocess); keeping the shipped check pure-dict means the common, non-legacy case is zero-latency and fully testable without mocking.

## Feature branch must be explicit in the YAML; inference is unreliable

The legacy signal needs a feature branch to query. The epic.yaml `git_flow.base_branch` is the *base*, not the feature branch. Deriving the feature branch from epic naming convention (e.g., `feat/{epic-id}`) would be implicit and fragile. Convention adopted: artifacts carry an explicit `branch` field; absence means the legacy signal cannot fire (conservative default).

## `git branch -r --merged` is the right query for deleted remote branches

`git branch --merged` only checks local branches — misses branches merged and then deleted remotely (which is the common post-PR state). Using `-r --merged origin/{default}` queries remote-tracking refs, which remain even after the remote branch is deleted, until the next `git remote prune`.

## plan_terminal_report_candidates vs plan_candidates are intentionally separate

`plan_candidates()` is EVICT-only (untracked, D1). A separate function avoids the complexity of a combined scan with two different age-source strategies (mtime vs git-last-commit per D5). The split makes D1/D2 action enforcement explicit in the function signature rather than conditional branches inside one function.

## git-last-commit age falls back to mtime; never raises

The `_git_commit_age_days()` helper falls back to mtime silently. This means a path that git doesn't know about (untracked file matched by a tracked-class glob) degrades gracefully rather than crashing the sweep.
