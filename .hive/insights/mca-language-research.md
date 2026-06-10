# mca-language-research insights

- The apparent JS/Python split is not explained by "Python cannot host runtime logic"; the Python DAG executor is already the deeper orchestration substrate. The JS concentration is at product/tool integration edges: Multica dispatch, Anthropic session clients, Sandcastle, task adapters, and Claude Code hooks.
- There is no root package manifest or lockfile on this branch, so npm dependency claims must be derived from source imports and nested adapter package.json files. This is a dependency-governance gap, not just an inventory inconvenience.
- Sandcastle is the only audited dependency that looks like a categorical obstacle to literal pure-Python feature parity. better-sqlite3, js-yaml, zod, and @anthropic-ai/sdk all have plausible Python replacement paths, but Sandcastle's current API boundary is JS-native.
- Root CLAUDE.md should not be treated as any kind of project charter. It is exclusively context-mode routing and command hygiene. The closest charter-like file is .pHive/CONTEXT.md, but it is a glossary/conventions file and does not lock implementation language or dependency policy.
