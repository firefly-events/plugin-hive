/**
 * Scenario YAML loader + validator for simulated-manual testing.
 *
 * Story: c-1-scenario-schema-and-loader (autonomous-cycle-loop)
 *
 * Exports:
 *   loadScenario(filePath, opts?) → parsed scenario object (throws on invalid)
 *   loadResults(filePath, opts?)  → parsed execution_results object (throws on invalid)
 *
 * Scenario schema (simulated-manual):
 *   id: string (required, kebab-case)
 *   title: string (required, non-empty)
 *   description: string (optional)
 *   mode: 'spec-walk' | 'implementation-walk' (required)
 *   NOTE: 'live-walk' was removed in M2 — actual/vision-cursor scenarios are now
 *   SimMan-format and are NOT loaded by this function (SimMan owns their parsing).
 *   story: string (optional — required for implementation-walk marker check)
 *   epic: string (optional — required for implementation-walk marker check)
 *   preconditions: string[] (optional)
 *   steps: { action: string, expected: string, actor?: string }[] (required, non-empty)
 *   postconditions: string[] (optional)
 *
 * implementation-walk refuses to proceed if the story's integrate episode
 * marker is absent from <state-dir>/episodes/<epic>/<story>/integrate.yaml,
 * where <state-dir> follows the sdr-1 resolver (HIVE_STATE_DIR env >
 * paths.state_dir in hive.config.yaml > default .pHive).
 *
 * execution_results schema (step-03-worker output):
 *   execution_results:
 *     story_id: string (required)
 *     epic_id: string (required)
 *     executed_at: string (required, ISO 8601)
 *     platform: string (required)
 *     device: string (required)
 *     results: { test_id, requirement_ref, status, duration_ms,
 *                started_at, finished_at, error?, screenshot?, log? }[] (required, non-empty)
 *     summary: { total, passed, failed, skipped, total_duration_ms } (required)
 *     artifacts: { screenshots_dir, logs_dir, results_file } (required)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveStateDir } from '../config.js';

const VALID_MODES = new Set(['spec-walk', 'implementation-walk']);
const CANONICAL_TOP_LEVEL_FIELDS = new Set([
  'id',
  'title',
  'description',
  'mode',
  'story',
  'epic',
  'preconditions',
  'steps',
  'postconditions',
]);
const LEGACY_TOP_LEVEL_FIELDS = new Set([
  'invocation',
  'pre_conditions',
  'expectations',
  'sandcastle_mode_override',
]);
const CANONICAL_STEP_FIELDS = new Set(['action', 'expected', 'actor']);

/**
 * Load and validate a scenario YAML file.
 *
 * @param {string} filePath - absolute or relative path to the scenario YAML
 * @param {{ cwd?: string, epicId?: string }} [opts]
 * @returns {object} parsed + validated scenario
 * @throws structured Error with .code, .filePath, .field
 */
export function loadScenario(filePath, { cwd = process.cwd(), epicId } = {}) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw makeError('FILE_NOT_FOUND', `Cannot read scenario file: ${filePath}: ${e.message}`, filePath, null);
  }

  let doc;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw makeError('YAML_PARSE_ERROR', `YAML parse error in ${filePath}: ${e.message}`, filePath, null);
  }

  validateSchema(doc, filePath);

  if (doc.mode === 'implementation-walk') {
    assertIntegrateMarker(doc, filePath, cwd, epicId);
  }

  return doc;
}

// ─── loadResults ─────────────────────────────────────────────────────────────

/**
 * Load and validate a step-03-worker execution_results YAML file.
 *
 * The file must contain a top-level `execution_results` mapping with fields:
 *   story_id, epic_id, executed_at, platform, device, results, summary, artifacts
 *
 * @param {string} filePath - absolute or relative path to the results.yaml file
 * @param {{ cwd?: string }} [opts]
 * @returns {{ execution_results: object }} parsed + validated results envelope
 * @throws structured Error with .code, .filePath, .field
 */
export function loadResults(filePath, { cwd = process.cwd() } = {}) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw makeError('FILE_NOT_FOUND', `Cannot read results file: ${filePath}: ${e.message}`, filePath, null);
  }

  let doc;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw makeError('YAML_PARSE_ERROR', `YAML parse error in ${filePath}: ${e.message}`, filePath, null);
  }

  validateResultsSchema(doc, filePath);

  return doc;
}

// ─── Results Validation ───────────────────────────────────────────────────────

const RESULTS_TOP_LEVEL_FIELDS = new Set(['execution_results']);
const RESULTS_ENVELOPE_FIELDS = new Set([
  'story_id',
  'epic_id',
  'executed_at',
  'platform',
  'device',
  'results',
  'summary',
  'artifacts',
]);
const RESULTS_ITEM_REQUIRED_FIELDS = new Set([
  'test_id',
  'requirement_ref',
  'status',
  'duration_ms',
  'started_at',
  'finished_at',
]);
const RESULTS_ITEM_OPTIONAL_FIELDS = new Set(['error', 'screenshot', 'log']);
const RESULTS_ITEM_ALL_FIELDS = new Set([
  ...RESULTS_ITEM_REQUIRED_FIELDS,
  ...RESULTS_ITEM_OPTIONAL_FIELDS,
]);
const VALID_TEST_STATUSES = new Set(['pass', 'fail', 'skipped']);
const SUMMARY_FIELDS = new Set(['total', 'passed', 'failed', 'skipped', 'total_duration_ms']);
const ARTIFACTS_FIELDS = new Set(['screenshots_dir', 'logs_dir', 'results_file']);

function validateResultsSchema(doc, filePath) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: results file must be a YAML mapping`,
      filePath,
      null,
    );
  }

  for (const field of Object.keys(doc)) {
    if (!RESULTS_TOP_LEVEL_FIELDS.has(field)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: unrecognized top-level field '${field}'; expected 'execution_results'`,
        filePath,
        field,
      );
    }
  }

  const er = doc.execution_results;
  if (!er || typeof er !== 'object' || Array.isArray(er)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: 'execution_results' must be a non-null mapping`,
      filePath,
      'execution_results',
    );
  }

  for (const field of Object.keys(er)) {
    if (!RESULTS_ENVELOPE_FIELDS.has(field)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: unrecognized field 'execution_results.${field}'`,
        filePath,
        `execution_results.${field}`,
      );
    }
  }

  // Required string scalars
  for (const f of ['story_id', 'epic_id', 'executed_at', 'platform', 'device']) {
    if (!er[f] || typeof er[f] !== 'string' || !er[f].trim()) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: 'execution_results.${f}' is required and must be a non-empty string`,
        filePath,
        `execution_results.${f}`,
      );
    }
  }

  // results array
  if (!Array.isArray(er.results) || er.results.length === 0) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: 'execution_results.results' is required and must be a non-empty array`,
      filePath,
      'execution_results.results',
    );
  }

  for (let i = 0; i < er.results.length; i++) {
    const item = er.results[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: execution_results.results[${i}] must be an object`,
        filePath,
        `execution_results.results[${i}]`,
      );
    }
    for (const field of Object.keys(item)) {
      if (!RESULTS_ITEM_ALL_FIELDS.has(field)) {
        throw makeError(
          'VALIDATION_ERROR',
          `${filePath}: unrecognized field 'execution_results.results[${i}].${field}'`,
          filePath,
          `execution_results.results[${i}].${field}`,
        );
      }
    }
    for (const req of RESULTS_ITEM_REQUIRED_FIELDS) {
      if (item[req] === undefined || item[req] === null) {
        throw makeError(
          'VALIDATION_ERROR',
          `${filePath}: 'execution_results.results[${i}].${req}' is required`,
          filePath,
          `execution_results.results[${i}].${req}`,
        );
      }
    }
    for (const strField of ['test_id', 'requirement_ref', 'started_at', 'finished_at']) {
      if (typeof item[strField] !== 'string' || !item[strField].trim()) {
        throw makeError(
          'VALIDATION_ERROR',
          `${filePath}: 'execution_results.results[${i}].${strField}' must be a non-empty string`,
          filePath,
          `execution_results.results[${i}].${strField}`,
        );
      }
    }
    if (!VALID_TEST_STATUSES.has(item.status)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: 'execution_results.results[${i}].status' must be one of [${[...VALID_TEST_STATUSES].join(', ')}]; got: ${JSON.stringify(item.status)}`,
        filePath,
        `execution_results.results[${i}].status`,
      );
    }
    if (typeof item.duration_ms !== 'number' || item.duration_ms < 0) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: 'execution_results.results[${i}].duration_ms' must be a non-negative number`,
        filePath,
        `execution_results.results[${i}].duration_ms`,
      );
    }
  }

  // summary
  const summary = er.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: 'execution_results.summary' is required and must be a mapping`,
      filePath,
      'execution_results.summary',
    );
  }
  for (const field of Object.keys(summary)) {
    if (!SUMMARY_FIELDS.has(field)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: unrecognized field 'execution_results.summary.${field}'`,
        filePath,
        `execution_results.summary.${field}`,
      );
    }
  }
  for (const f of SUMMARY_FIELDS) {
    if (typeof summary[f] !== 'number' || summary[f] < 0) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: 'execution_results.summary.${f}' is required and must be a non-negative number`,
        filePath,
        `execution_results.summary.${f}`,
      );
    }
  }

  // artifacts
  const artifacts = er.artifacts;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: 'execution_results.artifacts' is required and must be a mapping`,
      filePath,
      'execution_results.artifacts',
    );
  }
  for (const field of Object.keys(artifacts)) {
    if (!ARTIFACTS_FIELDS.has(field)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: unrecognized field 'execution_results.artifacts.${field}'`,
        filePath,
        `execution_results.artifacts.${field}`,
      );
    }
  }
  for (const f of ARTIFACTS_FIELDS) {
    if (!artifacts[f] || typeof artifacts[f] !== 'string' || !artifacts[f].trim()) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: 'execution_results.artifacts.${f}' is required and must be a non-empty string`,
        filePath,
        `execution_results.artifacts.${f}`,
      );
    }
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateSchema(doc, filePath) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: scenario must be a YAML mapping`,
      filePath,
      null,
    );
  }

  for (const field of Object.keys(doc)) {
    if (LEGACY_TOP_LEVEL_FIELDS.has(field)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: field '${field}' belongs to the deprecated invocation/pre_conditions/expectations schema; use the canonical mode/steps/preconditions/postconditions schema`,
        filePath,
        field,
      );
    }
    if (!CANONICAL_TOP_LEVEL_FIELDS.has(field)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: unrecognized top-level field '${field}'`,
        filePath,
        field,
      );
    }
  }

  requireString(doc, 'id', filePath);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.id.trim())) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: field 'id' must be kebab-case (lowercase letters/digits, hyphen-separated); got: ${JSON.stringify(doc.id)}`,
      filePath,
      'id',
    );
  }
  requireString(doc, 'title', filePath);
  optionalString(doc, 'description', filePath);
  optionalString(doc, 'story', filePath);
  optionalString(doc, 'epic', filePath);

  if (!doc.mode || !VALID_MODES.has(doc.mode)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: field 'mode' must be one of [${[...VALID_MODES].join(', ')}]; got: ${JSON.stringify(doc.mode)}`,
      filePath,
      'mode',
    );
  }

  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: field 'steps' is required and must be a non-empty array`,
      filePath,
      'steps',
    );
  }

  for (let i = 0; i < doc.steps.length; i++) {
    const step = doc.steps[i];
    if (!step || typeof step !== 'object') {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: steps[${i}] must be an object`,
        filePath,
        `steps[${i}]`,
      );
    }
    for (const field of Object.keys(step)) {
      if (!CANONICAL_STEP_FIELDS.has(field)) {
        throw makeError(
          'VALIDATION_ERROR',
          `${filePath}: unrecognized field 'steps[${i}].${field}'`,
          filePath,
          `steps[${i}].${field}`,
        );
      }
    }
    if (!step.action || typeof step.action !== 'string' || !step.action.trim()) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: steps[${i}].action is required and must be a non-empty string`,
        filePath,
        `steps[${i}].action`,
      );
    }
    if (!step.expected || typeof step.expected !== 'string' || !step.expected.trim()) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: steps[${i}].expected is required and must be a non-empty string`,
        filePath,
        `steps[${i}].expected`,
      );
    }
    if (step.actor !== undefined && (typeof step.actor !== 'string' || !step.actor.trim())) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: steps[${i}].actor must be a non-empty string when present`,
        filePath,
        `steps[${i}].actor`,
      );
    }
  }

  for (const arrField of ['preconditions', 'postconditions']) {
    if (doc[arrField] === undefined) continue;
    if (!Array.isArray(doc[arrField])) {
      throw makeError(
        'VALIDATION_ERROR',
        `${filePath}: field '${arrField}' must be an array when present`,
        filePath,
        arrField,
      );
    }
    for (let i = 0; i < doc[arrField].length; i++) {
      const v = doc[arrField][i];
      if (typeof v !== 'string' || !v.trim()) {
        throw makeError(
          'VALIDATION_ERROR',
          `${filePath}: ${arrField}[${i}] must be a non-empty string`,
          filePath,
          `${arrField}[${i}]`,
        );
      }
    }
  }
}

function requireString(doc, field, filePath) {
  if (!doc[field] || typeof doc[field] !== 'string' || !doc[field].trim()) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: field '${field}' is required and must be a non-empty string`,
      filePath,
      field,
    );
  }
}

function optionalString(doc, field, filePath) {
  if (doc[field] === undefined) return;
  if (typeof doc[field] !== 'string' || !doc[field].trim()) {
    throw makeError(
      'VALIDATION_ERROR',
      `${filePath}: field '${field}' must be a non-empty string when present`,
      filePath,
      field,
    );
  }
}

// ─── Implementation-walk guard ────────────────────────────────────────────────

function assertIntegrateMarker(doc, filePath, cwd, callerEpicId) {
  const storyId = doc.story;
  const epicId = callerEpicId || doc.epic;
  if (!storyId || !epicId) {
    throw makeError(
      'INTEGRATE_MARKER_MISSING',
      [
        `${filePath}: implementation-walk mode requires both 'story' and 'epic' context to locate the integrate marker.`,
        `Got story=${JSON.stringify(storyId)}, epic=${JSON.stringify(epicId)} (caller epic_id: ${JSON.stringify(callerEpicId)}).`,
        `Provide them on the scenario or pass --epic to the loader, or switch to mode: spec-walk.`,
      ].join('\n'),
      filePath,
      'mode',
    );
  }

  const stateDir = resolveStateDir({ cwd: resolve(cwd) });
  const markerPath = resolve(stateDir, `episodes/${epicId}/${storyId}/integrate.yaml`);
  if (!existsSync(markerPath)) {
    const err = makeError(
      'INTEGRATE_MARKER_MISSING',
      [
        `${filePath}: implementation-walk mode requires the story's integrate episode marker.`,
        `Expected marker at: ${markerPath}`,
        `Story '${storyId}' (epic '${epicId}') has not completed its integrate step.`,
        `Switch to mode: spec-walk, or wait until the integrate marker is written.`,
      ].join('\n'),
      filePath,
      'mode',
    );
    err.markerPath = markerPath;
    err.storyId = storyId;
    err.epicId = epicId;
    throw err;
  }
}

// ─── Error factory ────────────────────────────────────────────────────────────

function makeError(code, message, filePath, field) {
  const err = new Error(message);
  err.code = code;
  err.filePath = filePath;
  err.field = field;
  return err;
}

// ─── Minimal YAML parser ──────────────────────────────────────────────────────
//
// Handles the specific scenario YAML shape:
//   - top-level scalar fields
//   - top-level list fields (sequence of strings or objects)
//   - nested object fields inside list items (steps)
// Does NOT handle: anchors, multi-document, block scalars (|/>), flow style.
// If js-yaml is available it is preferred (dynamic import on first call).

let jsYamlCache;

function parseYaml(text) {
  // Try js-yaml if previously resolved
  if (jsYamlCache) {
    return jsYamlCache.load(text);
  }
  return parseYamlSync(text);
}

/**
 * Minimal synchronous YAML parser for the scenario format.
 * Parses a subset of YAML sufficient for scenario files.
 */
function parseYamlSync(text) {
  const lines = text.split(/\r?\n/);
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
      i++;
      continue;
    }

    // Top-level key: value  OR  key: (start of block)
    const topKv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)/);
    if (!topKv) {
      i++;
      continue;
    }

    const key = topKv[1];
    const rest = topKv[2].trim();

    if (rest === '' || rest.startsWith('#')) {
      // Block value — look ahead for indented content
      i++;
      const { value, next } = parseBlock(lines, i, 0);
      result[key] = value;
      i = next;
    } else {
      result[key] = parseScalar(rest.replace(/\s*#.*$/, '').trim());
      i++;
    }
  }

  return result;
}

/**
 * Parse an indented block starting at `lines[start]`.
 * `parentIndent` is the indent of the owning key line (always 0 for top-level).
 * Returns { value, next } where next is the index of the first line not consumed.
 */
function parseBlock(lines, start, parentIndent) {
  // Peek to determine block type
  let i = start;
  while (i < lines.length && (/^\s*$/.test(lines[i]) || /^\s*#/.test(lines[i]))) i++;

  if (i >= lines.length) return { value: null, next: i };

  const firstLine = lines[i];
  const indent = firstLine.match(/^(\s*)/)[1].length;

  if (indent <= parentIndent) {
    // No indented block found
    return { value: null, next: i };
  }

  // Sequence (list)?
  if (/^\s*-\s/.test(firstLine) || /^\s*-\s*$/.test(firstLine)) {
    return parseSequence(lines, i, indent);
  }

  // Mapping
  return parseMapping(lines, i, indent);
}

function parseSequence(lines, start, indent) {
  const list = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) { i++; continue; }

    const lineIndent = line.match(/^(\s*)/)[1].length;
    if (lineIndent < indent) break;

    const itemMatch = line.match(/^(\s*)-\s*(.*)/);
    if (!itemMatch) {
      // continuation or sub-key of previous item — handled by mapping
      break;
    }

    const itemRest = itemMatch[2].trim();

    if (itemRest === '' || itemRest.startsWith('#')) {
      // The item is a mapping block on the following lines
      i++;
      const { value, next } = parseMapping(lines, i, indent + 1);
      list.push(value);
      i = next;
    } else {
      // Might be a scalar or an inline kv starting a mapping
      const kvMatch = itemRest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)/);
      if (kvMatch) {
        // Inline first key of a mapping item
        const firstKey = kvMatch[1];
        const firstVal = kvMatch[2].trim().replace(/\s*#.*$/, '').trim();
        const obj = {};
        obj[firstKey] = firstVal === '' ? null : parseScalar(firstVal);
        i++;
        // Collect remaining keys at same indent+2
        const subIndent = indent + 2;
        while (i < lines.length) {
          const sub = lines[i];
          if (/^\s*$/.test(sub) || /^\s*#/.test(sub)) { i++; continue; }
          const subInd = sub.match(/^(\s*)/)[1].length;
          if (subInd < subIndent) break;
          // Check it's not a new list item at the parent indent
          if (subInd === indent && /^\s*-/.test(sub)) break;
          const subKv = sub.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)/);
          if (!subKv) { i++; continue; }
          const subKey = subKv[1];
          const subRest = subKv[2].trim().replace(/\s*#.*$/, '').trim();
          obj[subKey] = subRest === '' ? null : parseScalar(subRest);
          i++;
        }
        list.push(obj);
      } else {
        list.push(parseScalar(itemRest.replace(/\s*#.*$/, '').trim()));
        i++;
      }
    }
  }

  return { value: list, next: i };
}

function parseMapping(lines, start, indent) {
  const obj = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) { i++; continue; }

    const lineIndent = line.match(/^(\s*)/)[1].length;
    if (lineIndent < indent) break;

    const kv = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)/);
    if (!kv) { i++; continue; }

    const key = kv[1];
    const rest = kv[2].trim().replace(/\s*#.*$/, '').trim();

    if (rest === '') {
      i++;
      const { value, next } = parseBlock(lines, i, lineIndent);
      obj[key] = value;
      i = next;
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }

  return { value: obj, next: i };
}

function parseScalar(val) {
  if (!val || val === '~' || val === 'null') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  // Quoted string
  if (/^"(.*)"$/.test(val)) return val.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  if (/^'(.*)'$/.test(val)) return val.slice(1, -1).replace(/''/g, "'");
  // Integer
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  // Float
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}
