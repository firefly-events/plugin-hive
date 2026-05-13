# Episode Record — s2-provider-wrap

**Story:** s2-provider-wrap (sandcastle-adoption-followon)
**Timestamp:** 2026-05-12
**Branch:** feat/sandcastle-adoption-followon
**Commit SHA:** 785b539

---

## Files Touched

| File | Action |
|------|--------|
| `hive/lib/sandcastle-provider.js` | Created — provider wrapper module |
| `tests/hive-lib/sandcastle-provider.test.js` | Created — 15 node:test tests |
| `.pHive/episodes/sandcastle-adoption-followon/s2-provider-wrap/security-review.md` | Created — OWASP sidecar |

---

## Test Results

- **Framework:** `node:test` (same as s1-redaction-wrapper)
- **Tests run:** 15
- **Passed:** 15
- **Failed:** 0
- **Run command:** `node tests/hive-lib/sandcastle-provider.test.js`

---

## Security Sidecar Verdict

**passed** — No critical findings. Three informational findings (default logger documentation, storyId branch-name sanitisation, cwd-at-require-time for auth mount). None block integration.

---

## package.json Decision

Root `package.json` does not exist at `/Users/don/Documents/plugin-hive/package.json`. Per hive memory `feedback_byo_enhancements_no_root_deps`, the project prefers CLIs over root dependencies. A root `package.json` was NOT created. Decision: document manual install instead.

**Manual install for sandcastle mode users:**
```
npm install @ai-hero/sandcastle@">=0.5.10 <0.6.0"
```

The runtime version preflight in `createSandcastleProvider` gates on `>=0.5.10 <0.6.0` regardless of package.json presence. Supply-chain defence is maintained.

**Semver implementation note:** `semver` npm package is not available (no root package.json). An inline `satisfiesSandcastleRange` function was implemented in the module to avoid adding a dependency. The implementation handles only the specific range `>=0.5.10 <0.6.0` and is unit-tested via preflight tests AC-1 through AC-4.

---

## branchStrategy Field Name Correction

The work-item prompt specified `branchStrategy: { type: "branch", name: storyId }`. This conflicts with the canonical sources:
- `.pHive/spikes/sandcastle/harness.ts` uses `branchStrategy: { type: "branch", branch: "..." }`
- Research findings §2.4 API surface documents `branch?: string` field

Implementation uses `branch: storyId` per canonical source. This is noted in inline comments and the commit message.

---

## AC Checklist

- [x] `@ai-hero/sandcastle >=0.5.10 <0.6.0` — documented; not in package.json (absent); preflight enforces at runtime
- [x] Preflight fails before construction for 0.5.9 (below lower) and 0.6.0 (at upper, excluded)
- [x] Default options: Podman, userns:false, `.sandcastle/codex-config` → `/home/agent/.codex`
- [x] `createWorktree(storyId)` sets `branchStrategy: { type: "branch", branch: storyId }`
- [x] `wt.close()` is on the Sandcastle-returned object; legacy `.claude/worktrees` not touched
- [x] Logger wrapped by `wrapSandcastleLogger` before provider construction
- [x] No `/execute` routing changes
