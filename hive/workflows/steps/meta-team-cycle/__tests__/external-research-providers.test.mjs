import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  fetchClaudeCodeReleases,
  GH_RELEASES_URL,
  isHiveActionable,
  classifyRelease,
  releaseToCandidate,
  fetchAnthropicBlog,
  isBlogPostRelevant,
  classifyBlogPost,
  blogItemToCandidate,
  ANTHROPIC_BLOG_FEED_URL,
} from '../external-research-providers.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startMockServer(handler) {
  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const ACTIONABLE_RELEASE = {
  tag_name: 'v1.5.0',
  name: 'v1.5.0 — Introducing Workflows and Routines',
  body: 'New Workflows primitive lets you define multi-step agent workflows. Routines cloud trigger now supported.',
  html_url: 'https://github.com/anthropics/claude-code/releases/tag/v1.5.0',
  published_at: '2025-06-01T12:00:00Z',
  created_at: '2025-06-01T12:00:00Z',
};

const BUGFIX_RELEASE = {
  tag_name: 'v1.4.1',
  name: 'patch: fix token expiry edge case',
  body: 'Fixed a bug where token refresh failed under race condition.',
  html_url: 'https://github.com/anthropics/claude-code/releases/tag/v1.4.1',
  published_at: '2025-05-20T08:00:00Z',
  created_at: '2025-05-20T08:00:00Z',
};

const AGENTS_RELEASE = {
  tag_name: 'v1.6.0',
  name: 'Agents view and /code-review command',
  body: 'New agents view added to the sidebar. /code-review command renamed and promoted to stable.',
  html_url: 'https://github.com/anthropics/claude-code/releases/tag/v1.6.0',
  published_at: '2025-07-10T10:00:00Z',
  created_at: '2025-07-10T10:00:00Z',
};

// ---------------------------------------------------------------------------
// isHiveActionable
// ---------------------------------------------------------------------------

test('isHiveActionable — returns true for release with workflow/routine keywords', () => {
  assert.equal(isHiveActionable(ACTIONABLE_RELEASE), true);
});

test('isHiveActionable — returns true for agents view + /code-review release', () => {
  assert.equal(isHiveActionable(AGENTS_RELEASE), true);
});

test('isHiveActionable — returns false for patch/bugfix release', () => {
  assert.equal(isHiveActionable(BUGFIX_RELEASE), false);
});

test('isHiveActionable — returns false for empty release', () => {
  assert.equal(isHiveActionable({ tag_name: 'v0.0.1', name: '', body: '' }), false);
});

// ---------------------------------------------------------------------------
// classifyRelease — tiering, not hard discard
// ---------------------------------------------------------------------------

test('classifyRelease — actionable for capability-shift release', () => {
  assert.equal(classifyRelease(ACTIONABLE_RELEASE), 'actionable');
  assert.equal(classifyRelease(AGENTS_RELEASE), 'actionable');
});

test('classifyRelease — watch for non-empty bugfix release (no longer discarded)', () => {
  assert.equal(classifyRelease(BUGFIX_RELEASE), 'watch');
});

test('classifyRelease — null for empty release (hard discard)', () => {
  assert.equal(classifyRelease({ tag_name: 'v0.0.1', name: '', body: '' }), null);
});

test('classifyRelease — null for single-word body (hard discard)', () => {
  assert.equal(classifyRelease({ tag_name: 'v0.0.2', name: 'patch', body: 'fixes' }), null);
});

// ---------------------------------------------------------------------------
// releaseToCandidate shape
// ---------------------------------------------------------------------------

test('releaseToCandidate — emits correct discovery_source and signal_subtype', () => {
  const candidate = releaseToCandidate(ACTIONABLE_RELEASE);
  assert.equal(candidate.discovery_source, 'external_research');
  assert.equal(candidate.signal_subtype, 'claude_code_release');
});

test('releaseToCandidate — emits signal_tier derived from classify when not passed', () => {
  const actionable = releaseToCandidate(ACTIONABLE_RELEASE);
  assert.equal(actionable.signal_tier, 'actionable');
  const watch = releaseToCandidate(BUGFIX_RELEASE);
  assert.equal(watch.signal_tier, 'watch');
});

test('releaseToCandidate — explicit tier override wins over classify', () => {
  const candidate = releaseToCandidate(ACTIONABLE_RELEASE, 'watch');
  assert.equal(candidate.signal_tier, 'watch');
});

test('releaseToCandidate — id uses external-proposal-cc-release namespace', () => {
  const candidate = releaseToCandidate(ACTIONABLE_RELEASE);
  assert.match(candidate.id, /^external-proposal-cc-release-/);
  assert.ok(candidate.id.includes(ACTIONABLE_RELEASE.tag_name));
});

test('releaseToCandidate — includes source_url, published_at, raw_body_excerpt', () => {
  const candidate = releaseToCandidate(ACTIONABLE_RELEASE);
  assert.equal(candidate.source_url, ACTIONABLE_RELEASE.html_url);
  assert.equal(candidate.published_at, ACTIONABLE_RELEASE.published_at);
  assert.ok(typeof candidate.raw_body_excerpt === 'string');
  assert.ok(candidate.raw_body_excerpt.length > 0);
});

test('releaseToCandidate — raw_body_excerpt truncated to 500 chars', () => {
  const longBody = 'x'.repeat(1000);
  const candidate = releaseToCandidate({ ...ACTIONABLE_RELEASE, body: longBody });
  assert.ok(candidate.raw_body_excerpt.length <= 500);
});

test('releaseToCandidate — charter_objective is tooling', () => {
  const candidate = releaseToCandidate(ACTIONABLE_RELEASE);
  assert.equal(candidate.charter_objective, 'tooling');
});

// ---------------------------------------------------------------------------
// fetchClaudeCodeReleases — happy path
// ---------------------------------------------------------------------------

test('fetchClaudeCodeReleases — emits all non-empty releases with tiered signal', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, [ACTIONABLE_RELEASE, BUGFIX_RELEASE, AGENTS_RELEASE]);
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.equal(result.error, null);
    // All three releases have non-empty bodies → all emit as candidates now.
    // ACTIONABLE + AGENTS = 'actionable' tier; BUGFIX = 'watch' tier.
    assert.equal(result.candidates.length, 3);
    const byTag = Object.fromEntries(result.candidates.map((c) => [c.id, c]));
    const v150 = result.candidates.find((c) => c.id.includes('v1.5.0'));
    const v160 = result.candidates.find((c) => c.id.includes('v1.6.0'));
    const v141 = result.candidates.find((c) => c.id.includes('v1.4.1'));
    assert.equal(v150.signal_tier, 'actionable');
    assert.equal(v160.signal_tier, 'actionable');
    assert.equal(v141.signal_tier, 'watch');
  } finally {
    await close();
  }
});

test('fetchClaudeCodeReleases — all candidates have correct shape', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, [ACTIONABLE_RELEASE]);
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.equal(c.discovery_source, 'external_research');
    assert.equal(c.signal_subtype, 'claude_code_release');
    assert.match(c.id, /^external-proposal-cc-release-/);
    assert.ok(typeof c.source_url === 'string');
    assert.ok(typeof c.rationale === 'string');
  } finally {
    await close();
  }
});

test('fetchClaudeCodeReleases — non-empty bugfix release now emits as watch candidate', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, [BUGFIX_RELEASE]);
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.equal(result.error, null);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].signal_tier, 'watch');
  } finally {
    await close();
  }
});

test('fetchClaudeCodeReleases — empty body release is hard-discarded', async () => {
  const empty = { tag_name: 'v0.0.1', name: '', body: '', html_url: '', published_at: null };
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, [empty]);
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.equal(result.error, null);
    assert.deepEqual(result.candidates, []);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// fetchClaudeCodeReleases — failure modes → empty list, not error throw
// ---------------------------------------------------------------------------

test('fetchClaudeCodeReleases — HTTP 403 returns empty candidates with error string', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 403, { message: 'API rate limit exceeded' });
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.deepEqual(result.candidates, []);
    assert.ok(typeof result.error === 'string');
    assert.ok(result.error.includes('403'));
  } finally {
    await close();
  }
});

test('fetchClaudeCodeReleases — network error returns empty candidates with error string', async () => {
  const fetchFn = () => Promise.reject(new Error('ECONNREFUSED'));
  const result = await fetchClaudeCodeReleases({ fetchFn, apiUrl: 'http://0.0.0.0:1' });
  assert.deepEqual(result.candidates, []);
  assert.ok(typeof result.error === 'string');
  assert.ok(result.error.length > 0);
});

test('fetchClaudeCodeReleases — non-array response returns empty candidates with error', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, { message: 'unexpected object' });
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.deepEqual(result.candidates, []);
    assert.ok(typeof result.error === 'string');
  } finally {
    await close();
  }
});

test('fetchClaudeCodeReleases — does not throw on any failure', async () => {
  const fetchFn = () => { throw new Error('sync throw'); };
  const result = await fetchClaudeCodeReleases({ fetchFn, apiUrl: 'http://unused' });
  assert.deepEqual(result.candidates, []);
  assert.ok(typeof result.error === 'string');
});

// ---------------------------------------------------------------------------
// GH_RELEASES_URL constant
// ---------------------------------------------------------------------------

test('GH_RELEASES_URL points to anthropics/claude-code releases', () => {
  assert.ok(GH_RELEASES_URL.includes('anthropics/claude-code'));
  assert.ok(GH_RELEASES_URL.includes('releases'));
});

// ---------------------------------------------------------------------------
// Anthropic blog fixtures
// ---------------------------------------------------------------------------

const MODEL_POST = {
  title: 'Introducing Claude 3.5 Sonnet',
  link: 'https://www.anthropic.com/news/claude-3-5-sonnet',
  pubDate: 'Wed, 20 Jun 2025 12:00:00 +0000',
  description: 'Today we are releasing Claude 3.5 Sonnet, our most capable model yet with vision and tool use.',
};

const SDK_POST = {
  title: 'New agent SDK capabilities in the Anthropic API',
  link: 'https://www.anthropic.com/news/agent-sdk-update',
  pubDate: 'Mon, 10 Mar 2025 09:00:00 +0000',
  description: 'The Anthropic API now supports agent tool calls and multi-turn workflows natively.',
};

const POLICY_POST = {
  title: 'Our approach to AI policy and government regulation',
  link: 'https://www.anthropic.com/news/ai-policy',
  pubDate: 'Fri, 05 Apr 2025 08:00:00 +0000',
  description: 'Anthropic shares its perspective on legislation and government policy for AI.',
};

const FUNDING_POST = {
  title: 'Anthropic raises $2B in Series D funding',
  link: 'https://www.anthropic.com/news/series-d',
  pubDate: 'Tue, 01 Jan 2025 10:00:00 +0000',
  description: 'We are excited to announce our latest investment round and partnership.',
};

function makeRssFeed(items) {
  const itemsXml = items.map((it) => `
    <item>
      <title><![CDATA[${it.title}]]></title>
      <link>${it.link}</link>
      <pubDate>${it.pubDate}</pubDate>
      <description><![CDATA[${it.description}]]></description>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Anthropic News</title>${itemsXml}</channel></rss>`;
}

// ---------------------------------------------------------------------------
// isBlogPostRelevant
// ---------------------------------------------------------------------------

test('isBlogPostRelevant — returns true for model release post', () => {
  assert.equal(isBlogPostRelevant(MODEL_POST), true);
});

test('isBlogPostRelevant — returns true for agent SDK post', () => {
  assert.equal(isBlogPostRelevant(SDK_POST), true);
});

test('isBlogPostRelevant — returns false for policy post', () => {
  assert.equal(isBlogPostRelevant(POLICY_POST), false);
});

test('isBlogPostRelevant — returns false for funding/investment post', () => {
  assert.equal(isBlogPostRelevant(FUNDING_POST), false);
});

test('isBlogPostRelevant — skip signals take precedence over keep signals', () => {
  // Has "model" (keep) but also "policy" (skip) — must be excluded
  const mixed = {
    title: 'Anthropic model policy update',
    description: 'New policy governing model access.',
    link: '',
    pubDate: '',
  };
  assert.equal(isBlogPostRelevant(mixed), false);
});

test('isBlogPostRelevant — returns false for empty post', () => {
  assert.equal(isBlogPostRelevant({ title: '', description: '', link: '', pubDate: '' }), false);
});

// ---------------------------------------------------------------------------
// classifyBlogPost — tiering
// ---------------------------------------------------------------------------

test('classifyBlogPost — actionable for keep-list keyword post', () => {
  assert.equal(classifyBlogPost(MODEL_POST), 'actionable');
  assert.equal(classifyBlogPost(SDK_POST), 'actionable');
});

test('classifyBlogPost — null (hard skip) for policy/funding posts', () => {
  assert.equal(classifyBlogPost(POLICY_POST), null);
  assert.equal(classifyBlogPost(FUNDING_POST), null);
});

test('classifyBlogPost — watch for post that passes skip list but misses keep list', () => {
  const neutral = {
    title: 'A note about our research',
    description: 'Today we share a short reflection on long-term planning.',
    link: '',
    pubDate: '',
  };
  assert.equal(classifyBlogPost(neutral), 'watch');
});

test('classifyBlogPost — skip wins over keep when both present', () => {
  const mixed = {
    title: 'Anthropic model policy update',
    description: 'New policy governing model access.',
    link: '',
    pubDate: '',
  };
  assert.equal(classifyBlogPost(mixed), null);
});

test('classifyBlogPost — null for empty post', () => {
  assert.equal(classifyBlogPost({ title: '', description: '', link: '', pubDate: '' }), null);
});

// ---------------------------------------------------------------------------
// blogItemToCandidate shape
// ---------------------------------------------------------------------------

test('blogItemToCandidate — emits correct discovery_source and signal_subtype', () => {
  const candidate = blogItemToCandidate(MODEL_POST, 0);
  assert.equal(candidate.discovery_source, 'external_research');
  assert.equal(candidate.signal_subtype, 'anthropic_blog');
});

test('blogItemToCandidate — emits signal_tier derived from classify when not passed', () => {
  const actionable = blogItemToCandidate(MODEL_POST, 0);
  assert.equal(actionable.signal_tier, 'actionable');
  const neutral = blogItemToCandidate({
    title: 'A note', description: 'Some neutral content here.', link: '', pubDate: '',
  }, 1);
  assert.equal(neutral.signal_tier, 'watch');
});

test('blogItemToCandidate — explicit tier override wins over classify', () => {
  const candidate = blogItemToCandidate(MODEL_POST, 0, 'watch');
  assert.equal(candidate.signal_tier, 'watch');
});

test('blogItemToCandidate — id uses external-proposal-anthropic-blog namespace', () => {
  const candidate = blogItemToCandidate(MODEL_POST, 0);
  assert.match(candidate.id, /^external-proposal-anthropic-blog-/);
});

test('blogItemToCandidate — includes source_url and published_at', () => {
  const candidate = blogItemToCandidate(MODEL_POST, 0);
  assert.equal(candidate.source_url, MODEL_POST.link);
  assert.equal(candidate.published_at, MODEL_POST.pubDate);
});

test('blogItemToCandidate — raw_body_excerpt truncated to 500 chars', () => {
  const longPost = { ...MODEL_POST, description: 'x'.repeat(1000) };
  const candidate = blogItemToCandidate(longPost, 0);
  assert.ok(candidate.raw_body_excerpt.length <= 500);
});

test('blogItemToCandidate — charter_objective is tooling', () => {
  const candidate = blogItemToCandidate(MODEL_POST, 0);
  assert.equal(candidate.charter_objective, 'tooling');
});

// ---------------------------------------------------------------------------
// fetchAnthropicBlog — happy path
// ---------------------------------------------------------------------------

test('fetchAnthropicBlog — emits actionable + drops hard-skip posts', async () => {
  const xml = makeRssFeed([MODEL_POST, POLICY_POST, SDK_POST, FUNDING_POST]);
  const fetchFn = () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(xml),
  });
  const result = await fetchAnthropicBlog({ fetchFn, feedUrl: 'http://unused' });
  assert.equal(result.error, null);
  // POLICY + FUNDING hard-skip; MODEL + SDK pass as actionable.
  assert.equal(result.candidates.length, 2);
  const titles = result.candidates.map((c) => c.title);
  assert.ok(titles.includes(MODEL_POST.title));
  assert.ok(titles.includes(SDK_POST.title));
  assert.ok(!titles.includes(POLICY_POST.title));
  assert.ok(!titles.includes(FUNDING_POST.title));
  for (const c of result.candidates) {
    assert.equal(c.signal_tier, 'actionable');
  }
});

test('fetchAnthropicBlog — emits watch candidate for neutral post (no keep keyword, no skip)', async () => {
  const NEUTRAL_POST = {
    title: 'A short reflection on long-term planning',
    link: 'https://www.anthropic.com/news/neutral-reflection',
    pubDate: 'Mon, 02 Jun 2025 09:00:00 +0000',
    description: 'Some thoughts on planning. Does not mention any of the keep-list signals.',
  };
  const xml = makeRssFeed([NEUTRAL_POST]);
  const fetchFn = () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(xml),
  });
  const result = await fetchAnthropicBlog({ fetchFn, feedUrl: 'http://unused' });
  assert.equal(result.error, null);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].signal_tier, 'watch');
});

test('fetchAnthropicBlog — all candidates have correct shape', async () => {
  const xml = makeRssFeed([MODEL_POST]);
  const fetchFn = () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(xml),
  });
  const result = await fetchAnthropicBlog({ fetchFn, feedUrl: 'http://unused' });
  assert.equal(result.candidates.length, 1);
  const c = result.candidates[0];
  assert.equal(c.discovery_source, 'external_research');
  assert.equal(c.signal_subtype, 'anthropic_blog');
  assert.match(c.id, /^external-proposal-anthropic-blog-/);
  assert.ok(typeof c.source_url === 'string');
  assert.ok(typeof c.rationale === 'string');
});

test('fetchAnthropicBlog — empty list when no posts are relevant', async () => {
  const xml = makeRssFeed([POLICY_POST, FUNDING_POST]);
  const fetchFn = () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(xml),
  });
  const result = await fetchAnthropicBlog({ fetchFn, feedUrl: 'http://unused' });
  assert.equal(result.error, null);
  assert.deepEqual(result.candidates, []);
});

// ---------------------------------------------------------------------------
// fetchAnthropicBlog — failure modes → empty list, not error throw
// ---------------------------------------------------------------------------

test('fetchAnthropicBlog — HTTP 403 returns empty candidates with error string', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 403, { message: 'forbidden' });
  });
  try {
    const result = await fetchAnthropicBlog({ feedUrl: baseUrl });
    assert.deepEqual(result.candidates, []);
    assert.ok(typeof result.error === 'string');
    assert.ok(result.error.includes('403'));
  } finally {
    await close();
  }
});

test('fetchAnthropicBlog — network error returns empty candidates with error string', async () => {
  const fetchFn = () => Promise.reject(new Error('ECONNREFUSED'));
  const result = await fetchAnthropicBlog({ fetchFn, feedUrl: 'http://0.0.0.0:1' });
  assert.deepEqual(result.candidates, []);
  assert.ok(typeof result.error === 'string');
  assert.ok(result.error.length > 0);
});

test('fetchAnthropicBlog — does not throw on any failure', async () => {
  const fetchFn = () => { throw new Error('sync throw'); };
  const result = await fetchAnthropicBlog({ fetchFn, feedUrl: 'http://unused' });
  assert.deepEqual(result.candidates, []);
  assert.ok(typeof result.error === 'string');
});

test('fetchAnthropicBlog — HTTP 500 returns empty candidates with error string', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 500, { message: 'server error' });
  });
  try {
    const result = await fetchAnthropicBlog({ feedUrl: baseUrl });
    assert.deepEqual(result.candidates, []);
    assert.ok(typeof result.error === 'string');
    assert.ok(result.error.includes('500'));
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// ANTHROPIC_BLOG_FEED_URL constant
// ---------------------------------------------------------------------------

test('ANTHROPIC_BLOG_FEED_URL points to anthropic.com', () => {
  assert.ok(ANTHROPIC_BLOG_FEED_URL.includes('anthropic.com'));
});
