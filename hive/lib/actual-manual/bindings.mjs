'use strict';

/**
 * Flow-bindings overlay loader + fail-fast validator.
 *
 * Story: am-2-flow-bindings-schema (actual-manual-tier)
 *
 * Exports:
 *   loadBindings(filePath, scenarioId?) → validated overlay object (throws on invalid)
 *   validateBindings(doc, scenarioId)   → void (throws on invalid)
 *   KNOWN_TRUTH_SIGNALS                 → Set<string> — extend before loading to accept new signals
 *   KNOWN_ACT_VALUES                    → Set<string> — extend before loading to accept new acts
 *
 * Overlay schema (JSON):
 *   {
 *     scenario: string (required, non-empty)
 *     steps: StepEntry[] (required, non-empty)
 *   }
 *
 *   StepEntry (how: "native"):
 *     { how: "native", act: Act, args: object, setup?: Primitive[], truth?: TruthSignal }
 *
 *   StepEntry (how: "vision"):
 *     { how: "vision", target: string, setup?: Primitive[], truth?: TruthSignal }
 *
 *   Primitive: { act: Act, args: object }
 *   Act: "goto" | "fill" | "tapRole" | "tapText" | "wait"
 *   TruthSignal: "cta_enabled" | "posted"  (extensible via KNOWN_TRUTH_SIGNALS)
 *
 * Reference: hive/references/actual-manual-overlay-schema.md
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const KNOWN_TRUTH_SIGNALS = new Set(['cta_enabled', 'posted']);

export const KNOWN_ACT_VALUES = new Set(['goto', 'fill', 'tapRole', 'tapText', 'wait']);

const VALID_HOW = new Set(['native', 'vision']);

/**
 * Load and validate a flow-bindings JSON file.
 *
 * @param {string} filePath - path to the overlay JSON file
 * @param {string} [scenarioId] - used in error messages; inferred from doc.scenario if omitted
 * @returns {object} parsed + validated overlay
 * @throws Error with .code, .scenarioId, .stepIndex
 */
export function loadBindings(filePath, scenarioId) {
  const absPath = resolve(filePath);
  let raw;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (e) {
    throw makeError(
      'FILE_NOT_FOUND',
      `Cannot read overlay file: ${absPath}: ${e.message}`,
      scenarioId ?? null,
      null,
    );
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw makeError(
      'JSON_PARSE_ERROR',
      `JSON parse error in ${absPath}: ${e.message}`,
      scenarioId ?? null,
      null,
    );
  }

  validateBindings(doc, scenarioId ?? doc?.scenario ?? '(unknown)');
  return doc;
}

/**
 * Resolve the default overlay path for a scenario id.
 *
 * Looks for `scenarios/flow-bindings/<scenarioId>.json` relative to cwd.
 *
 * @param {string} scenarioId
 * @param {{ cwd?: string }} [opts]
 * @returns {string} absolute path
 */
export function resolveBindingsPath(scenarioId, { cwd = process.cwd() } = {}) {
  return resolve(join(cwd, 'scenarios', 'flow-bindings', `${scenarioId}.json`));
}

/**
 * Validate an already-parsed overlay document.
 * Throws immediately on the first violation with a message naming the scenario id + step index.
 *
 * @param {unknown} doc - parsed overlay
 * @param {string} scenarioId - used in error messages
 */
export function validateBindings(doc, scenarioId) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw makeError(
      'VALIDATION_ERROR',
      `scenario "${scenarioId}": overlay must be a JSON object`,
      scenarioId,
      null,
    );
  }

  if (!doc.scenario || typeof doc.scenario !== 'string' || !doc.scenario.trim()) {
    throw makeError(
      'VALIDATION_ERROR',
      `scenario "${scenarioId}": field "scenario" is required and must be a non-empty string`,
      scenarioId,
      null,
    );
  }

  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw makeError(
      'VALIDATION_ERROR',
      `scenario "${scenarioId}": field "steps" is required and must be a non-empty array`,
      scenarioId,
      null,
    );
  }

  for (let i = 0; i < doc.steps.length; i++) {
    validateStep(doc.steps[i], scenarioId, i);
  }
}

function validateStep(step, scenarioId, index) {
  const loc = `scenario "${scenarioId}" step ${index}`;

  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw makeError('VALIDATION_ERROR', `${loc}: step must be an object`, scenarioId, index);
  }

  if (!VALID_HOW.has(step.how)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${loc}: "how" must be "native" or "vision"; got: ${JSON.stringify(step.how)}`,
      scenarioId,
      index,
    );
  }

  if (step.how === 'native') {
    validateNativeStep(step, scenarioId, index, loc);
  } else {
    validateVisionStep(step, scenarioId, index, loc);
  }

  if (step.setup !== undefined) {
    validateSetup(step.setup, scenarioId, index, loc);
  }

  if (step.truth !== undefined) {
    if (!KNOWN_TRUTH_SIGNALS.has(step.truth)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${loc}: unknown truth signal ${JSON.stringify(step.truth)}; known: [${[...KNOWN_TRUTH_SIGNALS].join(', ')}]`,
        scenarioId,
        index,
      );
    }
  }
}

function validateNativeStep(step, scenarioId, index, loc) {
  if (!KNOWN_ACT_VALUES.has(step.act)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${loc}: "act" must be one of [${[...KNOWN_ACT_VALUES].join(', ')}]; got: ${JSON.stringify(step.act)}`,
      scenarioId,
      index,
    );
  }

  if (!step.args || typeof step.args !== 'object' || Array.isArray(step.args)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${loc}: native step requires "args" to be a non-null object`,
      scenarioId,
      index,
    );
  }
}

function validateVisionStep(step, scenarioId, index, loc) {
  if (!step.target || typeof step.target !== 'string' || !step.target.trim()) {
    throw makeError(
      'VALIDATION_ERROR',
      `${loc}: vision step requires a non-empty "target" label`,
      scenarioId,
      index,
    );
  }
}

function validateSetup(setup, scenarioId, index, loc) {
  if (!Array.isArray(setup)) {
    throw makeError(
      'VALIDATION_ERROR',
      `${loc}: "setup" must be an array when present`,
      scenarioId,
      index,
    );
  }

  for (let j = 0; j < setup.length; j++) {
    const prim = setup[j];
    const primLoc = `${loc} setup[${j}]`;

    if (!prim || typeof prim !== 'object' || Array.isArray(prim)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${primLoc}: setup primitive must be an object`,
        scenarioId,
        index,
      );
    }

    if (!KNOWN_ACT_VALUES.has(prim.act)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${primLoc}: "act" must be one of [${[...KNOWN_ACT_VALUES].join(', ')}]; got: ${JSON.stringify(prim.act)}`,
        scenarioId,
        index,
      );
    }

    if (!prim.args || typeof prim.args !== 'object' || Array.isArray(prim.args)) {
      throw makeError(
        'VALIDATION_ERROR',
        `${primLoc}: setup primitive requires "args" to be a non-null object`,
        scenarioId,
        index,
      );
    }
  }
}

function makeError(code, message, scenarioId, stepIndex) {
  const err = new Error(message);
  err.code = code;
  err.scenarioId = scenarioId;
  err.stepIndex = stepIndex;
  return err;
}
