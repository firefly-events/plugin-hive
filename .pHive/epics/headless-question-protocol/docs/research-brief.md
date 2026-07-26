# Research Brief — Headless Question Protocol

**Epic:** headless-question-protocol
**Source:** `docs/scope/plugin-hive-headless-question-protocol.md`
**Date:** 2026-07-25

## Part 1 — The interactive-only gap

### Blocking prompt sites (confirmed by direct grep, file:line)

**`AskUserQuestion` (Claude Code runtime tool, blocking):**
- `skills/design/SKILL.md:123` — Touchpoint 1 (rendition selection) and Touchpoint 2 (brief
  sign-off), explicitly documented as blocking: "`/design` halts until the user responds."
- `hive/references/wireframe-protocol.md:38` — Touchpoint 1, "Ask for selection."
- `hive/references/wireframe-protocol.md:58` — Touchpoint 2, "Ask for approval."
- `hive/references/wireframe-protocol.md:91-92` — "Touchpoints are **blocking**... require
  **direct user access** — they must run in the main session or team lead, not in a
  background teammate."

**Prose "Ask the user" / "Ask:" blocking gates:**
- `skills/kickoff/SKILL.md:13,22,24,26,36,41,46`
- `hive/references/kickoff-protocol.md:45,58,99,145,182,320-363,756-786,906`
- `skills/plan/SKILL.md:106` (branch-switch confirmation), `:707` (14b version_bump),
  `:713` (14c sidecar_retention)
- Several daily-ceremony step files and `skills/ship/SKILL.md` also block on prose prompts,
  but are out of the literal ask (kickoff/design/plan) — noted as adjacent, not in-scope.

### What already exists vs. what's missing

- **No generic "am I headless" primitive anywhere in `hive/lib`.** Grepped for
  `isatty|process.stdin|--print|CI=|interactive` — every hit is either an MCP server's own
  stdin protocol, a `readline` confirm-prompt local to one script
  (`hive/lib/hermes-reconciler/epic-bootstrap.mjs:70`, has its own `--yes` skip flag), or Hive
  *spawning* `claude --print` as a child (the inverse direction).
- **Closest existing analog:** `under_scheduler.auto_approve` in
  `hive/references/workflow-schema.md:440-456` — a step-level DAG/workflow field for
  non-interactive `pause` nodes. Scoped to `hive/lib/dag_executor`, not to skill-level
  `AskUserQuestion`/prose call sites.
- **No question-envelope schema, no `submitAnswers`** anywhere in the repo outside the scope
  doc itself.
- `skills/triage/SKILL.md:19,105` has the one existing machine-readable convention in-repo:
  a `--json` flag returning a structured envelope instead of a human table — output-only
  (queries), not an input/answer envelope, but useful precedent for envelope shape/tone.

### Schema-doc convention (for the new question-envelope schema)

No `hive/schemas/` directory exists. Machine-readable contracts live as markdown under
`hive/references/`, named `<thing>-schema.md` or `<thing>.schema.md`
(`story-yaml-schema.md`, `cycle-state-schema.md`, `triage-queue-schema.md`,
`.pHive/metrics/experiment-envelope.schema.md`). Common shape: header (purpose, target path,
status) → field-by-field Purpose/Data-shape/Cardinality/Storage-rule table → mutation-rules
section with explicit allowed-transition table → closure-invariant section → worked examples
→ closing "what this schema does NOT commit to" fence. `triage-queue-schema.md:9` establishes
"consumers MUST tolerate absence" for new/missing files — directly reusable.

### `.pHive/` placement convention

Two dominant shapes observed: single-index-file (`triage/queue.yaml`, `design/index.yaml`)
vs. one-file-per-record (`cycle-state/<epic-id>.yaml`, `metrics/experiments/<id>.yaml`,
`interrupts/<timestamp>.yaml`). A new `.pHive/questions/` directory fits either; per-record
(`.pHive/questions/<skill>-<invocation-id>.yaml`) reads cleanest for a request/response
envelope that gets mutated in place by the answering orchestrator.

### `hive/lib` organization

Mixed Python + JS/TS by design — `config.js` and `config.py` are dual-implemented already for
the same config-resolution job. A new runtime-mode helper should follow this existing
dual-implementation convention rather than picking one language.

## Part 2 — Global Stop hook (`metrics-stop-dispatch`)

### Registration

`.claude-plugin/plugin.json:36-51`, `Stop` array, `matcher: ""` (fires on every session Stop,
unconditionally):

```json
"Stop": [
  { "matcher": "", "hooks": [
    { "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/stop-interrupt-capture.sh\"", "timeout": 10 },
    { "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/metrics-stop-dispatch.sh\" || true", "timeout": 15 }
  ]}
]
```

Two hooks run serially on every Stop: up to 10s + 15s = 25s worst case before session
finalization completes, before any size-driven slowdown.

### `hooks/metrics-stop-dispatch.sh` (228 lines)

- `:65-74` — only existing short-circuit: `metrics.enabled` config check, exits 0 if disabled.
- `:111-130` (`_extract_tokens`) — **the hot path**: `jq -c -s '[...]' "$jsonl"`. The `-s`
  (slurp) flag loads the **entire JSONL transcript into memory as one array** before
  filtering/summing. O(n) time and memory in transcript size, **no size guard, no line cap,
  no streaming** (confirmed: zero hits for `wc -c|stat -f|MAX_|too large|truncat`).
- `:25` — `trap 'exit 0' ERR` + `|| true` at the plugin.json command level: failure is
  swallowed silently (no warning surfaced), so the failure mode isn't a crash — it's silent
  metric loss when the parse takes too long or errors.
- Header comment `:10-11` confirms full-transcript-parse-per-Stop is the *intended* mechanism
  ("C2.0 chosen mechanism"), not an oversight — it simply has no scaling safeguard.
- The only cost bound today is the harness-level `timeout: 15` wrapper. Whether Claude Code
  reliably kills a hook process at that timeout (vs. the process continuing to consume memory
  briefly after) is not verifiable from inside this repo — treated as an open risk, not a
  confirmed fact.

### No background/foreground session signal exists

Grepped `HIVE_BACKGROUND|--bg|background mode|is_background` across `hooks/`, `hive/`,
`skills/`, `.claude-plugin/`. The only `--bg`/`--background` hit
(`skills/execute/SKILL.md:443`) is an unrelated execute-dispatch mode flag, not a
session-classification signal reaching the hook layer. **There is currently no way for the
Stop hook to detect "this is a `claude --bg` session" and branch on it** — this would have to
be newly introduced, and its existence/reliability as a signal is unconfirmed.

### Sibling hooks (pattern reference)

| Event | Matcher | Command | Timeout |
|---|---|---|---|
| `PreToolUse` | `"Agent"` | `check-agent-misuse.sh` | 5 |
| `SessionStart` | `""` | `chromadb-start.sh` (backgrounded `& disown`) | 5 |
| `SessionStart` | `""` | `effort-gate.sh` | 5 |
| `Stop` | `""` | `stop-interrupt-capture.sh` (no `\|\| true` — load-bearing) | 10 |
| `Stop` | `""` | `metrics-stop-dispatch.sh \|\| true` | 15 |
| `SubagentStop` | `""` | `notify-agent-complete.sh \|\| true` | 10 |

`hooks/notify-agent-complete.sh:17-19` names the `|| true` + internal `trap ERR exit 0`
double-guard as the shared Hive convention for "hook must never break the session" — the fix
should extend this convention (bound the cost), not replace it.
