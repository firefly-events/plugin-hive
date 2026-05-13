---
name: sandbox-setup
description: Prepare Codex auth material for Sandcastle runs. Sets up the mounted auth.json that the Sandcastle codex() provider requires — run this once before any /execute session that uses Sandcastle mode.
---

# Hive Sandbox Setup

Provision the Codex auth material required for Sandcastle container runs.

**Input:** `$ARGUMENTS` (optional) — may pass `--force` to replace an existing valid auth.json (use when rotating your API key).

**When to run:** Once per machine, after cloning the repo or after rotating an OpenAI API key. This skill is a gated precondition — `/execute` does NOT invoke it on the hot path.

## Why this exists

Sandcastle's `codex()` provider mounts `~/.codex/auth.json` inside the container. Codex CLI ≥ 0.129 ignores the plain `OPENAI_API_KEY` environment variable and requires this file. Running a Sandcastle session without it produces a 401 and a silently failed agent run.

The mount path used by this project:

- **Host path:** `.sandcastle/codex-config/` (relative to repo root)
- **Container path:** `/home/agent/.codex`

## Idempotency logic

The skill is safe to re-run. The following pseudo-shell describes every branch:

```bash
#!/usr/bin/env bash
set -euo pipefail

AUTH_DIR=".sandcastle/codex-config"
AUTH_FILE="${AUTH_DIR}/auth.json"

# ── Branch 1: OPENAI_API_KEY must be present ──────────────────────────────────
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY is not set." >&2
  echo "  Set it in your shell or in .env.local before running /hive:sandbox-setup." >&2
  exit 1
fi

# ── Branch 2: auth.json absent → create ──────────────────────────────────────
if [ ! -f "$AUTH_FILE" ]; then
  mkdir -p "$AUTH_DIR"
  # Deliver key via printf (NOT printenv) to avoid shell-history exposure.
  # The auth.json format used by Codex CLI apikey mode:
  printf '{"apiKey":"%s"}\n' "$OPENAI_API_KEY" > "$AUTH_FILE"
  chmod 600 "$AUTH_FILE"
  echo "Created ${AUTH_FILE} (0600)."
  exit 0
fi

# ── Branch 3 / 4: auth.json exists → validate before preserving ──────────────
# Parse with node to check JSON validity AND required apiKey field.
VALID=$(node -e "
  const fs = require('fs');
  try {
    const obj = JSON.parse(fs.readFileSync('${AUTH_FILE}', 'utf8'));
    process.stdout.write(obj.apiKey ? 'ok' : 'missing_apikey');
  } catch (e) {
    process.stdout.write('parse_error');
  }
")

case "$VALID" in
  ok)
    echo "Existing ${AUTH_FILE} is valid (apiKey present). Nothing to do."
    echo "  Run with --force to replace it (e.g., after an API key rotation)."
    exit 0
    ;;
  missing_apikey)
    echo "ERROR: ${AUTH_FILE} is malformed — JSON parsed but apiKey field is missing." >&2
    echo "  This file will not work with Codex CLI ≥ 0.129." >&2
    echo "  Action: delete ${AUTH_FILE} and re-run /hive:sandbox-setup," >&2
    echo "  OR rotate your key upstream and re-run with --force." >&2
    exit 2
    ;;
  parse_error)
    echo "ERROR: ${AUTH_FILE} is malformed — JSON.parse failed." >&2
    echo "  The file may be truncated or corrupted." >&2
    echo "  Action: delete ${AUTH_FILE} and re-run /hive:sandbox-setup," >&2
    echo "  OR rotate your key upstream and re-run with --force." >&2
    exit 2
    ;;
esac
```

### Branch summary

| Condition | Outcome |
|-----------|---------|
| `OPENAI_API_KEY` unset | Fail before any container call. |
| `auth.json` absent | Create dir, write file, `chmod 600`. |
| `auth.json` present, valid JSON, `apiKey` present | Preserve. Exit 0. |
| `auth.json` present, parse fails OR `apiKey` missing | **Fail loud** with rotation prompt. Exit 2. Do not auto-recover. |

## Key delivery to Podman

When passing the API key to a Podman container, use the `printf` form to avoid the key appearing in shell history:

```bash
# CORRECT — printf does not add the key to shell history
printf '%s' "$OPENAI_API_KEY" | podman run -i \
  -v "$(pwd)/.sandcastle/codex-config:/home/agent/.codex:ro" \
  sandcastle:spike \
  codex ...
```

Alternatively, write the key to a `0600` env-file and use `--env-file`:

```bash
# CORRECT — env-file with restricted permissions
echo "OPENAI_API_KEY=${OPENAI_API_KEY}" > .sandcastle/run.env
chmod 600 .sandcastle/run.env
podman run --env-file .sandcastle/run.env \
  -v "$(pwd)/.sandcastle/codex-config:/home/agent/.codex:ro" \
  sandcastle:spike \
  codex ...
# Clean up immediately after use
rm .sandcastle/run.env
```

> **Anti-pattern — do not use:** `printenv OPENAI_API_KEY | podman run -i ...`
> Shell history records only the literal command (variable name, not value), but
> this form still exposes the secret through other vectors: the parent shell's
> environment is visible via `/proc/<pid>/environ` to anyone who can read it
> (ptrace, same-uid processes, debuggers), `printenv`'s own argv shows the key
> name to `ps`, and the stdin pipe makes the expanded value briefly resident in
> kernel buffers that any container-runtime hook can capture.
> Use `printf '%s' "$OPENAI_API_KEY"` (stdin-only, no child argv leak), an
> `--env-file` with `chmod 600`, or a real secret manager (1Password CLI,
> `pass`, `aws secretsmanager get-secret-value`) instead.

## Verification

After running the skill, confirm the mount works:

```bash
podman run --rm \
  -v "$(pwd)/.sandcastle/codex-config:/home/agent/.codex:ro" \
  sandcastle:spike \
  ls -la /home/agent/.codex/auth.json
```

Expected output: a single file with mode `600` (or `400` on read-only mount).

## Prerequisites

See `hive/references/sandcastle-setup-checklist.md` for the full environment checklist, including Podman version, image build steps, and the `userns: false` production caveat.

## Gitignore

`.sandcastle/` should be gitignored so auth material is never committed. Confirm `.gitignore` contains:

```
.sandcastle/
```

## Instructions

Read `hive/references/sandcastle-setup-checklist.md` for the complete environment prerequisites. Run the idempotency script above (or the equivalent interactive flow), then verify the mount path before proceeding to `/hive:execute`.
