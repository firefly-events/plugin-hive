/**
 * External research subproviders for step-02b.
 *
 * Each provider returns:
 *   { candidates: Array<ExternalCandidate>, error: string|null }
 *
 * On fetch/parse failure the provider returns an empty candidates list and a
 * non-null error string — it never throws. This satisfies the step-02b
 * guaranteed-output contract: callers always receive a usable candidates array.
 */

'use strict';

// ---------------------------------------------------------------------------
// Actionability filter keywords — heuristic for "Hive-relevant capability shift"
// ---------------------------------------------------------------------------

const ACTIONABILITY_KEYWORDS = [
  // New primitives / workflow concepts
  'workflow',
  'routine',
  'routines',
  'agent',
  'agents',
  'subagent',
  'hooks',
  '/code-review',
  'code-review',
  'permissions',
  'mcp',
  'tool use',
  'tool_use',
  'parallel',
  'memory',
  'compact',
  'compaction',
  // Renamed or promoted commands
  'rename',
  'promoted',
  // Major capability words
  'new command',
  'new skill',
  'new feature',
  'now supports',
  'introducing',
];

/**
 * Returns true if a release looks hive-actionable (new capability / primitive).
 * Bug-fix-only releases are excluded. Heuristic; false-positives acceptable since
 * step-03 performs a second ranking pass.
 */
function isHiveActionable(release) {
  const text = [
    release.name || '',
    release.tag_name || '',
    release.body || '',
  ]
    .join(' ')
    .toLowerCase();

  // Explicit skip signals
  if (/^\s*(patch|hotfix|bug\s*fix)\b/i.test(release.name || '')) return false;

  return ACTIONABILITY_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Map a raw GH release object → ExternalCandidate shape expected by step-03.
 */
function releaseToCandidate(release) {
  const tagName = release.tag_name || 'unknown';
  const title = release.name || tagName;
  const publishedAt = release.published_at || release.created_at || null;
  const url = release.html_url || `https://github.com/anthropics/claude-code/releases/tag/${tagName}`;

  return {
    id: `external-proposal-cc-release-${tagName}`,
    title: `Claude Code ${tagName}: ${title}`,
    discovery_source: 'external_research',
    signal_subtype: 'claude_code_release',
    source_url: url,
    published_at: publishedAt,
    impact_score: null,
    risk_score: null,
    effort_score: null,
    priority_score: null,
    charter_objective: 'tooling',
    rationale: `Claude Code release ${tagName} published on ${publishedAt}. Review for Hive-actionable capability changes.`,
    raw_body_excerpt: typeof release.body === 'string'
      ? release.body.slice(0, 500)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Public: fetchClaudeCodeReleases
// ---------------------------------------------------------------------------

const GH_RELEASES_URL = 'https://api.github.com/repos/anthropics/claude-code/releases';

/**
 * Fetch Claude Code releases from the GH API and return hive-actionable
 * candidates.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.fetchFn]   - injectable fetch (default: globalThis.fetch)
 * @param {string}   [opts.apiUrl]    - override GH API URL (for tests)
 * @param {number}   [opts.perPage]   - releases per page (default 30, max 100)
 * @returns {Promise<{ candidates: object[], error: string|null }>}
 */
export async function fetchClaudeCodeReleases(opts = {}) {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const apiUrl = opts.apiUrl ?? GH_RELEASES_URL;
  const perPage = opts.perPage ?? 30;

  const url = `${apiUrl}?per_page=${perPage}`;

  let releases;
  try {
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'plugin-hive-meta-team/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      return {
        candidates: [],
        error: `GH API returned HTTP ${res.status} for ${url}`,
      };
    }

    releases = await res.json();
  } catch (err) {
    return {
      candidates: [],
      error: `fetch failed: ${err?.message ?? String(err)}`,
    };
  }

  if (!Array.isArray(releases)) {
    return {
      candidates: [],
      error: 'GH API response is not an array',
    };
  }

  const candidates = releases.filter(isHiveActionable).map(releaseToCandidate);

  return { candidates, error: null };
}

// ---------------------------------------------------------------------------
// Anthropic blog subprovider
// ---------------------------------------------------------------------------

// RSS feed for https://www.anthropic.com/news
const ANTHROPIC_BLOG_FEED_URL = 'https://www.anthropic.com/rss.xml';

// Keywords that indicate a post is about a model release, capability, or SDK.
const BLOG_KEEP_KEYWORDS = [
  'model',
  'claude',
  'api',
  'sdk',
  'agent',
  'capability',
  'introducing',
  'computer use',
  'tool',
  'vision',
  'context window',
  'token',
  'feature',
  'benchmark',
  'release',
];

// Keywords that indicate a post is primarily company/business/policy — skip.
const BLOG_SKIP_KEYWORDS = [
  'policy',
  'legislation',
  'government',
  'regulation',
  'funding',
  'investment',
  'valuation',
  'series',
  'partnership',
  'acquisition',
  'hiring',
  'culture',
  'diversity',
  'leadership',
  'company news',
];

function extractXmlTag(xml, tag) {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    'i',
  );
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[1];
    const link = extractXmlTag(chunk, 'link') ||
      (chunk.match(/<link\s*\/?>(.*?)<\/link>/i)?.[1] ?? '');
    items.push({
      title: extractXmlTag(chunk, 'title'),
      link: link.trim(),
      pubDate: extractXmlTag(chunk, 'pubDate'),
      description: extractXmlTag(chunk, 'description'),
    });
  }
  return items;
}

/**
 * Returns true if the post is about a model release, capability announcement,
 * or agent SDK change. Returns false for company/business/policy posts.
 */
function isBlogPostRelevant(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (BLOG_SKIP_KEYWORDS.some((kw) => text.includes(kw))) return false;
  return BLOG_KEEP_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Map a parsed RSS item → ExternalCandidate shape expected by step-03.
 */
function blogItemToCandidate(item, index) {
  const slugBase = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return {
    id: `external-proposal-anthropic-blog-${slugBase || index}`,
    title: item.title,
    discovery_source: 'external_research',
    signal_subtype: 'anthropic_blog',
    source_url: item.link,
    published_at: item.pubDate || null,
    impact_score: null,
    risk_score: null,
    effort_score: null,
    priority_score: null,
    charter_objective: 'tooling',
    rationale: `Anthropic blog post published on ${item.pubDate || 'unknown date'}. Review for Hive-actionable model or capability changes.`,
    raw_body_excerpt: item.description.slice(0, 500),
  };
}

/**
 * Fetch the Anthropic blog RSS feed and return relevant candidates.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.fetchFn]  - injectable fetch (default: globalThis.fetch)
 * @param {string}   [opts.feedUrl] - override feed URL (for tests)
 * @returns {Promise<{ candidates: object[], error: string|null }>}
 */
export async function fetchAnthropicBlog(opts = {}) {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const feedUrl = opts.feedUrl ?? ANTHROPIC_BLOG_FEED_URL;

  let xml;
  try {
    const res = await fetchFn(feedUrl, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'plugin-hive-meta-team/1.0',
      },
    });

    if (!res.ok) {
      return {
        candidates: [],
        error: `Anthropic blog feed returned HTTP ${res.status} for ${feedUrl}`,
      };
    }

    xml = await res.text();
  } catch (err) {
    return {
      candidates: [],
      error: `fetch failed: ${err?.message ?? String(err)}`,
    };
  }

  let items;
  try {
    items = parseRssItems(xml);
  } catch (err) {
    return {
      candidates: [],
      error: `RSS parse failed: ${err?.message ?? String(err)}`,
    };
  }

  if (items.length === 0) {
    return {
      candidates: [],
      error: typeof xml === 'string' && xml.length > 0
        ? null
        : 'RSS feed returned no parseable items',
    };
  }

  const candidates = items
    .filter(isBlogPostRelevant)
    .map((item, i) => blogItemToCandidate(item, i));

  return { candidates, error: null };
}

// Exported for tests only.
export {
  isHiveActionable,
  releaseToCandidate,
  GH_RELEASES_URL,
  isBlogPostRelevant,
  blogItemToCandidate,
  ANTHROPIC_BLOG_FEED_URL,
};
