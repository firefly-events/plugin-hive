import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcileSkillsWithDeps } from '../index.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-test-1';
const TOKEN = 'test-token';
const SERVER_URL = 'http://fake-server';

function makeLoadSkillsExportConfigFn(exports) {
  return async () => ({ schema_version: 1, exports });
}

function makeHttpJsonFn({ existingSkills = [], calls = [] } = {}) {
  return async function fakeHttpJson(serverUrl, apiPath, { method = 'GET', body } = {}) {
    calls.push({ method, apiPath, body });

    if (method === 'GET' && apiPath.startsWith('/api/skills')) {
      return existingSkills;
    }

    if (method === 'POST' && apiPath.startsWith('/api/skills')) {
      return { id: `new-id-${body?.name}`, name: body?.name };
    }

    if (method === 'PUT' && apiPath.startsWith('/api/skills/')) {
      const matched = existingSkills.find((s) => apiPath.includes(encodeURIComponent(s.id)));
      return { id: matched?.id ?? 'unknown-id', name: body?.name };
    }

    throw new Error(`Unhandled fake request: ${method} ${apiPath}`);
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-skills-test-'));
}

function normalizeContent(str) {
  return String(str)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function computeExpectedHash(skillContent, substrateDeps) {
  const parts = [normalizeContent(skillContent)];
  for (const { depPath, content } of substrateDeps) {
    parts.push(`<!-- substrate: ${depPath} -->`);
    parts.push(normalizeContent(content));
  }
  const bundled = parts.join('\n\n');
  return crypto.createHash('sha256').update(bundled, 'utf8').digest('hex');
}

// Write a fixture skill directory under repoRoot
function writeSkillFixture(repoRoot, { skillRelPath = 'skills/test-skill/SKILL.md', skillContent = '# Test Skill\nDoes things.\n', substratePaths = [] } = {}) {
  const fullSkillPath = path.join(repoRoot, skillRelPath);
  fs.mkdirSync(path.dirname(fullSkillPath), { recursive: true });
  fs.writeFileSync(fullSkillPath, skillContent);

  for (const { relPath, content } of substratePaths) {
    const fullPath = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

function desiredExport(overrides = {}) {
  return {
    skill_ref: 'skills/test-skill/SKILL.md',
    multica_name: 'test-skill',
    substrate_deps: [],
    visibility: 'private',
    ...overrides,
  };
}

function existingSkill(name, contentHash, id = null, overrides = {}) {
  return {
    id: id ?? `id-${name}`,
    name,
    content: 'old-content',
    content_hash: contentHash,
    visibility: 'private',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Path 1: Cold — empty workspace + 1-entry yaml → 1 skill created with bundled substrate
// ---------------------------------------------------------------------------

test('cold path — creates skill with bundled substrate when workspace is empty', async () => {
  const repoRoot = tmpDir();
  const skillContent = '# Metrics Check\nDoes metrics.\n';
  const substrateContent = '# Prelude\nCommon preamble.\n';

  writeSkillFixture(repoRoot, {
    skillRelPath: 'skills/metrics-check/SKILL.md',
    skillContent,
    substratePaths: [{ relPath: 'hive/references/skill-prelude.md', content: substrateContent }],
  });

  const calls = [];
  const httpJsonFn = makeHttpJsonFn({ existingSkills: [], calls });
  const loadFn = makeLoadSkillsExportConfigFn([
    desiredExport({
      skill_ref: 'skills/metrics-check/SKILL.md',
      multica_name: 'metrics-check',
      substrate_deps: ['hive/references/skill-prelude.md'],
      visibility: 'private',
    }),
  ]);

  const result = await reconcileSkillsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSkillsExportConfigFn: loadFn,
    repoRoot,
    pluginRoot: repoRoot,
  });

  assert.equal(result.created.length, 1, 'should create 1 skill');
  assert.equal(result.patched.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.removed.length, 0);
  assert.ok(result.created.includes('metrics-check'));

  const postCalls = calls.filter((c) => c.method === 'POST');
  assert.equal(postCalls.length, 1);
  const payload = postCalls[0].body;
  assert.equal(payload.name, 'metrics-check');
  assert.equal(payload.visibility, 'private');
  assert.ok(typeof payload.content === 'string', 'payload must include bundled content');
  assert.ok(payload.content.includes('<!-- substrate: hive/references/skill-prelude.md -->'), 'bundled content must include substrate separator');
  assert.ok(payload.content.includes('# Prelude'), 'bundled content must include substrate body');
  assert.ok(typeof payload.content_hash === 'string' && payload.content_hash.length === 64, 'content_hash must be a sha256 hex string');
});

// ---------------------------------------------------------------------------
// Path 2: Warm idempotent — re-run with no source changes → no upserts fire
// ---------------------------------------------------------------------------

test('warm idempotent path — re-run with no changes skips all skills', async () => {
  const repoRoot = tmpDir();
  const skillContent = '# Test Skill\nDoes things.\n';

  writeSkillFixture(repoRoot, { skillContent });

  // Pre-compute what the hash will be so we can set up the server to return it
  const expectedHash = computeExpectedHash(skillContent, []);

  const calls = [];
  const httpJsonFn = makeHttpJsonFn({
    existingSkills: [existingSkill('test-skill', expectedHash, 'id-test-skill', { content: 'irrelevant', content_hash: expectedHash, visibility: 'private', name: 'test-skill' })],
    calls,
  });
  const loadFn = makeLoadSkillsExportConfigFn([desiredExport()]);

  const result = await reconcileSkillsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSkillsExportConfigFn: loadFn,
    repoRoot,
    pluginRoot: repoRoot,
  });

  assert.equal(result.created.length, 0);
  assert.equal(result.patched.length, 0);
  assert.equal(result.skipped.length, 1, 'should skip unchanged skill');
  assert.ok(result.skipped.includes('test-skill'));

  const mutatingCalls = calls.filter((c) => c.method === 'POST' || c.method === 'PUT');
  assert.equal(mutatingCalls.length, 0, 'no POST or PUT should fire on idempotent re-run');
});

test('warm path when server omits content_hash — falls back to normalized content, skips', async () => {
  const repoRoot = tmpDir();
  const skillContent = '# Test Skill\nDoes things.\n';

  writeSkillFixture(repoRoot, { skillContent });

  const calls = [];
  const httpJsonFn = makeHttpJsonFn({
    // Server response intentionally omits content_hash; raw content matches (modulo normalization).
    existingSkills: [{ id: 'id-test-skill', name: 'test-skill', content: skillContent, visibility: 'private' }],
    calls,
  });
  const loadFn = makeLoadSkillsExportConfigFn([desiredExport()]);

  const result = await reconcileSkillsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSkillsExportConfigFn: loadFn,
    repoRoot,
    pluginRoot: repoRoot,
  });

  assert.equal(result.skipped.length, 1, 'should skip when content matches despite missing content_hash');
  assert.ok(result.skipped.includes('test-skill'));
  const mutatingCalls = calls.filter((c) => c.method === 'POST' || c.method === 'PUT');
  assert.equal(mutatingCalls.length, 0, 'no PUT churn on warm run when server omits content_hash');
});

// ---------------------------------------------------------------------------
// Path 3: Drift — SKILL.md content edited → update fires
// ---------------------------------------------------------------------------

test('drift path — SKILL.md edit triggers update (content_hash change)', async () => {
  const repoRoot = tmpDir();
  const oldContent = '# Old Content\n';
  const newContent = '# New Content — edited\n';

  writeSkillFixture(repoRoot, { skillContent: newContent });

  const oldHash = computeExpectedHash(oldContent, []);

  const calls = [];
  const httpJsonFn = makeHttpJsonFn({
    existingSkills: [{ id: 'id-test-skill', name: 'test-skill', content: oldContent, content_hash: oldHash, visibility: 'private' }],
    calls,
  });
  const loadFn = makeLoadSkillsExportConfigFn([desiredExport()]);

  const result = await reconcileSkillsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSkillsExportConfigFn: loadFn,
    repoRoot,
    pluginRoot: repoRoot,
  });

  assert.equal(result.patched.length, 1, 'should patch 1 skill after content change');
  assert.ok(result.patched.includes('test-skill'));
  assert.equal(result.created.length, 0);
  assert.equal(result.skipped.length, 0);

  const putCalls = calls.filter((c) => c.method === 'PUT');
  assert.equal(putCalls.length, 1, 'should make 1 PUT call');
  const newHash = computeExpectedHash(newContent, []);
  assert.equal(putCalls[0].body.content_hash, newHash, 'PUT payload must carry updated content_hash');
});

// ---------------------------------------------------------------------------
// Path 4: Substrate-dep change — prelude.md edited → update fires
// ---------------------------------------------------------------------------

test('substrate-dep change — prelude.md edit triggers update', async () => {
  const repoRoot = tmpDir();
  const skillContent = '# Test Skill\nBody.\n';
  const oldPrelude = '# Old Prelude\n';
  const newPrelude = '# New Prelude — updated\n';
  const substrateRelPath = 'hive/references/skill-prelude.md';

  writeSkillFixture(repoRoot, {
    skillContent,
    substratePaths: [{ relPath: substrateRelPath, content: newPrelude }],
  });

  // Existing skill has hash computed with oldPrelude
  const oldHash = computeExpectedHash(skillContent, [{ depPath: substrateRelPath, content: oldPrelude }]);

  const calls = [];
  const httpJsonFn = makeHttpJsonFn({
    existingSkills: [{ id: 'id-test-skill', name: 'test-skill', content_hash: oldHash, content: 'old', visibility: 'private' }],
    calls,
  });
  const loadFn = makeLoadSkillsExportConfigFn([
    desiredExport({ substrate_deps: [substrateRelPath] }),
  ]);

  const result = await reconcileSkillsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSkillsExportConfigFn: loadFn,
    repoRoot,
    pluginRoot: repoRoot,
  });

  assert.equal(result.patched.length, 1, 'substrate change should trigger update');
  assert.ok(result.patched.includes('test-skill'));

  const putCalls = calls.filter((c) => c.method === 'PUT');
  assert.equal(putCalls.length, 1);
  assert.ok(putCalls[0].body.content.includes('<!-- substrate: hive/references/skill-prelude.md -->'));
  assert.ok(putCalls[0].body.content.includes('# New Prelude — updated'));
});

// ---------------------------------------------------------------------------
// Path 5: Removed entry — orphan in Multica, logged warning, NOT deleted
// ---------------------------------------------------------------------------

test('removed entry — orphan in Multica logs warning but is not deleted', async () => {
  const repoRoot = tmpDir();
  const skillContent = '# Test Skill\n';

  writeSkillFixture(repoRoot, { skillContent });
  const expectedHash = computeExpectedHash(skillContent, []);

  const calls = [];
  const httpJsonFn = makeHttpJsonFn({
    existingSkills: [
      { id: 'id-test-skill', name: 'test-skill', content_hash: expectedHash, content: 'irrelevant', visibility: 'private' },
      { id: 'id-orphan', name: 'orphan-skill', content_hash: 'abc123', content: 'orphan', visibility: 'workspace' },
    ],
    calls,
  });
  const loadFn = makeLoadSkillsExportConfigFn([desiredExport()]);

  const warnMessages = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnMessages.push(args.join(' '));

  try {
    const result = await reconcileSkillsWithDeps({
      serverUrl: SERVER_URL,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      consent: true,
      httpJsonFn,
      loadSkillsExportConfigFn: loadFn,
      repoRoot,
      pluginRoot: repoRoot,
    });

    assert.equal(result.removed.length, 1, 'should report 1 removed skill');
    assert.ok(result.removed.includes('orphan-skill'));

    const orphanWarn = warnMessages.find((m) => m.includes('orphan-skill'));
    assert.ok(orphanWarn, 'console.warn should mention orphan-skill');
    assert.ok(orphanWarn.includes('skipping deletion for safety'), 'warn must include safety message');

    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'must not DELETE orphaned skills');
  } finally {
    console.warn = originalWarn;
  }
});

test('missing skillsConfigPath file → empty envelope, no HTTP calls (matches SKILL.md)', async () => {
  // SKILL.md documents that a missing skills-export.yaml is skipped silently.
  // Without the fs.existsSync guard this would throw CONFIG_LOAD_ERROR.
  const calls = [];
  const httpJsonFn = async (...args) => { calls.push(args); throw new Error('should not be called'); };
  const missingPath = path.join(os.tmpdir(), `skills-export-missing-${crypto.randomBytes(6).toString('hex')}.yaml`);
  assert.equal(fs.existsSync(missingPath), false, 'fixture path must not exist');

  const result = await reconcileSkillsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    skillsConfigPath: missingPath,
  });

  assert.deepEqual(result, { created: [], patched: [], skipped: [], removed: [] });
  assert.equal(calls.length, 0, 'no HTTP calls when skills-export.yaml is absent');
});
