/**
 * Session Registry
 *
 * Read-modify-write operations on state/sessions/index.yaml.
 * Uses an advisory lock (sentinel file with O_EXCL) to prevent
 * concurrent writes. Fail-open: if lock cannot be acquired after
 * 10 retries (1s total), proceeds without the lock.
 *
 * Registry schema:
 *   created: <ISO 8601>
 *   sessions:
 *     - session_id, epic_id, story_id, step_id, agent_name, model,
 *       status, created_at, last_active_at, sse_last_event_at
 *
 * Status enum: pending | active | completed | failed | stuck
 */

'use strict';

const fs = require('fs');
const path = require('path');

let yaml;
try {
  yaml = require('js-yaml');
} catch {
  throw new Error('js-yaml not available — run: npm install js-yaml');
}

const REGISTRY_PATH = path.join(process.cwd(), 'state', 'sessions', 'index.yaml');

/**
 * Acquire advisory lock on the registry file.
 * @param {string} registryPath
 * @returns {Promise<boolean>} true if lock acquired
 */
async function acquireLock(registryPath) {
  const lockPath = registryPath + '.lock';
  for (let i = 0; i < 10; i++) {
    try {
      fs.writeFileSync(lockPath, '', { flag: 'wx' });
      return true;
    } catch {
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
async function upsert(sessionId, fields, registryPath = REGISTRY_PATH) {
  const locked = await acquireLock(registryPath);
  try {
    const data = readRegistry(registryPath);
    const idx = data.sessions.findIndex(s => s.session_id === sessionId);
    if (idx >= 0) {
      data.sessions[idx] = { ...data.sessions[idx], ...fields, session_id: sessionId };
    } else {
      data.sessions.push({ session_id: sessionId, ...fields });
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
async function update(sessionId, fields, registryPath = REGISTRY_PATH) {
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
function read(registryPath = REGISTRY_PATH) {
  return readRegistry(registryPath);
}

module.exports = { upsert, update, read, REGISTRY_PATH };
