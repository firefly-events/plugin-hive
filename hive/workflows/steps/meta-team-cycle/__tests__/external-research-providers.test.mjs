import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  fetchClaudeCodeReleases,
  GH_RELEASES_URL,
  isHiveActionable,
  releaseToCandidate,
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
// releaseToCandidate shape
// ---------------------------------------------------------------------------

test('releaseToCandidate — emits correct discovery_source and signal_subtype', () => {
  const candidate = releaseToCandidate(ACTIONABLE_RELEASE);
  assert.equal(candidate.discovery_source, 'external_research');
  assert.equal(candidate.signal_subtype, 'claude_code_release');
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

test('fetchClaudeCodeReleases — returns only hive-actionable candidates', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, [ACTIONABLE_RELEASE, BUGFIX_RELEASE, AGENTS_RELEASE]);
  });

  try {
    const result = await fetchClaudeCodeReleases({ apiUrl: baseUrl });
    assert.equal(result.error, null);
    assert.equal(result.candidates.length, 2);
    const tags = result.candidates.map((c) => c.id);
    assert.ok(tags.some((id) => id.includes('v1.5.0')));
    assert.ok(tags.some((id) => id.includes('v1.6.0')));
    assert.ok(!tags.some((id) => id.includes('v1.4.1')));
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

test('fetchClaudeCodeReleases — empty list when no releases are actionable', async () => {
  const { baseUrl, close } = await startMockServer((_req, res) => {
    sendJson(res, 200, [BUGFIX_RELEASE]);
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
