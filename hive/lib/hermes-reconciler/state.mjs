/**
 * hermes-reconciler/state.mjs — cycle-state reader/writer for the hermes_reconciler: block.
 *
 * The block is additive and absence-tolerant: cycle-state files without it
 * load fine and readHermesReconcilerState() returns safe defaults.
 * Writes are atomic (temp file + rename) and preserve all other top-level blocks.
 *
 * Exports:
 *   readHermesReconcilerState(cycleStatePath) → HermesReconcilerState
 *   writeHermesReconcilerState(cycleStatePath, updates) → void
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

let yaml = null;
try {
  yaml = _require('js-yaml');
} catch {
  yaml = null;
}

function requireYaml() {
  if (!yaml) throw new Error('js-yaml not available — run: npm install js-yaml');
  return yaml;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  gate_state: null,
  in_flight_story_id: null,
  in_flight_task_id: null,
  dispatched_at: null,
  current_phase: null,
  stuck_after_seconds: 1800,
  stories: {},
};

function applyDefaults(raw) {
  const base = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return base;

  return {
    gate_state:          raw.gate_state          ?? base.gate_state,
    in_flight_story_id:  raw.in_flight_story_id  ?? base.in_flight_story_id,
    in_flight_task_id:   raw.in_flight_task_id   ?? base.in_flight_task_id,
    dispatched_at:       raw.dispatched_at        ?? base.dispatched_at,
    current_phase:       raw.current_phase        ?? base.current_phase,
    stuck_after_seconds: raw.stuck_after_seconds  ?? base.stuck_after_seconds,
    stories:             raw.stories && typeof raw.stories === 'object'
                           ? raw.stories
                           : base.stories,
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the hermes_reconciler: block from a cycle-state YAML file.
 * If the file does not exist or the block is absent, returns safe defaults.
 * Never throws on missing file or missing block.
 *
 * @param {string} cycleStatePath Absolute path to the cycle-state YAML file.
 * @returns {object} HermesReconcilerState with all fields present.
 */
export function readHermesReconcilerState(cycleStatePath) {
  let text;
  try {
    text = fs.readFileSync(cycleStatePath, 'utf8');
  } catch {
    return applyDefaults(null);
  }

  let doc;
  try {
    doc = requireYaml().load(text);
  } catch {
    return applyDefaults(null);
  }

  return applyDefaults(doc?.hermes_reconciler ?? null);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Merge updates into the hermes_reconciler: block and write back atomically.
 * All other top-level blocks in the cycle-state file are preserved verbatim.
 * The write is atomic: a temp file is written then renamed into place.
 *
 * @param {string} cycleStatePath Absolute path to the cycle-state YAML file.
 * @param {object} updates Partial hermes_reconciler fields to merge.
 *   The `stories` sub-map is merged per-story (existing stories not in updates are kept).
 */
export function writeHermesReconcilerState(cycleStatePath, updates) {
  const y = requireYaml();

  let doc = {};
  let text;
  try {
    text = fs.readFileSync(cycleStatePath, 'utf8');
  } catch {
    text = null;
  }

  if (text) {
    try {
      doc = y.load(text) ?? {};
    } catch {
      doc = {};
    }
  }

  const current = applyDefaults(doc.hermes_reconciler ?? null);

  // Merge updates — stories get per-story merge, top-level scalar fields get replaced.
  const mergedStories = { ...current.stories };
  if (updates.stories && typeof updates.stories === 'object') {
    for (const [storyId, storyPatch] of Object.entries(updates.stories)) {
      mergedStories[storyId] = { ...(mergedStories[storyId] ?? {}), ...storyPatch };
    }
  }

  const merged = {
    ...current,
    ...updates,
    stories: mergedStories,
  };

  doc.hermes_reconciler = merged;

  const serialized = y.dump(doc, { lineWidth: 120, quotingType: '"', forceQuotes: false });

  const dir = path.dirname(cycleStatePath);
  const tmpPath = path.join(
    os.tmpdir(),
    `hermes-reconciler-${process.pid}-${Date.now()}.yaml.tmp`,
  );

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  fs.renameSync(tmpPath, cycleStatePath);
}
