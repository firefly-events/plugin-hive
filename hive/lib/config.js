// ESM module: hive/lib/package.json declares `"type": "module"`, so plain
// `.js` files in this package scope are ES modules (the previous CJS form was
// un-loadable here). Named exports are unchanged. On Node >= 22.12,
// `require()` of this file works via require(esm); on older Node versions,
// require() callers (e.g. handoff/dispatch.mjs `_require`) fall to their
// existing try/catch fallback — the same behavior they had before this change.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);
const _dirname = path.dirname(fileURLToPath(import.meta.url));

let yaml = null;
try {
  yaml = _require('js-yaml');
} catch {
  yaml = null;
}

const EMIT_LIFECYCLE_AT_VALUES = new Set(['phase', 'story', 'step', 'off']);
const DEFAULT_PROJECT_CONFIG_PATH = path.join(process.cwd(), 'hive.config.yaml');
const DEFAULT_BASELINE_CONFIG_PATH = path.join(_dirname, '..', 'hive.config.yaml');

function readConfigFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseConfigText(raw);
}

function parseConfigText(raw) {
  if (!raw || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {}

  if (yaml) {
    const safeLoader = typeof yaml.safeLoad === 'function' ? yaml.safeLoad : yaml.load;
    const parsed = safeLoader(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  return parseTopLevelYamlScalars(raw);
}

function parseTopLevelYamlScalars(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*(?:#.*)?$/);
    if (!match) continue;
    result[match[1]] = coerceConfigValue(match[2]);
  }
  return result;
}

function coerceConfigValue(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'null') return null;
  return normalized;
}

function validateEmitLifecycleAt(value, sourcePath = 'hive.config.yaml') {
  if (value === undefined || value === null || value === '') return 'phase';
  if (typeof value !== 'string' || !EMIT_LIFECYCLE_AT_VALUES.has(value)) {
    throw new Error(
      `Invalid emit_lifecycle_at in ${sourcePath}: ${JSON.stringify(value)}. ` +
      'Allowed values: phase, story, step, off.'
    );
  }
  return value;
}

/**
 * resolveStateDir — Node compatibility shim for the state-dir resolver.
 *
 * The CANONICAL implementation is `resolve_state_dir` in hive/lib/config.py
 * (language-strategy ADR Option B); this shim and the shell resolver in
 * hooks/common.sh conform to its behavior, proven by the shared fixture
 * tests/fixtures/state-dir-conformance.yaml.
 *
 * Precedence: HIVE_STATE_DIR env > paths.state_dir in the root
 * hive.config.yaml > default `.pHive`. The config file is located via
 * CONFIG_FILE env when set, else $HIVE_ROOT/hive.config.yaml when HIVE_ROOT
 * is set and non-empty, else cwd/hive.config.yaml.
 * Absolute values are used as-is; relative values resolve under
 * paths.target_project when set (itself resolved under cwd when relative),
 * else under cwd. Output is always absolute and symlink-canonicalized.
 */
function resolveStateDir(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  let configPath =
    env.CONFIG_FILE ||
    (env.HIVE_ROOT
      ? path.join(env.HIVE_ROOT, 'hive.config.yaml')
      : path.join(cwd, 'hive.config.yaml'));
  // Relative CONFIG_FILE/HIVE_ROOT resolve against the cwd argument (the
  // shell shim cd's to cwd first, so this keeps the runtimes conformant).
  if (!path.isAbsolute(configPath)) configPath = path.join(cwd, configPath);

  // Like the shell shim, the env value is used raw (empty means unset);
  // only config-sourced values go through scalar cleaning.
  let stateDir = env.HIVE_STATE_DIR || null;
  if (stateDir === null) {
    stateDir = readPathsValue(configPath, 'state_dir');
    if (stateDir === null) stateDir = '.pHive';
  }

  if (path.isAbsolute(stateDir)) return canonicalizePath(stateDir);

  const targetProject = readPathsValue(configPath, 'target_project');
  let base;
  if (targetProject === null) {
    base = cwd;
  } else if (path.isAbsolute(targetProject)) {
    base = canonicalizePath(targetProject);
  } else {
    base = canonicalizePath(path.join(cwd, targetProject));
  }

  return canonicalizePath(path.join(base, stateDir));
}

/**
 * Symlink-canonicalize an absolute path. Like `realpath -m`: the longest
 * existing prefix is resolved through the filesystem and any non-existent
 * tail components are appended unchanged.
 */
function canonicalizePath(inputPath) {
  let current = path.normalize(inputPath);
  const pending = [];
  for (;;) {
    try {
      const resolved = fs.realpathSync(current);
      return pending.length ? path.join(resolved, ...pending) : resolved;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return pending.length ? path.join(current, ...pending) : current;
      }
      pending.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Read one `paths.<key>` scalar from a hive.config.yaml file. Tries JSON,
 * then js-yaml when available, then the line-oriented block fallback.
 * Returns a cleaned string or null when missing/empty/"null".
 */
function readPathsValue(configPath, key) {
  if (!configPath || !fs.existsSync(configPath)) return null;
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }

  let parsed = null;
  try {
    const candidate = JSON.parse(raw);
    if (candidate && typeof candidate === 'object') parsed = candidate;
  } catch {}

  if (parsed === null && yaml) {
    try {
      const safeLoader = typeof yaml.safeLoad === 'function' ? yaml.safeLoad : yaml.load;
      const candidate = safeLoader(raw);
      if (candidate && typeof candidate === 'object') parsed = candidate;
    } catch {}
  }

  if (parsed !== null) {
    const paths = parsed.paths;
    const value = paths && typeof paths === 'object' ? paths[key] : undefined;
    return cleanPathsScalar(value);
  }

  return cleanPathsScalar(parsePathsBlockValue(raw, key));
}

/**
 * Line-oriented fallback mirroring the awk parse in hooks/common.sh: scans
 * the `paths:` block for `key` when neither JSON nor js-yaml parsing applies.
 * Inline `# comments` are stripped from the value, matching YAML parsers.
 */
function parsePathsBlockValue(raw, key) {
  let inPaths = false;
  const keyPattern = new RegExp(
    `^\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`
  );
  for (const line of raw.split(/\r?\n/)) {
    if (/^paths:\s*(?:#.*)?$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^[^\s#][^:]*:/.test(line)) inPaths = false;
    if (inPaths) {
      const match = line.match(keyPattern);
      if (match) return match[1].replace(/\s*#.*$/, '');
    }
  }
  return null;
}

/**
 * Normalize a paths scalar: trim, strip one matching pair of surrounding
 * quotes, and map ""/"null" to null (mirrors the shell shim's awk cleanup).
 */
function cleanPathsScalar(value) {
  if (value === undefined || value === null) return null;
  let text = String(value).trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1);
  }
  if (text === '' || text === 'null') return null;
  return text;
}

function readEmitLifecycleAt(options = {}) {
  const baselineConfigPath = options.baselineConfigPath || DEFAULT_BASELINE_CONFIG_PATH;
  const projectConfigPath = options.projectConfigPath || process.env.HIVE_CONFIG || DEFAULT_PROJECT_CONFIG_PATH;
  const baselineConfig = readConfigFile(baselineConfigPath);
  const projectConfig = readConfigFile(projectConfigPath);

  if (Object.prototype.hasOwnProperty.call(projectConfig, 'emit_lifecycle_at')) {
    return validateEmitLifecycleAt(projectConfig.emit_lifecycle_at, projectConfigPath);
  }
  if (Object.prototype.hasOwnProperty.call(baselineConfig, 'emit_lifecycle_at')) {
    return validateEmitLifecycleAt(baselineConfig.emit_lifecycle_at, baselineConfigPath);
  }
  return 'phase';
}

export {
  EMIT_LIFECYCLE_AT_VALUES,
  parseConfigText,
  readConfigFile,
  readEmitLifecycleAt,
  resolveStateDir,
  validateEmitLifecycleAt,
};
