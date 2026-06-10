'use strict';

/**
 * Conformance tests for the Node state-dir resolver shim (story sdr-1).
 *
 * Iterates the shared fixture tests/fixtures/state-dir-conformance.yaml
 * (JSON content — valid YAML) and asserts that resolveStateDir() in
 * hive/lib/config.js produces the shared expected path for every row.
 * The canonical implementation is hive/lib/config.py resolve_state_dir;
 * the Python harness (tests/test_state_dir_conformance.py) additionally
 * drives the shell shim, so all three runtimes are pinned to the same
 * expected bytes.
 *
 * Run: node --test tests/state-dir-conformance.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// hive/lib is an ESM package scope ("type": "module"); dynamic import() loads
// it from this CJS test file on every supported Node version.
const configModulePromise = import(
  pathToFileURL(path.join(__dirname, '..', 'hive', 'lib', 'config.js')).href
);

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'state-dir-conformance.yaml');
const { rows } = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

/**
 * Materialize one fixture row in a fresh canonical temp dir: substitute the
 * $TMP placeholder, create dirs/symlinks, write config_yaml to config_path,
 * and build the per-row env. Returns { tmp, cwd, env, expected }.
 */
function setUpRow(row) {
  const tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'state-dir-conformance-'))
  );
  const sub = (value) => value.replaceAll('$TMP', tmp);

  for (const dir of row.dirs || []) {
    fs.mkdirSync(sub(dir), { recursive: true });
  }
  for (const [link, target] of Object.entries(row.symlinks || {})) {
    fs.symlinkSync(sub(target), sub(link));
  }

  if (row.config_yaml !== null && row.config_yaml !== undefined) {
    const configPath = sub(row.config_path);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, sub(row.config_yaml), 'utf8');
  }

  // Env is taken verbatim from the row (CONFIG_FILE / HIVE_ROOT /
  // HIVE_STATE_DIR are all per-row), so the config-file location tiers are
  // actually observable.
  const env = {};
  for (const [key, value] of Object.entries(row.env || {})) {
    env[key] = sub(value);
  }

  return { tmp, cwd: sub(row.cwd), env, expected: sub(row.expected) };
}

for (const row of rows) {
  test(`resolveStateDir conformance: ${row.name}`, async (t) => {
    const { resolveStateDir } = await configModulePromise;
    const { tmp, cwd, env, expected } = setUpRow(row);
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

    assert.equal(resolveStateDir({ cwd, env }), expected);
  });
}
