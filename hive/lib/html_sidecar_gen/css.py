"""CSS stylesheet constant for the HTML sidecar template."""

CSS = """
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.65;
    color: #1a1a1a;
    background: #f3f4f6;
    margin: 0;
    padding: 0;
  }
  .page-wrap {
    max-width: 1140px;
    margin: 0 auto;
    padding: 2rem;
    display: flex;
    gap: 2rem;
    align-items: flex-start;
  }
  .content {
    flex: 1;
    min-width: 0;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 2.5rem 3rem;
  }
  h1, h2, h3, h4 { margin-top: 2rem; margin-bottom: 0.5rem; font-weight: 600; }
  h1 { font-size: 1.75rem; border-bottom: 2px solid #e5e5e5; padding-bottom: 0.5rem; }
  h2 { font-size: 1.35rem; border-bottom: 1px solid #f0f0f0; padding-bottom: 0.25rem; }
  p { margin: 0.75rem 0; }
  pre {
    background: #f6f6f6;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 1rem;
    overflow-x: auto;
    font-size: 0.875em;
  }
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.875em; background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
  pre code { background: none; padding: 0; font-size: 1em; }
  blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding: 0.5rem 1rem; color: #555; }
  ul, ol { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  figure {
    margin: 1.5rem 0;
    padding: 1rem;
    border: 1px dashed #ccc;
    border-radius: 4px;
    background: #f9f9f9;
    text-align: center;
  }
  figure img { max-width: 100%; height: auto; border-radius: 3px; }
  figure figcaption { font-size: 0.85em; color: #666; margin-top: 0.5rem; }
  figure[data-placeholder]::before {
    content: attr(data-placeholder);
    display: block;
    font-style: italic;
    color: #888;
    padding: 2rem;
  }
  .mermaid { margin: 1.5rem 0; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 2rem 0; }
  a { color: #0066cc; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }

  /* ── Story cards ─────────────────────────────────────────── */
  .story-card {
    border: 1px solid #e0e7ef;
    border-radius: 8px;
    padding: 1.25rem 1.5rem 1rem;
    margin: 1.5rem 0;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.07);
  }
  .story-card > h2:first-child { margin-top: 0; }
  .complexity-low    { border-left: 4px solid #10b981; }
  .complexity-medium { border-left: 4px solid #f59e0b; }
  .complexity-high   { border-left: 4px solid #ef4444; }

  /* ── Status badges ───────────────────────────────────────── */
  .badge {
    display: inline-block;
    font-size: 0.7em;
    font-weight: 700;
    padding: 0.2em 0.65em;
    border-radius: 12px;
    vertical-align: middle;
    margin-left: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .badge-pending     { background: #fef3c7; color: #92400e; }
  .badge-in-progress { background: #dbeafe; color: #1e40af; }
  .badge-done        { background: #d1fae5; color: #065f46; }
  .badge-blocked     { background: #fee2e2; color: #991b1b; }
  .badge-todo        { background: #f3f4f6; color: #374151; }

  /* ── Collapsible details ─────────────────────────────────── */
  details {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    margin: 0.75rem 0;
    overflow: hidden;
  }
  details > summary {
    padding: 0.55rem 1rem;
    cursor: pointer;
    font-weight: 600;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #f9fafb;
  }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::before {
    content: '\25B6';
    font-size: 0.6em;
    transition: transform 0.15s;
    flex-shrink: 0;
    color: #9ca3af;
  }
  details[open] > summary::before { transform: rotate(90deg); }
  details[open] > summary { border-bottom: 1px solid #e5e7eb; }
  .details-body { padding: 0.75rem 1rem; }

  /* ── Sticky TOC ──────────────────────────────────────────── */
  .toc-nav {
    position: sticky;
    top: 1rem;
    width: 210px;
    flex-shrink: 0;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1rem;
    font-size: 0.82em;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    line-height: 1.45;
  }
  .toc-nav h4 {
    margin: 0 0 0.6rem;
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #6b7280;
  }
  .toc-nav ol { padding-left: 1rem; margin: 0; list-style: none; padding-left: 0; }
  .toc-nav li { margin: 0.25rem 0; }
  .toc-nav li.toc-h3 { padding-left: 0.9rem; }
  .toc-nav a { color: #374151; text-decoration: none; }
  .toc-nav a:hover { color: #0066cc; text-decoration: underline; }

  /* ── Syntax highlight ────────────────────────────────────── */
  .hl-k { color: #7c3aed; font-weight: 600; }
  .hl-s { color: #059669; }
  .hl-c { color: #9ca3af; font-style: italic; }
  .hl-n { color: #d97706; }

  /* ── Dark mode ───────────────────────────────────────────── */
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #0f172a; }
    .content { background: #1e293b; border-color: #334155; }
    h1 { border-bottom-color: #334155; }
    h2 { border-bottom-color: #263045; }
    pre { background: #0f172a; border-color: #334155; }
    code { background: #334155; color: #e2e8f0; }
    blockquote { border-color: #4b5563; color: #9ca3af; }
    th { background: #334155; }
    th, td { border-color: #4b5563; }
    figure { border-color: #4b5563; background: #0f172a; }
    figure figcaption { color: #9ca3af; }
    a { color: #60a5fa; }
    hr { border-color: #334155; }
    .story-card { background: #1e293b; border-color: #334155; box-shadow: none; }
    .toc-nav { background: #0f172a; border-color: #334155; }
    .toc-nav h4 { color: #9ca3af; }
    .toc-nav a { color: #d1d5db; }
    .toc-nav a:hover { color: #60a5fa; }
    details { border-color: #334155; }
    details > summary { background: #0f172a; }
    details[open] > summary { border-color: #334155; }
    .badge-pending     { background: #451a03; color: #fde68a; }
    .badge-in-progress { background: #1e3a5f; color: #93c5fd; }
    .badge-done        { background: #064e3b; color: #6ee7b7; }
    .badge-blocked     { background: #450a0a; color: #fca5a5; }
    .badge-todo        { background: #1e293b; color: #9ca3af; }
    .hl-k { color: #a78bfa; }
    .hl-s { color: #34d399; }
    .hl-c { color: #6b7280; }
    .hl-n { color: #fbbf24; }
  }

  /* ── Print ───────────────────────────────────────────────── */
  @media print {
    body { background: #fff; color: #000; }
    .page-wrap { display: block; padding: 0; max-width: 100%; }
    .toc-nav { display: none; }
    .content { border: none; box-shadow: none; border-radius: 0; padding: 0.5rem 0; }
    .story-card { box-shadow: none; break-inside: avoid; border: 1px solid #ccc; }
    details > :not(summary) { display: block !important; }
    details { border: none; }
    details > summary { background: none; border: none; cursor: default; }
    details > summary::before { display: none; }
    a { color: #000; text-decoration: underline; }
    pre { white-space: pre-wrap; word-break: break-word; }
  }
""".strip()
