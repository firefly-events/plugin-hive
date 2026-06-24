# Slack App Runbook (hpr-3)

Reproducible setup for the Hive lights-on loop's Slack human-gate. Provisions the
four `HERMES_SLACK_*` values consumed per [`env-contract.md`](./env-contract.md).
**No secret values live in this file or any committed file.**

## 1. Create the Slack app

1. https://api.slack.com/apps → **Create New App** → **From scratch** → name it
   (e.g. `Hive Orchestrator`) → pick the workspace.
2. **OAuth & Permissions → Scopes → Bot Token Scopes** → add **`chat:write`**.
3. **Install to Workspace** → **Allow**.

## 2. Capture the four values

| Value | Where in the Slack app UI | Env var |
|-------|---------------------------|---------|
| Bot User OAuth Token (`xoxb-…`) | OAuth & Permissions → after install | `HERMES_SLACK_BOT_TOKEN` |
| Signing Secret | Basic Information → App Credentials → Show | `HERMES_SLACK_SIGNING_SECRET` |
| Incoming Webhook URL | Incoming Webhooks → Activate → Add New Webhook → pick channel | `HERMES_SLACK_WEBHOOK_URL` |
| Channel ID (`C…`) | the target channel → About | `HERMES_SLACK_CHANNEL_ID` |

**Interactivity** stays OFF until the Studio inbound receiver exists (deferred hpr-1
Studio slice) — it needs a public Request URL pointing at that endpoint.

## 3. Store on Studio (root-only, never committed)

```bash
# ~/.config/hermes/secrets.env  — chmod 600, owner running the Hermes runtime
umask 077
mkdir -p ~/.config/hermes
cat > ~/.config/hermes/secrets.env <<'EOF'
export HERMES_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
export HERMES_SLACK_SIGNING_SECRET="..."
export HERMES_SLACK_BOT_TOKEN="xoxb-..."
export HERMES_SLACK_CHANNEL_ID="C..."
EOF
chmod 600 ~/.config/hermes/secrets.env
```

## 4. Verify outbound

```bash
# Sandbox / any host with the webhook URL — confirms the channel + webhook work.
# (curl shown for reference; in context-mode use a sandboxed fetch.)
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"text":"Hive Orchestrator connected — Slack outbound live (hpr-3)."}' \
  "$HERMES_SLACK_WEBHOOK_URL"
# Expect: HTTP 200, body "ok"
```

## 5. Activate (make the live Hermes process read the secrets)

The launchd plists are world-readable, so secrets must be **sourced** from the
`600` file, not pasted into the plist. Point the Hermes gateway at a wrapper that
sources `secrets.env` before exec, then reload:

```bash
# Wrapper: ~/.config/hermes/run-gateway.sh  (chmod 700)
#   #!/bin/zsh
#   source ~/.config/hermes/secrets.env
#   exec /Users/hive/Code/hermes-agent/.venv/bin/python -m hermes_cli.main "$@"
# Set the gateway plist ProgramArguments to the wrapper, then:
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
```

The reconciler/`slack-notify-await.mjs` node processes spawned under the gateway then
inherit `HERMES_SLACK_*`. **This step restarts the Hermes runtime** — schedule it.

## 6. Rotation

Regenerate the credential in the Slack app settings → update
`~/.config/hermes/secrets.env` → re-run step 5 (gateway reload). No code change.
