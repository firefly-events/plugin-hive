/**
 * SDK-version pin for maintainer-recorded sessions-cloud fixtures.
 *
 * Run: node tests/hive-lib/sdk-version-fixture-pin.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'sessions-cloud');
const LOCKFILE_PATH = path.join(REPO_ROOT, 'package-lock.json');
const RECORDING_PATH = path.join(FIXTURE_DIR, 'session-recording.ndjson');
const SDK_NAME = '@anthropic-ai/sdk';

function readFixtureVersion() {
  const [headerLine] = fs.readFileSync(RECORDING_PATH, 'utf8').split(/\r?\n/);
  const metadata = JSON.parse(headerLine);
  if (metadata.type !== 'fixture_metadata') {
    throw new Error('maintainer must re-record sessions-cloud fixture: missing fixture metadata header');
  }
  return metadata.sdk_version;
}

function readLockedSdkVersion() {
  const lock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, 'utf8'));
  const packages = lock && lock.packages;
  const rootPkg = packages && packages[`node_modules/${SDK_NAME}`];
  if (rootPkg && typeof rootPkg.version === 'string') return rootPkg.version;

  const dependency = lock && lock.dependencies && lock.dependencies[SDK_NAME];
  if (dependency && typeof dependency.version === 'string') return dependency.version;

  throw new Error(`could not locate ${SDK_NAME} in package-lock.json`);
}

test('fixture metadata pins the installed @anthropic-ai/sdk version', (t) => {
  if (!fs.existsSync(RECORDING_PATH)) {
    t.skip('pre-condition: maintainer-fixture-absent');
    return;
  }

  const fixtureVersion = readFixtureVersion();
  const lockedVersion = readLockedSdkVersion();
  assert.equal(
    fixtureVersion,
    lockedVersion,
    `maintainer must re-record sessions-cloud fixture: metadata sdk_version=${fixtureVersion} package-lock=${lockedVersion}`,
  );
});
