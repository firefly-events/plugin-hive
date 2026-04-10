---
name: detect-framework-from-config
description: "detect the test framework from config files before reading any test files; config files are authoritative and prevent false assumptions"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

Always determine the test framework from project config before reading test files. Test
files often contain patterns that work with multiple frameworks, making framework detection
from test code unreliable. Config files are unambiguous.

Detection priority order:

1. `package.json` → check `jest`, `vitest`, `mocha` keys in `devDependencies` or `scripts`
2. `jest.config.*`, `vitest.config.*`, `mocha.*` → framework-specific config files
3. `pyproject.toml` → check `[tool.pytest]` or `[tool.unittest]`
4. `cargo.toml` → built-in Rust test runner
5. `go.mod` → built-in Go test runner (`go test`)
6. `.maestro/` directory → Maestro CLI for mobile UI tests (check this for React Native / Flutter projects)

Once framework is identified:
- Record it in your scout report: `test_framework: {name} {version}`
- Note the test runner command: `test_command: {npm test | pytest | go test ./... | etc.}`
- Note the config file path: `config_file: {path}`

Do not proceed to reading test files until the framework is recorded. If no framework is
detectable, flag `test_framework: unknown` and note which config files were checked.
