# Episode: s1-auth-setup-skill

**Story:** s1-auth-setup-skill  
**Epic:** sandcastle-adoption-followon  
**Timestamp:** 2026-05-12T00:00:00Z  
**Branch:** feat/sandcastle-adoption-followon  
**Commit:** 5ee8583

## Files touched

| File | Change |
|------|--------|
| `skills/hive/skills/sandbox-setup/SKILL.md` | Created — `/hive:sandbox-setup` user-facing skill |
| `hive/references/sandcastle-setup-checklist.md` | Created — pre-flight environment checklist |

## Security sidecar

**File:** `.pHive/episodes/sandcastle-adoption-followon/s1-auth-setup-skill/security-review.md`  
**Verdict:** `passed`  
**Critical findings:** 0  
**Informational findings:** 3 (printf JSON-escaping edge case, userns caveat already covered, optional audit trail)

## Patched ACs addressed

- Malformed `auth.json` fail-loud: SKILL.md branches 3/4 emit exit-2 with rotation prompt on JSON.parse failure or missing `apiKey` field; no silent preserve, no auto-recovery.
- Shell-history-safe key delivery: documented `printf '%s' "$OPENAI_API_KEY" | podman run -i ...` and `--env-file` forms; explicit anti-pattern callout for `printenv OPENAI_API_KEY | podman run -i ...`.

## Notes

Security sidecar did not return `needs_revision`. No revision cycle was needed.
