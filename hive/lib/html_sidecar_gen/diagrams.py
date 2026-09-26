"""Mermaid diagram pipeline — offline pre-render via mmdc."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_PARALLEL_MARKER = "‖"  # ‖ glyph used in /plan dependency graphs

# mmdc renders trusted-ish planning markdown, but Mermaid SVG can still carry active
# content (scripts, foreignObject HTML, event handlers, javascript: links). The SVG is
# inlined into a file:// HTML page, so sanitize before insertion (defense-in-depth).
_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.IGNORECASE | re.DOTALL)
_FOREIGNOBJECT_RE = re.compile(
    r"<foreignObject\b[^>]*>.*?</foreignObject\s*>", re.IGNORECASE | re.DOTALL
)
_SELFCLOSE_DANGER_RE = re.compile(r"<(?:script|foreignObject)\b[^>]*/\s*>", re.IGNORECASE)
_EVENT_ATTR_RE = re.compile(r"""\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_JS_HREF_RE = re.compile(
    r"""(\b(?:xlink:href|href)\s*=\s*)("|')\s*javascript:[^"']*\2""", re.IGNORECASE
)


def _sanitize_svg(svg: str) -> str:
    """Strip active content from mmdc-produced SVG before inlining into HTML."""
    svg = _SCRIPT_RE.sub("", svg)
    svg = _FOREIGNOBJECT_RE.sub("", svg)
    svg = _SELFCLOSE_DANGER_RE.sub("", svg)
    svg = _EVENT_ATTR_RE.sub("", svg)
    svg = _JS_HREF_RE.sub(r"\1\2#\2", svg)  # neutralize javascript: links → "#"
    return svg


def _escape_caption(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _render_mermaid_svg(source: str) -> str | None:
    """Run mmdc to pre-render mermaid source to SVG. Returns SVG string or None."""
    if not shutil.which("mmdc"):
        return None
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            in_file = Path(tmpdir) / "diagram.mmd"
            out_file = Path(tmpdir) / "diagram.svg"
            in_file.write_text(source, encoding="utf-8")
            result = subprocess.run(
                ["mmdc", "-i", str(in_file), "-o", str(out_file)],
                capture_output=True,
                timeout=30,
            )
            if result.returncode == 0 and out_file.exists():
                return out_file.read_text(encoding="utf-8")
    except Exception:
        pass
    return None


def mermaid_fence_to_figure(raw_source: str, title: str = "") -> str:
    """Pre-render mermaid source, wrap in <figure><figcaption>.

    title: plain text of the nearest preceding heading, used as caption label.
    When source contains ‖, a legend is appended to the figcaption.
    Falls back to <pre class="mermaid-fallback"> when mmdc is unavailable.
    """
    svg = _render_mermaid_svg(raw_source)
    if svg is not None:
        inner = _sanitize_svg(svg.strip())
    else:
        sys.stderr.write("warning: mmdc not available; mermaid diagram rendered as source\n")
        escaped = (
            raw_source
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        inner = f'<pre class="mermaid-fallback">{escaped}</pre>'

    caption_parts: list[str] = []
    if title:
        caption_parts.append(f'<span class="diagram-title">{_escape_caption(title)}</span>')
    if _PARALLEL_MARKER in raw_source:
        caption_parts.append(
            f'<span class="diagram-legend">{_PARALLEL_MARKER} = parallel to its peers</span>'
        )

    figcaption = "<figcaption>" + "".join(caption_parts) + "</figcaption>"
    return f'<figure class="diagram">\n{inner}\n{figcaption}\n</figure>'


def mermaid_fence_to_html(raw_source: str) -> str:
    """Pre-render mermaid source to inline SVG via mmdc, or fall back to <pre> block.

    Wraps output in <figure><figcaption>. Use mermaid_fence_to_figure(source, title=...)
    when a heading-derived caption is available.
    """
    return mermaid_fence_to_figure(raw_source)


def get_mermaid_script(has_mermaid: bool) -> str:
    """No-op: mermaid is pre-rendered to SVG; no CDN script needed."""
    return ""
