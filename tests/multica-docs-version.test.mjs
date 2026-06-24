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

function extractChangelogSection(changelog, version) {
  const headingPattern = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\].*$`, 'm');
  const match = changelog.match(headingPattern);

  assert.ok(match, `expected CHANGELOG.md to contain ${version} heading`);

  const start = match.index;
  const nextHeading = changelog.slice(start + match[0].length).search(/^## \[/m);
  const end = nextHeading === -1
    ? changelog.length
    : start + match[0].length + nextHeading;

  return changelog.slice(start, end);
}

test('multica docs and version release metadata are aligned', async () => {
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

  // Version metadata must be in lockstep across all sources. Pin to
  // plugin.json as the source of truth rather than a frozen literal, so this
  // contract holds at every release (it previously asserted 2.6.0 and silently
  // went stale after that bump).
  const version = pluginJson.version;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'AC3+5 plugin.json version is semver');
  assert.equal(marketplaceJson.version, version, 'AC4 marketplace outer version matches plugin.json');
  assert.equal(marketplaceJson.plugins[0].version, version, 'AC4 marketplace plugin version matches plugin.json');

  const badgeLine = readme
    .split('\n')
    .find((line) => line.includes('img.shields.io/badge/version-'));

  assert.ok(badgeLine, 'AC5 README version badge line exists');
  assert.ok(
    badgeLine.includes(`version-${version}-green`),
    `AC5 README version badge matches plugin.json (${version})`,
  );

  // The 2.6.0 changelog section is a historical anchor for the Multica-docs
  // epic (multica-init bootstrap + sandcastle cleanup) — assert it never regresses.
  const changelogSection = extractChangelogSection(changelog, '2.6.0');
  assert.match(changelogSection, /multica/i, 'AC6 2.6.0 section mentions Multica');
  assert.match(changelogSection, /\/hive:multica-init/, 'AC6 2.6.0 section mentions bootstrap command');
  assert.match(changelogSection, /sandcastle-adoption-followon/, 'AC6 2.6.0 section mentions cleanup epic');

  assert.match(readme, /\/hive:multica-init/, 'AC1 README mentions Multica bootstrap');
  assert.match(readme, /^#{2,3}\s+.*execution.*$/im, 'AC2 README has execution near a heading');

  for (const keyword of ['post-plan', 'post-review', 'Multica', 'execute']) {
    assert.match(guide, new RegExp(keyword), `GUIDE.md mentions ${keyword}`);
  }
});
