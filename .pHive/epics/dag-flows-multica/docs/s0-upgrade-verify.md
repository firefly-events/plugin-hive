# s0 upgrade verify — Multica 0.3.4 → 0.3.26 (2026-06-21)

Local Multica upgraded via Homebrew (`multica-ai/tap`, trusted). Daemon restarted.

## Verified
- `multica --version` = 0.3.26 (commit e1c67543, built 2026-06-18); daemon pid 25985, `/health` 200.
- Agents intact: claude, codex, hermes. Workspaces: 2 (plugin-hive=PLU default, ffe-social-engine).
- **Data survived migration** — all epic issues present (PLU-381..397 among 50 PLU-3xx).

## Endpoint / contract drift (feeds s4/s5/s6)
- **NATIVE repo commands added** — `multica repo add|checkout|list|remove`. The s4 premise
  ("PUT /api/workspaces {repos} endpoint doesn't exist in v0.3.4; repo-bind deferred") is now
  OBSOLETE. s4 likely shrinks to invoking `multica repo add <url>` in multica-init; the custom
  `ensureRepos` PUT helper may be redundant or should wrap the native command. RE-SCOPE s4.
- **s5 re-check:** confirm whether a native create-issue / reconcile path now exists in 0.3.26
  before building the custom `cli.mjs create-issue` + `reconcile` helpers. `multica issue create`
  already works (used to publish this epic). Reconcile (fetch+ff-merge) still appears to be a
  git-level concern, but verify against `multica repo checkout` semantics.

## Open — fork alignment (user 2026-06-21)
Local brew runs UPSTREAM multica-ai/multica 0.3.26. The live runtime we will interact with is the
FFE fork on the Mac Studio (~/Code/spikes/multica origin = firefly-events/multica.git, plus
local-only hermes-agent commits). To develop the bridge against the EXACT code, pull the Studio
fork. Scope + source TBD with user → prep story s0b (see epic).
