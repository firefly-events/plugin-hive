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

Note: `git commit`, `git push`, and destructive operations are intentionally NOT in the allowlist. Those should still require approval.
