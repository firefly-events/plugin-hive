/**
 * Session Episode Writer
 *
 * Writes a session episode YAML file atomically using .tmp → rename.
 * Episodes are written to: <state-dir>/episodes/<epic_id>/<story_id>/<step_id>.yaml
 * where <state-dir> resolves via the sdr-1 resolver (HIVE_STATE_DIR env >
 * paths.state_dir in hive.config.yaml > default .pHive).
 *
 * Episode schema:
 *   session_id, epic_id, story_id, step_id, agent_name, model,
 *   status, created_at, completed_at, sse_event_count, events: []
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
function defaultEpisodesBase() {
  return path.join(resolveStateDir(), 'episodes');
}

/**
 * Write an episode YAML file for a completed session.
 *
 * @param {Object} episode
 * @param {string} episode.session_id
 * @param {string} episode.epic_id
 * @param {string} episode.story_id
 * @param {string} episode.step_id
 * @param {string} episode.agent_name
 * @param {string} episode.model
 * @param {string} episode.status - completed | failed | stuck
 * @param {string} episode.created_at - ISO 8601
 * @param {string} episode.completed_at - ISO 8601
 * @param {number} episode.sse_event_count
 * @param {Array}  [episode.events] - raw SSE events (optional; can be large)
 * @param {string} [episodesBase] - override base path (for testing)
 * @returns {string} absolute path to the written episode file
 */
function writeEpisode(episode, episodesBase = defaultEpisodesBase()) {
  const { epic_id, story_id, step_id, session_id } = episode;

  if (!epic_id || !story_id || !step_id || !session_id) {
    throw new Error('writeEpisode: epic_id, story_id, step_id, and session_id are required');
  }

  const dir = path.join(episodesBase, epic_id, story_id);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const suffix = String(session_id).replace(/[^a-zA-Z0-9_-]/g, '').slice(-12);
  const filename = suffix ? `${step_id}-${suffix}.yaml` : `${step_id}.yaml`;
  const targetPath = path.join(dir, filename);
  const tmpPath = targetPath + '.tmp';

  const data = {
    session_id,
    epic_id,
    story_id,
    step_id,
    agent_name: episode.agent_name || null,
    model: episode.model || null,
    status: episode.status || 'completed',
    created_at: episode.created_at || null,
    completed_at: episode.completed_at || new Date().toISOString(),
    sse_event_count: episode.sse_event_count || 0,
    events: episode.events || [],
  };

  fs.writeFileSync(tmpPath, yaml.dump(data, { lineWidth: 120 }), 'utf8');
  fs.renameSync(tmpPath, targetPath);

  return targetPath;
}

export { writeEpisode, defaultEpisodesBase };
