# Marketplace Schema Audit

- Canonical source: <https://code.claude.com/docs/en/plugin-marketplaces>
- Last checked: 2026-05-09
- Scope: Anthropic Claude Code plugin marketplace schema for `.claude-plugin/marketplace.json`

## Required fields

- Top level: `name` (`string`), `owner` (`object`), `plugins` (`array`)
- `owner`: `name` (`string`); `email` (`string`) is optional
- `plugins[]`: `name` (`string`), `source` (`string | object`)

## Optional fields

- Top level: `$schema` (`string`), `description` (`string`), `version` (`string`), `allowCrossMarketplaceDependenciesOn` (`string[]`)
- Backward-compatible under `metadata`: `pluginRoot` (`string`), `description` (`string`), `version` (`string`)
- `plugins[]` metadata: `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, `strict`
- `plugins[]` component fields: `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`
- `plugins[].source` forms:
  - Relative path string beginning with `./`
  - `github`: `repo` required, `ref` optional, `sha` optional
  - `url`: `url` required, `ref` optional, `sha` optional
  - `git-subdir`: `url` and `path` required, `ref` optional, `sha` optional
  - `npm`: `package` required, `version` optional, `registry` optional

## Distribution Security Fields

- `plugins[].source.sha`: optional, accept. Exact commit pin for `github` / `url` / `git-subdir` sources is the strongest published upstream pin and should be used when Hive distributes from remote git sources.
- `plugins[].source.ref`: optional, accept. Branch or tag selection is weaker than `sha` but is still a published release-channel control and belongs in the audit trail.
- `plugins[].source.version` (`npm` only): optional, defer. It is a distribution pin for npm packages, but Hive currently ships from a local relative path and does not use npm distribution.
- `plugins[].version`: optional, accept. Anthropic documents it as a loose plugin version pin; Hive already uses it, but it is weaker than an exact commit pin.
- Signing field: absent, defer. The canonical marketplace schema does not publish a signature field, so this remains an upstream-schema gap to track.
- Attestation field: absent, defer. No attestation field is documented for marketplace entries or plugin sources.
- Integrity-hash field: absent, defer. The schema exposes `sha` for commit pinning, but no artifact digest or checksum field is documented.
- Code-signing-key URL field: absent, defer. No published field exists for key discovery or trust-chain metadata.

## Hive-specific gaps

- Initial audit gap: top-level `categories` and `tags` in Hive's manifest were not present in the published marketplace schema; the fix is to keep categorization on `plugins[]`, where Anthropic documents `category` and `tags`.
- Initial audit gap: Hive stored the marketplace description only at `metadata.description`; the canonical schema prefers top-level `description`, while still accepting the nested form for backward compatibility.
- Follow-on backlog implied by deferred fields: if Anthropic later publishes signing, attestation, integrity-digest, or key-URL fields, Hive should adopt them in a separate distribution-security slice rather than silently ignoring them.
