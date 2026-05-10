/**
 * cc_session_id correlation tests for session-registry + session-client.
 *
 * Story s7-a6-cc-session-id-correlation. TDD: written RED before implementation.
 * Run: node tests/hive-lib/session-registry.cc-session-id.test.js
 *
 * Four cases:
 *   a) env var set → cc_session_id populated on the row
 *   b) env var unset → cc_session_id null/absent (no error)
 *   c) Hive session_id remains canonical — cc_session_id never displaces
 *      session_id, regardless of env var value
 *   d) Substrate-agnostic — env-var pickup happens at the session-client
 *      registry-write helper (upstream of substrate selection), so the
 *      same stamping behavior holds whether the caller subsequently
 *      drives Sessions-API or Messages-API
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REGISTRY_PATH_MOD = path.join(REPO_ROOT, 'hive', 'lib', 'session-registry.js');
const CLIENT_PATH_MOD = path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js');
const SDK_NAME = '@anthropic-ai/sdk';

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

/**
 * Stub @anthropic-ai/sdk AND js-yaml so session-client.js + session-registry.js
 * can load in a test env without those deps installed (project follows
 * BYO-enhancements — no root package.json).
 *
 * The js-yaml stub is a tiny shim covering only the surface session-registry
 * uses: load(text) and dump(obj). Since the registry's YAML payloads are flat
 * lists of primitive-keyed objects, JSON-as-YAML is a faithful subset for
 * round-tripping in test.
 */
function stubModules() {
  const origResolve = Module._resolveFilename;
  const origLoad = Module._load;

  const yamlStub = {
    load(text) {
      if (text == null || text === '') return undefined;
      // Support both real YAML files written by the registry AND our JSON
      // round-trip stub by trying JSON first, then a minimal YAML parse.
      try { return JSON.parse(text); } catch { /* fall through */ }
      return parseSimpleYaml(text);
    },
    dump(obj) {
      // Round-trip via JSON — strict subset that js-yaml.load can re-parse.
      return JSON.stringify(obj, null, 2);
    },
  };

  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === SDK_NAME) return SDK_NAME;
    if (request === 'js-yaml') return 'js-yaml';
    return origResolve.call(this, request, parent, ...rest);
  };
  Module._load = function (request, parent, ...rest) {
    if (request === SDK_NAME) {
      return function FakeAnthropic() { return { beta: { sessions: {} } }; };
    }
    if (request === 'js-yaml') return yamlStub;
    return origLoad.call(this, request, parent, ...rest);
  };
  return () => {
    Module._resolveFilename = origResolve;
    Module._load = origLoad;
  };
}

/**
 * Minimal YAML parser — only supports the subset session-registry could write
 * if it ever hands us a real YAML file (which our stub dump() avoids by using
 * JSON). Kept as a fallback so a manually-authored YAML registry still parses.
 */
function parseSimpleYaml(text) {
  // For our test harness, dump() always produces JSON. This branch is never
  // exercised, but kept as a defensive fallback that returns null rather
  // than throwing, mirroring js-yaml's permissive behavior.
  return null;
}

function tempRegistryPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-registry-cc-'));
  return path.join(dir, 'index.yaml');
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    });
}

const BASE_FIELDS = {
  epic_id: 'cwc-2026-integration',
  story_id: 's7-a6-cc-session-id-correlation',
  step_id: 'implement',
  agent_name: 'developer',
  model: 'claude-sonnet-4-6',
  status: 'active',
  created_at: '2026-05-09T10:00:00Z',
  last_active_at: '2026-05-09T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Case (a): env var set → cc_session_id populated on the row
// ---------------------------------------------------------------------------
test('case a — CLAUDE_CODE_SESSION_ID set, registry-write helper stamps cc_session_id on the row', async () => {
  const restore = stubModules();
  try {
    const sessionClient = freshRequire(CLIENT_PATH_MOD);
    const sessionRegistry = freshRequire(REGISTRY_PATH_MOD);

    assert.equal(typeof sessionClient.registerSession, 'function',
      'session-client must export registerSession (the env-var-aware registry-write helper)');

    const registryPath = tempRegistryPath();
    const sessionId = 'sess_aaa111';
    const ccId = 'cc_session_zzz999';

    await withEnv('CLAUDE_CODE_SESSION_ID', ccId, async () => {
      await sessionClient.registerSession(sessionId, BASE_FIELDS, registryPath);
    });

    const data = sessionRegistry.read(registryPath);
    assert.equal(data.sessions.length, 1, 'one row written');
    const row = data.sessions[0];
    assert.equal(row.session_id, sessionId, 'session_id matches caller-supplied value');
    assert.equal(row.cc_session_id, ccId, 'cc_session_id stamped from env var');
    assert.equal(row.epic_id, BASE_FIELDS.epic_id, 'other fields preserved');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Case (b): env var unset → cc_session_id null/absent (no error)
// ---------------------------------------------------------------------------
test('case b1 — CLAUDE_CODE_SESSION_ID unset, no cc_session_id key written, no error', async () => {
  const restore = stubModules();
  try {
    const sessionClient = freshRequire(CLIENT_PATH_MOD);
    const sessionRegistry = freshRequire(REGISTRY_PATH_MOD);

    const registryPath = tempRegistryPath();
    const sessionId = 'sess_bbb222';

    await withEnv('CLAUDE_CODE_SESSION_ID', undefined, async () => {
      await sessionClient.registerSession(sessionId, BASE_FIELDS, registryPath);
    });

    const data = sessionRegistry.read(registryPath);
    const row = data.sessions[0];
    assert.equal(row.session_id, sessionId, 'session_id present');
    // cc_session_id must be absent OR null — both are acceptable per AC #3.
    // Strict: prefer absent (omit the key) so YAML stays clean.
    assert.ok(!('cc_session_id' in row) || row.cc_session_id === null,
      `cc_session_id must be absent or null when env unset, got: ${JSON.stringify(row.cc_session_id)}`);
  } finally {
    restore();
  }
});

test('case b2 — CLAUDE_CODE_SESSION_ID empty-string treated as unset (no key written)', async () => {
  const restore = stubModules();
  try {
    const sessionClient = freshRequire(CLIENT_PATH_MOD);
    const sessionRegistry = freshRequire(REGISTRY_PATH_MOD);

    const registryPath = tempRegistryPath();
    const sessionId = 'sess_bbb333';

    await withEnv('CLAUDE_CODE_SESSION_ID', '', async () => {
      await sessionClient.registerSession(sessionId, BASE_FIELDS, registryPath);
    });

    const data = sessionRegistry.read(registryPath);
    const row = data.sessions[0];
    assert.ok(!('cc_session_id' in row) || row.cc_session_id === null,
      `empty-string env var must be treated as unset, got: ${JSON.stringify(row.cc_session_id)}`);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Case (c): Hive session_id remains canonical
// ---------------------------------------------------------------------------
test('case c — cc_session_id never displaces the canonical Hive session_id', async () => {
  const restore = stubModules();
  try {
    const sessionClient = freshRequire(CLIENT_PATH_MOD);
    const sessionRegistry = freshRequire(REGISTRY_PATH_MOD);

    const registryPath = tempRegistryPath();
    const sessionId = 'sess_canonical_ccc444';
    const ccId = 'cc_session_should_not_displace';

    await withEnv('CLAUDE_CODE_SESSION_ID', ccId, async () => {
      await sessionClient.registerSession(sessionId, BASE_FIELDS, registryPath);
    });

    const row = sessionRegistry.read(registryPath).sessions[0];
    // The canonical key the rest of the system (KG source_session, etc.) reads
    // is `session_id` — it must remain the caller-supplied Hive id.
    assert.equal(row.session_id, sessionId, 'canonical session_id unchanged');
    assert.notEqual(row.session_id, ccId, 'session_id is NOT replaced by cc_session_id');
    assert.equal(row.cc_session_id, ccId, 'cc_session_id sits alongside as correlation');
  } finally {
    restore();
  }
});

test('case c2 — additive: existing pre-cc_session_id rows remain valid after re-read', async () => {
  const restore = stubModules();
  try {
    const sessionRegistry = freshRequire(REGISTRY_PATH_MOD);

    const registryPath = tempRegistryPath();
    // Simulate a row written by the OLD code path (no cc_session_id key).
    await sessionRegistry.upsert('sess_legacy', { ...BASE_FIELDS }, registryPath);

    const data = sessionRegistry.read(registryPath);
    assert.equal(data.sessions.length, 1, 'legacy row readable');
    const row = data.sessions[0];
    assert.equal(row.session_id, 'sess_legacy');
    assert.ok(!('cc_session_id' in row), 'legacy rows have no cc_session_id key');
    assert.equal(row.epic_id, BASE_FIELDS.epic_id, 'all other fields intact');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Case (d): substrate-agnostic — env-var pickup happens upstream of substrate selection
// ---------------------------------------------------------------------------
test('case d — env-var pickup is structurally upstream of runSession() substrate switch', async () => {
  const restore = stubModules();
  try {
    const sessionClient = freshRequire(CLIENT_PATH_MOD);
    const sessionRegistry = freshRequire(REGISTRY_PATH_MOD);

    // Drive the helper twice — once "as if" the caller will then invoke the
    // legacy Sessions-API createSession, once "as if" the caller will then
    // invoke runSession({substrate:'messages'}). The helper itself never
    // looks at the substrate; the test's job is to confirm that the SAME
    // env var produces the SAME stamp regardless of which substrate the
    // caller subsequently uses.
    const ccId = 'cc_session_substrate_agnostic';

    await withEnv('CLAUDE_CODE_SESSION_ID', ccId, async () => {
      // Path 1: session-client.registerSession alongside legacy Sessions-API.
      const registryPath1 = tempRegistryPath();
      await sessionClient.registerSession('sess_legacy_path', BASE_FIELDS, registryPath1);
      const row1 = sessionRegistry.read(registryPath1).sessions[0];

      // Path 2: session-client.registerSession alongside Messages-API path.
      // We do NOT actually call runSession here — registerSession is the env
      // pickup site, and it is upstream. To prove substrate-agnosticism, we
      // assert that the helper signature does not require any substrate arg
      // and that the row content is identical under both call sites.
      const registryPath2 = tempRegistryPath();
      await sessionClient.registerSession('sess_messages_path', BASE_FIELDS, registryPath2);
      const row2 = sessionRegistry.read(registryPath2).sessions[0];

      assert.equal(row1.cc_session_id, ccId, 'legacy-path row stamped');
      assert.equal(row2.cc_session_id, ccId, 'messages-path row stamped');
      assert.equal(row1.cc_session_id, row2.cc_session_id, 'same env var → same stamp regardless of substrate');

      // Structural check: the helper must accept (sessionId, fields, registryPath)
      // and NOT a substrate argument. This pins env-var pickup as upstream of
      // substrate selection.
      assert.ok(sessionClient.registerSession.length <= 3,
        `registerSession arity should be ≤ 3 (sessionId, fields, registryPath?), got ${sessionClient.registerSession.length}`);
    });
  } finally {
    restore();
  }
});

test('case d2 — runSession({substrate:"messages"}) reachable under harness opt-in (s5 entry point exists)', async () => {
  // This is the existence-proof half of (d): the s5 delegation entry point
  // must be reachable so that a caller that opted into the Messages-API
  // substrate via test harness can drive it. We do not exercise the full
  // Messages-API loop here (s5 owns that — see messages-session.test.js).
  const restore = stubModules();
  try {
    const sessionClient = freshRequire(CLIENT_PATH_MOD);
    assert.equal(typeof sessionClient.runSession, 'function',
      'runSession delegation entry point must remain reachable');

    // And the messages-session module exposes the harness seam used by
    // s5's runtime-fork test.
    const messagesSession = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'messages-session.js'));
    assert.equal(typeof messagesSession.__setClientFactoryForTesting, 'function',
      'messages-session must expose __setClientFactoryForTesting harness seam');
  } finally {
    restore();
  }
});
