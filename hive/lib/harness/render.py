"""Render report.json (from s3 collect.py) into visual artifacts.

The render side turns the normalized report dict into (1) a self-contained
HTML dashboard (stat cards, agent-flow diagram, before/after file-tree view)
and (2) standalone exports — one mermaid ``.md`` per diagram plus a stat
block — ready to compile into a video.

Self-contained means self-contained: no external CDN, font, script, or
fetch. The flow diagram is emitted as inline fenced ``mermaid`` text (per
``hive/references/planning-format-contract.md`` accTitle/accDescr + legend
conventions) alongside a static HTML/CSS fallback, since there is no live
mermaid.js runtime available in the dashboard.

Every section degrades cleanly on the real zero-state collect.py produces
(no epic, no events, no snapshots yet): zero stat cards render "0", not
NaN or blank, and a missing file-tree snapshot pair renders a placeholder
instead of crashing.

Stdlib-first: only ``json``/``argparse``/``html``/``pathlib`` are used.

CLI:
    python3 -m hive.lib.harness.render --report report.json
    python3 -m hive.lib.harness.render --deliverable design-system
"""

from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path
from typing import Any

from hive.lib.config import resolve_state_dir
from hive.lib.harness.collect import collect_report


def _ms_to_human(ms: Any) -> str:
    """Render a millisecond duration as a human string; 0/None -> '0s'."""
    try:
        total_seconds = max(0, float(ms)) / 1000.0
    except (TypeError, ValueError):
        total_seconds = 0.0
    if total_seconds < 60:
        return f"{total_seconds:.1f}s".replace(".0s", "s")
    minutes, seconds = divmod(int(round(total_seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {seconds}s"
    return f"{seconds}s"


def _int(value: Any) -> int:
    """Coerce a numeric report field to int for display; non-numeric -> 0."""
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _flow_mermaid(deliverable: str, flow: list[dict[str, Any]]) -> str:
    """Fenced ```mermaid`` text for the agent/skill flow, accTitle/accDescr'd."""
    lines = [
        "```mermaid",
        "graph TD",
        f"accTitle: {deliverable} Agent Flow",
        "accDescr: Agents and steps that ran for this deliverable",
    ]
    if not flow:
        lines.append('  EMPTY["no steps yet"]')
    else:
        for step in flow:
            step_id = step.get("step") or "unknown"
            node_label = step_id
            agents = step.get("agents") or []
            if agents:
                personas = ", ".join(
                    a.get("persona") or "?" for a in agents if isinstance(a, dict)
                )
                node_label = f"{step_id} ({personas})"
            lines.append(f'  {step_id}["{node_label}"]')
            for dep in step.get("depends_on") or []:
                lines.append(f"  {dep} --> {step_id}")
    lines.append("```")
    lines.append("")
    lines.append("‖ = parallel to its peers")
    return "\n".join(lines)


def _flow_fallback_html(flow: list[dict[str, Any]]) -> str:
    """Static HTML/CSS node list fallback for the flow diagram (no mermaid runtime)."""
    if not flow:
        return '<p class="empty-state">No steps yet.</p>'
    items = []
    for step in flow:
        step_id = _esc(step.get("step") or "unknown")
        deps = step.get("depends_on") or []
        agents = step.get("agents") or []
        deps_str = ", ".join(_esc(d) for d in deps) if deps else "none"
        if agents:
            agents_str = ", ".join(
                _esc(a.get("persona") or "?") for a in agents if isinstance(a, dict)
            )
        else:
            agents_str = "(no episode yet)"
        items.append(
            "<li class=\"flow-node\">"
            f"<span class=\"flow-step\">{step_id}</span>"
            f"<span class=\"flow-deps\">depends on: {deps_str}</span>"
            f"<span class=\"flow-agents\">agents: {agents_str}</span>"
            "</li>"
        )
    return '<ol class="flow-list">' + "".join(items) + "</ol>"


def _file_tree_mermaid(deliverable: str, files: dict[str, Any] | None) -> str:
    """Fenced ```mermaid`` text for the before/after file-tree counts."""
    lines = [
        "```mermaid",
        "graph LR",
        f"accTitle: {deliverable} File Tree Delta",
        "accDescr: Before/after tracked-file counts by top-level directory",
    ]
    if not files:
        lines.append('  EMPTY["no snapshot pair captured yet"]')
    else:
        counts = files.get("counts") or {}
        if not counts:
            lines.append('  EMPTY["no tracked files"]')
        else:
            for dirname, count in counts.items():
                node_id = "".join(ch if ch.isalnum() else "_" for ch in str(dirname)) or "root"
                lines.append(f'  {node_id}["{dirname}: {count} files"]')
    lines.append("```")
    return "\n".join(lines)


def _file_tree_html(files: dict[str, Any] | None) -> str:
    """Static before/after file-tree view: a dir -> count table, or a placeholder."""
    if not files:
        return '<p class="empty-state">No snapshot pair captured yet.</p>'
    counts = files.get("counts") or {}
    added = files.get("added") or []
    rows = "".join(
        f"<tr><td>{_esc(dirname)}</td><td>{_esc(count)}</td></tr>"
        for dirname, count in counts.items()
    ) or '<tr><td colspan="2">no tracked files</td></tr>'
    added_html = (
        "<ul class=\"files-added\">"
        + "".join(f"<li>{_esc(path)}</li>" for path in added)
        + "</ul>"
        if added
        else '<p class="empty-state">no files added</p>'
    )
    before_sha = _esc(files.get("before_sha") or "?")
    after_sha = _esc(files.get("after_sha") or "?")
    return (
        f'<p class="shas">{before_sha[:12]} &rarr; {after_sha[:12]}</p>'
        f'<table class="file-tree"><thead><tr><th>dir</th><th>files</th></tr>'
        f"</thead><tbody>{rows}</tbody></table>"
        f"<h4>files added</h4>{added_html}"
    )


_CSS = """
:root { color-scheme: light dark; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  margin: 0; padding: 2rem; background: #0f1115; color: #e6e8eb; }
h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
.subtitle { color: #9aa3ad; margin-top: 0; margin-bottom: 1.5rem; }
.stat-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem; }
.stat-card { background: #1a1d24; border: 1px solid #2a2e37; border-radius: 8px;
  padding: 1rem 1.25rem; min-width: 160px; flex: 1; }
.stat-card .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: #9aa3ad; margin-bottom: 0.4rem; }
.stat-card .value { font-size: 1.6rem; font-weight: 600; }
section { margin-bottom: 2rem; }
section h2 { font-size: 1.05rem; border-bottom: 1px solid #2a2e37; padding-bottom: 0.4rem; }
.flow-list { list-style: none; padding: 0; margin: 0; }
.flow-node { background: #1a1d24; border: 1px solid #2a2e37; border-radius: 6px;
  padding: 0.6rem 0.9rem; margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.15rem; }
.flow-step { font-weight: 600; }
.flow-deps, .flow-agents { font-size: 0.8rem; color: #9aa3ad; }
table.file-tree { border-collapse: collapse; width: 100%; max-width: 420px; }
table.file-tree th, table.file-tree td { text-align: left; padding: 0.3rem 0.6rem;
  border-bottom: 1px solid #2a2e37; }
.files-added { max-height: 200px; overflow-y: auto; font-size: 0.85rem; }
.empty-state { color: #9aa3ad; font-style: italic; }
.shas { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #9aa3ad; }
pre.mermaid-source { background: #1a1d24; border: 1px solid #2a2e37; border-radius: 6px;
  padding: 0.75rem 1rem; overflow-x: auto; font-size: 0.8rem; }
"""


def render_html(report: dict[str, Any]) -> str:
    """Render ``report`` into a self-contained HTML body fragment.

    No <head>/<html> wrapper is required by the Artifact tool per the s4
    acceptance criteria; a <style> block is included inline so the fragment
    stands alone when embedded.
    """
    deliverable = report.get("deliverable") or "unknown"
    wall_ms = report.get("wall_ms_total")
    gate_ms = report.get("human_gate_ms_total")
    gate_count = _int(report.get("gate_count"))
    tokens = report.get("tokens") or {}
    token_total = _int(tokens.get("total"))
    token_input = _int(tokens.get("input"))
    token_output = _int(tokens.get("output"))
    flow = report.get("flow") or []
    files = report.get("files")

    flow_mermaid = _flow_mermaid(deliverable, flow)
    tree_mermaid = _file_tree_mermaid(deliverable, files)

    return f"""<style>{_CSS}</style>
<div class="harness-dashboard">
  <h1>{_esc(deliverable)} — metric capture harness</h1>
  <p class="subtitle">generated report dashboard</p>

  <div class="stat-row">
    <div class="stat-card">
      <div class="label">Wall time</div>
      <div class="value">{_esc(_ms_to_human(wall_ms))}</div>
    </div>
    <div class="stat-card">
      <div class="label">Human gate time</div>
      <div class="value">{_esc(_ms_to_human(gate_ms))}</div>
      <div class="flow-deps">{gate_count} gate{'s' if gate_count != 1 else ''}</div>
    </div>
    <div class="stat-card">
      <div class="label">Token cost</div>
      <div class="value">{token_total}</div>
      <div class="flow-deps">in {token_input} / out {token_output}</div>
    </div>
  </div>

  <section>
    <h2>Agent flow</h2>
    {_flow_fallback_html(flow)}
    <details><summary>mermaid source</summary><pre class="mermaid-source">{_esc(flow_mermaid)}</pre></details>
  </section>

  <section>
    <h2>File tree (before / after)</h2>
    {_file_tree_html(files)}
    <details><summary>mermaid source</summary><pre class="mermaid-source">{_esc(tree_mermaid)}</pre></details>
  </section>
</div>
"""


def _stat_block(report: dict[str, Any]) -> str:
    deliverable = report.get("deliverable") or "unknown"
    tokens = report.get("tokens") or {}
    lines = [
        f"# {deliverable} — stats",
        "",
        f"- wall time: {_ms_to_human(report.get('wall_ms_total'))}",
        f"- human gate time: {_ms_to_human(report.get('human_gate_ms_total'))} "
        f"({_int(report.get('gate_count'))} gates)",
        f"- tokens: total {_int(tokens.get('total'))} "
        f"(input {_int(tokens.get('input'))}, output {_int(tokens.get('output'))}, "
        f"cache_read {_int(tokens.get('cache_read'))}, "
        f"cache_creation {_int(tokens.get('cache_creation'))})",
    ]
    return "\n".join(lines) + "\n"


def exports_dir(deliverable: str, repo: Path) -> Path:
    """Resolve ``<state-dir>/harness/exports/<deliverable>``, mirroring snapshot.py."""
    state_dir = resolve_state_dir(cwd=repo, env=os.environ)
    return Path(state_dir) / "harness" / "exports" / deliverable


def write_exports(
    report: dict[str, Any], repo: Path, out_dir: Path | None = None
) -> dict[str, Path]:
    """Write standalone mermaid/.md exports for ``report``; return path map.

    ``out_dir`` overrides the default ``<state-dir>/harness/exports/<deliverable>``
    location — callers that must not write into Hive state (e.g. the /metrics
    command, which is read-only) pass a caller-owned artifact directory instead.
    """
    deliverable = report.get("deliverable") or "unknown"
    out_dir = out_dir if out_dir is not None else exports_dir(deliverable, repo)
    out_dir.mkdir(parents=True, exist_ok=True)

    flow_path = out_dir / "flow.mermaid.md"
    tree_path = out_dir / "file-tree.mermaid.md"
    stats_path = out_dir / "stats.md"

    flow_path.write_text(_flow_mermaid(deliverable, report.get("flow") or []) + "\n", encoding="utf-8")
    tree_path.write_text(_file_tree_mermaid(deliverable, report.get("files")) + "\n", encoding="utf-8")
    stats_path.write_text(_stat_block(report), encoding="utf-8")

    return {"flow": flow_path, "file_tree": tree_path, "stats": stats_path}


def render(
    report: dict[str, Any],
    repo: Path,
    out_html: Path | None = None,
    exports_dir: Path | None = None,
) -> dict[str, Any]:
    """Render the HTML dashboard + write standalone exports; return a summary dict.

    ``exports_dir`` overrides the default state-dir export location — see
    ``write_exports``.
    """
    html_body = render_html(report)
    if out_html is not None:
        out_html.parent.mkdir(parents=True, exist_ok=True)
        out_html.write_text(html_body, encoding="utf-8")
    export_paths = write_exports(report, repo, exports_dir)
    return {"html": html_body, "exports": export_paths}


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", default=None, help="path to an existing report.json")
    parser.add_argument("--deliverable", default=None, help="epic/deliverable id (collects live if --report omitted)")
    parser.add_argument("--repo", default=None, help="repo root (default: cwd)")
    parser.add_argument("--out-html", default=None, help="output path for the dashboard HTML fragment")
    parser.add_argument("--exports-dir", default=None, help="override the exports output directory")
    args = parser.parse_args(argv)

    if not args.report and not args.deliverable:
        parser.error("one of --report or --deliverable is required")

    repo = Path(args.repo).resolve() if args.repo else Path.cwd()

    if args.report:
        report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    else:
        report = collect_report(args.deliverable, repo)

    out_html = Path(args.out_html) if args.out_html else None

    if args.exports_dir:
        html_body = render_html(report)
        if out_html is not None:
            out_html.parent.mkdir(parents=True, exist_ok=True)
            out_html.write_text(html_body, encoding="utf-8")
        out_dir = Path(args.exports_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        deliverable = report.get("deliverable") or "unknown"
        (out_dir / "flow.mermaid.md").write_text(
            _flow_mermaid(deliverable, report.get("flow") or []) + "\n", encoding="utf-8"
        )
        (out_dir / "file-tree.mermaid.md").write_text(
            _file_tree_mermaid(deliverable, report.get("files")) + "\n", encoding="utf-8"
        )
        (out_dir / "stats.md").write_text(_stat_block(report), encoding="utf-8")
        print(f"exports -> {out_dir}")
    else:
        result = render(report, repo, out_html)
        for name, path in result["exports"].items():
            print(f"{name} -> {path}")

    if out_html:
        print(f"dashboard -> {out_html}")

    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
