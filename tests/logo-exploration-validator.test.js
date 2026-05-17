'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const validator = require('../hive/lib/logo-exploration-validator.js');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logo-exploration-validator-'));
}

function buildValidExploration(root, options = {}) {
  const ts = options.timestamp || '20260517T143022Z';
  const dir = path.join(root, ts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'contact-sheet.html'), '<!doctype html><html></html>');
  fs.writeFileSync(path.join(dir, 'prompts.md'), '# prompts\n');
  const directions = options.directions || [1, 2];
  for (const d of directions) {
    const ddir = path.join(dir, `direction-${d}`);
    fs.mkdirSync(ddir);
    fs.writeFileSync(path.join(ddir, '.gitkeep'), '');
    const candidates = options.candidatesPerDirection || 4;
    for (let i = 0; i < candidates; i++) {
      fs.writeFileSync(path.join(ddir, `${i}.png`), 'png');
    }
  }
  return dir;
}

test('valid exploration dir passes with no errors or warnings', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('missing contact-sheet.html surfaces a clear error', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.unlinkSync(path.join(dir, 'contact-sheet.html'));
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => /missing required file: contact-sheet\.html/.test(e)),
    `errors: ${JSON.stringify(result.errors)}`
  );
});

test('missing prompts.md surfaces a clear error', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.unlinkSync(path.join(dir, 'prompts.md'));
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /missing required file: prompts\.md/.test(e)));
});

test('all errors are reported together when multiple required files are missing', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.unlinkSync(path.join(dir, 'contact-sheet.html'));
  fs.unlinkSync(path.join(dir, 'prompts.md'));
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /contact-sheet\.html/.test(e)));
  assert.ok(result.errors.some((e) => /prompts\.md/.test(e)));
});

test('no direction-<N>/ subdirectories is a hard failure', () => {
  const root = makeTempRoot();
  const dir = path.join(root, '20260517T143022Z');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'contact-sheet.html'), '');
  fs.writeFileSync(path.join(dir, 'prompts.md'), '');
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /no direction-<N>\/ subdirectories/.test(e)));
});

test('non-existent directory returns a clear error, not a throw', () => {
  const root = makeTempRoot();
  const result = validator.validateExplorationDir(path.join(root, 'does-not-exist'));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /does not exist/.test(e)));
});

test('non-directory path returns a clear error', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'file.txt');
  fs.writeFileSync(file, 'hi');
  const result = validator.validateExplorationDir(file);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /not a directory/.test(e)));
});

test('malformed timestamp dir name produces a warning, not an error', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root, { timestamp: 'not-a-timestamp' });
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, true);
  assert.ok(
    result.warnings.some((w) => /ISO-8601 UTC compact/.test(w)),
    `warnings: ${JSON.stringify(result.warnings)}`
  );
});

test('valid selected.yaml referencing existing candidate passes', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.writeFileSync(
    path.join(dir, 'selected.yaml'),
    'direction: 2\ncandidate: 1\nnotes: |\n  Strongest optical balance.\n'
  );
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.errors, []);
});

test('selected.yaml naming a missing direction is rejected', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root, { directions: [1] });
  fs.writeFileSync(path.join(dir, 'selected.yaml'), 'direction: 5\ncandidate: 0\n');
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => /direction 5 has no matching direction-5\//.test(e))
  );
});

test('selected.yaml naming a missing candidate index is rejected', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root, { candidatesPerDirection: 2 });
  fs.writeFileSync(path.join(dir, 'selected.yaml'), 'direction: 1\ncandidate: 7\n');
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => /candidate 7 not found at direction-1\/7\.png/.test(e))
  );
});

test('selected.yaml with non-integer direction is rejected', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.writeFileSync(path.join(dir, 'selected.yaml'), 'direction: pick-me\ncandidate: 0\n');
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /"direction" must be a positive integer/.test(e)));
});

test('unknown top-level key in selected.yaml is a warning', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.writeFileSync(
    path.join(dir, 'selected.yaml'),
    'direction: 1\ncandidate: 0\nrating: 5\n'
  );
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => /unknown key "rating"/.test(w)));
});

test('edits/ as a file (not a directory) is a hard failure', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.writeFileSync(path.join(dir, 'edits'), 'oops');
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /"edits" exists but is not a directory/.test(e)));
});

test('unexpected top-level entry produces a warning, not an error', () => {
  const root = makeTempRoot();
  const dir = buildValidExploration(root);
  fs.writeFileSync(path.join(dir, 'scratch.txt'), 'note');
  const result = validator.validateExplorationDir(dir);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => /unexpected entry: scratch\.txt/.test(w)));
});

test('empty dirPath returns an error, not a throw', () => {
  const result = validator.validateExplorationDir('');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /non-empty string/.test(e)));
});
