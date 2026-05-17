'use strict';

const fs = require('node:fs');
const path = require('node:path');

let yaml = null;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const REQUIRED_FILES = ['contact-sheet.html', 'prompts.md'];
const DIRECTION_DIR_RE = /^direction-([1-9]\d*)$/;
const CANDIDATE_FILE_RE = /^(\d+)\.png$/;
const TIMESTAMP_RE = /^[0-9]{8}T[0-9]{6}Z$/;
const KNOWN_TOP_LEVEL_ENTRIES = new Set([
  'contact-sheet.html',
  'prompts.md',
  'selected.yaml',
  'edits',
  '.gitkeep',
]);

function validateExplorationDir(dirPath) {
  const errors = [];
  const warnings = [];

  if (typeof dirPath !== 'string' || !dirPath) {
    errors.push('dirPath must be a non-empty string');
    return { valid: false, errors, warnings };
  }

  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    errors.push(`directory does not exist: ${dirPath}`);
    return { valid: false, errors, warnings };
  }
  if (!stat.isDirectory()) {
    errors.push(`not a directory: ${dirPath}`);
    return { valid: false, errors, warnings };
  }

  const dirName = path.basename(dirPath);
  if (!TIMESTAMP_RE.test(dirName)) {
    warnings.push(
      `directory name "${dirName}" does not match ISO-8601 UTC compact format (YYYYMMDDTHHMMSSZ)`
    );
  }

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    errors.push(`unable to read directory ${dirPath}: ${err.message}`);
    return { valid: false, errors, warnings };
  }
  const entryByName = new Map(entries.map((e) => [e.name, e]));

  for (const required of REQUIRED_FILES) {
    const entry = entryByName.get(required);
    if (!entry) {
      errors.push(`missing required file: ${required}`);
    } else if (!entry.isFile()) {
      errors.push(`expected file but found non-file: ${required}`);
    }
  }

  const directionDirs = entries.filter(
    (e) => e.isDirectory() && DIRECTION_DIR_RE.test(e.name)
  );
  if (directionDirs.length === 0) {
    errors.push('no direction-<N>/ subdirectories found (at least one is required)');
  }

  const directionNumbers = new Map();
  for (const dir of directionDirs) {
    const num = Number(dir.name.match(DIRECTION_DIR_RE)[1]);
    const candidates = collectCandidatePngs(path.join(dirPath, dir.name));
    directionNumbers.set(num, candidates);
    if (candidates.size === 0) {
      warnings.push(`${dir.name}/ contains no <i>.png candidate files`);
    }
  }

  const selectedPath = path.join(dirPath, 'selected.yaml');
  if (entryByName.has('selected.yaml')) {
    validateSelected(selectedPath, directionNumbers, errors, warnings);
  }

  const editsEntry = entryByName.get('edits');
  if (editsEntry && !editsEntry.isDirectory()) {
    errors.push('"edits" exists but is not a directory');
  }

  for (const entry of entries) {
    if (KNOWN_TOP_LEVEL_ENTRIES.has(entry.name)) continue;
    if (entry.isDirectory() && DIRECTION_DIR_RE.test(entry.name)) continue;
    warnings.push(`unexpected entry: ${entry.name}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function collectCandidatePngs(directionDirPath) {
  const result = new Set();
  let entries;
  try {
    entries = fs.readdirSync(directionDirPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(CANDIDATE_FILE_RE);
    if (match) result.add(Number(match[1]));
  }
  return result;
}

function validateSelected(filePath, directionNumbers, errors, warnings) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    errors.push(`selected.yaml unreadable: ${err.message}`);
    return;
  }

  let parsed;
  try {
    parsed = parseSelectedYaml(raw);
  } catch (err) {
    errors.push(`selected.yaml parse error: ${err.message}`);
    return;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('selected.yaml must be a YAML mapping at the top level');
    return;
  }

  const allowed = new Set(['direction', 'candidate', 'notes']);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) warnings.push(`selected.yaml: unknown key "${key}"`);
  }

  const direction = parsed.direction;
  const candidate = parsed.candidate;

  if (!Number.isInteger(direction) || direction <= 0) {
    errors.push('selected.yaml: "direction" must be a positive integer');
  } else if (!directionNumbers.has(direction)) {
    errors.push(
      `selected.yaml: direction ${direction} has no matching direction-${direction}/ subdirectory`
    );
  }

  if (!Number.isInteger(candidate) || candidate < 0) {
    errors.push('selected.yaml: "candidate" must be a non-negative integer');
  } else if (Number.isInteger(direction) && directionNumbers.has(direction)) {
    const pngs = directionNumbers.get(direction);
    if (!pngs.has(candidate)) {
      errors.push(
        `selected.yaml: candidate ${candidate} not found at direction-${direction}/${candidate}.png`
      );
    }
  }

  if (parsed.notes !== undefined && typeof parsed.notes !== 'string') {
    errors.push('selected.yaml: "notes" must be a string if present');
  }
}

function parseSelectedYaml(raw) {
  if (yaml) {
    const loader = typeof yaml.safeLoad === 'function' ? yaml.safeLoad : yaml.load;
    return loader(raw);
  }
  return parseMinimalSelectedYaml(raw);
}

function parseMinimalSelectedYaml(raw) {
  const result = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const scalar = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*(?:#.*)?$/);
    if (!scalar) {
      throw new Error(`unparseable line: ${line}`);
    }
    const key = scalar[1];
    const rest = scalar[2];
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const buf = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.startsWith(' ') || next.startsWith('\t') || next.trim() === '') {
          buf.push(next.replace(/^\s{0,4}/, ''));
          i++;
        } else {
          break;
        }
      }
      result[key] = buf.join('\n').replace(/\s+$/, '');
      continue;
    }
    result[key] = coerceScalar(rest);
    i++;
  }
  return result;
}

function coerceScalar(raw) {
  if (raw === '' || raw === '~' || raw.toLowerCase() === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  const quoted = raw.match(/^"(.*)"$|^'(.*)'$/);
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2];
  return raw;
}

module.exports = {
  validateExplorationDir,
  TIMESTAMP_RE,
  REQUIRED_FILES,
};
