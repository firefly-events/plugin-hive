import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function repoPath(...parts) {
  return path.join(repoRoot, ...parts);
}

async function readText(...parts) {
  return readFile(repoPath(...parts), 'utf8');
}

async function readJson(...parts) {
  return JSON.parse(await readText(...parts));
}

function readmeBadgeLine(readme) {
  return readme
    .split('\n')
    .find((line) => line.includes('img.shields.io/badge/version-'));
}

test('multica execute mode docs and release versions are aligned at 2.7.0', async () => {
  const [
    pluginJson,
    marketplaceJson,
    readme,
    changelog,
    guide,
  ] = await Promise.all([
    readJson('.claude-plugin', 'plugin.json'),
    readJson('.claude-plugin', 'marketplace.json'),
    readText('README.md'),
    readText('CHANGELOG.md'),
    readText('GUIDE.md'),
  ]);

  assert.equal(pluginJson.version, '2.7.0');
  assert.equal(marketplaceJson.version, '2.7.0');
  assert.equal(marketplaceJson.plugins[0].version, '2.7.0');

  assert.match(readmeBadgeLine(readme), /version-2\.7\.0-green/);

  assert.match(changelog, /^## \[2\.7\.0\]/m);
  for (const needle of [
    'multica',
    'execute-mode-multica',
    'HIVE_EXECUTION_MODE',
    '/hive:multica-init',
  ]) {
    assert.ok(changelog.includes(needle), `CHANGELOG.md contains ${needle}`);
  }

  for (const needle of [
    'HIVE_EXECUTION_MODE=multica',
    'execution.mode: multica',
  ]) {
    assert.ok(readme.includes(needle), `README.md contains ${needle}`);
  }

  for (const needle of [
    'whole-story',
    'fail-loud',
    'multica-run.yaml',
  ]) {
    assert.ok(guide.includes(needle), `GUIDE.md contains ${needle}`);
  }
});
