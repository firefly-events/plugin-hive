"""Parity and unit tests for hive.lib.html_sidecar_gen.

The parity test drives the Node JS engine (lib/html-sidecar-gen.js) and the
Python engine on the same fixed markdown fixture and asserts byte-identical
HTML output. The JS parity test is skipped if Node is not available in CI.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from hive.lib.html_sidecar_gen import (
    build_html,
    escape_html,
    generate_markdown_sidecar,
    generate_sidecar,
    html_to_markdown,
    markdown_to_html,
    sanitize_url,
)
from hive.lib.html_sidecar_gen.diagrams import mermaid_fence_to_figure

# Fixed markdown fixture — must stay stable across JS and Python runs.
FIXTURE_MD = """\
# Parity Fixture

A simple paragraph with **bold**, *italic*, and `inline code`.

## Section Two

Here is a list:

- Item alpha
- Item beta with a [link](https://example.com)

Ordered:

1. First
2. Second

> A blockquote line

```python
def hello():
    return "world"
```

A table:

| Name | Value |
| --- | --- |
| foo | bar |

---

End of fixture.
"""


class TestEscapeHtml(unittest.TestCase):
    def test_all_entities(self) -> None:
        self.assertEqual(escape_html('& < > "'), "&amp; &lt; &gt; &quot;")

    def test_no_change(self) -> None:
        self.assertEqual(escape_html("hello world"), "hello world")


class TestSanitizeUrl(unittest.TestCase):
    def test_https_passthrough(self) -> None:
        self.assertEqual(sanitize_url("https://example.com"), "https://example.com")

    def test_relative_passthrough(self) -> None:
        self.assertEqual(sanitize_url("./foo.md"), "./foo.md")

    def test_anchor_passthrough(self) -> None:
        self.assertEqual(sanitize_url("#section"), "#section")

    def test_javascript_blocked(self) -> None:
        self.assertEqual(sanitize_url("javascript:alert(1)"), "#")

    def test_data_blocked(self) -> None:
        self.assertEqual(sanitize_url("data:text/html,<h1>x</h1>"), "#")

    def test_mailto_passthrough(self) -> None:
        self.assertEqual(sanitize_url("mailto:a@b.com"), "mailto:a@b.com")


class TestMarkdownToHtml(unittest.TestCase):
    def test_heading(self) -> None:
        result = markdown_to_html("# Hello World")
        self.assertIn('<h1 id="hello-world">', result)
        self.assertIn("Hello World", result)

    def test_paragraph(self) -> None:
        result = markdown_to_html("Simple paragraph.")
        self.assertEqual(result, "<p>Simple paragraph.</p>")

    def test_bold(self) -> None:
        result = markdown_to_html("**bold text**")
        self.assertIn("<strong>bold text</strong>", result)

    def test_italic(self) -> None:
        result = markdown_to_html("*italic text*")
        self.assertIn("<em>italic text</em>", result)

    def test_inline_code(self) -> None:
        result = markdown_to_html("`code here`")
        self.assertIn("<code>code here</code>", result)

    def test_link(self) -> None:
        result = markdown_to_html("[example](https://example.com)")
        self.assertIn('<a href="https://example.com">example</a>', result)

    def test_fenced_code_block(self) -> None:
        md = "```python\nprint('hi')\n```"
        result = markdown_to_html(md)
        self.assertIn('<pre><code class="language-python">', result)
        # String literals are wrapped in hl-s spans by build-time highlighter
        self.assertIn('<span class="hl-s">', result)
        self.assertIn("print", result)

    def test_mermaid_block(self) -> None:
        md = "```mermaid\ngraph TD\n  A --> B\n```"
        result = markdown_to_html(md)
        self.assertIn("graph TD", result)
        # mmdc pre-renders to inline SVG; without mmdc falls back to mermaid-fallback pre block
        self.assertTrue("<svg" in result or 'class="mermaid-fallback"' in result)
        self.assertNotIn("cdn.jsdelivr.net", result)

    def test_mermaid_wrapped_in_figure(self) -> None:
        md = "```mermaid\ngraph TD\n  A --> B\n```"
        result = markdown_to_html(md)
        self.assertIn('<figure class="diagram">', result)
        self.assertIn("<figcaption>", result)

    def test_mermaid_figure_title_from_heading(self) -> None:
        md = "## Dependency Map\n\n```mermaid\ngraph TD\n  A --> B\n```"
        result = markdown_to_html(md)
        self.assertIn('<span class="diagram-title">Dependency Map</span>', result)

    def test_mermaid_figure_no_title_without_heading(self) -> None:
        md = "```mermaid\ngraph TD\n  A --> B\n```"
        result = markdown_to_html(md)
        self.assertNotIn('class="diagram-title"', result)

    def test_mermaid_parallel_legend_present(self) -> None:
        md = '```mermaid\ngraph TD\n  A["story-a ‖ variation"] --> B\n```'
        result = markdown_to_html(md)
        self.assertIn('<span class="diagram-legend">', result)
        self.assertIn("parallel to its peers", result)

    def test_mermaid_parallel_legend_absent_without_marker(self) -> None:
        md = "```mermaid\ngraph TD\n  A --> B\n```"
        result = markdown_to_html(md)
        self.assertNotIn('class="diagram-legend"', result)

    def test_unordered_list(self) -> None:
        md = "- alpha\n- beta"
        result = markdown_to_html(md)
        self.assertIn("<ul>", result)
        self.assertIn("<li>alpha</li>", result)
        self.assertIn("<li>beta</li>", result)

    def test_ordered_list(self) -> None:
        md = "1. first\n2. second"
        result = markdown_to_html(md)
        self.assertIn("<ol>", result)
        self.assertIn("<li>first</li>", result)

    def test_blockquote(self) -> None:
        md = "> quoted text"
        result = markdown_to_html(md)
        self.assertIn("<blockquote>", result)
        self.assertIn("quoted text", result)

    def test_horizontal_rule(self) -> None:
        result = markdown_to_html("---")
        self.assertEqual(result, "<hr>")

    def test_html_injection_escaped(self) -> None:
        result = markdown_to_html("<script>alert(1)</script>")
        self.assertNotIn("<script>", result)

    def test_figure_with_src(self) -> None:
        md = '<figure src="img.png" data-alt="A caption">\n</figure>'
        result = markdown_to_html(md)
        self.assertIn('<img src="img.png"', result)
        self.assertIn("A caption", result)

    def test_figure_placeholder(self) -> None:
        md = '<figure data-placeholder="Diagram placeholder">\n</figure>'
        result = markdown_to_html(md)
        self.assertIn('data-placeholder="Diagram placeholder"', result)


class TestBuildHtml(unittest.TestCase):
    def test_no_mermaid_script_when_absent(self) -> None:
        html = build_html("Test", "<p>hello</p>")
        # CSS contains ".mermaid" class — check the script tag specifically
        self.assertNotIn("startOnLoad", html)

    def test_mermaid_no_cdn_script(self) -> None:
        # Mermaid is pre-rendered to inline SVG; no CDN script tag should appear
        html = build_html("Test", '<div class="mermaid">graph TD\n  A --> B\n</div>')
        self.assertIn("mermaid", html)
        self.assertNotIn("startOnLoad", html)
        self.assertNotIn("cdn.jsdelivr.net", html)

    def test_title_escaped(self) -> None:
        html = build_html('<script>bad</script>', "<p>body</p>")
        self.assertIn("&lt;script&gt;bad&lt;/script&gt;", html)


class TestHtmlToMarkdown(unittest.TestCase):
    def test_round_trip_heading(self) -> None:
        html = build_html("Title", markdown_to_html("# Hello\n\nParagraph text."))
        md = html_to_markdown(html)
        self.assertIn("# Hello", md)
        self.assertIn("Paragraph text.", md)

    def test_strips_script(self) -> None:
        html = build_html("T", '<p>body</p><script>evil()</script>')
        md = html_to_markdown(html)
        self.assertNotIn("evil()", md)


class TestGenerateSidecar(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_generates_html_file(self) -> None:
        md_path = Path(self.tmp.name) / "test.md"
        md_path.write_text(FIXTURE_MD, encoding="utf-8")
        result = generate_sidecar(str(md_path))
        self.assertIsNotNone(result)
        html_path = Path(result)
        self.assertTrue(html_path.exists())
        content = html_path.read_text(encoding="utf-8")
        self.assertIn("<!DOCTYPE html>", content)
        self.assertIn("Parity Fixture", content)

    def test_returns_none_on_missing_file(self) -> None:
        result = generate_sidecar("/nonexistent/path/file.md")
        self.assertIsNone(result)


class TestGenerateMarkdownSidecar(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_generates_md_from_html(self) -> None:
        md_path = Path(self.tmp.name) / "doc.md"
        md_path.write_text("# Hello\n\nSome text.\n", encoding="utf-8")
        html_result = generate_sidecar(str(md_path))
        self.assertIsNotNone(html_result)
        md_result = generate_markdown_sidecar(html_result)
        self.assertIsNotNone(md_result)
        md_out = Path(md_result).read_text(encoding="utf-8")
        self.assertIn("Hello", md_out)
        self.assertIn("Some text.", md_out)

    def test_returns_none_on_missing_file(self) -> None:
        result = generate_markdown_sidecar("/nonexistent/path/file.html")
        self.assertIsNone(result)


# Byte-stable golden for the parity-critical core (markdown_to_html). The legacy JS
# generator was deleted in the cutover, so "parity vs JS" can no longer run; this
# frozen golden is the regression guard in its place — any change to the markdown→HTML
# structure (CSS/scaffolding excluded) must update this expectation deliberately.
# Mermaid is intentionally excluded so the golden does not depend on mmdc availability.
_GOLDEN_CORE_MD = """# Title

Intro **bold** and *italic* and `code`.

## Section

- one
- two

1. first
2. second

> a quote

| Name | Value |
| --- | --- |
| foo | bar |

```python
def f():
    return 1
```

A [link](https://example.com) and a bad [x](javascript:alert(1)).
"""

_GOLDEN_CORE_HTML = (
    '<h1 id="title">Title</h1>\n'
    '<p>Intro <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p>\n'
    '<h2 id="section">Section</h2>\n'
    '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n'
    '<ol>\n<li>first</li>\n<li>second</li>\n</ol>\n'
    '<blockquote><p>a quote</p></blockquote>\n'
    '<p>| Name | Value | | --- | --- | | foo | bar |</p>\n'
    '<pre><code class="language-python"><span class="hl-k">def</span> f():\n'
    '    <span class="hl-k">return</span> <span class="hl-n">1</span></code></pre>\n'
    '<p>A <a href="https://example.com">link</a> and a bad <a href="#">x</a>).</p>'
)


class TestByteStableCore(unittest.TestCase):
    """Frozen-golden regression guard for the markdown→HTML core (replaces the
    now-unrunnable JS parity test). Also pins that javascript: links are neutralized."""

    def test_markdown_to_html_matches_golden(self) -> None:
        out = markdown_to_html(_GOLDEN_CORE_MD)
        self.assertEqual(
            out,
            _GOLDEN_CORE_HTML,
            "markdown_to_html output drifted from the frozen golden — update "
            "_GOLDEN_CORE_HTML deliberately if this change is intended.",
        )

    def test_deterministic(self) -> None:
        self.assertEqual(markdown_to_html(_GOLDEN_CORE_MD), markdown_to_html(_GOLDEN_CORE_MD))

    def test_javascript_link_neutralized(self) -> None:
        self.assertIn('<a href="#">x</a>', markdown_to_html(_GOLDEN_CORE_MD))


class TestSvgSanitize(unittest.TestCase):
    """mmdc SVG is inlined into a file:// page, so active content must be stripped."""

    def test_strips_active_content(self) -> None:
        from hive.lib.html_sidecar_gen.diagrams import _sanitize_svg

        dirty = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            '<script>alert(1)</script>'
            '<a xlink:href="javascript:alert(2)" onclick="steal()">t</a>'
            '<foreignObject><b onmouseover="x()">hi</b></foreignObject>'
            '<rect width="10" height="10"/></svg>'
        )
        clean = _sanitize_svg(dirty)
        self.assertNotIn("<script", clean)
        self.assertNotIn("onclick", clean)
        self.assertNotIn("onmouseover", clean)
        self.assertNotIn("javascript:", clean)
        self.assertNotIn("<foreignObject", clean)
        # benign geometry survives
        self.assertIn("<rect", clean)


class TestGenerateEpicIndex(unittest.TestCase):
    """Tests for generate_epic_index: index.html generation, badges, offline links."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # Build a fake .pHive/epics/{id}/docs/ directory tree
        self.epic_id = "test-epic"
        self.docs_dir = (
            Path(self.tmp.name) / ".pHive" / "epics" / self.epic_id / "docs"
        )
        self.docs_dir.mkdir(parents=True)
        self.epic_dir = self.docs_dir.parent

    def _write_sidecar(self, name: str) -> Path:
        p = self.docs_dir / f"{name}.html"
        p.write_text(f"<html><body>{name}</body></html>", encoding="utf-8")
        return p

    def _write_story_yaml(self, name: str, status: str) -> Path:
        stories = self.epic_dir / "stories"
        stories.mkdir(exist_ok=True)
        p = stories / f"{name}.yaml"
        p.write_text(f"id: {name}\nstatus: {status}\n", encoding="utf-8")
        return p

    def test_index_created_with_links(self) -> None:
        from hive.lib.html_sidecar_gen import generate_epic_index

        self._write_sidecar("story-a")
        self._write_sidecar("story-b")
        result = generate_epic_index(self.docs_dir)
        self.assertIsNotNone(result)
        index_path = Path(result)
        self.assertTrue(index_path.exists())
        content = index_path.read_text(encoding="utf-8")
        self.assertIn('href="story-a.html"', content)
        self.assertIn('href="story-b.html"', content)

    def test_index_has_status_badges(self) -> None:
        from hive.lib.html_sidecar_gen import generate_epic_index

        self._write_sidecar("story-a")
        self._write_story_yaml("story-a", "done")
        result = generate_epic_index(self.docs_dir)
        content = Path(result).read_text(encoding="utf-8")
        self.assertIn('class="badge"', content)
        self.assertIn("done", content)

    def test_index_no_network_requests(self) -> None:
        """Index must contain no http/https src or href — offline-safe."""
        from hive.lib.html_sidecar_gen import generate_epic_index

        self._write_sidecar("story-a")
        result = generate_epic_index(self.docs_dir)
        content = Path(result).read_text(encoding="utf-8")
        # No external URLs in href/src attributes
        import re
        external = re.findall(r'(?:href|src)="https?://', content)
        self.assertEqual(external, [], f"External URLs found: {external}")

    def test_index_excludes_itself(self) -> None:
        """index.html must not link to itself."""
        from hive.lib.html_sidecar_gen import generate_epic_index

        self._write_sidecar("story-a")
        result = generate_epic_index(self.docs_dir)
        content = Path(result).read_text(encoding="utf-8")
        self.assertNotIn('href="index.html"', content)

    def test_index_empty_state(self) -> None:
        """Empty docs dir produces a valid index with empty-state message."""
        from hive.lib.html_sidecar_gen import generate_epic_index

        result = generate_epic_index(self.docs_dir)
        self.assertIsNotNone(result)
        content = Path(result).read_text(encoding="utf-8")
        self.assertIn("<!DOCTYPE html>", content)
        self.assertIn("No doc sidecars", content)

    def test_index_regenerates_on_call(self) -> None:
        """Calling generate_epic_index twice reflects newly added sidecar."""
        from hive.lib.html_sidecar_gen import generate_epic_index

        self._write_sidecar("story-a")
        generate_epic_index(self.docs_dir)
        self._write_sidecar("story-b")
        result = generate_epic_index(self.docs_dir)
        content = Path(result).read_text(encoding="utf-8")
        self.assertIn('href="story-b.html"', content)

    def test_generate_sidecar_in_epic_docs_emits_index(self) -> None:
        """generate_sidecar inside epic docs dir triggers index generation and prints both paths."""
        import io

        md_path = self.docs_dir / "story-a.md"
        md_path.write_text("# Story A\n\nContent.\n", encoding="utf-8")

        captured = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = captured
        try:
            result = generate_sidecar(str(md_path))
        finally:
            sys.stdout = old_stdout

        self.assertIsNotNone(result)
        output = captured.getvalue()
        lines = [l for l in output.splitlines() if l.strip()]
        self.assertEqual(len(lines), 2, f"Expected 2 paths on stdout, got: {lines}")
        self.assertTrue(lines[0].endswith(".html"))
        self.assertTrue(lines[1].endswith("index.html"))

    def test_generate_sidecar_outside_epic_docs_no_index(self) -> None:
        """generate_sidecar outside epic docs dir emits only the sidecar path."""
        import io

        md_path = Path(self.tmp.name) / "plain.md"
        md_path.write_text("# Plain\n\nContent.\n", encoding="utf-8")

        captured = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = captured
        try:
            generate_sidecar(str(md_path))
        finally:
            sys.stdout = old_stdout

        lines = [l for l in captured.getvalue().splitlines() if l.strip()]
        self.assertEqual(len(lines), 1, f"Expected only sidecar path, got: {lines}")

    def test_auto_open_off_by_default(self) -> None:
        """HIVE_SIDECAR_AUTO_OPEN unset → auto_open_enabled() returns False."""
        from hive.lib.html_sidecar_gen.index import auto_open_enabled

        env_backup = os.environ.pop("HIVE_SIDECAR_AUTO_OPEN", None)
        try:
            self.assertFalse(auto_open_enabled())
        finally:
            if env_backup is not None:
                os.environ["HIVE_SIDECAR_AUTO_OPEN"] = env_backup

    def test_auto_open_opt_in(self) -> None:
        """HIVE_SIDECAR_AUTO_OPEN=1 → auto_open_enabled() returns True."""
        from hive.lib.html_sidecar_gen.index import auto_open_enabled

        os.environ["HIVE_SIDECAR_AUTO_OPEN"] = "1"
        try:
            self.assertTrue(auto_open_enabled())
        finally:
            del os.environ["HIVE_SIDECAR_AUTO_OPEN"]


if __name__ == "__main__":
    unittest.main()
