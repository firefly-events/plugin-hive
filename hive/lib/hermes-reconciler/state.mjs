/**
 * hermes-reconciler/state.mjs — cycle-state reader/writer for the hermes_reconciler: block.
 *
 * The block is additive and absence-tolerant: cycle-state files without it
 * load fine and readHermesReconcilerState() returns safe defaults.
 * Writes are atomic (temp file + rename) and preserve all other top-level blocks.
 *
 * ## gate_state semantics
 *
 * gate_state is the autonomy latch. Only `pre_approved` allows a tick to advance work.
 *
 * | Value                   | Set by                         | Tick behavior                                    |
 * |-------------------------|--------------------------------|--------------------------------------------------|
 * | null                    | initial / factory default      | Not approved; tick refuses to advance            |
 * | "pre_approved"          | human approval via write-state | Approved to run; tick proceeds normally          |
 * | "review_awaiting_human" | reconciler on review_terminal  | Review verdict needs human decision; tick halted |
 * | "finalized"             | reconciler Branch 4            | Epic complete; no further ticks                  |
 *
 * Transitions (write-state is the ONLY write path):
 *   null -> pre_approved           human: cli.mjs write-state --patch '{"gate_state":"pre_approved","epic_of_record":"<handle>"}'
 *   pre_approved -> review_awaiting_human  reconciler: Branch 2, review_terminal, verdict != passed
 *   review_awaiting_human -> pre_approved  human continues: cli.mjs write-state --patch '{"gate_state":"pre_approved"}'
 *   pre_approved -> finalized       reconciler: Branch 4, after all stories done + PR created
 *
 * ## epic_of_record
 *
 * When a Hermes instance manages multiple epics, epic_of_record pins which epic this
 * hermes_reconciler block owns. Set once at human approval alongside gate_state=pre_approved.
 * A tick must validate epic_of_record matches its target before advancing.
 *
 * Exports:
 *   VALID_GATE_STATES -- Set of allowed gate_state string values (null is the absence value, not a member)
 *   readHermesReconcilerState(cycleStatePath) -> HermesReconcilerState
 *   writeHermesReconcilerState(cycleStatePath, updates) -> void
 */

import fs from 'node:fs';
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

/**
 * Allowed string values for gate_state. null (absent / not approved) is valid but is
 * represented as the JS null literal, not as a string in this set.
 */
export const VALID_GATE_STATES = new Set([
  'pre_approved',
  'review_awaiting_human',
  'finalized',
  // Terminal: a human rejected a review verdict (distinct from `finalized`,
  // which is success-terminal). The reconcile loop does not auto-resume from
  // `rejected` — re-approval (write gate_state back to `pre_approved`) is required.
  'rejected',
]);

// Plain object = non-null, typeof 'object', NOT an array. Arrays are objects in
// JS, so a bare `typeof x === 'object'` would accept `[...]` and later let
// Object.entries() treat array indices as story IDs, corrupting the contract.
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// -- Defaults --

const DEFAULTS = {
  gate_state: null,
  epic_of_record: null,
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
    epic_of_record:      raw.epic_of_record      ?? base.epic_of_record,
    in_flight_story_id:  raw.in_flight_story_id  ?? base.in_flight_story_id,
    in_flight_task_id:   raw.in_flight_task_id   ?? base.in_flight_task_id,
    dispatched_at:       raw.dispatched_at        ?? base.dispatched_at,
    current_phase:       raw.current_phase        ?? base.current_phase,
    stuck_after_seconds: raw.stuck_after_seconds  ?? base.stuck_after_seconds,
    stories:             isPlainObject(raw.stories) ? raw.stories : base.stories,
  };
}

// -- Read --

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
  } catch (error) {
    if (error?.code === 'ENOENT') return applyDefaults(null);
    throw error;
  }

  let doc;
  try {
    doc = requireYaml().load(text);
  } catch (error) {
    throw new Error(`Failed to parse cycle-state YAML at ${cycleStatePath}: ${error?.message || String(error)}`);
  }

  return applyDefaults(doc?.hermes_reconciler ?? null);
}

// -- Write --

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
  } catch (error) {
    if (error?.code === 'ENOENT') {
      text = null;
    } else {
      throw error;
    }
  }

  if (text) {
    try {
      doc = y.load(text) ?? {};
    } catch (error) {
      throw new Error(`Failed to parse cycle-state YAML at ${cycleStatePath}: ${error?.message || String(error)}`);
    }
  }

  const current = applyDefaults(doc.hermes_reconciler ?? null);

  // Merge updates — stories get per-story merge, top-level scalar fields get replaced.
  // The write path is the mutation boundary: reject malformed shapes loudly rather
  // than silently corrupting state (an array `stories`, or a per-story patch that is
  // an array/primitive, would spread garbage into the cycle-state file).
  if (updates.stories !== undefined && !isPlainObject(updates.stories)) {
    throw new Error('hermes_reconciler.stories must be a mapping of story IDs to objects');
  }
  const mergedStories = { ...current.stories };
  if (isPlainObject(updates.stories)) {
    for (const [storyId, storyPatch] of Object.entries(updates.stories)) {
      if (!isPlainObject(storyPatch)) {
        throw new Error(`hermes_reconciler.stories["${storyId}"] must be an object, got: ${Array.isArray(storyPatch) ? 'array' : typeof storyPatch}`);
      }
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
    dir,
    `.hermes-reconciler-${process.pid}-${Date.now()}.yaml.tmp`,
  );

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  fs.renameSync(tmpPath, cycleStatePath);
}
