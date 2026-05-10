# Sessions-Cloud Fixture

This directory is reserved for the one-time maintainer-recorded Sessions-API fixture used by the `s9-a5-cloud-mode-dead-code-gating` test suites.

Deferred state: until the maintainer records and commits the fixture bytes, these suites skip with `pre-condition: maintainer-fixture-absent`:

- `tests/hive-lib/sessions-cloud.fixture-rot.smoke.test.js`
- `tests/hive-lib/sdk-version-fixture-pin.test.js`
- `tests/hive-lib/sessions-cloud.fixture-redaction.test.js`

## Record-Once Procedure

1. Use a sandbox Anthropic project and a live `sessions-cloud` run on the target branch.
2. Capture the full create/send/stream exchange needed to exercise the Sessions-API branch end to end.
3. Write the committed fixture bytes into `session-recording.ndjson`.
4. Make line 1 a metadata header JSON object with at least:

```json
{"type":"fixture_metadata","sdk_version":"x.y.z","recorded_at":"2026-05-09T00:00:00Z","notes":"maintainer-recorded sessions-cloud fixture"}
```

5. Append one JSON object per line for the recorded create/send/stream transcript. Required record types:
- `create.request`
- `create.response`
- `send.request`
- `stream.event`
6. Confirm `sdk_version` matches the repo `package-lock.json` entry for `@anthropic-ai/sdk`.
7. Run the three fixture-dependent suites locally before commit.

## Mandatory Pre-Commit Redaction Checklist

- Remove any `Authorization` header values.
- Remove any `x-api-key` values.
- Remove any `x-request-id` values.
- Remove any `Bearer ...` token material.
- Remove any `sk-...` token material.
- Remove any `agent_...` identifiers.
- Remove any `env_...` identifiers.
- Remove any `environment_id` values.
- Remove any account-scoped identifiers, including `account_id`.
- Remove any `response.id` values that remain account-correlatable.
- Remove any free-text response bodies that may contain user or model content.

## Protected Token-Shape Catalog

- `Bearer <token>`
- `sk-...`
- `agent_...`
- `env_...`
- `Authorization`
- `x-api-key`
- `x-request-id`
- `environment_id`
- `account_id`
- `response.id`
- Free-text response bodies
