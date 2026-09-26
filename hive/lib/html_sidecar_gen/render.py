"""Core renderer: markdown → HTML, HTML → markdown, sidecar generators."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Optional

from .css import CSS
from .diagrams import get_mermaid_script, mermaid_fence_to_figure, mermaid_fence_to_html

# ── helpers ──────────────────────────────────────────────────────────────────


def escape_html(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _unescape_html(s: str) -> str:
    return (
        s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )


def sanitize_url(url: str) -> str:
    trimmed = str(url).strip()
    if re.match(r"^(https?:|mailto:|#|/|\.{1,2}/)", trimmed, re.IGNORECASE):
        return trimmed
    if re.match(r"^[a-z][a-z0-9+.\-]*:", trimmed, re.IGNORECASE):
        return "#"
    return trimmed


def _is_block_start(line: str) -> bool:
    return bool(
        re.match(r"^#{1,6}\s", line)
        or re.match(r"^>\s?", line)
        or re.match(r"^\d+\.\s", line)
        or re.match(r"^[-*+]\s", line)
        or re.match(r"^```", line)
        or re.match(r"^<figure", line)
        or re.match(r"^---+\s*$", line)
    )


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s)


def _heading_id(text: str) -> str:
    """Slugify plain heading text for use as an HTML id."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text.strip())
    return text.strip("-") or "section"


# ── inline markdown / HTML converters ────────────────────────────────────────


def _inline_markdown(s: str) -> str:
    s = escape_html(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\*(.+?)\*", r"<em>\1</em>", s)
    s = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", s)
    s = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{sanitize_url(m.group(2))}">{m.group(1)}</a>',
        s,
    )
    return s


def _inline_html_to_md(s: str) -> str:
    s = re.sub(r"<strong>([\s\S]*?)</strong>", r"**\1**", s, flags=re.IGNORECASE)
    s = re.sub(r"<b>([\s\S]*?)</b>", r"**\1**", s, flags=re.IGNORECASE)
    s = re.sub(r"<em>([\s\S]*?)</em>", r"*\1*", s, flags=re.IGNORECASE)
    s = re.sub(r"<i>([\s\S]*?)</i>", r"*\1*", s, flags=re.IGNORECASE)
    s = re.sub(
        r"<code>([\s\S]*?)</code>",
        lambda m: "`" + _unescape_html(m.group(1)) + "`",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r'<a\s+href="([^"]*)"[^>]*>([\s\S]*?)</a>',
        r"[\2](\1)",
        s,
        flags=re.IGNORECASE,
    )
    s = _strip_tags(s)
    return _unescape_html(s)


# ── build-time syntax highlighting ───────────────────────────────────────────

_HL_KW: dict[str, frozenset[str]] = {
    "python": frozenset([
        "False", "None", "True", "and", "as", "assert", "async", "await",
        "break", "class", "continue", "def", "del", "elif", "else", "except",
        "finally", "for", "from", "global", "if", "import", "in", "is",
        "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
        "while", "with", "yield",
    ]),
    "javascript": frozenset([
        "async", "await", "break", "case", "catch", "class", "const",
        "continue", "debugger", "default", "delete", "do", "else", "export",
        "extends", "false", "finally", "for", "from", "function", "if",
        "import", "in", "instanceof", "let", "new", "null", "of", "return",
        "static", "super", "switch", "this", "throw", "true", "try",
        "typeof", "undefined", "var", "void", "while", "yield",
    ]),
    "go": frozenset([
        "break", "case", "chan", "const", "continue", "default", "defer",
        "else", "fallthrough", "for", "func", "go", "goto", "if", "import",
        "interface", "map", "package", "range", "return", "select", "struct",
        "switch", "type", "var",
    ]),
    "rust": frozenset([
        "as", "async", "await", "break", "const", "continue", "crate", "dyn",
        "else", "enum", "extern", "false", "fn", "for", "if", "impl",
        "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref",
        "return", "self", "static", "struct", "super", "trait", "true",
        "type", "unsafe", "use", "where", "while",
    ]),
}
_HL_KW["js"] = _HL_KW["javascript"]
_HL_KW["ts"] = _HL_KW["javascript"]
_HL_KW["typescript"] = _HL_KW["javascript"]
_HL_KW["jsx"] = _HL_KW["javascript"]
_HL_KW["tsx"] = _HL_KW["javascript"]
_HL_KW["py"] = _HL_KW["python"]
_HL_KW["rs"] = _HL_KW["rust"]


def _highlight_code(code: str, lang: str) -> str:
    """Build-time syntax highlight — stdlib only, no external deps."""
    lang = (lang or "").lower().strip()
    if lang in ("", "text", "plain", "txt", "output"):
        return escape_html(code)

    kws = _HL_KW.get(lang, frozenset())
    is_py = lang in ("python", "py")
    is_js = lang in ("js", "javascript", "ts", "typescript", "jsx", "tsx")
    hash_comment = lang in ("python", "py", "bash", "sh", "shell", "yaml", "yml", "ruby", "rb")
    has_block_comment = not hash_comment

    patterns: list[str] = []
    if is_py:
        patterns.append(r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'')
    patterns.append(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')
    if is_js:
        patterns.append(r'`(?:[^`\\]|\\.)*`')
    if hash_comment:
        patterns.append(r'#[^\n]*')
    else:
        patterns.append(r'//[^\n]*')
    if has_block_comment:
        patterns.append(r'/\*[\s\S]*?\*/')
    patterns.append(r'\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b')
    if kws:
        sorted_kws = sorted(kws, key=len, reverse=True)
        patterns.append(r'\b(?:' + '|'.join(re.escape(k) for k in sorted_kws) + r')\b')

    combined = re.compile('|'.join(f'(?:{p})' for p in patterns), re.MULTILINE | re.DOTALL)

    out: list[str] = []
    last = 0
    for m in combined.finditer(code):
        if m.start() > last:
            out.append(escape_html(code[last:m.start()]))
        token = m.group(0)
        first = token[0] if token else ''
        if first in ('"', "'") or token[:3] in ('"""', "'''") or (is_js and first == '`'):
            out.append(f'<span class="hl-s">{escape_html(token)}</span>')
        elif token.startswith(('#', '//', '/*')):
            out.append(f'<span class="hl-c">{escape_html(token)}</span>')
        elif first.isdigit() or (len(token) > 1 and token[:2].lower() == '0x'):
            out.append(f'<span class="hl-n">{escape_html(token)}</span>')
        else:
            out.append(f'<span class="hl-k">{escape_html(token)}</span>')
        last = m.end()
    if last < len(code):
        out.append(escape_html(code[last:]))
    return ''.join(out)


def _strip_hl_spans(s: str) -> str:
    """Remove syntax highlight spans inserted by _highlight_code."""
    return re.sub(r'<span class="hl-[^"]*">([\s\S]*?)</span>', r'\1', s)


# ── block-level markdown → HTML ───────────────────────────────────────────────


def markdown_to_html(md: str) -> str:
    lines = md.split("\n")
    out: list[str] = []
    seen_ids: dict[str, int] = {}
    last_heading: str = ""  # plain-text of the most recent heading, for diagram captions
    i = 0

    while i < len(lines):
        line = lines[i]

        # Mermaid fenced code block
        if re.match(r"^```mermaid\s*$", line):
            mermaid_lines: list[str] = []
            i += 1
            while i < len(lines) and not re.match(r"^```\s*$", lines[i]):
                mermaid_lines.append(lines[i])
                i += 1
            out.append(mermaid_fence_to_figure(chr(10).join(mermaid_lines), title=last_heading))
            i += 1
            continue

        # Generic fenced code block
        fence_match = re.match(r"^```(\w*)\s*$", line)
        if fence_match:
            lang = fence_match.group(1) or ""
            code_lines: list[str] = []
            i += 1
            while i < len(lines) and not re.match(r"^```\s*$", lines[i]):
                code_lines.append(lines[i])
                i += 1
            lang_attr = f' class="language-{escape_html(lang)}"' if lang else ""
            raw_code = chr(10).join(code_lines)
            highlighted = _highlight_code(raw_code, lang)
            out.append(f"<pre><code{lang_attr}>{highlighted}</code></pre>")
            i += 1
            continue

        # figure HTML block — pass through as-is
        if re.match(r"^<figure", line):
            fig_lines = [line]
            while i + 1 < len(lines) and not re.match(r"^</figure>", lines[i]):
                i += 1
                fig_lines.append(lines[i])
                if re.match(r"^</figure>", lines[i]):
                    break
            raw = "\n".join(fig_lines)
            src_match = re.search(r'(?:data-src|src)="([^"]+)"', raw)
            alt_match = re.search(r'data-alt="([^"]+)"|data-placeholder="([^"]+)"', raw)
            alt_text = (alt_match.group(1) or alt_match.group(2) or "") if alt_match else ""
            if src_match:
                out.append(
                    f'<figure>\n  <img src="{escape_html(src_match.group(1))}" alt="{escape_html(alt_text)}">\n'
                    f"  <figcaption>{escape_html(alt_text)}</figcaption>\n</figure>"
                )
            else:
                placeholder = (alt_match.group(2) if alt_match else alt_text)
                out.append(
                    f'<figure data-placeholder="{escape_html(placeholder)}">\n'
                    f"  <figcaption>{escape_html(placeholder)}</figcaption>\n</figure>"
                )
            i += 1
            continue

        # Headings
        h_match = re.match(r"^(#{1,6})\s+(.+)", line)
        if h_match:
            level = len(h_match.group(1))
            inner = _inline_markdown(h_match.group(2))
            slug = _heading_id(_strip_tags(inner))
            if slug in seen_ids:
                seen_ids[slug] += 1
                slug = f"{slug}-{seen_ids[slug]}"
            else:
                seen_ids[slug] = 0
            last_heading = _strip_tags(inner)
            out.append(f'<h{level} id="{escape_html(slug)}">{inner}</h{level}>')
            i += 1
            continue

        # Horizontal rule
        if re.match(r"^---+\s*$", line):
            out.append("<hr>")
            i += 1
            continue

        # Blockquote
        if re.match(r"^>\s", line):
            q_lines: list[str] = []
            while i < len(lines) and re.match(r"^>\s?", lines[i]):
                q_lines.append(re.sub(r"^>\s?", "", lines[i]))
                i += 1
            out.append(f'<blockquote><p>{"<br>".join(_inline_markdown(l) for l in q_lines)}</p></blockquote>')
            continue

        # Unordered list
        if re.match(r"^[-*+]\s", line):
            items: list[str] = []
            while i < len(lines) and re.match(r"^[-*+]\s", lines[i]):
                items.append(f"<li>{_inline_markdown(re.sub(r'^[-*+]\s', '', lines[i]))}</li>")
                i += 1
            out.append("<ul>\n" + "\n".join(items) + "\n</ul>")
            continue

        # Ordered list
        if re.match(r"^\d+\.\s", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i]):
                items.append(f"<li>{_inline_markdown(re.sub(r'^\d+\.\s', '', lines[i]))}</li>")
                i += 1
            out.append("<ol>\n" + "\n".join(items) + "\n</ol>")
            continue

        # Blank line
        if line.strip() == "":
            i += 1
            continue

        # Paragraph
        para_lines: list[str] = []
        while i < len(lines) and lines[i].strip() != "" and not _is_block_start(lines[i]):
            para_lines.append(lines[i])
            i += 1
        if para_lines:
            out.append(f'<p>{" ".join(_inline_markdown(l) for l in para_lines)}</p>')
        else:
            i += 1

    return "\n".join(out)


# ── HTML → markdown (inverse direction) ──────────────────────────────────────


def html_to_markdown(html: str) -> str:
    body_match = re.search(r"<body[^>]*>([\s\S]*?)</body>", html, re.IGNORECASE)
    body = body_match.group(1) if body_match else html

    content_match = re.search(r'<div[^>]*class="content"[^>]*>([\s\S]*)<\/div>', body, re.IGNORECASE)
    if content_match:
        body = content_match.group(1)

    # Strip badge spans (injected into headings)
    body = re.sub(r'<span[^>]*class="[^"]*badge[^"]*"[^>]*>[\s\S]*?</span>', '', body, flags=re.IGNORECASE)

    # Unwrap story-card sections (keep inner content)
    body = re.sub(r'<section[^>]*>([\s\S]*?)</section>', r'\1', body, flags=re.IGNORECASE)

    # Convert <details>/<summary> back to h3 + content
    body = re.sub(
        r'<details[^>]*>\s*<summary[^>]*>([\s\S]*?)</summary>\s*(?:<div[^>]*>)?([\s\S]*?)(?:</div>\s*)?</details>',
        lambda m: '\n### ' + _unescape_html(_strip_tags(m.group(1))).strip() + '\n' + m.group(2).strip() + '\n',
        body,
        flags=re.IGNORECASE,
    )

    # Mermaid divs → fenced mermaid block
    body = re.sub(
        r'<div[^>]*class="mermaid"[^>]*>([\s\S]*?)</div>',
        lambda m: "\n```mermaid\n" + _unescape_html(m.group(1)).strip() + "\n```\n",
        body,
        flags=re.IGNORECASE,
    )

    # Fenced code blocks from <pre><code ...> (strip highlight spans first)
    body = re.sub(
        r'<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)</code></pre>',
        lambda m: "\n" + (f"```{m.group(1)}" if m.group(1) else "```") + "\n" + _unescape_html(_strip_hl_spans(m.group(2))).strip() + "\n```\n",
        body,
        flags=re.IGNORECASE,
    )

    # Headings
    for level in range(6, 0, -1):
        hashes = "#" * level
        body = re.sub(
            f"<h{level}[^>]*>([\\s\\S]*?)</h{level}>",
            lambda m, h=hashes: "\n" + h + " " + _inline_html_to_md(m.group(1)).strip() + "\n",
            body,
            flags=re.IGNORECASE,
        )

    # <hr>
    body = re.sub(r"<hr[^>]*>", "\n---\n", body, flags=re.IGNORECASE)

    # Blockquotes
    body = re.sub(
        r"<blockquote[^>]*>([\s\S]*?)</blockquote>",
        lambda m: "\n" + "\n".join("> " + l for l in _inline_html_to_md(m.group(1)).strip().split("\n")) + "\n",
        body,
        flags=re.IGNORECASE,
    )

    # Tables
    def _convert_table(m: re.Match) -> str:
        inner = m.group(1)
        rows: list[str] = []
        header_done = False
        for row_m in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", inner, re.IGNORECASE):
            cells = [_inline_html_to_md(c.group(1)).strip() for c in re.finditer(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", row_m.group(1), re.IGNORECASE)]
            if not cells:
                continue
            is_header = bool(re.search(r"<th", row_m.group(1), re.IGNORECASE))
            rows.append("| " + " | ".join(cells) + " |")
            if is_header and not header_done:
                rows.append("|" + "".join("---|" for _ in cells))
                header_done = True
        return "\n" + "\n".join(rows) + "\n"

    body = re.sub(r"<table[^>]*>([\s\S]*?)</table>", _convert_table, body, flags=re.IGNORECASE)

    # Unordered lists
    body = re.sub(
        r"<ul[^>]*>([\s\S]*?)</ul>",
        lambda m: "\n" + "\n".join("- " + _inline_html_to_md(li.group(1)).strip() for li in re.finditer(r"<li[^>]*>([\s\S]*?)</li>", m.group(1), re.IGNORECASE)) + "\n",
        body,
        flags=re.IGNORECASE,
    )

    # Ordered lists
    def _convert_ol(m: re.Match) -> str:
        items = [_inline_html_to_md(li.group(1)).strip() for li in re.finditer(r"<li[^>]*>([\s\S]*?)</li>", m.group(1), re.IGNORECASE)]
        return "\n" + "\n".join(f"{n + 1}. {item}" for n, item in enumerate(items)) + "\n"

    body = re.sub(r"<ol[^>]*>([\s\S]*?)</ol>", _convert_ol, body, flags=re.IGNORECASE)

    # Paragraphs
    body = re.sub(
        r"<p[^>]*>([\s\S]*?)</p>",
        lambda m: "\n" + _inline_html_to_md(m.group(1)).strip() + "\n",
        body,
        flags=re.IGNORECASE,
    )

    # Strip nav and script blocks
    body = re.sub(r"<nav[\s\S]*?</nav>", "", body, flags=re.IGNORECASE)
    body = re.sub(r"<script[\s\S]*?</script>", "", body, flags=re.IGNORECASE)

    # Remaining tags — preserve <figure> blocks, strip everything else
    body = re.sub(
        r"<figure[\s\S]*?</figure>|<[^>]+>",
        lambda m: m.group(0) if m.group(0).startswith("<figure") else "",
        body,
    )

    # Collapse multiple blank lines
    body = re.sub(r"\n{3,}", "\n\n", body)

    return body.strip() + "\n"


# ── TOC + story-card post-processors ─────────────────────────────────────────

_TOC_RE = re.compile(r'<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)</h[23]>', re.IGNORECASE)
_H2_SPLIT_RE = re.compile(r'(<h2\b[^>]*>[\s\S]*?</h2>)', re.IGNORECASE)
_H3_SPLIT_RE = re.compile(r'(<h3\b[^>]*>[\s\S]*?</h3>)', re.IGNORECASE)
_STATUS_RE = re.compile(r'\b(pending|in.progress|done|completed|blocked|todo)\b', re.IGNORECASE)
_COMPLEXITY_RE = re.compile(r'\bcomplexity[\s:]+\**\s*(low|medium|high)\**', re.IGNORECASE)


def _build_toc(body_html: str) -> str:
    """Return sticky TOC nav HTML built from h2/h3 headings with id attrs."""
    entries = _TOC_RE.findall(body_html)
    if len(entries) < 2:
        return ""
    items: list[str] = []
    for level, hid, text in entries:
        css = ' class="toc-h3"' if level == "3" else ""
        items.append(f'<li{css}><a href="#{escape_html(hid)}">{escape_html(_strip_tags(text))}</a></li>')
    return '<nav class="toc-nav"><h4>Contents</h4><ol>' + "".join(items) + "</ol></nav>"


def _wrap_h3_details(html: str) -> str:
    """Wrap h3-level sections in <details open> collapsible elements."""
    parts = _H3_SPLIT_RE.split(html)
    if len(parts) <= 1:
        return html

    out = [parts[0]]
    pairs = list(zip(parts[1::2], parts[2::2]))

    for h3_tag, content in pairs:
        id_m = re.search(r'\bid="([^"]+)"', h3_tag)
        hid = id_m.group(1) if id_m else ""
        text = _strip_tags(h3_tag)
        id_attr = f' id="{escape_html(hid)}"' if hid else ""
        out.append(
            f"<details open>"
            f"<summary{id_attr}>{escape_html(text)}</summary>"
            f'<div class="details-body">{content}</div>'
            f"</details>"
        )

    return "".join(out)


def _inject_story_cards(body_html: str) -> str:
    """Wrap h2-level sections in story-card <section>s with status badges; wrap h3s in <details>."""
    parts = _H2_SPLIT_RE.split(body_html)
    if len(parts) <= 1:
        return body_html

    out = [parts[0]]
    pairs = list(zip(parts[1::2], parts[2::2]))

    for h2_tag, content in pairs:
        # Detect status keyword in content
        status_m = _STATUS_RE.search(content)
        status = ""
        if status_m:
            raw = status_m.group(1).lower()
            if re.match(r"in.progress", raw):
                status = "in-progress"
            elif raw in ("completed",):
                status = "done"
            else:
                status = raw

        badge_html = f'<span class="badge badge-{escape_html(status)}">{escape_html(status)}</span>' if status else ""
        h2_modified = re.sub(r"(</h2>)", badge_html + r"\1", h2_tag, count=1) if badge_html else h2_tag

        complexity_m = _COMPLEXITY_RE.search(content)
        complexity = complexity_m.group(1).lower() if complexity_m else ""
        card_cls = "story-card" + (f" complexity-{complexity}" if complexity else "")

        content_with_details = _wrap_h3_details(content)
        out.append(f'<section class="{card_cls}">{h2_modified}{content_with_details}</section>')

    return "".join(out)


# ── HTML document builder ─────────────────────────────────────────────────────


def build_html(title: str, body_html: str) -> str:
    has_mermaid = 'class="mermaid"' in body_html
    mermaid_script = get_mermaid_script(has_mermaid)

    toc = _build_toc(body_html)
    body_html = _inject_story_cards(body_html)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape_html(title)}</title>
  <style>{CSS}</style>
  {mermaid_script}
</head>
<body>
  <div class="page-wrap">
    {toc}
    <div class="content">
      {body_html}
    </div>
  </div>
</body>
</html>"""


# ── public API ────────────────────────────────────────────────────────────────


def generate_sidecar(markdown_path: str) -> Optional[str]:
    """Generate a .html sidecar for a markdown file.

    Non-blocking on failure: always returns; logs a warning and returns None on error.
    Returns the .html output path on success, None on failure.
    Emits the sidecar path (and the epic index path when applicable) to stdout.
    """
    try:
        from .index import auto_open_enabled, epic_docs_dir_for, generate_epic_index

        md_path = Path(markdown_path).resolve()
        html_path = md_path.with_suffix(".html")

        md = md_path.read_text(encoding="utf-8")
        title_match = re.search(r"^#\s+(.+)", md, re.MULTILINE)
        title = title_match.group(1) if title_match else md_path.stem

        body_html = markdown_to_html(md)
        html = build_html(title, body_html)

        html_path.write_text(html, encoding="utf-8")
        sys.stdout.write(str(html_path) + "\n")

        docs_dir = epic_docs_dir_for(html_path)
        if docs_dir is not None:
            index_path = generate_epic_index(docs_dir, auto_open=auto_open_enabled())
            if index_path:
                sys.stdout.write(index_path + "\n")

        return str(html_path)
    except Exception as err:
        sys.stderr.write(f"warning: html-sidecar-gen failed for {markdown_path}: {err}\n")
        return None


def generate_markdown_sidecar(html_path: str) -> Optional[str]:
    """Generate a .md sidecar from an HTML file (inverse direction — PRD use case).

    Non-blocking on failure: always returns; logs a warning and returns None on error.
    Returns the .md output path on success, None on failure.
    """
    try:
        h_path = Path(html_path).resolve()
        md_path = h_path.with_suffix(".md")

        html = h_path.read_text(encoding="utf-8")
        md = html_to_markdown(html)

        md_path.write_text(md, encoding="utf-8")
        return str(md_path)
    except Exception as err:
        sys.stderr.write(f"warning: html-sidecar-gen generateMarkdownSidecar failed for {html_path}: {err}\n")
        return None
