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
 * | "finalized"             | reconciler Branch 4            | Epic complete (success); no further ticks        |
 * | "rejected"              | human rejects a review verdict | Terminal (rejected); tick does NOT auto-resume   |
 *
 * Transitions (write-state is the ONLY write path):
 *   null -> pre_approved           human: cli.mjs write-state --patch '{"gate_state":"pre_approved","epic_of_record":"<handle>"}'
 *   pre_approved -> review_awaiting_human  reconciler: Branch 2, review_terminal, verdict != passed
 *   review_awaiting_human -> pre_approved  human continues: cli.mjs write-state --patch '{"gate_state":"pre_approved"}'
 *   review_awaiting_human -> rejected      human rejects: tick does not auto-resume; re-approval (-> pre_approved) required
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
/**
 * Validate top-level hermes_reconciler field shapes at the single write boundary.
 * Both the CLI (cmdWriteState) and the Slack human-gate path (slack-notify-await)
 * write through writeHermesReconcilerState, so enforcing here — not only in
 * cli.mjs — prevents any caller from persisting off-contract values.
 */
function validateReconcilerUpdates(updates) {
  if (!isPlainObject(updates)) {
    throw new Error('hermes_reconciler updates must be an object');
  }
  const VALID_UPDATE_KEYS = new Set([
    'gate_state',
    'epic_of_record',
    'in_flight_story_id',
    'in_flight_task_id',
    'current_phase',
    'dispatched_at',
    'stuck_after_seconds',
    'stories',
  ]);
  const unknownKeys = Object.keys(updates).filter((k) => !VALID_UPDATE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown top-level hermes_reconciler fields: ${unknownKeys.join(', ')}`);
  }
  if ('gate_state' in updates && updates.gate_state !== null && !VALID_GATE_STATES.has(updates.gate_state)) {
    throw new Error(
      `hermes_reconciler.gate_state must be null or one of: ${[...VALID_GATE_STATES].join(', ')}. Got: ${JSON.stringify(updates.gate_state)}`,
    );
  }
  if ('epic_of_record' in updates && updates.epic_of_record !== null
      && (typeof updates.epic_of_record !== 'string' || updates.epic_of_record.trim() === '')) {
    throw new Error('hermes_reconciler.epic_of_record must be null or a non-empty string');
  }
  for (const f of ['in_flight_story_id', 'in_flight_task_id', 'current_phase', 'dispatched_at']) {
    if (f in updates && updates[f] !== null && typeof updates[f] !== 'string') {
      throw new Error(`hermes_reconciler.${f} must be null or a string`);
    }
  }
  if ('stuck_after_seconds' in updates && updates.stuck_after_seconds !== null
      && (typeof updates.stuck_after_seconds !== 'number' || !Number.isFinite(updates.stuck_after_seconds))) {
    throw new Error('hermes_reconciler.stuck_after_seconds must be null or a finite number');
  }
}

/**
 * Run `fn` while holding an exclusive advisory lock on the cycle-state file.
 * The cron tick and a human Slack-resolve can both write this file; the
 * temp-file-then-rename is atomic per write, but the surrounding read-modify-write
 * is not — without a lock two concurrent writers can lose an update. A `mkdir`
 * lock is atomic on POSIX; stale locks (older than staleMs) are reclaimed.
 */
function withCycleStateLock(cycleStatePath, fn, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  // The lock dir is a sibling of the state file, so the parent must exist before
  // we can acquire it (the write itself also needs the dir).
  fs.mkdirSync(path.dirname(cycleStatePath), { recursive: true });
  const lockDir = `${cycleStatePath}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > staleMs) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue; // lock vanished between EEXIST and stat — retry immediately
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring cycle-state lock: ${lockDir}`);
      }
      const until = Date.now() + 25;
      while (Date.now() < until) { /* brief spin before retry */ }
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmdirSync(lockDir); } catch { /* already released */ }
  }
}

/**
 * Transactional read-modify-write under a single lock. `mutator(current)` receives
 * the freshly-read, defaults-applied state and returns the `updates` patch to merge
 * — or throws to abort the write (e.g. a precondition failure). Because the read,
 * the mutator's precondition check, and the write all execute inside one
 * `withCycleStateLock`, no concurrent writer can slip between a precondition check
 * and the write it guards (closes the resolveGate check-then-write TOCTOU).
 */
export function mutateHermesReconcilerState(cycleStatePath, mutator) {
  const y = requireYaml();

  return withCycleStateLock(cycleStatePath, () => {
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

    // Compute the patch INSIDE the lock so any precondition the mutator enforces
    // is atomic with the write.
    const updates = mutator(current) ?? {};
    validateReconcilerUpdates(updates);

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
    return merged;
  });
}

export function writeHermesReconcilerState(cycleStatePath, updates) {
  // Validate eagerly for callers passing a static patch; mutate re-validates the
  // resolved patch inside the lock (cheap, pure).
  validateReconcilerUpdates(updates);
  return mutateHermesReconcilerState(cycleStatePath, () => updates);
}
