# s5-1 Insights: PRD HTML-primary vehicle

## The inverse-direction sidecar is a strip, not a re-parse

`generateMarkdownSidecar` works by regex replacement on raw HTML — not by using a real
HTML parser. This is intentional and consistent with how `markdownToHtml` works in the
same file (also regex). The risk: deeply nested or malformed HTML produces garbled
markdown. The mitigation: PRD skill output is machine-generated from a known template, so
the HTML structure is predictable. If a human edits the HTML, sidecar quality degrades —
that's acceptable since neither file is hand-edited after generation.

## `<figure>` blocks pass through to .md unchanged

The regex in `htmlToMarkdown` deliberately skips `<figure>` and `</figure>` tags when
stripping remaining HTML. This means the raw `<figure data-placeholder="...">` block
appears verbatim in the `.md` sidecar. This is correct — the planning-format-contract
§5 and §6 define `data-placeholder` as the grep signal for unfilled wireframe slots. A
future agent grepping the `.md` sidecar for pending wireframes will find them.

## PRD skill is HTML-primary, not markdown-rendered-to-HTML

Other doc types write `.md` then call `generateSidecar` to produce `.html`. PRD inverts
this: write `.html` directly, then call `generateMarkdownSidecar` for the `.md`. This
means the PRD skill needs to produce valid HTML by construction — no intermediate
markdown pass. The Mermaid blocks go in as `<div class="mermaid">` in the HTML source,
not as ` ```mermaid ``` ` fences. The `.md` sidecar's `htmlToMarkdown` converts them
back to ` ```mermaid ``` ` fences for terminal readability.

## Branch conflict risk: both files committed for PRD

All other `.html` sidecar files are gitignored. PRD `.html` and `.md` are both committed.
If two agents dispatch concurrently on a PRD story, the push-rebase loop in the
integration contract handles it — but the PRD files are more likely to conflict than
other artifacts because both `.html` and `.md` change together. The story dispatch
parallel-dispatch gate should treat PRD as a single-agent deliverable.
