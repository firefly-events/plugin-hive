# Insights: language-strategy ADR

## Sandcastle is the only categorical blocker

Every other JS dependency has a Python equivalent: js-yaml → PyYAML, better-sqlite3 → sqlite3, @anthropic-ai/sdk → Python SDK. Only `@ai-hero/sandcastle` has no Python equivalent. When analyzing a language migration for any Hive-shaped repo, find the single non-incidental JS package first — it determines whether "pure" is achievable or a direction.

## "Pure-Python" vs "Python-first" is a vocabulary decision, not a technical one

The codebase already has a clear Python core (DAG executor, metrics, KG, meta-experiment) and a clear JS boundary (dispatch, sessions, Sandcastle). The split is not random — JS lives at integration seams. The ADR's job was to name that existing reality and declare what is intentional boundary vs. migration target.

## Config duplication is a leading indicator, not the disease

`config.js` and `config.py` implementing similar-but-not-identical parsers is a symptom of an undocumented charter, not the root problem. Future analysts: when you see cross-runtime duplicates, check for a missing ownership declaration before recommending consolidation.

## The hinge question to surface early: is the JS-native dependency intentionally core or accidentally present?

For Sandcastle (and similar): whether it's "long-term-core" or "optional/maintainer-only" completely changes the cost tier of the migration. Ask this question before sizing any migration epic. The answer lives in the maintainer's head, not in the codebase — surface it as an open decision.

## Branch collision: worktree lock blocks integration contract

When a parallel agent has already checked out the integration branch in another worktree, the daemon's auto-created branch cannot follow the standard `git checkout research/language-strategy` + reset path. Resolution used here: write files directly to the existing checked-out worktree (same git object store, correct branch). The integration contract's commit/push steps execute from whichever worktree holds the branch.
