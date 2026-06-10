/**
 * Session Registry
 *
 * Read-modify-write operations on <state-dir>/sessions/index.yaml, where
 * <state-dir> resolves via the sdr-1 resolver (HIVE_STATE_DIR env >
 * paths.state_dir in hive.config.yaml > default .pHive).
 * Uses an advisory lock (sentinel file with O_EXCL) to prevent
 * concurrent writes. Fail-open: if lock cannot be acquired after
 * 10 retries (1s total), proceeds without the lock.
 *
 * Registry schema:
 *   created: <ISO 8601>
 *   sessions:
 *     - session_id, epic_id, story_id, step_id, agent_name, model,
 *       status, created_at, last_active_at, sse_last_event_at,
 *       cc_session_id
 *
 * Status enum: pending | active | completed | failed | stuck
 *
 * `cc_session_id` is an additive correlation column — it carries the
 * Claude Code harness session id (process.env.CLAUDE_CODE_SESSION_ID)
 * when present. The Hive `session_id` remains canonical for KG
 * source_epic / source_session per binding decision
 * `claude-code-session-id-precedence`. Pickup happens in
 * session-client.registerSession() at registry-write time; existing
 * rows without this column remain valid.
 */

// ESM: hive/lib/package.json declares "type": "module", which made the prior
// CJS form of this file un-loadable (same latent break sdr-1 fixed in
// config.js). require() consumers keep working via require(esm).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveStateDir } from './config.js';

const _require = createRequire(import.meta.url);

let yaml;
try {
  yaml = _require('js-yaml');
} catch {
  throw new Error('js-yaml not available — run: npm install js-yaml');
}

// Resolved per call (not at module load) so HIVE_STATE_DIR / hive.config.yaml
// changes and cwd are honored at write time.
function defaultRegistryPath() {
  return path.join(resolveStateDir(), 'sessions', 'index.yaml');
}

/**
 * Acquire advisory lock on the registry file.
 * @param {string} registryPath
 * @returns {Promise<boolean>} true if lock acquired
 */
async function acquireLock(registryPath) {
  const lockPath = registryPath + '.lock';
  for (let i = 0; i < 10; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      try {
        const pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (pid && pid !== process.pid) {
          try {
            process.kill(pid, 0);
          } catch {
            try { fs.unlinkSync(lockPath); } catch { /* race: already gone */ }
            continue;
          }
        }
      } catch { /* lock file vanished between checks */ }
      await new Promise(r => setTimeout(r, 100));
    }
  }
  console.warn('[session-registry] could not acquire lock — proceeding without it (fail-open)');
  return false;
}

/**
 * Release advisory lock.
 * @param {string} registryPath
 * @param {boolean} wasLocked
 */
function releaseLock(registryPath, wasLocked) {
  if (!wasLocked) return;
  const lockPath = registryPath + '.lock';
  try { fs.unlinkSync(lockPath); } catch { /* best-effort */ }
}

/**
 * Read the registry file, returning parsed object. Creates it if absent.
 * @param {string} registryPath
 * @returns {Object} { created, sessions: [] }
 */
function readRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    return { created: new Date().toISOString(), sessions: [] };
  }
  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = yaml.load(raw);
    if (!parsed || !Array.isArray(parsed.sessions)) {
      return { created: parsed && parsed.created || new Date().toISOString(), sessions: [] };
    }
    return parsed;
  } catch (err) {
    console.warn(`[session-registry] parse error — starting fresh: ${err.message}`);
    return { created: new Date().toISOString(), sessions: [] };
  }
}

/**
 * Write registry object to disk atomically (.tmp → rename).
 * @param {string} registryPath
 * @param {Object} data
 */
function writeRegistry(registryPath, data) {
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = registryPath + '.tmp';
  fs.writeFileSync(tmpPath, yaml.dump(data, { lineWidth: 120 }), 'utf8');
  fs.renameSync(tmpPath, registryPath);
}

/**
 * Upsert a session entry in the registry.
 * If a session with session_id already exists, it is merged (fields in
 * `fields` override existing values). Otherwise a new entry is appended.
 *
 * @param {string} sessionId
 * @param {Object} fields - any subset of the session entry schema
 * @param {string} [registryPath] - override default path (for testing)
 * @returns {Promise<void>}
 */
async function upsert(sessionId, fields, registryPath = defaultRegistryPath()) {
  const locked = await acquireLock(registryPath);
  try {
    const data = readRegistry(registryPath);
    const idx = data.sessions.findIndex(s => s.session_id === sessionId);
    if (idx >= 0) {
      data.sessions[idx] = { ...data.sessions[idx], ...fields, session_id: sessionId };
    } else {
      data.sessions.push({ ...fields, session_id: sessionId });
    }
    writeRegistry(registryPath, data);
  } finally {
    releaseLock(registryPath, locked);
  }
}

/**
 * Update specific fields on an existing session entry.
 * If the session does not exist, logs a warning and does nothing.
 *
 * @param {string} sessionId
 * @param {Object} fields
 * @param {string} [registryPath]
 * @returns {Promise<void>}
 */
async function update(sessionId, fields, registryPath = defaultRegistryPath()) {
  const locked = await acquireLock(registryPath);
  try {
    const data = readRegistry(registryPath);
    const idx = data.sessions.findIndex(s => s.session_id === sessionId);
    if (idx < 0) {
      console.warn(`[session-registry] update: session ${sessionId} not found — skipping`);
      return;
    }
    data.sessions[idx] = { ...data.sessions[idx], ...fields };
    writeRegistry(registryPath, data);
  } finally {
    releaseLock(registryPath, locked);
  }
}

/**
 * Read the full registry without locking (read-only).
 * @param {string} [registryPath]
 * @returns {Object}
 */
function read(registryPath = defaultRegistryPath()) {
  return readRegistry(registryPath);
}

export { upsert, update, read, defaultRegistryPath };
