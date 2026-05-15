'use strict';

const fs = require('node:fs');
const path = require('node:path');

let yaml = null;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const EMIT_LIFECYCLE_AT_VALUES = new Set(['phase', 'story', 'step', 'off']);
const DEFAULT_PROJECT_CONFIG_PATH = path.join(process.cwd(), 'hive.config.yaml');
const DEFAULT_BASELINE_CONFIG_PATH = path.join(__dirname, '..', 'hive.config.yaml');

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

module.exports = {
  EMIT_LIFECYCLE_AT_VALUES,
  parseConfigText,
  readConfigFile,
  readEmitLifecycleAt,
  validateEmitLifecycleAt,
};
