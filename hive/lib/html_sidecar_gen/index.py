"""Epic index generator: per-epic index.html linking all doc sidecars with status badges."""

from __future__ import annotations

import os
import sys
import webbrowser
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from .css import CSS

# Status → (background, foreground)
_STATUS_COLORS: dict[str, tuple[str, str]] = {
    "done": ("#2da44e", "#ffffff"),
    "in_progress": ("#0969da", "#ffffff"),
    "in_review": ("#9a40d4", "#ffffff"),
    "blocked": ("#cf222e", "#ffffff"),
    "cancelled": ("#6e7781", "#ffffff"),
    "pending": ("#656d76", "#ffffff"),
}

_BADGE_CSS = """
  .badge {
    display: inline-block;
    padding: 0.15em 0.55em;
    border-radius: 12px;
    font-size: 0.78em;
    font-weight: 600;
    vertical-align: middle;
    letter-spacing: 0.02em;
    text-transform: lowercase;
  }
  .sidecar-list { list-style: none; padding: 0; margin: 0; }
  .sidecar-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid #f0f0f0;
  }
  .sidecar-item a { font-weight: 500; flex: 1; }
  .empty { color: #888; font-style: italic; }
"""


def _badge_html(status: str) -> str:
    from .render import escape_html

    bg, fg = _STATUS_COLORS.get(status, _STATUS_COLORS["pending"])
    label = escape_html(status.replace("_", " "))
    return f'<span class="badge" style="background:{bg};color:{fg}">{label}</span>'


def _read_status_from_yaml(yaml_path: Path) -> str:
    """Parse status from a YAML file without a YAML library dependency."""
    try:
        for line in yaml_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("status:"):
                val = stripped.split(":", 1)[1].strip().strip('"').strip("'")
                return val or "pending"
    except Exception:
        pass
    return "pending"


def _find_story_yaml(sidecar_stem: str, epic_dir: Path) -> Optional[Path]:
    """Return the story YAML for this sidecar stem, or None if not found."""
    stories_dir = epic_dir / "stories"
    if not stories_dir.is_dir():
        return None
    candidate = stories_dir / f"{sidecar_stem}.yaml"
    return candidate if candidate.is_file() else None


def generate_epic_index(
    epic_docs_dir: Path | str,
    auto_open: bool = False,
) -> Optional[str]:
    """Generate (or regenerate) the per-epic index.html.

    Links every .html sidecar in the docs dir with a status badge derived from
    the matching story YAML (best-effort; defaults to 'pending' when not found).
    All links are relative so the index works offline from file://.

    Returns the index.html path on success, None on failure.
    """
    try:
        docs_dir = Path(epic_docs_dir)
        docs_dir.mkdir(parents=True, exist_ok=True)

        epic_dir = docs_dir.parent  # .pHive/epics/{epic-id}/
        epic_id = epic_dir.name

        index_path = docs_dir / "index.html"

        sidecars = sorted(
            p for p in docs_dir.glob("*.html") if p.name != "index.html"
        )

        if sidecars:
            from .render import escape_html

            items = []
            for sidecar in sidecars:
                story_yaml = _find_story_yaml(sidecar.stem, epic_dir)
                status = _read_status_from_yaml(story_yaml) if story_yaml else "pending"
                badge = _badge_html(status)
                # href: percent-encode the filename (also escapes quotes/control chars);
                # link text: HTML-escape the stem. A crafted .html filename in the docs
                # dir must not inject attributes or markup into the index (Codex review).
                href = quote(sidecar.name)
                text = escape_html(sidecar.stem)
                items.append(
                    f'  <li class="sidecar-item">'
                    f'<a href="{href}">{text}</a>{badge}'
                    f"</li>"
                )
            list_html = '<ul class="sidecar-list">\n' + "\n".join(items) + "\n</ul>"
        else:
            list_html = '<p class="empty">No doc sidecars found yet.</p>'

        html = _build_index_html(epic_id, list_html)
        index_path.write_text(html, encoding="utf-8")

        if auto_open:
            webbrowser.open(index_path.as_uri())

        return str(index_path)
    except Exception as err:
        sys.stderr.write(f"warning: epic-index generation failed for {epic_docs_dir}: {err}\n")
        return None


def _build_index_html(epic_id: str, list_html: str) -> str:
    from .render import escape_html

    safe_id = escape_html(epic_id)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Epic index — {safe_id}</title>
  <style>{CSS}
{_BADGE_CSS}  </style>
</head>
<body>
  <div class="content">
    <h1>Epic index — {safe_id}</h1>
    <p>All doc sidecars for this epic. Regenerated on every write.</p>
    {list_html}
  </div>
</body>
</html>"""


def _is_epic_docs_dir(html_path: Path) -> bool:
    """Return True when html_path is inside .pHive/epics/{id}/docs/."""
    try:
        parts = html_path.parts
        # Need at least: .pHive / epics / {id} / docs / file.html
        for i, part in enumerate(parts):
            if part == "epics" and i + 2 < len(parts) and parts[i + 2] == "docs":
                return True
    except Exception:
        pass
    return False


def epic_docs_dir_for(html_path: Path) -> Optional[Path]:
    """Return the docs dir Path if html_path is inside an epic docs dir, else None."""
    if _is_epic_docs_dir(html_path):
        return html_path.parent
    return None


def auto_open_enabled() -> bool:
    """Return True when the HIVE_SIDECAR_AUTO_OPEN env var is set to a truthy value."""
    val = os.environ.get("HIVE_SIDECAR_AUTO_OPEN", "")
    return val.strip().lower() in ("1", "true", "yes")
