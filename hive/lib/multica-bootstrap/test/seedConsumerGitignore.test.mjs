import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { seedConsumerGitignoreWithDeps } from '../index.mjs';

const REPO_ROOT = '/repo';
const GITIGNORE = path.join(REPO_ROOT, '.gitignore');
const LINE = '.pHive/dag-outputs/';

// In-memory fake fs implementing only the surface seedConsumerGitignoreWithDeps
// uses: readFileSync (throws ENOENT when absent), writeFileSync, mkdirSync.
function makeFakeFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const dirs = [];
  return {
    files,
    dirs,
    readFileSync(p) {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: no such file, open '${p}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p);
    },
    writeFileSync(p, content) {
      files.set(p, content);
    },
    mkdirSync(p) {
      dirs.push(p);
    },
  };
}

// AC-1: consumer repo that has never run multica-init (has a .gitignore lacking
// the line) — after the run .gitignore contains .pHive/dag-outputs/.
test('AC-1: appends line to an existing .gitignore that lacks it', () => {
  const fs = makeFakeFs({ [GITIGNORE]: 'node_modules/\n.pHive/cache/\n' });
  const res = seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  assert.equal(res.seeded, true);
  assert.ok(fs.files.get(GITIGNORE).split('\n').includes(LINE));
});

// AC-2: consumer repo that already has the line — re-running does not duplicate it.
test('AC-2: does not duplicate the line when already present', () => {
  const fs = makeFakeFs({ [GITIGNORE]: `node_modules/\n${LINE}\n` });
  const res = seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  assert.equal(res.seeded, false);
  const occurrences = fs.files.get(GITIGNORE).split('\n').filter((l) => l === LINE).length;
  assert.equal(occurrences, 1);
});

// AC-2 (repeated-run idempotency): running twice in a row yields a single line.
test('AC-2: repeated runs stay idempotent (no growth on second run)', () => {
  const fs = makeFakeFs({ [GITIGNORE]: '.pHive/cache/\n' });
  seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  const afterFirst = fs.files.get(GITIGNORE);
  const second = seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  assert.equal(second.seeded, false);
  assert.equal(fs.files.get(GITIGNORE), afterFirst);
  assert.equal(fs.files.get(GITIGNORE).split('\n').filter((l) => l === LINE).length, 1);
});

// AC-3: consumer repo with no .gitignore — it is created and contains the line.
test('AC-3: creates .gitignore when none exists and writes the line', () => {
  const fs = makeFakeFs({});
  const res = seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  assert.equal(res.seeded, true);
  assert.ok(fs.files.has(GITIGNORE));
  assert.ok(fs.files.get(GITIGNORE).split('\n').includes(LINE));
});

// AC-4: the line is placed immediately after the last existing .pHive/ entry,
// not at an arbitrary position and not at the end of the file.
test('AC-4: inserts immediately after the last existing .pHive entry', () => {
  const fs = makeFakeFs({
    [GITIGNORE]: 'node_modules/\n.pHive/cache/\n.pHive/state/\ndist/\n',
  });
  seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  const lines = fs.files.get(GITIGNORE).split('\n').filter((l) => l !== '');
  const lastPhiveIdx = lines.lastIndexOf('.pHive/state/');
  assert.equal(lines[lastPhiveIdx + 1], LINE);
  // and it must sit before the unrelated trailing 'dist/' entry
  assert.ok(lines.indexOf(LINE) < lines.indexOf('dist/'));
});

// AC-4 (no .pHive entries present): falls back to appending at end of file.
test('AC-4: appends at end when no .pHive entry exists for grouping', () => {
  const fs = makeFakeFs({ [GITIGNORE]: 'node_modules/\ndist/\n' });
  seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  const lines = fs.files.get(GITIGNORE).split('\n').filter((l) => l !== '');
  assert.equal(lines[lines.length - 1], LINE);
});

// Adversarial (story risk §risks): the duplicate guard must be string-exact —
// a no-trailing-slash variant must NOT block seeding the exact line.
test('exact-match guard: variant without trailing slash does not suppress the seed', () => {
  const fs = makeFakeFs({ [GITIGNORE]: '.pHive/dag-outputs\n' });
  const res = seedConsumerGitignoreWithDeps({ repoRoot: REPO_ROOT, fs });
  assert.equal(res.seeded, true);
  assert.ok(fs.files.get(GITIGNORE).split('\n').includes(LINE));
});
