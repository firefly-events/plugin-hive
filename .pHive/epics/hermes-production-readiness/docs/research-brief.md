# Research Brief — hermes-production-readiness

## Goal

Wire the **runtime plumbing** so a persistent Hermes cron actually runs the
lights-on orchestrator loop on Studio. The prior epic (`hermes-orchestrator-skills`,
shipped v2.13.1, PR #321) built the *contract*; this epic builds the *runtime that
runs it*.

## What already exists (verified in repo @ develop 5ad3bfc2)

| Surface | File | Status |
| --- | --- | --- |
| Gate contract | `hive/lib/hermes-reconciler/state.mjs` | `VALID_GATE_STATES` (pre_approved / review_awaiting_human / finalized / rejected + null), `epic_of_record`, `readHermesReconcilerState`, internal `validateReconcilerUpdates`, advisory lock. |
| Outbound human gate | `hive/lib/hermes-reconciler/slack-notify-await.mjs` | `buildVerdictMessage`, `buildErrorMessage`, `surfaceVerdictHook`, `surfaceErrorHook`, **`resolveGate(cycleStatePath,{storyId,action})`** (line 221). |
| MCP surface | `hive/lib/multica-story-dispatch/mcp-tools.mjs` | 7 tools: dispatch_story, poll_task, epic_status, write_state, post_comment, episode, cancel. |
| Dispatch CLI | `hive/lib/multica-story-dispatch/cli.mjs` | 10 subcommands incl. write-state, create-issue, reconcile. |
| Runbooks | `hive/references/orchestrator-skills/*.md` | monitor-epic, reconcile-tick, kickoff-plan, kickoff-exec, watch-cron, slack-notify-await. |
| Tests | `hive/lib/hermes-reconciler/__tests__/` | gate-state-latch.test.mjs, slack-notify-await.test.mjs. |

## The gap (what's missing)

1. **Inbound transport** — `resolveGate` exists but nothing calls it from a human's
   Slack reply. Only outbound (`surface*Hook` → webhook) exists. **No HTTP receiver
   in the repo.** This is the loop-closer.
2. **Cron tick** — no durable scheduler fires `reconcile-tick` over `epic_of_record`.
   `kickoff-exec` describes the loop; nothing runs it unattended.
3. **Slack app + secrets** — no Slack app, signing secret, bot token, or webhook
   configured.
4. **Epic-approval bootstrap** — no gated entrypoint sets an epic's initial
   `gate_state: pre_approved` + `epic_of_record`. (Hermes must never mint this itself.)
5. **Studio runtime** — multica daemon autostart/health, Hermes `~/.hermes/config.yaml`
   `mcp_servers.multica` wiring, workspace bind — not durable across restarts.

## Runtime-home finding (shapes the whole plan)

`runtime_home = Studio` (mac.lan, user `hive`). Most of this epic's surface is
**Studio / hermes-agent + ops**, NOT plugin-hive code:

- **Repo-side (plugin-hive):** extend `buildVerdictMessage/buildErrorMessage` to emit
  Block Kit blocks (text fallback kept); a thin `resolveGate`-invoker entrypoint; docs.
- **Studio-side (~/Code/hermes-agent + host):** the HTTP receiver (candidate: extend
  `mcp_serve.py` / `gateway/`, which already expose `permissions_list_open` /
  `permissions_respond` mapping conceptually onto notify-and-await), the cron, Slack
  app config, secrets storage (keychain/env), daemon autostart.

Implication: stories carry both a repo slice and a Studio slice; Studio work is
executed on-host or via SSH (`studio-multica`), reconciled against the live fork —
NOT online Multica docs.

## Validation note

No new third-party libraries required on the repo side (stdlib Node + existing
js-yaml). Slack Block Kit + request-signing is a well-known contract (HMAC-SHA256
over `v0:timestamp:body` with the signing secret); confidence high, verify exact
header names (`X-Slack-Signature`, `X-Slack-Request-Timestamp`) at implementation.
Studio-side receiver language follows hermes-agent (Python).
