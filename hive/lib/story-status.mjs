/**
 * story-status.mjs — derive story effective status from episode markers + git state.
 *
 * Export surface:
 *   deriveStoryStatus({ epic_id, story_id, repo_root? })
 *     → 'pending' | 'in_progress' | 'completed' | 'deferred' | 'blocked' | 'failed'
 *
 *   deriveAllStatuses({ repo_root? })
 *     → Map<string, { epic_id, story_id, yaml_status, derived_status, stale }>
 *
 * Priority order (episode-schema.md §"Reading markers for status"):
 *   1. `deferred:` block in story YAML → deferred
 *   2. Any episode marker status=failed|escalated → failed
 *   3. depends_on stories not yet completed → blocked (subset of pending)
 *   4. No episode markers → pending
 *   5. Final workflow step has status=completed marker → completed
 *   6. Otherwise (markers exist, final step not completed) → in_progress
 *
 * Authoritative source order: git + .pHive/episodes/ > YAML status: field.
 * The YAML status: field is advisory only (episode-schema.md, deprecated note).
 */

'use strict';

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Repo root resolution
// ---------------------------------------------------------------------------

function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, '.pHive'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to two levels up from hive/lib/
  return resolve(__dirname, '..', '..');
}

// ---------------------------------------------------------------------------
// Minimal YAML field reader (avoids a full parse for simple scalar fields)
// ---------------------------------------------------------------------------

function readYamlField(text, field) {
  const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
  const m = text.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

function readYamlListField(text, field) {
  // Handles both inline [a, b] and block list form
  const inline = new RegExp(`^${field}:\\s*\\[([^\\]]*)]`, 'm');
  const mi = text.match(inline);
  if (mi) {
    return mi[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  // Block list: lines starting with "  - " after the field header
  const headerRe = new RegExp(`^${field}:\\s*$`, 'm');
  if (!headerRe.test(text)) return [];
  const after = text.slice(text.search(headerRe) + field.length + 1);
  const lines = after.split('\n');
  const items = [];
  for (const line of lines) {
    const m = line.match(/^\s+-\s+(.+)$/);
    if (!m) {
      if (line.trim() && !line.match(/^\s/)) break;
      continue;
    }
    items.push(m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  return items;
}

function hasYamlBlock(text, field) {
  return new RegExp(`^${field}:`, 'm').test(text);
}

// ---------------------------------------------------------------------------
// Story YAML helpers
// ---------------------------------------------------------------------------

function readStoryYaml(repoRoot, epic_id, story_id) {
  const path = join(repoRoot, '.pHive', 'epics', epic_id, 'stories', `${story_id}.yaml`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function getStorySteps(storyText) {
  // Extract step ids from the steps: block
  const steps = [];
  const stepsStart = storyText.search(/^steps:\s*$/m);
  if (stepsStart === -1) return steps;
  const after = storyText.slice(stepsStart);
  const lines = after.split('\n').slice(1);
  for (const line of lines) {
    if (line.trim() && !line.match(/^\s/)) break;
    const m = line.match(/^\s+id:\s+(.+)$/);
    if (m) steps.push(m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Episode marker helpers
// ---------------------------------------------------------------------------

function readEpisodeMarkers(repoRoot, epic_id, story_id) {
  const dir = join(repoRoot, '.pHive', 'episodes', epic_id, story_id);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.yaml'));
  return files.map(f => {
    const text = readFileSync(join(dir, f), 'utf8');
    // Strip YAML front-matter delimiter if present
    const body = text.startsWith('---') ? text.split('---').slice(1).join('---') : text;
    return {
      file: f,
      step_id: readYamlField(body, 'step_id'),
      status: readYamlField(body, 'status'),
    };
  });
}

// ---------------------------------------------------------------------------
// Git state helpers
// ---------------------------------------------------------------------------

function isBranchMergedToMain(repoRoot, branchPattern) {
  try {
    const merged = execFileSync('git', [
      'branch', '-r', '--merged', 'origin/main',
    ], { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = merged.split('\n').map(l => l.trim());
    return lines.some(l => l.includes(branchPattern));
  } catch {
    return false;
  }
}

function isStoryBranchMerged(repoRoot, epic_id, story_id) {
  // Common branch patterns for story branches
  const patterns = [
    story_id,
    `${epic_id}/${story_id}`,
  ];
  return patterns.some(p => isBranchMergedToMain(repoRoot, p));
}

// ---------------------------------------------------------------------------
// deriveStoryStatus — core function
// ---------------------------------------------------------------------------

/**
 * Derive a story's effective status from episode markers + git state.
 *
 * @param {object} opts
 * @param {string} opts.epic_id
 * @param {string} opts.story_id
 * @param {string} [opts.repo_root] - defaults to nearest ancestor with .pHive
 * @returns {'pending'|'in_progress'|'completed'|'deferred'|'blocked'|'failed'}
 */
export function deriveStoryStatus({ epic_id, story_id, repo_root }) {
  const repoRoot = repo_root || findRepoRoot(process.cwd());
  const storyText = readStoryYaml(repoRoot, epic_id, story_id);

  // 1. deferred: block in YAML
  if (storyText && hasYamlBlock(storyText, 'deferred')) {
    return 'deferred';
  }

  // Pre-marker-era completions: YAML status=completed + shipped: block is accepted as evidence
  // when there are no episode markers. This covers stories shipped before the marker system.
  if (storyText && hasYamlBlock(storyText, 'shipped')) {
    const yamlStatus = readYamlField(storyText, 'status');
    if (yamlStatus === 'completed') return 'completed';
  }

  // Collect episode markers
  const markers = readEpisodeMarkers(repoRoot, epic_id, story_id);

  // 2. Any marker failed or escalated
  if (markers.some(m => m.status === 'failed' || m.status === 'escalated')) {
    return 'failed';
  }

  // Determine the canonical step list (from story YAML, then fall back to markers)
  const storySteps = storyText ? getStorySteps(storyText) : [];
  const terminalStep = storySteps.length > 0 ? storySteps[storySteps.length - 1] : null;

  // 5. Terminal step completed
  if (terminalStep) {
    const terminalMarker = markers.find(m => m.step_id === terminalStep && m.status === 'completed');
    if (terminalMarker) return 'completed';
  }

  // Check git state — branch merged to main is also a completed signal
  if (isStoryBranchMerged(repoRoot, epic_id, story_id)) {
    return 'completed';
  }

  // 3. blocked — depends_on stories not completed
  if (storyText) {
    const deps = readYamlListField(storyText, 'depends_on');
    if (deps.length > 0) {
      const allDepsComplete = deps.every(dep => {
        const depStatus = deriveStoryStatus({ epic_id, story_id: dep, repo_root: repoRoot });
        return depStatus === 'completed';
      });
      if (!allDepsComplete && markers.length === 0) return 'blocked';
    }
  }

  // 4. No markers → pending
  if (markers.length === 0) return 'pending';

  // 6. Markers exist but terminal not completed → in_progress
  return 'in_progress';
}

// ---------------------------------------------------------------------------
// deriveAllStatuses — bulk scan across all epics
// ---------------------------------------------------------------------------

/**
 * Scan all epics and return derived status for every story.
 *
 * @param {object} [opts]
 * @param {string} [opts.repo_root]
 * @returns {Array<{epic_id, story_id, yaml_status, derived_status, stale}>}
 */
export function deriveAllStatuses({ repo_root } = {}) {
  const repoRoot = repo_root || findRepoRoot(process.cwd());
  const epicsDir = join(repoRoot, '.pHive', 'epics');
  if (!existsSync(epicsDir)) return [];

  const results = [];
  const epics = readdirSync(epicsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const epic_id of epics) {
    const storiesDir = join(epicsDir, epic_id, 'stories');
    if (!existsSync(storiesDir)) continue;
    const storyFiles = readdirSync(storiesDir).filter(f => f.endsWith('.yaml'));

    for (const sf of storyFiles) {
      const story_id = sf.replace(/\.yaml$/, '');
      const storyText = readStoryYaml(repoRoot, epic_id, story_id);
      const yaml_status = storyText ? (readYamlField(storyText, 'status') || 'pending') : 'pending';
      const derived_status = deriveStoryStatus({ epic_id, story_id, repo_root: repoRoot });
      results.push({
        epic_id,
        story_id,
        yaml_status,
        derived_status,
        stale: yaml_status !== derived_status,
      });
    }
  }
  return results;
}
