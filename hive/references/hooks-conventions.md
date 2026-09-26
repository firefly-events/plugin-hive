# Hive Hook Conventions

Conventions for Claude Code **tool-hooks** wired by Hive. Tool-hooks intercept Claude
tool calls; they are distinct from Sandcastle **lifecycle hooks** (worktree/container
milestones) — see `hive/references/sandcastle-hooks-reference.md` for that layer.

Hive wires its hooks in `.claude-plugin/plugin.json` under the `hooks` key, grouped by
event name. Each entry is `{ "matcher": <tool-glob>, "hooks": [{ "type": "command",
"command": <shell> }] }`. The shell command is a `hooks/*.sh` shim that reads the hook
payload as JSON on stdin and (optionally) writes a JSON decision object on stdout.

---

## PostToolUse — `updatedToolOutput` convention

`PostToolUse` fires **after** a tool runs, with the tool's input and output available on
stdin. As of its GA rollout, a `PostToolUse` hook may **replace the tool result** that
Claude sees by emitting `hookSpecificOutput.updatedToolOutput` on stdout. This now works
for **all tools** (previously MCP-tools only).

### Hook structure

In `.claude-plugin/plugin.json`:

```json
"PostToolUse": [
  {
    "matcher": "Read",
    "hooks": [
      {
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/<your-hook>.sh\"",
        "timeout": 5
      }
    ]
  }
]
```

- **event key** — `PostToolUse` (the hook type).
- **`matcher`** — tool name/glob the hook applies to (e.g. `Read`, `Edit`, `mcp__*`).
- **`command`** — the `hooks/*.sh` shim, invoked with the payload on stdin.

### Replacing the result with `updatedToolOutput`

To rewrite what Claude sees, the shim writes JSON to stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "updatedToolOutput": "<replacement tool result>"
  }
}
```

Claude consumes `updatedToolOutput` in place of the original tool result.

### CAVEAT — built-in tools enforce their output schema

For **built-in tools** (e.g. `Read`, `Edit`, `Bash`), `updatedToolOutput` must conform
to that tool's output schema. **If it does not match, it is silently ignored and the
ORIGINAL tool output is used** — no error is raised. (MCP tools are more permissive, which
is why this convention originally shipped MCP-only.)

Practical consequence: when targeting a built-in tool, either (a) produce a replacement
that conforms to the tool's output schema, or (b) accept that a non-conforming payload is
a silent no-op. Do not assume an arbitrary structure will take effect.

### Worked example — context-mode reminder on large `Read` output

Goal: when `Read` returns a large file, prepend a context-mode routing reminder so the
agent is nudged toward sandbox tools — **without** discarding the file content. Because
`Read`'s output is textual, the conforming approach is to return the **original content
with the reminder prefixed** (still a valid `Read`-shaped string result). A structurally
different payload would be silently dropped per the caveat above.

`hooks/read-ctx-reminder.sh` (illustrative — NOT wired in this epic):

```bash
#!/usr/bin/env bash
# PostToolUse(Read): prepend a context-mode reminder to large Read output.
set -euo pipefail

payload="$(cat)"                       # hook payload (JSON) on stdin
output="$(jq -r '.tool_response // .tool_output // ""' <<<"$payload")"

# Only act on large results; otherwise pass through unchanged (emit nothing).
threshold=20000
if (( ${#output} < threshold )); then
  exit 0
fi

reminder='[context-mode] Large file read. Prefer ctx_execute_file for analysis so raw content stays in the sandbox.'
updated="${reminder}"$'\n\n'"${output}"   # conforms to Read schema: still a text result

jq -n --arg out "$updated" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    updatedToolOutput: $out
  }
}'
```

Emitting nothing (exit 0 with no stdout) leaves the original output untouched — the
correct behavior for the below-threshold path.

---

## Posture for this epic

This epic ships **convention text only**. No live `PostToolUse` hook is added to `hooks/`
or wired in `.claude-plugin/plugin.json`; the example above is illustrative. Authoring and
wiring a real `PostToolUse` hook is deferred to a follow-on work item with a concrete
consumer use case.
