import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureReposWithDeps } from '../index.mjs';

const WORKSPACE_ID = 'ws-repos-1';
const TOKEN = 'test-token';
const SERVER_URL = 'http://fake-server';

// Build a fake httpJson that returns `repos` on GET and echoes the PUT body.
function makeHttpJson(initialRepos) {
  const calls = [];
  const fn = async (serverUrl, path, opts = {}) => {
    calls.push({ serverUrl, path, method: opts.method || 'GET', body: opts.body });
    if ((opts.method || 'GET') === 'GET') {
      return { repos: initialRepos };
    }
    return { repos: opts.body?.repos ?? [] };
  };
  fn.calls = calls;
  return fn;
}

test('binds repo when not already present (consent given)', async () => {
  const httpJson = makeHttpJson([]);
  const res = await ensureReposWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    repoUrl: 'git@github.com:firefly-events/plugin-hive.git',
    consent: true,
    httpJson,
    detectGitOrigin: () => '',
  });
  assert.equal(res.bound, true);
  assert.equal(res.created, true);
  const puts = httpJson.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].body.repos, [{ url: 'git@github.com:firefly-events/plugin-hive.git' }]);
});

test('idempotent no-op when url already bound', async () => {
  const url = 'git@github.com:firefly-events/plugin-hive.git';
  const httpJson = makeHttpJson([{ url }]);
  const res = await ensureReposWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    repoUrl: url,
    consent: true,
    httpJson,
    detectGitOrigin: () => '',
  });
  assert.equal(res.created, false);
  assert.equal(res.bound, true);
  assert.equal(httpJson.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('falls back to detectGitOrigin when repoUrl omitted', async () => {
  const httpJson = makeHttpJson([]);
  const res = await ensureReposWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJson,
    detectGitOrigin: () => 'git@github.com:firefly-events/plugin-hive.git',
  });
  assert.equal(res.repoUrl, 'git@github.com:firefly-events/plugin-hive.git');
  assert.equal(res.created, true);
});

test('throws REPO_URL_UNRESOLVED when no url and no origin', async () => {
  const httpJson = makeHttpJson([]);
  await assert.rejects(
    () =>
      ensureReposWithDeps({
        serverUrl: SERVER_URL,
        token: TOKEN,
        workspaceId: WORKSPACE_ID,
        consent: true,
        httpJson,
        detectGitOrigin: () => '',
      }),
    (err) => err.code === 'REPO_URL_UNRESOLVED',
  );
});

test('requires consent before binding', async () => {
  const httpJson = makeHttpJson([]);
  await assert.rejects(
    () =>
      ensureReposWithDeps({
        serverUrl: SERVER_URL,
        token: TOKEN,
        workspaceId: WORKSPACE_ID,
        repoUrl: 'git@github.com:firefly-events/plugin-hive.git',
        consent: false,
        httpJson,
        detectGitOrigin: () => '',
      }),
    (err) => err.code === 'CONSENT_REQUIRED',
  );
});

test('requires token and workspaceId', async () => {
  await assert.rejects(
    () => ensureReposWithDeps({ token: '', workspaceId: WORKSPACE_ID }),
    (err) => err.code === 'AUTH_REQUIRED',
  );
  await assert.rejects(
    () => ensureReposWithDeps({ token: TOKEN, workspaceId: '' }),
    (err) => err.code === 'WORKSPACE_REQUIRED',
  );
});
