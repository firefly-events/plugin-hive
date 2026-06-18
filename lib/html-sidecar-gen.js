// Sidecar HTML generator: produces a .html sibling for a markdown file.
// Non-blocking on failure — caller always gets a resolved promise.
'use strict';

const fs = require('fs');
const path = require('path');

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.65;
    color: #1a1a1a;
    background: #fafafa;
    margin: 0;
    padding: 2rem;
  }
  .content {
    max-width: 800px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 2.5rem 3rem;
  }
  h1, h2, h3, h4 { margin-top: 2rem; margin-bottom: 0.5rem; font-weight: 600; }
  h1 { font-size: 1.75rem; border-bottom: 2px solid #e5e5e5; padding-bottom: 0.5rem; }
  h2 { font-size: 1.35rem; border-bottom: 1px solid #f0f0f0; padding-bottom: 0.25rem; }
  p { margin: 0.75rem 0; }
  pre { background: #f6f6f6; border: 1px solid #e0e0e0; border-radius: 4px; padding: 1rem; overflow-x: auto; }
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.875em; background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
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
`.trim();

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Minimal markdown → HTML converter covering the subset used in Hive docs.
// Not a full spec implementation — just enough for readable sidecar output.
function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Mermaid fenced code block
    if (/^```mermaid\s*$/.test(line)) {
      const mermaidLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        mermaidLines.push(lines[i]);
        i++;
      }
      out.push(`<div class="mermaid">\n${escapeHtml(mermaidLines.join('\n'))}\n</div>`);
      i++;
      continue;
    }

    // Generic fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      i++;
      continue;
    }

    // figure HTML block — pass through as-is
    if (/^<figure/.test(line)) {
      const figLines = [line];
      while (i + 1 < lines.length && !/^<\/figure>/.test(lines[i])) {
        i++;
        figLines.push(lines[i]);
        if (/^<\/figure>/.test(lines[i])) break;
      }
      // Re-emit the figure, resolving data-src to img if present
      const raw = figLines.join('\n');
      const srcMatch = raw.match(/data-src="([^"]+)"/);
      const altMatch = raw.match(/data-alt="([^"]+)"|data-placeholder="([^"]+)"/);
      const altText = altMatch ? (altMatch[1] || altMatch[2] || '') : '';
      if (srcMatch) {
        out.push(`<figure>\n  <img src="${escapeHtml(srcMatch[1])}" alt="${escapeHtml(altText)}">\n  <figcaption>${escapeHtml(altText)}</figcaption>\n</figure>`);
      } else {
        const placeholder = altMatch ? altMatch[2] : altText;
        out.push(`<figure data-placeholder="${escapeHtml(placeholder)}">\n  <figcaption>${escapeHtml(placeholder)}</figcaption>\n</figure>`);
      }
      i++;
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineMarkdown(hMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${qLines.map(inlineMarkdown).join('<br>')}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>\n${items.join('\n')}\n</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>\n${items.join('\n')}\n</ol>`);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^[#>`\-*+\d]/.test(lines[i]) && !/^```/.test(lines[i]) && !/^<figure/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${paraLines.map(inlineMarkdown).join(' ')}</p>`);
    } else {
      i++;
    }
  }

  return out.join('\n');
}

function inlineMarkdown(str) {
  // Bold
  str = str.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  str = str.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  str = str.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);
  // Links
  str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return str;
}

function buildHtml(title, bodyHtml) {
  const hasMermaid = bodyHtml.includes('class="mermaid"');
  const mermaidScript = hasMermaid
    ? `<script type="module">
      import mermaid from '${MERMAID_CDN}';
      mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
    </script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}</style>
  ${mermaidScript}
</head>
<body>
  <div class="content">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * Generate a .html sidecar for a markdown file.
 * Non-blocking on failure: always resolves; logs a warning and returns null on error.
 * @param {string} markdownPath - absolute or relative path to the .md file
 * @returns {Promise<string|null>} - resolves to the .html output path, or null on failure
 */
async function generateSidecar(markdownPath) {
  try {
    const mdPath = path.resolve(markdownPath);
    const htmlPath = mdPath.replace(/\.md$/, '.html');

    const md = fs.readFileSync(mdPath, 'utf8');
    const titleMatch = md.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1] : path.basename(mdPath, '.md');

    const bodyHtml = markdownToHtml(md);
    const html = buildHtml(title, bodyHtml);

    fs.writeFileSync(htmlPath, html, 'utf8');
    return htmlPath;
  } catch (err) {
    process.stderr.write(`warning: html-sidecar-gen failed for ${markdownPath}: ${err.message}\n`);
    return null;
  }
}

module.exports = { generateSidecar };

// CLI entry: node lib/html-sidecar-gen.js <path.md>
if (require.main === module) {
  const [, , mdPath] = process.argv;
  if (!mdPath) {
    process.stderr.write('Usage: html-sidecar-gen <path.md>\n');
    process.exit(1);
  }
  generateSidecar(mdPath)
    .then(out => process.stdout.write(out + '\n'))
    .catch(err => {
      process.stderr.write(`warning: sidecar generation failed: ${err.message}\n`);
      process.exit(0);
    });
}
