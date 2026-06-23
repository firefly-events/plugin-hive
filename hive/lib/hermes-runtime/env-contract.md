# Hermes Runtime — Environment Variable Contract

Variables consumed by the Hermes lights-on runtime on Studio.
**No secret values live in this file.** Store values in the Studio keychain
or a root-only env file (e.g. `/etc/profile.d/hermes-secrets.sh` or
`~/.config/hermes/secrets.env`). Source that file in the shell that starts
the Hermes runtime.

---

## Slack (hpr-3 provisions these)

| Variable | Required by | Description |
|----------|-------------|-------------|
| `HERMES_SLACK_WEBHOOK_URL` | `slack-notify-await.mjs` (existing) | Incoming webhook URL for outbound verdict/error posts. |
| `HERMES_SLACK_SIGNING_SECRET` | hpr-1 inbound receiver | Slack app signing secret (HMAC-SHA256 request verification). |
| `HERMES_SLACK_BOT_TOKEN` | hpr-1 confirmation posts, hpr-4 bootstrap notice | Bot OAuth token (`xoxb-`). Required scopes: `chat:write`. |
| `HERMES_SLACK_CHANNEL_ID` | hpr-4 bootstrap notice (optional) | Channel ID for the "epic X is now lights-on" notice. |

Rotation: re-generate in the Slack app settings → update Studio keychain/env → no code change required.

---

## Multica (daemon + MCP surface)

| Variable | Required by | Description |
|----------|-------------|-------------|
| `MULTICA_API_URL` | `multica` CLI, `mcp-tools.mjs` | Override if the daemon listens on a non-default port. Default: `http://127.0.0.1:7842`. |

---

## Usage

```bash
# Example secrets.env (root-only, NOT committed)
export HERMES_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
export HERMES_SLACK_SIGNING_SECRET="..."
export HERMES_SLACK_BOT_TOKEN="xoxb-..."
export HERMES_SLACK_CHANNEL_ID="C..."
```

Source in the shell that runs Hermes (e.g. add to `~/.zshrc` or the launchd
`EnvironmentVariables` dict for the Hermes process, **never** committed to the repo).
