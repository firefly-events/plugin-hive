# LSP Suggestions Reference

Single source for the confirmed language→LSP-plugin map, settings.json enable
pattern, invariants, and suggestion copy used by `/kickoff` and `/plan`.

## Confirmed Language → Plugin Map

| Language | Plugin ID | Scope |
|----------|-----------|-------|
| kotlin | kotlin-lsp | claude-plugins-official |
| swift | swift-lsp | claude-plugins-official |

Unmapped languages (Python, TypeScript, JavaScript, Go, Rust, etc.): **no suggestion**.
Do not invent plugin names for unmapped languages. Safe default is silence.

## Settings.json Enable Pattern

A plugin is enabled when `~/.claude/settings.json` has the plugin key set to `true`
under the `enabledPlugins` object:

```json
{
  "enabledPlugins": {
    "<plugin-name>@<scope>": true
  }
}
```

Examples:
- `{"enabledPlugins": {"kotlin-lsp@claude-plugins-official": true}}`
- `{"enabledPlugins": {"swift-lsp@claude-plugins-official": true}}`

A plugin is **not enabled** when the `enabledPlugins` key is absent, the plugin key
is absent under it, or the value is `false`.

## Invariants

- **NEVER invoke the `LSP` tool** — the tool errors when no language server is
  configured. The suggestion is TEXT-ONLY and must never trigger any LSP tool call.
- **Never required** — with no LSP plugin enabled, `/kickoff`, `/plan`, and
  `/execute` behave byte-identically. The suggestion is informational only.
- **One suggestion maximum** — emit at most one suggestion per scope, regardless of
  how many confirmed languages are detected. If multiple confirmed languages are
  present, name them all in a single suggestion line.

## Suggestion Copy

```
Tip (optional): {language} support may improve navigation. Enable with:
  ~/.claude/settings.json → "{plugin}@{scope}": true
This is optional — Hive works without it.
```

Substitution: `{language}` = detected language name, `{plugin}` = plugin ID from
map above, `{scope}` = `claude-plugins-official`.

For multiple confirmed languages: list them comma-separated in `{language}` and
show one enable line per plugin.

## Detection Logic (stdlib Python)

```python
import json
from pathlib import Path

CONFIRMED_PLUGINS = {
    "kotlin": ("kotlin-lsp", "claude-plugins-official"),
    "swift":  ("swift-lsp",  "claude-plugins-official"),
}


def get_tech_stack_languages(profile: dict) -> list:
    """Tolerant reader — handles both flat list and nested languages[] shapes.

    Aligned with ``resolve_languages`` in ``hive/references/kickoff-protocol.md``.
    Both implement the same normalisation logic; they differ only in signature
    (this one takes a full profile dict and extracts tech_stack first).
    Neither is a shared import — the fenced-block-tested pattern intentionally
    keeps each doc self-contained.
    """
    ts = profile.get("tech_stack") or []
    if isinstance(ts, list):
        return [str(x).lower() for x in ts]
    # nested shape: {languages: [], frameworks: [], build_tools: []}
    langs = ts.get("languages") or []  # guard against present-but-null key
    return [str(x).lower() for x in langs]


def is_plugin_enabled(plugin: str, scope: str) -> bool:
    """Return True iff the plugin is listed under enabledPlugins in settings.json.

    Claude Code nests plugin flags under {"enabledPlugins": {"<plugin>@<scope>": true}}.
    A valid-but-non-dict JSON value (array, string, …) degrades to False rather
    than raising.
    """
    settings_path = Path.home() / ".claude" / "settings.json"
    if not settings_path.exists():
        return False
    try:
        settings = json.loads(settings_path.read_text())
        if not isinstance(settings, dict):
            return False
        enabled = settings.get("enabledPlugins") or {}
        return enabled.get(f"{plugin}@{scope}") is True
    except (json.JSONDecodeError, OSError, AttributeError, TypeError):
        return False


def lsp_suggestion(profile: dict):
    """
    Returns a one-line suggestion string when a confirmed-but-not-enabled
    LSP plugin exists for the detected tech_stack. Returns None otherwise.
    """
    languages = get_tech_stack_languages(profile)
    hits = []
    for lang in languages:
        if lang in CONFIRMED_PLUGINS:
            plugin, scope = CONFIRMED_PLUGINS[lang]
            if not is_plugin_enabled(plugin, scope):
                hits.append((lang, plugin, scope))
    if not hits:
        return None
    lang_names = ", ".join(h[0] for h in hits)
    enable_lines = "\n  ".join(
        f'"{h[1]}@{h[2]}": true' for h in hits
    )
    return (
        f"Tip (optional): {lang_names} support may improve navigation. "
        f"Enable with:\n  ~/.claude/settings.json → {enable_lines}\n"
        "This is optional — Hive works without it."
    )
```

## Scope of Application

| Surface | When to emit |
|---------|-------------|
| `/kickoff` brownfield | After Phase 3 resolves `tech_stack` — confirmed-but-not-enabled only |
| `/plan` Medium or Large scope | After `SCALE DECISION` — confirmed-but-not-enabled only |
| `/plan` Small scope | **Never** |
| LSP already enabled | **Never** |
| Language has no confirmed plugin | **Never** |
