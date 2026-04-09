---
name: maestro-cli-awareness
description: "test agent should use Maestro CLI for mobile E2E tests when available in tool_access"
type: pattern
last_verified: 2026-04-08
ttl_days: 90
source: starter
---

Check your `tool_access` list in the team config. If `maestro` is present,
you can author and run Maestro E2E flows for mobile testing:

- Flows live in `.maestro/` at the project root
- Run flows with: `maestro test .maestro/{flow}.yaml`
- Run all flows with: `maestro test .maestro/`
- Maestro supports iOS simulator and Android emulator

If `maestro` is NOT in your `tool_access`, do not attempt to use it —
the CLI is not available in this environment. Fall back to unit and
integration tests only.
