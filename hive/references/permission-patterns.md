# Permission Patterns

Per-workflow recommendations for minimizing permission prompts during Hive execution. These are recommendations for users to add to their project's `.claude/settings.json` — Hive does not configure permissions automatically.

## Why Permission Prompts Happen

Claude Code prompts for approval when a command is unfamiliar or potentially destructive. Hive agents trigger excessive prompts when they:

1. **Use shell variable assignments** — `PG1="abc"` triggers "command contains newlines"
2. **Improvise CLI commands** — unknown flags or syntax patterns
3. **Use the Write tool for managed files** — writing .f0 JSON directly instead of using CLI
4. **Use multi-line commands** — backslash continuation triggers approval

Step files prevent most of these by providing exact command templates. This document covers the remaining cases where project-level permission configuration helps.

## Per-Workflow Allowlists

### UI Design Workflow

Frame0 CLI commands are sandboxed to .f0 files and non-destructive. Pre-approve all.

```json
{
  "permissions": {
    "allow": [
      "Bash(cli-anything-frame-zero*)"
    ]
  }
}
```

**Rationale:** User feedback — "I should never need to approve a Frame0 CLI command. It's wireframing. I don't care if it destroys all the wireframes."

### Development Workflow

Build, test, and lint commands are read-only or produce expected artifacts.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test*)",
      "Bash(npm run build*)",
      "Bash(npm run lint*)",
      "Bash(./gradlew *)",
      "Bash(pytest*)",
      "Bash(cargo test*)",
      "Bash(cargo build*)"
    ]
  }
}
```

Adapt to your project's actual build/test commands. The pattern is: allow the commands your CI already runs.

### Test Swarm Workflow

Test runners and device commands.

```json
{
  "permissions": {
    "allow": [
      "Bash(maestro *)",
      "Bash(npm test*)",
      "Bash(pytest*)",
      "Bash(./gradlew test*)",
      "Bash(xcrun *)",
      "Bash(adb *)"
    ]
  }
}
```

### Daily Ceremony

Read-only git and state queries.

```json
{
  "permissions": {
    "allow": [
      "Bash(git status*)",
      "Bash(git log*)",
      "Bash(git diff*)",
      "Bash(git branch*)"
    ]
  }
}
```

## Parameter-Level Matching

Claude Code permission rules can now match on individual tool **parameters**, not just the
tool name or the leading Bash command. This is **generally available** — no flag or preview
gate required. It lets you write precise allow/deny rules for tools that take structured
input (Edit, Write, MCP calls) where a bare tool name is too coarse.

### Syntax

```
Tool(param:value)
```

- `param` is a named field on the tool's input (e.g. `file_path` for Edit/Write, `command`
  for Bash, `url` for WebFetch).
- `value` is matched literally, with `*` as a wildcard (same glob semantics as the existing
  tool-name patterns like `Bash(npm test*)`).
- Multiple constraints can target the same tool across separate rules; deny rules win over
  allow rules.

### Worked Hive Examples

These use real Hive tooling and the paths Hive agents actually touch.

```json
{
  "permissions": {
    "allow": [
      "Edit(file_path:.pHive/**)",
      "Edit(file_path:hive/references/**)",
      "Write(file_path:.pHive/episodes/**)",
      "Write(file_path:.pHive/cycle-state/**)",
      "Bash(command:git status*)",
      "Bash(command:./gradlew test*)",
      "mcp__plugin_context-mode_context-mode__ctx_execute(language:shell)"
    ],
    "deny": [
      "Edit(file_path:hive/lib/dag_executor/**)",
      "Edit(file_path:**/.claude/settings.json)",
      "Write(file_path:**/.env*)",
      "Bash(command:git push*)",
      "Bash(command:rm -rf*)"
    ]
  }
}
```

What each rule does, in Hive terms:

- `Edit(file_path:.pHive/**)` — let a planning agent freely edit epic/story YAML and
  cycle-state under `.pHive/` without prompting on every file.
- `Write(file_path:.pHive/episodes/**)` — allow episode markers (the artifacts
  `multica_episode` and ship reconciliation write) without approval.
- `Edit(file_path:hive/lib/dag_executor/**)` in **deny** — protect the canonical Python DAG
  executor from incidental edits by a docs- or planning-scoped agent.
- `Bash(command:git push*)` in **deny** — keeps outbound publishing gated even when a broad
  `Bash(command:git *)` allow exists elsewhere (deny precedence).
- `mcp__..._ctx_execute(language:shell)` — pre-approve sandbox shell execution (the routed
  replacement for raw Bash under the context-mode rules) while leaving other languages to
  prompt.

The `*` wildcard works mid-value, so `Edit(file_path:**/*.md)` (docs-only agent) or
`Bash(command:pytest hive/lib/**)` are both valid.

### Role-to-Deny-List

Hive runs multiple agent roles against the same repo. Param-level deny lists let each role
keep a tight blast radius. Recommended baselines:

| Role | Recommended deny-listed parameter patterns | Why |
|---|---|---|
| `orchestrator` | `Edit(file_path:hive/lib/**)`, `Write(file_path:hive/lib/**)`, `Bash(command:git commit*)`, `Bash(command:git push*)` | Orchestrators dispatch and reconcile; they should not be hand-editing canonical runtime code or publishing. |
| `developer` | `Edit(file_path:.pHive/cycle-state/**)`, `Edit(file_path:**/.claude/settings.json)`, `Bash(command:git push*)`, `Write(file_path:**/.env*)` | Devs write code, not orchestration state or host permission config; push stays human-gated. |
| `reviewer` | `Edit(file_path:**)`, `Write(file_path:**)`, `Bash(command:git commit*)`, `Bash(command:git push*)` | Reviewers are read-and-comment only; deny all mutation so a review pass cannot alter the tree. |
| `planner` | `Edit(file_path:hive/lib/**)`, `Edit(file_path:src/**)`, `Bash(command:git commit*)`, `Bash(command:git push*)` | Planners produce `.pHive/` epics and stories, not implementation code or commits. |

Deny rules are evaluated before allow rules, so these patterns hold even when a broad
allowlist (`Bash(command:git *)`, `Edit(file_path:**)`) is also configured for convenience.

Note: as with the tool-name allowlists, `git commit` and `git push` are intentionally kept
**out of every allowlist and inside the deny lists above**. Mutating history and publishing
remain human-gated at the parameter level too — a `Bash(command:git *)` allow must always be
paired with explicit `Bash(command:git commit*)` / `Bash(command:git push*)` denies.

## Command Pattern Rules for Step Files

Step files MUST follow these patterns. They are mandatory for all command templates.

| Do | Don't | Why |
|---|---|---|
| Single-line commands with literal values | Shell variable assignments (`F0="path"`) | Variables trigger "contains newlines" prompt |
| `&&` chaining for sequential commands | Multi-line with `\` continuation | `&&` is one logical command; `\` triggers approval |
| Use CLI tools (Frame0, git, build commands) | Use Write tool for managed files | Managed files need their CLI to register properly |
| Copy-paste from command templates | Construct commands from memory | Wrong flags cause silent failures + fallback to Write |
| Use `--` flag syntax | Positional args where flags exist | Flags are self-documenting and less error-prone |

### && chaining pattern (standard for Hive agents)

When multiple sequential commands are needed, chain them with `&&`:

```bash
# GOOD — one logical command, one permission prompt
./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n com.app/.MainActivity

# BAD — three separate commands, three permission prompts
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.app/.MainActivity

# BAD — shell variable, triggers "contains newlines"
APK="app/build/outputs/apk/debug/app-debug.apk"
adb install -r "$APK"
```

This pattern works because `&&` chains are treated as a single command by Claude Code's permission system. Each command in the chain only runs if the previous one succeeded.

### bypassPermissions limitation

`bypassPermissions` on teammates does NOT suppress all prompt types. Specifically, "command contains newlines" prompts still fire for shell variable assignments. The `&&` chaining + literal values pattern avoids this entirely.

## Combining Allowlists

A project using all Hive workflows might have:

```json
{
  "permissions": {
    "allow": [
      "Bash(cli-anything-frame-zero*)",
      "Bash(./gradlew *)",
      "Bash(npm test*)",
      "Bash(npm run *)",
      "Bash(maestro *)",
      "Bash(git status*)",
      "Bash(git log*)",
      "Bash(git diff*)",
      "Bash(git branch*)"
    ]
  }
}
```

Note: `git commit`, `git push`, and destructive operations are intentionally NOT in the allowlist. Those should still require approval. The same holds at the parameter level — see the role-to-deny-list table above, where `Bash(command:git commit*)` and `Bash(command:git push*)` are deny-listed for every role rather than allowlisted.
