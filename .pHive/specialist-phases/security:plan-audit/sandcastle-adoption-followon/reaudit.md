## Security Re-audit (narrow): 4 major findings from prior verdict

## Finding-by-finding

- **F1: closed** — Two AC bullets explicitly address both required forms. In `s1-redaction-wrapper.yaml` acceptance_criteria: (1) "Given log output containing 'Authorization: Bearer sk-test' (case-insensitive header form), when passed through the wrapper, then the bearer value is masked to [REDACTED] while preserving the header name." (2) "Given log output containing JSON form \"api_key\": \"sk-test\" or \"openai_api_key\": \"sk-test\", when passed through the wrapper, then the value is masked to [REDACTED] while preserving the key name." Both forms from the original finding — `Authorization: Bearer <value>` (case-insensitive) and `"key": "value"` JSON form — are now explicitly required by the spec. Fixture tests for both patterns are also implied by the AC structure (each is a Given/When/Then testable assertion against a concrete input string).

- **F2: closed** — AC bullet in `s1-redaction-wrapper.yaml` reads: "Given the redaction wrapper is installed before the first sandcastle import, when sandcastle emits its startup log, then no unredacted key value appears in stdout or stderr." This is the verbatim recommended change. On testability: the AC is end-to-end observable (intercept stdout/stderr before any `import`/`require`, verify no raw key value in the captured output) and would catch a real ordering bug — a test that installs the wrapper *after* the import would fail this assertion. The AC is specific enough to be falsifiable by a test that instruments module load order. No additional architectural guard (lint rule or module-load-order comment) is required to block approval; the AC is sufficient at the spec level.

- **F3: closed** — AC bullet in `s1-auth-setup-skill.yaml` acceptance_criteria reads: "Given an existing auth.json that fails JSON.parse or is missing a required apiKey field, when /hive:sandbox-setup runs, then it fails loud with a message indicating malformed auth and prompts rotation rather than silently preserving the file." Both disqualifying conditions from the finding (JSON.parse failure AND missing `apiKey` field) are enumerated. The fail-loud + rotation-prompt requirement is explicit. Silent-acceptance path is closed at spec level.

- **F4: closed** — Both surfaces are patched. (1) AC in `s2-provider-wrap.yaml`: "Given package metadata is updated, when dependencies are inspected, then @ai-hero/sandcastle is pinned with a constrained range `>=0.5.10 <0.6.0` (0.x upper-bound required because minor bumps are breaking)." (2) `files_to_modify` entry: "Add `@ai-hero/sandcastle` with a constrained semver range `>=0.5.10 <0.6.0` (per security:plan-audit major finding — 0.x bumps are breaking; tighter `~0.5.10` is also acceptable)." The rationale citing 0.x breaking-change semantics is present in both AC and implementation note. The open upper-bound attack surface is closed.

## Verdict

approved
