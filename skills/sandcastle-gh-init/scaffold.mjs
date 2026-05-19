#!/usr/bin/env node
/**
 * scaffold.mjs — implementation for /hive:sandcastle-gh-init.
 *
 * Layers GH-event-trigger glue on top of an already-initialized
 * Sandcastle setup. Sandcastle init is a prerequisite; this helper
 * never runs it. Managed files live under `.github/` and
 * `.hive-dispatch/`; `.sandcastle/` stays sandcastle's domain.
 *
 * Order matters: prereq check, then `gh` auth, then label probe,
 * then arg parsing, then writes. Every write is recorded in the
 * manifest so re-runs are bounded to managed paths.
 *
 * Stdlib + `gh`/`git` only. No new npm deps.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, 'assets');

const GH_BIN = process.env.HIVE_GH_BIN || 'gh';
const GIT_BIN = process.env.HIVE_GIT_BIN || 'git';

const CANONICAL_LABELS = [
  'hive:ready',
  'hive:in-flight',
  'hive:shipped',
  'hive:failed',
];

const VALID_RUNNERS = new Set(['ubuntu-latest', 'self-hosted']);
// `claude-oauth` is the new default (subscription OAuth via
// CLAUDE_CODE_OAUTH_TOKEN — no per-token billing). `anthropic-api` is
// the legacy pay-per-token path. `anthropic` is a back-compat alias
// for `anthropic-api` so consumers running `--secret-mode anthropic`
// don't break across the rename.
const VALID_SECRET_MODES = new Set([
  'claude-oauth',
  'anthropic-api',
  'anthropic',
  'openai',
]);
const SECRET_MODE_TO_KEY = {
  'claude-oauth': 'CLAUDE_CODE_OAUTH_TOKEN',
  'anthropic-api': 'ANTHROPIC_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const MANAGED_FILES = [
  '.github/workflows/hive-dispatch.yml',
  '.github/scripts/sandcastle-hive-bridge.mts',
  '.hive-dispatch/manifest.yaml',
];

const PREREQ_CONTAINER_FILES = [
  '.sandcastle/Dockerfile',
  '.sandcastle/Containerfile',
];
const PREREQ_REMEDIATION =
  "Sandcastle is not initialized in this repo. Run 'npx sandcastle init', " +
  'choose your provider/template/backlog, then re-run /hive:sandcastle-gh-init. ' +
  '(Looks for .sandcastle/Dockerfile or .sandcastle/Containerfile — sandcastle ' +
  '0.5.x ships a Podman-style Containerfile by default.)';

function usage() {
  return [
    'Usage: node skills/sandcastle-gh-init/scaffold.mjs',
    '         [--runner ubuntu-latest|self-hosted]',
    '         [--secret-mode claude-oauth|anthropic-api|openai]',
    '         [--force-recover]',
    '         [--cwd <path>]',
  ].join('\n');
}

function fail(message, code = 1) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

function warn(message) {
  process.stderr.write(`WARN: ${message}\n`);
}

function parseArgs(argv) {
  const out = {
    runner: 'ubuntu-latest',
    secretMode: 'claude-oauth',
    forceRecover: false,
    cwd: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--runner') {
      const value = argv[++i];
      if (!value) fail('--runner requires a value.');
      if (!VALID_RUNNERS.has(value)) {
        fail(
          `invalid --runner '${value}'. Allowed: ${[...VALID_RUNNERS].join(', ')}.`,
        );
      }
      out.runner = value;
      continue;
    }
    if (arg === '--secret-mode') {
      const value = argv[++i];
      if (!value) fail('--secret-mode requires a value.');
      if (!VALID_SECRET_MODES.has(value)) {
        fail(
          `invalid --secret-mode '${value}'. Allowed: ${[...VALID_SECRET_MODES].join(', ')}.`,
        );
      }
      if (value === 'anthropic') {
        warn(
          "--secret-mode 'anthropic' is a deprecated alias for 'anthropic-api'. " +
            "Use --secret-mode anthropic-api (per-token API billing) or " +
            "--secret-mode claude-oauth (subscription OAuth, the new default).",
        );
      }
      out.secretMode = value;
      continue;
    }
    if (arg === '--force-recover') {
      out.forceRecover = true;
      continue;
    }
    if (arg === '--cwd') {
      const value = argv[++i];
      if (!value) fail('--cwd requires a path.');
      out.cwd = value;
      continue;
    }
    fail(`unknown argument '${arg}'.\n\n${usage()}`);
  }
  return out;
}

function checkPrereqs(cwd) {
  const found = PREREQ_CONTAINER_FILES.some((rel) =>
    fs.existsSync(path.join(cwd, rel)),
  );
  if (!found) {
    process.stderr.write(`${PREREQ_REMEDIATION}\n`);
    process.exit(2);
  }
}

function runGh(args, cwd) {
  return execFileSync(GH_BIN, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function checkGhAuth(cwd) {
  try {
    execFileSync(GH_BIN, ['auth', 'status'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') {
      fail(
        "the `gh` CLI is required but was not found on PATH. " +
          'Install GitHub CLI from https://cli.github.com/ and re-run.',
      );
    }
    const stderr = (error && error.stderr && error.stderr.toString()) || '';
    fail(
      "`gh auth status` failed. Run `gh auth login` to authenticate before " +
        `re-running.${stderr ? `\n  ${stderr.trim().split('\n').join('\n  ')}` : ''}`,
    );
  }
}

function probeCanonicalLabels(cwd) {
  let raw;
  try {
    raw = runGh(['label', 'list', '--json', 'name', '--limit', '200'], cwd);
  } catch (error) {
    const stderr = (error && error.stderr && error.stderr.toString()) || '';
    warn(
      'could not list repository labels (skipping the canonical-label check).' +
        (stderr ? ` gh said: ${stderr.trim().split('\n')[0]}` : ''),
    );
    return;
  }
  let labels;
  try {
    labels = JSON.parse(raw);
  } catch {
    warn('could not parse `gh label list --json name` output; skipping label check.');
    return;
  }
  const names = new Set(
    (Array.isArray(labels) ? labels : [])
      .map((entry) => (entry && entry.name ? String(entry.name) : null))
      .filter(Boolean),
  );
  const missing = CANONICAL_LABELS.filter((name) => !names.has(name));
  if (missing.length === 0) return;
  warn(
    'the following canonical Hive labels are missing on this repository:\n  ' +
      missing.join(', ') +
      '\n  Hive dispatch will still scaffold, but the workflow will fail at the' +
      '\n  first label transition. Create them with:',
  );
  for (const label of missing) {
    process.stderr.write(
      `    gh label create '${label}' --description 'Hive dispatch state'\n`,
    );
  }
}

function readSandcastlePin(cwd) {
  const pkgPath = path.join(
    cwd,
    'node_modules',
    '@ai-hero',
    'sandcastle',
    'package.json',
  );
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // fall through to npm ls fallback
    }
  }
  try {
    const raw = execFileSync(
      'npm',
      ['ls', '@ai-hero/sandcastle', '--json', '--depth=0'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const parsed = JSON.parse(raw);
    const entry =
      parsed &&
      parsed.dependencies &&
      parsed.dependencies['@ai-hero/sandcastle'];
    if (entry && typeof entry.version === 'string') return entry.version;
  } catch {
    // ignored — fall through to unknown
  }
  warn(
    'could not determine @ai-hero/sandcastle version. Recording "unknown" in ' +
      'manifest. Install sandcastle into the consumer repo (npm i @ai-hero/sandcastle) ' +
      'and re-run to pin a version.',
  );
  return 'unknown';
}

function renderTemplate(tpl, substitutions) {
  let out = tpl;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function readManifest(cwd) {
  const manifestPath = path.join(cwd, '.hive-dispatch', 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const managed = [];
  let inManaged = false;
  for (const line of raw.split('\n')) {
    if (/^managed_files:\s*$/.test(line)) {
      inManaged = true;
      continue;
    }
    if (inManaged) {
      const match = line.match(/^\s+-\s+(.+?)\s*$/);
      if (match) {
        managed.push(match[1].replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (/^\S/.test(line)) inManaged = false;
    }
  }
  return { managedFiles: managed };
}

function checkPartialScaffold(cwd, forceRecover) {
  const conflicts = MANAGED_FILES.filter((rel) =>
    fs.existsSync(path.join(cwd, rel)),
  );
  if (conflicts.length === 0) return;
  if (forceRecover) {
    warn(
      'partial scaffold detected (no manifest, but managed files present). ' +
        '--force-recover passed; overwriting:\n  - ' +
        conflicts.join('\n  - '),
    );
    return;
  }
  fail(
    'partial scaffold detected — managed files already exist but ' +
      '.hive-dispatch/manifest.yaml is absent. The following paths conflict:\n  - ' +
      conflicts.join('\n  - ') +
      "\n\nRe-run with `--force-recover` to overwrite, or delete the files yourself first.",
    3,
  );
}

function writeFile(cwd, relPath, contents) {
  const abs = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf8');
}

function serializeManifest(fields) {
  const lines = [];
  lines.push(`version: 1`);
  lines.push(`sandcastle_pin: ${yamlScalar(fields.sandcastle_pin)}`);
  lines.push(`runner: ${yamlScalar(fields.runner)}`);
  lines.push(`secret_mode: ${yamlScalar(fields.secret_mode)}`);
  lines.push(`created_at: ${yamlScalar(fields.created_at)}`);
  lines.push(`managed_files:`);
  for (const file of fields.managed_files) {
    lines.push(`  - ${yamlScalar(file)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function yamlScalar(value) {
  const str = String(value);
  if (/^[A-Za-z0-9_./:+-]+$/.test(str) && !/^[0-9]/.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function gitAddAndCommit(cwd, files) {
  try {
    execFileSync(GIT_BIN, ['add', '--', ...files], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error && error.stderr && error.stderr.toString()) || '';
    fail(
      `\`git add\` failed. Ensure you are inside a git working tree before running this skill.${
        stderr ? `\n  ${stderr.trim()}` : ''
      }`,
    );
  }
  const body =
    'chore(hive): wire github-issue dispatch via sandcastle\n\n' +
    'Files written:\n' +
    files.map((f) => `- ${f}`).join('\n') +
    '\n';
  try {
    execFileSync(GIT_BIN, ['commit', '-m', body], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error && error.stderr && error.stderr.toString()) || '';
    fail(
      `\`git commit\` failed. Resolve the issue and commit manually, or re-run the skill.${
        stderr ? `\n  ${stderr.trim()}` : ''
      }`,
    );
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();

  checkPrereqs(cwd);
  checkGhAuth(cwd);
  probeCanonicalLabels(cwd);

  const manifest = readManifest(cwd);
  if (!manifest) {
    checkPartialScaffold(cwd, opts.forceRecover);
  }

  const secretKey = SECRET_MODE_TO_KEY[opts.secretMode];
  const ymlTpl = fs.readFileSync(
    path.join(ASSETS_DIR, 'hive-dispatch.yml.tpl'),
    'utf8',
  );
  const mtsTpl = fs.readFileSync(
    path.join(ASSETS_DIR, 'sandcastle-hive-bridge.mts.tpl'),
    'utf8',
  );
  const workflowOut = renderTemplate(ymlTpl, {
    RUNNER: opts.runner,
    SECRET_KEY: secretKey,
  });
  const bridgeOut = renderTemplate(mtsTpl, { SECRET_KEY: secretKey });

  writeFile(cwd, '.github/workflows/hive-dispatch.yml', workflowOut);
  writeFile(cwd, '.github/scripts/sandcastle-hive-bridge.mts', bridgeOut);

  const sandcastlePin = readSandcastlePin(cwd);
  const manifestBody = serializeManifest({
    sandcastle_pin: sandcastlePin,
    runner: opts.runner,
    secret_mode: opts.secretMode,
    created_at: new Date().toISOString(),
    managed_files: MANAGED_FILES,
  });
  writeFile(cwd, '.hive-dispatch/manifest.yaml', manifestBody);

  gitAddAndCommit(cwd, MANAGED_FILES);

  process.stdout.write(
    [
      'Hive dispatch scaffold complete.',
      `  runner:       ${opts.runner}`,
      `  secret mode:  ${opts.secretMode} (env: ${secretKey})`,
      `  sandcastle:   ${sandcastlePin}`,
      '  files:',
      ...MANAGED_FILES.map((f) => `    - ${f}`),
      '',
      'Next steps:',
      `  1. Add ${secretKey} as a repository secret (Settings -> Secrets -> Actions).`,
      "  2. Label any planned issue 'hive:ready' to trigger the workflow.",
      '',
    ].join('\n'),
  );
}

main();
