/**
 * Session Episode Writer
 *
 * Writes a session episode YAML file atomically using .tmp → rename.
 * Episodes are written to: state/episodes/<epic_id>/<story_id>/<step_id>.yaml
 *
 * Episode schema:
 *   session_id, epic_id, story_id, step_id, agent_name, model,
 *   status, created_at, completed_at, sse_event_count, events: []
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

const EPISODES_BASE = path.join(process.cwd(), 'state', 'episodes');

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
function writeEpisode(episode, episodesBase = EPISODES_BASE) {
  const { epic_id, story_id, step_id, session_id } = episode;

  if (!epic_id || !story_id || !step_id || !session_id) {
    throw new Error('writeEpisode: epic_id, story_id, step_id, and session_id are required');
  }

  const dir = path.join(episodesBase, epic_id, story_id);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `${step_id}.yaml`;
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

module.exports = { writeEpisode, EPISODES_BASE };
