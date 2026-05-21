'use strict';

/**
 * Scenario YAML loader + validator for simulated-manual testing.
 *
 * Story: c-1-scenario-schema-and-loader (autonomous-cycle-loop)
 *
 * Exports:
 *   loadScenario(filePath, opts?) → parsed scenario object (throws on invalid)
 *
 * Scenario schema (simulated-manual):
 *   id: string (required, kebab-case)
 *   title: string (required, non-empty)
 *   mode: 'spec-walk' | 'implementation-walk' (required)
 *   story: string (optional — required for implementation-walk marker check)
 *   epic: string (optional — required for implementation-walk marker check)
 *   preconditions: string[] (optional)
 *   steps: { action: string, expected: string, actor?: string }[] (required, non-empty)
 *   postconditions: string[] (optional)
 *
 * implementation-walk refuses to proceed if the story's integrate episode
 * marker is absent from .pHive/episodes/<epic>/<story>/integrate.yaml.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const VALID_MODES = new Set(['spec-walk', 'implementation-walk']);

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

// ─── Validation ──────────────────────────────────────────────────────────────

function validateSchema(doc, filePath) {
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

  const markerPath = resolve(cwd, `.pHive/episodes/${epicId}/${storyId}/integrate.yaml`);
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
