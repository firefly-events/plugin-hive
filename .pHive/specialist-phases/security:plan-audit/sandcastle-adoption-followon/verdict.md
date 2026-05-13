## Security Audit: Epic D sandcastle-adoption-followon plan-level review

---

## Findings

- `s1-redaction-wrapper.yaml:62` — Regex (see fenced block below) does not match `Authorization: Bearer <token>` header form, JSON `"key": "<value>"` form, or multiline base64-encoded secrets. A Sandcastle `WorktreeError` or debug dump could emit these alternate forms in the same log file the regex is meant to protect. The regex catches the known `-e VAR=VALUE` argv form but does not constitute exhaustive secret redaction. [severity: major]

  ```
  \b([A-Z0-9_]*(?:API_KEY|TOKEN|_KEY))=([^\s"'`]+)
  ```

- `harness.ts:23-24` — The spike logs `OPENAI_API_KEY prefix` characters to stdout before the redaction wrapper is installed (line 23: `console.log(...OPENAI_API_KEY.slice(0,7)...)`). The harness installs stdout/stderr intercepts on lines 35-40 **after** this console.log. If the production wrapper follows the same ordering pattern, early provider log lines (e.g., the Sandcastle import on line 42) escape redaction. The s1-redaction-wrapper AC requires wrapper-before-provider-construction but the spike shows a timing gap that must be explicitly closed in the implementation spec. [severity: major]

- `s1-auth-setup-skill.yaml:18-21` — The idempotency AC specifies "preserves the existing usable auth.json without duplicating state" but does not specify behavior for a **malformed** or **expired** `auth.json`. A silently-accepted corrupted file passes the idempotency check while producing a 401 at runtime. The spec should require a validity check (e.g., JSON parse + required field presence) and fail-loud with a rotation message rather than silent acceptance. [severity: major]

- `s2-provider-wrap.yaml:56-57` — The `package.json` entry for `@ai-hero/sandcastle` uses `>=0.5.10` (open upper bound) on a 0.x package. Any 0.x minor bump can introduce breaking changes to spawn semantics, mount behavior, or logger format without a major-version signal. A compromised or accidental 0.x release could alter log redaction paths or auth mount locations before the runtime preflight fires. The preflight (`fail before provider construction`) partially mitigates this, but the version constraint should be `>=0.5.10 <0.6.0` (or equivalent semver range) to constrain the attack surface. [severity: major]

- `s1-gitignore-template.yaml:18` — The `.gitignore` already has a broad `.pHive/*` ignore at line 1 with many `!.pHive/...` negation rules. The proposed `.sandcastle/` rule is a **top-level** ignore; however, an entry like `.sandcastle/` placed below `*.log` (line 68 of current `.gitignore`) is evaluated in order. If future rules add `!.sandcastle/something`, they will work correctly because the top-level rule is not `/**` anchored. The story's AC already requires verifying that `.pHive` negations are unaffected. Inspection of the current `.gitignore` confirms `.pHive` negations are structurally separate, so this is **not** a collision today. Minor: document in S5 adoption guide that `.sandcastle/` is a global (non-anchored) rule and could hide any directory by that name in a subdirectory of the repo. [severity: minor]

- `s2-provider-wrap.yaml:64` — `userns: false` disables user namespace separation in rootless Podman. Inside the container, processes run as root in their namespace with no UID remapping. On a Linux host this grants the container process the same effective UID as the Podman daemon owner, which may allow the container to read any file owned by that user on bind-mounted paths (including `.sandcastle/codex-config/auth.json`). On macOS (the dominant dev platform) the Podman VM boundary provides additional separation, reducing practical risk. The mitigation for the macOS parallelism race (`userns: false`) is appropriate for the development target but should be explicitly contraindicated for production Linux deployment in the adoption guide. [severity: moderate]

- `s1-auth-setup-skill.yaml:code_examples` — The spike-proven one-time setup pipes `OPENAI_API_KEY` through stdin to a `podman run` invocation (`printenv OPENAI_API_KEY | podman run -i ...`). The `printenv` form exposes the key in the process argv and shell history. The setup skill should use `--env-file` or a stdin pipe sourced from `printf '%s'` rather than `printenv` to avoid shell history exposure. [severity: moderate]

- `s1-redaction-wrapper.yaml:61-65` — The regex uses the `\b` word boundary before the variable name. In the form `CONTENT_TYPE=...` or `X-API-KEY=...` (hyphenated header names that Sandcastle may log), `\b` does not match at hyphens. Hyphenated header names are not captured by the current pattern. [severity: moderate]

- `s2-provider-wrap.yaml` — No spec exists for what happens when the redaction wrapper itself throws (e.g., a malformed chunk passed to `String(line).replace()`). An uncaught exception in the logger wrapper should not propagate into provider construction; the wrapper needs a try/catch fallback that emits a redacted placeholder rather than the raw chunk. Absence of error-path spec is a plan-level gap. [severity: moderate]

- `s1-auth-setup-skill.yaml` — No story covers rotation or revocation of a compromised `auth.json`. If a key mounted under `.sandcastle/codex-config/` is rotated, the setup skill has no defined re-run behavior beyond the general idempotency AC. This is a defense-in-depth gap without a dedicated rotation path. [severity: minor]

- `s1-gitignore-template.yaml` — `*.log` is already in the root `.gitignore` (line 68). The `.sandcastle/logs/` subdirectory would be caught by `*.log` for individual `.log` files, but the directory itself would not be ignored, and non-`.log` artifacts (e.g., `run.log` without extension, temporary files) could be committed. The explicit `.sandcastle/` directory ignore is correct and necessary; this is informational confirmation that `*.log` alone is insufficient. [severity: minor]

---

## Recommended Changes

- **[Addresses major finding 1]** Expand the redaction regex in `hive/lib/sandcastle-log-redaction.js` to additionally match `Authorization: Bearer <value>` (case-insensitive header form) and `"<KEY_NAME>": "<value>"` JSON form. Add fixture tests for both patterns. Acknowledge that base64-encoded secrets and `printenv` dump output are out of scope for V1 but note the gap in the adoption guide.

- **[Addresses major finding 2]** The implementation spec for `s1-redaction-wrapper` must explicitly require that `wrapSandcastleLogger` is called **before** any `import` or `require` of `@ai-hero/sandcastle` modules that could emit log output. Add an AC: "Given the redaction wrapper is installed before the first sandcastle import, when sandcastle emits its startup log, then no unredacted key value appears in stdout or stderr."

- **[Addresses major finding 3]** Add an AC to `s1-auth-setup-skill`: "Given an existing `auth.json` that fails JSON.parse or is missing a required `apiKey` field, when `/hive:sandbox-setup` runs, then it fails loud with a message indicating malformed auth and prompts rotation." The setup skill must validate the file structure, not just test for existence.

- **[Addresses major finding 4]** Change the version constraint from `>=0.5.10` to `>=0.5.10 <0.6.0` (or a tighter patch pin such as `~0.5.10`). Document the rationale in `hive/references/sandcastle-setup-checklist.md`: 0.x upper-bound required because minor bumps are breaking.

- **[Addresses moderate finding — userns]** Add an explicit note in `hive/references/sandcastle-setup-checklist.md` and the S5 adoption guide: "`userns: false` is required for macOS parallel Podman runs but should NOT be used in production Linux deployments where UID isolation is required."

- **[Addresses moderate finding — printenv]** Replace the `printenv OPENAI_API_KEY | podman run -i` pattern in setup skill docs with a form that avoids shell history exposure: use `printf '%s' "$OPENAI_API_KEY" | podman run -i ...` or a dedicated `--env-file` approach that reads from a 0600 file.

- **[Addresses moderate finding — wrapper error path]** Add an AC to `s1-redaction-wrapper`: "Given the wrapper's redact function throws on a non-string chunk, when an exception is caught, then a safe placeholder string is emitted and execution continues without propagating the exception into provider construction."

---

## Threat Model Notes

- **Trust boundary shift:** Moving from env var (`OPENAI_API_KEY`) to a bind-mounted `auth.json` file shifts the trust boundary from process-level env (ephemeral, not persisted to disk) to a file on the host filesystem. The file persists across runs and is accessible to any process running as the same UID. The `.gitignore` addition closes the accidental-commit vector but does not address host filesystem access.

- **Attacker capability (insider/supply chain):** The `@ai-hero/sandcastle` 0.x dependency is a third-party package with no upper-version bound. A malicious or accidental 0.x release that alters logger format could bypass the regex-based redaction without changing the major/minor version the preflight checks against. Tightening the semver range reduces this surface.

- **Log data flow:** `.sandcastle/logs/<name>.log` is written by Sandcastle's file logger before the in-Hive redaction wrapper can intercept it. The wrapper intercepts stdout/stderr of the Hive process but does NOT modify what Sandcastle writes directly to the log file path. If `sandcastle-log-redaction.js` only wraps the logger *callback*, and Sandcastle writes the log file internally, the file on disk may still contain raw key values. The story spec should clarify whether the wrapper intercepts the file write path or only the callback stream.

- **Container escape surface:** `userns: false` with bind-mounted `auth.json` means a container escape would give the attacker read access to credentials on the host. This is an accepted risk for dev environments; the adoption guide must document it explicitly.

- **Timing gap:** Any Sandcastle import that triggers module-level initialization (e.g., version check, telemetry ping) before the logger wrapper is installed creates a narrow unredacted window. This is a concrete concern given the spike's ordering pattern.

---

## Summary

The S1+S2 design correctly identifies the key-leak surface and proposes the right structural mitigations (in-process redaction wrapper, `.gitignore` coverage, auth-mount isolation, version preflight). However, four major findings block the current design from shipping as specified: (1) the redaction regex covers only the known `-e VAR=VALUE` argv form and misses `Authorization: Bearer` and JSON key forms that Sandcastle error serialization can emit; (2) the wrapper installation timing is unspecified and the spike demonstrates a pre-import log line that would escape redaction; (3) the auth setup idempotency AC does not mandate validity checking of a malformed `auth.json`, creating a silent-failure path; and (4) the open-ended `>=0.5.10` version constraint on a 0.x supply-chain dependency leaves redaction and mount semantics vulnerable to unexpected upstream changes without semver signal. These findings are remediable at the design spec level without requiring redesign of the overall architecture. The gitignore mechanics, worktree ownership split, and fail-fast preflight pattern are sound. With the four major findings addressed in the S1 story specs before implementation begins, the security posture is appropriate for a sandboxed development substrate.

---

## Verdict
needs_revision
