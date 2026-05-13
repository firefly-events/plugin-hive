# Security Review — s2-provider-wrap

**Story:** s2-provider-wrap (sandcastle-adoption-followon)
**Reviewer:** security-reviewer sidecar (OWASP Top 10)
**Date:** 2026-05-12
**Files reviewed:**
- `hive/lib/sandcastle-provider.js`
- `tests/hive-lib/sandcastle-provider.test.js`

---

## Security Review Verdict: passed

---

## Findings

### Critical

_(none)_

### Informational

- **secrets** `hive/lib/sandcastle-provider.js:80-82` — The `wrapSandcastleLogger` wrapper is installed before the `podmanFactory`/`dockerFactory` call, which is the correct defence-in-depth position. One edge case: if the `logger` option is not supplied, the module falls back to `process.stdout.write`. This is fine for the current scope (no secret values exist at factory-instantiation time without the logger being called), but callers who omit a logger should be aware that redaction still applies because the base logger itself is wrapped.
  **Suggestion:** Document in JSDoc that the default logger is also wrapped, so callers do not assume raw stdout is used.

- **input-validation** `hive/lib/sandcastle-provider.js:152-155` — `createWorktree` validates `storyId` as a non-empty string before passing it to Sandcastle. This is correct. However, there is no sanitisation of branch-name illegal characters (e.g. `..`, spaces, `~^:`). In practice, storyIds are controlled by Hive internals and not user-supplied, so injection risk is low.
  **Suggestion:** Add a lightweight check `assert /^[a-zA-Z0-9_/-]+$/.test(storyId)` if storyIds ever become user-supplied.

- **dependency** `hive/lib/sandcastle-provider.js:36-50` — The inline `satisfiesSandcastleRange` function correctly implements `>=0.5.10 <0.6.0`. This acts as a supply-chain defence: a compromised 0.6.x build cannot be silently loaded even if `npm install` resolves a newer version. The upper bound choice is sound because 0.x semver has no stability guarantee.
  **Suggestion:** No change required. The preflight is a textbook supply-chain guard. Consider adding a `SANDCASTLE_RANGE` export for downstream callers who need to display the constraint.

- **misconfiguration** `hive/lib/sandcastle-provider.js:100-105` — `userns: false` is hardcoded as the default. This disables Podman user-namespace remapping, which trades container UID isolation for parallel-run stability on macOS (the documented race condition). This is the correct default given the spike findings. Callers cannot override this without going through `options`.
  **Suggestion:** The design is intentional. If a future caller needs `userns: true`, a new option can be exposed; the current default is the safe-for-hive choice.

- **auth** `hive/lib/sandcastle-provider.js:102-107` — The `.sandcastle/codex-config` mount delivers `~/.codex/auth.json` (Codex API key) into the container. The host path is resolved from `process.cwd()` at module load time, not at provider instantiation time, which means a cwd change between module require and factory call would silently bind the wrong directory. Risk is low in practice (Hive does not chdir) but worth noting.
  **Suggestion:** Resolve `codexConfigHostPath` inside the factory call, not at module top level. Currently resolved lazily via `opts.codexConfigHostPath || DEFAULT_CODEX_CONFIG_HOST_PATH` — this is acceptable since `DEFAULT_CODEX_CONFIG_HOST_PATH` is computed once at require time. Consider making it a lazy getter `() => path.join(process.cwd(), ...)` to capture actual cwd at call time.

---

## Summary

The implementation follows all three security-relevant controls correctly:

1. **Redaction wiring** — `wrapSandcastleLogger` is installed before any code path that could emit logs. The wrapper is from the already-audited `sandcastle-log-redaction.js` (s1). No raw secret values reach stdout/stderr.

2. **Version preflight as supply-chain defence** — The inline range check (`>=0.5.10 <0.6.0`) fires before `SandboxProvider` construction. A version mismatch produces a clear error rather than a silent API behaviour change. Upper bound `<0.6.0` is correct for a 0.x package with no stability contract.

3. **Auth mount handling** — The `.sandcastle/codex-config` bind-mount delivers Codex credentials into the container at the correct path. No secrets are hardcoded. `userns: false` is the correct macOS Podman default per spike findings.

The informational findings are hardening opportunities, not vulnerabilities. Integration is not blocked.

**Verdict: passed**
