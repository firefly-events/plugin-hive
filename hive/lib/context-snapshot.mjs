/**
 * context-snapshot.mjs — read-only composer for Hive project state.
 *
 * Export:
 *   composeContextSnapshot({ stateDir, epic?, episodeLimit? })
 *     → { schema_version, generated_at, branch, epics, stories,
 *          episodes_recent, triage_open, metrics_health }
 *
 * stateDir  — repo root (the directory that contains .pHive)
 * epic       — optional epic id filter; omit to include all epics
 * episodeLimit — max episode markers per story (default 5)
 *
 * All optional sources (triage, metrics, cycle-state, episodes) are
 * handled gracefully: absence yields empty arrays / null fields, never throws.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { deriveStoryStatus } from './story-status.mjs';

// ---------------------------------------------------------------------------
// Minimal YAML scalar reader (no dep on a YAML library)
// ---------------------------------------------------------------------------

function readField(text, field) {
  // Match field at start of line or after whitespace (handles indented YAML blocks)
  const m = text.match(new RegExp(`(?:^|\\s)${field}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function readBlock(text, field) {
  const re = new RegExp(`^${field}:\\s*$`, 'm');
  if (!re.test(text)) return null;
  const start = text.search(re) + field.length + 2;
  const lines = text.slice(start).split('\n');
  const blockLines = [];
  for (const line of lines) {
    if (line === '' || /^\s/.test(line)) { blockLines.push(line); continue; }
    break;
  }
  return blockLines.join('\n').trimEnd() || null;
}

function safeRead(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function currentBranch(repoRoot) {
  try {
    return execFileSync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------

function loadEpics(pHiveDir, epicFilter) {
  const epicsDir = join(pHiveDir, 'epics');
  if (!existsSync(epicsDir)) return [];

  const epicIds = readdirSync(epicsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(id => !epicFilter || id === epicFilter);

  return epicIds.map(id => {
    const epicYaml = safeRead(join(epicsDir, id, 'epic.yaml'));
    const cycleYaml = safeRead(join(pHiveDir, 'cycle-state', `${id}.yaml`));

    const storiesDir = join(epicsDir, id, 'stories');
    const storyCount = existsSync(storiesDir)
      ? readdirSync(storiesDir).filter(f => f.endsWith('.yaml')).length
      : 0;

    return {
      id,
      title: epicYaml ? (readField(epicYaml, 'title') || readField(epicYaml, 'name') || id) : id,
      methodology: epicYaml ? readField(epicYaml, 'methodology') : null,
      story_count: storyCount,
      phase: cycleYaml ? readField(cycleYaml, 'phase') : null,
      branch: cycleYaml ? readField(cycleYaml, 'branch') : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

function loadStories(pHiveDir, epicFilter, repoRoot) {
  const epicsDir = join(pHiveDir, 'epics');
  if (!existsSync(epicsDir)) return [];

  const epicIds = readdirSync(epicsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(id => !epicFilter || id === epicFilter);

  const stories = [];
  for (const epicId of epicIds) {
    const storiesDir = join(epicsDir, epicId, 'stories');
    if (!existsSync(storiesDir)) continue;

    const storyFiles = readdirSync(storiesDir).filter(f => f.endsWith('.yaml'));
    for (const sf of storyFiles) {
      const storyId = sf.replace(/\.yaml$/, '');
      const text = safeRead(join(storiesDir, sf));

      const derived_status = deriveStoryStatus({
        epic_id: epicId,
        story_id: storyId,
        repo_root: repoRoot,
      });

      stories.push({
        epic_id: epicId,
        story_id: storyId,
        title: text ? (readField(text, 'title') || storyId) : storyId,
        status: derived_status,
        complexity: text ? readField(text, 'complexity') : null,
        depends_on: text ? readDependsList(text) : [],
      });
    }
  }
  return stories;
}

function readDependsList(text) {
  const inline = text.match(/^depends_on:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const block = text.match(/^depends_on:\s*$([\s\S]*?)(?=^\S)/m);
  if (block) {
    return block[1].split('\n')
      .map(l => l.match(/^\s+-\s+(.+)$/))
      .filter(Boolean)
      .map(m => m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Episodes (most recent N per story)
// ---------------------------------------------------------------------------

function loadEpisodesRecent(pHiveDir, epicFilter, limit) {
  const episodesDir = join(pHiveDir, 'episodes');
  if (!existsSync(episodesDir)) return [];

  const epicIds = readdirSync(episodesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(id => !epicFilter || id === epicFilter);

  const results = [];
  for (const epicId of epicIds) {
    const epicEpisodesDir = join(episodesDir, epicId);
    if (!existsSync(epicEpisodesDir)) continue;

    const storyDirs = readdirSync(epicEpisodesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const storyId of storyDirs) {
      const storyDir = join(epicEpisodesDir, storyId);
      const files = readdirSync(storyDir)
        .filter(f => f.endsWith('.yaml'))
        .sort()
        .slice(-limit);

      const markers = files.map(f => {
        const raw = safeRead(join(storyDir, f));
        if (!raw) return null;
        const body = raw.startsWith('---') ? raw.split('---').slice(1).join('---') : raw;
        return {
          file: f,
          step_id: readField(body, 'step_id'),
          status: readField(body, 'status'),
        };
      }).filter(Boolean);

      if (markers.length > 0) {
        results.push({ epic_id: epicId, story_id: storyId, markers });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

function loadTriageOpen(pHiveDir) {
  const queuePath = join(pHiveDir, 'triage', 'queue.yaml');
  const text = safeRead(queuePath);
  if (!text) return [];

  const items = [];
  // Parse YAML item blocks — extract id, state, kind, title for each "- id:" entry
  const itemBlocks = text.split(/\n(?=\s*-\s+id:)/);
  for (const block of itemBlocks) {
    const id = readField(block, 'id');
    const state = readField(block, 'state');
    if (!id || !state) continue;
    if (state === 'closed') continue;
    items.push({
      id,
      state,
      kind: readField(block, 'kind'),
      title: readField(block, 'title'),
      priority: readField(block, 'priority'),
      reporter: readField(block, 'reporter'),
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Metrics health
// ---------------------------------------------------------------------------

function loadMetricsHealth(pHiveDir, epicFilter, repoRoot) {
  const epicsDir = join(pHiveDir, 'epics');
  if (!existsSync(epicsDir)) return [];

  const epicIds = readdirSync(epicsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(id => !epicFilter || id === epicFilter);

  const results = [];
  for (const epicId of epicIds) {
    const storiesDir = join(epicsDir, epicId, 'stories');
    if (!existsSync(storiesDir)) continue;

    const storyFiles = readdirSync(storiesDir).filter(f => f.endsWith('.yaml'));
    for (const sf of storyFiles) {
      const storyId = sf.replace(/\.yaml$/, '');
      const text = safeRead(join(storiesDir, sf));
      if (!text) continue;

      // Gracefully absent — skip stories with no metric: block
      if (!/^metric:/m.test(text)) continue;

      const applies = readField(text, 'applies');
      const name = readField(text, 'name');
      const direction = readField(text, 'direction');
      const unit = readField(text, 'unit');
      const baseline = readField(text, 'baseline');

      results.push({
        epic_id: epicId,
        story_id: storyId,
        applies: applies === 'true' ? true : applies === 'false' ? false : null,
        metric: applies === 'false' ? null : {
          name,
          direction,
          unit,
          baseline: baseline === 'null' ? null : baseline,
        },
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose a JSON snapshot of current Hive project state.
 *
 * @param {object} opts
 * @param {string} opts.stateDir   Repo root (contains .pHive)
 * @param {string} [opts.epic]     Optional epic id filter
 * @param {number} [opts.episodeLimit=5]  Max episode markers per story
 * @returns {object} Snapshot payload (schema_version: 1)
 */
export function composeContextSnapshot({ stateDir, epic, episodeLimit = 5 }) {
  const pHiveDir = join(stateDir, '.pHive');

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    branch: currentBranch(stateDir),
    epics: loadEpics(pHiveDir, epic),
    stories: loadStories(pHiveDir, epic, stateDir),
    episodes_recent: loadEpisodesRecent(pHiveDir, epic, episodeLimit),
    triage_open: loadTriageOpen(pHiveDir),
    metrics_health: loadMetricsHealth(pHiveDir, epic, stateDir),
  };
}
