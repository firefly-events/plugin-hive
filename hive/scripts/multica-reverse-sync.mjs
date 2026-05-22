#!/usr/bin/env node
/**
 * multica-reverse-sync.mjs — poll Multica and flip story YAML to deferred when cancelled.
 *
 * Usage:
 *   node hive/scripts/multica-reverse-sync.mjs [repo-root]
 *   MULTICA_SERVER_URL=https://... MULTICA_TOKEN=mul_... node hive/scripts/multica-reverse-sync.mjs
 *
 * Credentials: env vars MULTICA_SERVER_URL + MULTICA_TOKEN, or ~/.multica/config.json.
 *
 * Output: one summary line to stdout:
 *   <N> issues checked, <M> cancelled, <P> YAMLs patched, <Q> no-ops
 */

'use strict';

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

function loadConfig(overrides = {}) {
  const serverUrl = overrides.serverUrl || process.env.MULTICA_SERVER_URL || '';
  const token = overrides.token || process.env.MULTICA_TOKEN || '';
  if (serverUrl && token) return { serverUrl, token };

  const configPath = join(process.env.HOME || '', '.multica', 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return {
        serverUrl: serverUrl || cfg.server_url || '',
        token: token || cfg.token || '',
      };
    } catch {
      // fall through
    }
  }
  return { serverUrl, token };
}

// ---------------------------------------------------------------------------
// Minimal YAML helpers (no deps)
// ---------------------------------------------------------------------------

function readYamlField(text, field) {
  const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
  const m = text.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

function hasYamlBlock(text, field) {
  return new RegExp(`^${field}:`, 'm').test(text);
}

// ---------------------------------------------------------------------------
// Episode marker discovery
// ---------------------------------------------------------------------------

function* findMarkers(episodesDir) {
  if (!existsSync(episodesDir)) return;
  for (const epic of readdirSync(episodesDir)) {
    const epicDir = join(episodesDir, epic);
    try {
      if (!statSync(epicDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const story of readdirSync(epicDir)) {
      const markerPath = join(epicDir, story, 'multica-run.yaml');
      if (existsSync(markerPath)) {
        yield { epicFromPath: epic, storyFromPath: story, markerPath };
      }
    }
  }
}

function parseMarker(markerPath) {
  const raw = readFileSync(markerPath, 'utf8');
  const body = raw.startsWith('---') ? raw.split('---').slice(1).join('---') : raw;
  return {
    issue_id: readYamlField(body, 'issue_id'),
    issue_identifier: readYamlField(body, 'issue_identifier'),
    workspace_id: readYamlField(body, 'workspace_id'),
    story_id: readYamlField(body, 'story_id'),
    epic: readYamlField(body, 'epic'),
  };
}

// ---------------------------------------------------------------------------
// Multica API
// ---------------------------------------------------------------------------

async function fetchIssueStatus({ serverUrl, token, workspaceId, issueId }) {
  const base = serverUrl.replace(/\/+$/, '');
  const url = `${base}/api/issues/${encodeURIComponent(issueId)}?workspace_id=${encodeURIComponent(workspaceId)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching issue ${issueId}`);
  }
  const data = await resp.json();
  return data.status;
}

// ---------------------------------------------------------------------------
// Story YAML helpers
// ---------------------------------------------------------------------------

function getStoryYamlPath(repoRoot, epicId, storyId) {
  return join(repoRoot, '.pHive', 'epics', epicId, 'stories', `${storyId}.yaml`);
}

function getCurrentStoryStatus(repoRoot, epicId, storyId) {
  const path = getStoryYamlPath(repoRoot, epicId, storyId);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  if (hasYamlBlock(text, 'deferred')) return 'deferred';
  return readYamlField(text, 'status') || 'pending';
}

function patchStoryYaml(repoRoot, epicId, storyId, issueIdentifier) {
  const path = getStoryYamlPath(repoRoot, epicId, storyId);
  if (!existsSync(path)) return false;

  let text = readFileSync(path, 'utf8');

  if (/^status:\s*.+$/m.test(text)) {
    text = text.replace(/^(status:\s*).+$/m, `$1deferred`);
  } else {
    text = text.replace(/^(id:\s*.+)$/m, `$1\nstatus: deferred`);
  }

  const at = new Date().toISOString();
  const deferredBlock =
    `deferred:\n` +
    `  at: "${at}"\n` +
    `  source: multica-cancelled\n` +
    `  issue_identifier: ${issueIdentifier}`;

  text = text.trimEnd() + '\n' + deferredBlock + '\n';
  writeFileSync(path, text, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Core run — exported for testing
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.serverUrl
 * @param {string} opts.token
 * @returns {Promise<{checked: number, cancelled: number, patched: number, noops: number}>}
 */
export async function run({ repoRoot, serverUrl, token }) {
  const episodesDir = join(repoRoot, '.pHive', 'episodes');
  let checked = 0, cancelled = 0, patched = 0, noops = 0;

  for (const { epicFromPath, storyFromPath, markerPath } of findMarkers(episodesDir)) {
    const marker = parseMarker(markerPath);
    const issueId = marker.issue_id;
    const workspaceId = marker.workspace_id;

    if (!issueId || !workspaceId) continue;

    const epicId = marker.epic || epicFromPath;
    const storyId = marker.story_id || storyFromPath;
    const issueIdentifier = marker.issue_identifier || issueId;

    checked++;
    let status;
    try {
      status = await fetchIssueStatus({ serverUrl, token, workspaceId, issueId });
    } catch (err) {
      process.stderr.write(`  warn: could not fetch ${issueIdentifier}: ${err.message}\n`);
      continue;
    }

    if (status !== 'cancelled') continue;
    cancelled++;

    const currentStatus = getCurrentStoryStatus(repoRoot, epicId, storyId);

    // Skip completed/failed/deferred — only patch pending or in_progress stories.
    if (
      currentStatus === 'deferred' ||
      currentStatus === 'completed' ||
      currentStatus === 'failed'
    ) {
      noops++;
      continue;
    }

    const ok = patchStoryYaml(repoRoot, epicId, storyId, issueIdentifier);
    if (ok) {
      patched++;
    } else {
      noops++;
    }
  }

  return { checked, cancelled, patched, noops };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const repoRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '..', '..');
  const config = loadConfig();

  if (!config.serverUrl || !config.token) {
    process.stderr.write(
      'Error: MULTICA_SERVER_URL and MULTICA_TOKEN must be set ' +
      '(or configured in ~/.multica/config.json).\n',
    );
    process.exit(1);
  }

  run({ repoRoot, serverUrl: config.serverUrl, token: config.token })
    .then(({ checked, cancelled, patched, noops }) => {
      console.log(
        `${checked} issues checked, ${cancelled} cancelled, ${patched} YAMLs patched, ${noops} no-ops`,
      );
    })
    .catch(err => {
      process.stderr.write(`Fatal: ${err.message || err}\n`);
      process.exit(1);
    });
}
