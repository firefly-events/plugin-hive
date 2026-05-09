/**
 * Dreaming Replay
 *
 * Story: s16-b3-dreaming-replay-meta-optimize-fifth-source
 * Trigger contract reference only: s11-c1-under-scheduler-step-metadata and
 * s12-c2-routines-acr-integration-refs land separately on this branch.
 *
 * Q3 primary source:
 *   URL: https://platform.claude.com/docs/en/managed-agents/dreams
 *   Last checked: 2026-05-09
 *
 * The public Dreams API is a managed-agents async "dream" resource over
 * memory stores + past sessions. This module is the local cross-session
 * adapter for Hive's episode corpus under `.pHive/episodes/`: it mirrors the
 * public Dreams envelope where practical, then emits local `playbook_delta`
 * outputs for wiki/KG consumers. When preview capability is unavailable, it
 * silently returns no proposals.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

let yaml = null;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const CONFIG_PATH = path.join(__dirname, '..', 'hive.config.yaml');

async function runDreamingReplay({
  episodeRoot,
  kg = null,
  wiki = null,
  capabilityProbe = defaultCapabilityProbe,
} = {}) {
  const capable = await capabilityProbe();
  if (!capable) {
    return { playbookDeltas: [], capabilityErr: null };
  }

  const root = path.resolve(String(episodeRoot || '.pHive/episodes'));
  const files = listEpisodeFiles(root);
  const playbookDeltas = [];
  const timeoutMs = readDreamingTimeoutMs();
  const startedAt = Date.now();

  for (const filePath of files) {
    const parsed = parseEpisodeFile(filePath);
    const delta = toDreamAdapterDelta(root, filePath, parsed);
    if (!delta) continue;
    playbookDeltas.push(delta);
    emitDelta(wiki, 'applyDelta', delta.outputs[0].wiki);
    emitDelta(kg, 'applyDelta', delta.outputs[0].kg);

    if (Number.isFinite(timeoutMs) && timeoutMs >= 0 && (Date.now() - startedAt) > timeoutMs) {
      return { playbookDeltas, capabilityErr: null, timeoutErr: true };
    }
  }

  return { playbookDeltas, capabilityErr: null };
}

async function defaultCapabilityProbe() {
  return false;
}

function emitDelta(target, methodName, payload) {
  if (!target || typeof target[methodName] !== 'function') return;
  target[methodName](payload);
}

function listEpisodeFiles(root) {
  if (!fs.existsSync(root)) return [];
  const queue = [root];
  const files = [];
  let index = 0;

  while (index < queue.length) {
    const current = queue[index];
    index += 1;
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function parseEpisodeFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (yaml) {
    return yaml.load(raw) || {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Unable to parse episode fixture without js-yaml: ${filePath}`);
  }
}

function toDreamAdapterDelta(root, filePath, parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const pb = parsed.playbook_delta;
  if (!pb || typeof pb !== 'object') return null;

  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  const sessionId = relative.replace(/\.ya?ml$/i, '');
  const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;

  return {
    type: 'dream',
    source_episode: sessionId,
    status: typeof parsed.status === 'string' ? parsed.status : 'completed',
    inputs: [{ type: 'sessions', session_ids: [sessionId] }],
    outputs: [{
      type: 'playbook_delta',
      title: stringOrEmpty(pb.title),
      rationale: stringOrEmpty(pb.rationale),
      wiki: toObject(pb.wiki),
      kg: toObject(pb.kg),
    }],
    model: { id: 'local-episode-walker' },
    instructions: 'Local adapter over .pHive/episodes/**/*.yaml for cross-session replay.',
    session_id: sessionId,
    created_at: timestamp,
    ended_at: timestamp,
    archived_at: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    error: null,
  };
}

function toObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function readDreamingTimeoutMs() {
  let config;
  try {
    config = parseConfigFile(CONFIG_PATH);
  } catch {
    return Infinity;
  }

  const timeoutHours = config && config.dreaming && Number(config.dreaming.timeout_hours);
  if (!Number.isFinite(timeoutHours) || timeoutHours < 0) {
    return Infinity;
  }
  return timeoutHours * 60 * 60 * 1000;
}

function parseConfigFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (yaml) {
    return yaml.load(raw) || {};
  }
  const match = raw.match(/^\s*dreaming:\s*$[\s\S]*?^\s*timeout_hours:\s*([0-9.]+)/m);
  if (!match) return {};
  return {
    dreaming: {
      timeout_hours: Number(match[1]),
    },
  };
}

module.exports = { runDreamingReplay };
