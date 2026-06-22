# Insights: a1-audit-plugin-install-payload

## The `.gitignore` negation pattern is a time bomb

Each new epic adds two lines to `.gitignore` (allowlist the dir, allowlist `**`). The payload grows silently — no PR reviewer sees it balloon because the YAML files themselves are small. The real problem is that 44 epics × avg ~125 files = 644 files, and this will be 1,000+ files in 6 months at current epic velocity. The audit exists because git's "what ships" question has no obvious answer in a repo with 40+ negation rules.

## Quantifying "what ships" requires `git ls-files`, not `.gitignore` inspection

Reading `.gitignore` tells you the policy intent, not the actual tracked set. `git ls-files` is the authoritative source. The two diverge whenever a `!` negation rule re-tracks something under a blanket-ignored parent. Always audit via `git ls-files | wc -l` and `stat` for byte counts.

## Claude Code plugins have no files manifest

There is no equivalent to npm's `files` field in `.claude-plugin/plugin.json`. Installation is a full git clone. Any remediation that doesn't reduce the tracked file set (e.g., a dist build) requires upstream platform support or a custom release workflow. Option A (untrack) is the only immediately available lever.

## `tests/` shipping is a 1.1 MB surprise

The test suite ships to every consumer. Tests are not useful to consumers and won't run without dev dependencies. This is a secondary priority after `.pHive/epics/` + `.pHive/episodes/` (7.3 MB combined) but worth addressing in the same follow-on story.

## `.hive/insights/` grows unboundedly

57 files / 94 KB today. Every story adds one insight file. These are dev notes for the maintainer's agent, not consumer documentation. They should be untracked along with the epic/episode trees.
