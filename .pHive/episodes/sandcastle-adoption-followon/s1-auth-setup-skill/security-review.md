# Security Review — s1-auth-setup-skill

**Reviewer persona:** security-reviewer  
**Framework:** OWASP Top 10  
**Files reviewed:**
- `skills/hive/skills/sandbox-setup/SKILL.md`
- `hive/references/sandcastle-setup-checklist.md`

**Scope focus (per story cross_cutting):**
- Auth material handling (auth.json lifecycle, key delivery to Podman)
- Shell-history exposure (printenv anti-pattern)
- File permissions (0600 on auth.json)

---

## Security Review Verdict: passed

---

## Findings

### Critical

_None._

### Informational

- **[secrets]** `skills/hive/skills/sandbox-setup/SKILL.md:45-46` — The write step uses `printf '{"apiKey":"%s"}\n' "$OPENAI_API_KEY" > "$AUTH_FILE"`. If `OPENAI_API_KEY` contains JSON-special characters (double-quote, backslash), the resulting `auth.json` would be syntactically valid shell output but would produce malformed JSON that trips the validity check on the next run. This is an edge case (OpenAI keys today use `sk-proj-[A-Za-z0-9]` format), but a defense-in-depth hardening.
  **Suggestion:** Use `node -e "fs.writeFileSync(..., JSON.stringify({apiKey: process.env.OPENAI_API_KEY}))"` or `jq -n --arg k "$OPENAI_API_KEY" '{"apiKey":$k}'` to produce the JSON rather than printf string interpolation. This eliminates any escaping risk.

- **[misconfiguration]** `hive/references/sandcastle-setup-checklist.md:section-8` — The `userns: false` caveat is correctly documented as a macOS-only workaround with an explicit warning against production Linux use. The moderate finding is well-surfaced. No change required; noting this is already addressed.
  **Suggestion:** None — covered by the checklist.

- **[logging]** `skills/hive/skills/sandbox-setup/SKILL.md:30-47` — The auth-write branch does not log which PID or invocation wrote the file. If the file is later found malformed, there is no trail. This is a documentation-level concern (not an execution concern) since SKILL.md describes a user-run script, not a daemon.
  **Suggestion:** Informational only; could suggest `echo "Created by $(whoami) at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .sandcastle/codex-config/.setup-log` but this is optional hardening, not a security requirement.

---

## Summary

The two deliverable files correctly:
- Fail loud on missing `OPENAI_API_KEY` before any container execution
- Validate `JSON.parse` success AND presence of `apiKey` before treating an existing file as valid
- Emit explicit rotation prompts (exit 2 with actionable message) on malformed auth.json — no silent preservation, no auto-recovery
- Document `printf '%s' "$OPENAI_API_KEY"` (not `printenv`) as the canonical key-delivery form to Podman
- Provide `--env-file` as a safe second option with a note to `chmod 600` and clean up
- Name `printenv OPENAI_API_KEY | podman run -i ...` explicitly as an anti-pattern in the "do not use" callout
- Document 0600 permissions on auth.json in both the skill and the checklist
- Flag `userns: false` as macOS-only with explicit production Linux caveat

The one hardening gap (printf JSON-escaping) is a theoretical edge case given current OpenAI key formats. It does not constitute a critical vulnerability and does not block integration. Verdict: **passed**.
