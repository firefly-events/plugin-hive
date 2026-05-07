/**
 * Session Prompt Builder
 *
 * Assembles the content string for the first user.message in a session.
 * Sources:
 *   1. story_context string (always included in full — never truncated)
 *   2. KG decisions from ~/.claude/hive/kg.sqlite (graceful degrade if absent)
 *
 * Total content is capped at MAX_CHARS. If KG context pushes over the cap,
 * the KG section is truncated (story_context is always preserved).
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const MAX_CHARS = 4000;
const KG_SQLITE_PATH = path.join(process.env.HOME || '~', '.claude', 'hive', 'kg.sqlite');

/**
 * Query KG decisions for a given epic.
 * Returns a formatted string block, or empty string on any error.
 * @param {string} epicId
 * @returns {string}
 */
function queryDecisions(epicId) {
  try {
    // Sanitize epicId to prevent injection (only allow alphanumeric, dash, underscore)
    const safeEpicId = epicId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const sql = `SELECT subject, predicate, object FROM triples WHERE valid_until IS NULL AND source_epic = '${safeEpicId}' LIMIT 20`;
    const result = execSync(`sqlite3 "${KG_SQLITE_PATH}" "${sql}"`, { encoding: 'utf8', timeout: 5000 });
    const lines = result.trim().split('\n').filter(Boolean);
    if (!lines.length) return '';

    const rows = lines.map(line => {
      const parts = line.split('|');
      return `- ${parts[0] || ''} ${parts[1] || ''} ${parts[2] || ''}`.trim();
    });
    return `\n\n## Knowledge Graph Context (from prior decisions)\n${rows.join('\n')}`;
  } catch {
    // kg.sqlite absent, sqlite3 not installed, or query failed — proceed without KG
    return '';
  }
}

/**
 * Build the prompt content string for the first user.message.
 *
 * @param {Object} params
 * @param {string} params.story_context - full story spec text (required)
 * @param {string} [params.epic_id] - used for KG query
 * @param {Array}  [params.matched_specialists] - specialist objects from payload
 * @returns {string} assembled content string, capped at MAX_CHARS
 */
function buildPrompt({ story_context, epic_id, matched_specialists = [] }) {
  if (!story_context) throw new Error('buildPrompt: story_context is required');

  let content = story_context;

  // Append specialist block if any (cap enforced in session-turn-builder)
  if (matched_specialists && matched_specialists.length > 0) {
    const specialists = matched_specialists;
    const lines = specialists.map(s =>
      `- ${s.name}: Flagged by trigger rule "${s.trigger_reason}" — persona at ${s.persona_path}`
    );
    content += `\n\n## Specialists Available\nThe following specialists are available for delegation on this step:\n${lines.join('\n')}`;
  }

  // Attempt KG context if epic_id provided
  if (epic_id) {
    const kgBlock = queryDecisions(epic_id);
    if (kgBlock) {
      const combined = content + kgBlock;
      if (combined.length <= MAX_CHARS) {
        content = combined;
      } else {
        // Truncate KG block to fit within cap
        const remaining = MAX_CHARS - content.length;
        if (remaining > 50) {
          // Enough room for at least a partial KG block header
          content = content + kgBlock.slice(0, remaining);
        }
        // If no room, skip KG entirely — story_context always wins
      }
    }
  }

  // Final cap: if story_context itself exceeded MAX_CHARS, we still pass it through
  // (spec: never truncate story_context)
  return content;
}

module.exports = { buildPrompt, queryDecisions };
