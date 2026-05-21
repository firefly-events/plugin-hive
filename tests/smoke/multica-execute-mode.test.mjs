import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dispatchStoryToAgent,
  ensureIssueBriefMatches,
  moveOutOfBacklogIfNeeded,
  resolveAgentUuidByName,
  serializeStoryBrief,
} from '../../hive/lib/multica-story-dispatch/index.mjs';
import {
  pollTaskUntilTerminal,
  writeMulticaRunEpisode,
} from '../../hive/lib/multica-story-dispatch/episode-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const adapterDir = path.join(repoRoot, 'hive', 'adapters', 'multica');
const adapterPath = path.join(adapterDir, 'index.ts');
const configPath = path.join(os.homedir(), '.multica', 'config.json');
const TITLE = 's5 smoke test 2026-05-21';
const MAX_WALL_CLOCK_MS = 120_000;

function trimTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function readMulticaSettings() {
  const cfg = await readJsonIfExists(configPath);
  return {
    token: process.env.MULTICA_TOKEN || cfg.token || '',
    serverUrl: trimTrailingSlash(process.env.MULTICA_SERVER_URL || cfg.server_url || ''),
    workspaceId: process.env.MULTICA_WORKSPACE_ID || cfg.workspace_id || '',
    workspaceSlug: process.env.MULTICA_WORKSPACE_SLUG || cfg.workspace_slug || 'plugin-hive',
  };
}

async function probeHealthz(serverUrl) {
  if (!serverUrl) return { ok: false, status: 'missing server_url' };
  try {
    const res = await fetch(`${serverUrl}/healthz`, {
      signal: AbortSignal.timeout(5_000),
    });
    return { ok: res.status === 200, status: res.status };
  } catch (error) {
    return { ok: false, status: error?.message || String(error) };
  }
}

async function httpJson(serverUrl, token, apiPath, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${serverUrl}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (res.status >= 200 && res.status < 300) return parsed;
  throw new Error(`Multica ${method} ${apiPath} failed HTTP ${res.status}: ${text}`);
}

async function resolveWorkspaceId({ serverUrl, token, workspaceId, workspaceSlug }) {
  if (workspaceId) return workspaceId;
  const body = await httpJson(serverUrl, token, '/api/workspaces');
  const workspaces = Array.isArray(body) ? body : body?.workspaces ?? body?.data ?? [];
  const match = workspaces.find((workspace) => workspace?.slug === workspaceSlug);
  assert.ok(match?.id, `workspace not found: ${workspaceSlug}`);
  return String(match.id);
}

function developerAgentNameFromConfig() {
  const agentsPath = path.join(repoRoot, '.pHive', 'multica', 'agents.yaml');
  assert.ok(existsSync(agentsPath), '.pHive/multica/agents.yaml exists');
  const raw = existsSync(agentsPath)
    ? String(readFileSync(agentsPath, 'utf8'))
    : '';
  assert.match(raw, /^\s*-\s+name:\s+developer\s*$/m, 'developer agent declared');
  return 'developer';
}

function runAdapter(request, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--prefix', adapterDir, 'tsx', adapterPath], {
      cwd: repoRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch (error) {
        reject(new Error(`adapter returned non-JSON stdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      if (code !== 0 || envelope.error) {
        reject(new Error(`adapter failed ${code}: ${JSON.stringify(envelope.error)}\n${stderr}`));
        return;
      }
      resolve(envelope.result);
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

async function issueUuidByIdentifier({ serverUrl, token, workspaceId, identifier }) {
  const body = await httpJson(
    serverUrl,
    token,
    `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}&identifier=${encodeURIComponent(identifier)}`,
  );
  const issues = Array.isArray(body) ? body : body?.issues ?? body?.data ?? [];
  const issue = issues.find((candidate) => String(candidate?.identifier) === identifier) ?? issues[0];
  assert.ok(issue?.id, `created issue ${identifier} resolvable by identifier`);
  return String(issue.id);
}

function parseIdentifier(trackerId) {
  const identifier = String(trackerId).split('/').pop();
  assert.ok(identifier, `adapter tracker id has identifier: ${trackerId}`);
  return identifier;
}

test('live Multica execute mode smoke dispatches one story and writes an episode', {
  timeout: MAX_WALL_CLOCK_MS + 30_000,
}, async (t) => {
  const settings = await readMulticaSettings();
  const health = await probeHealthz(settings.serverUrl);
  if (!health.ok) {
    t.skip(`/healthz not reachable or not 200 (${health.status})`);
    return;
  }
  if (!settings.token) {
    t.skip('MULTICA_TOKEN or ~/.multica/config.json token required after /healthz passed');
    return;
  }

  const workspaceId = await resolveWorkspaceId(settings);
  const agentName = developerAgentNameFromConfig();
  const agentUuid = await resolveAgentUuidByName(
    settings.serverUrl,
    settings.token,
    workspaceId,
    agentName,
  );

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'hive-multica-smoke-'));
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });
  const homeDir = path.join(tmpRoot, 'home');
  await mkdir(path.join(homeDir, '.multica'), { recursive: true });
  await writeFile(
    path.join(homeDir, '.multica', 'config.json'),
    `${JSON.stringify({
      server_url: settings.serverUrl,
      token: settings.token,
      workspace_id: workspaceId,
      workspace_slug: settings.workspaceSlug,
    }, null, 2)}\n`,
    'utf8',
  );

  const env = {
    ...process.env,
    HOME: homeDir,
    MULTICA_SERVER_URL: settings.serverUrl,
    MULTICA_TOKEN: settings.token,
  };
  const story = {
    id: 's5-smoke-and-docs-live-spike',
    epic: 'multica-execute-routing',
    title: TITLE,
    description: 'Live spike smoke for Hive multica execute mode dispatch.',
    acceptance_criteria: [
      'A throwaway issue is created through the real Multica adapter.',
      'The developer persona receives the assignment.',
      'Hive writes one terminal multica-run episode marker.',
    ],
    files_to_modify: [],
    references: ['README.md', 'GUIDE.md', 'CHANGELOG.md'],
  };

  const created = await runAdapter({
    method: 'createStory',
    params: {
      title: TITLE,
      body: '<brief placeholder>',
      labels: ['hive-smoke', 's5-smoke-and-docs'],
    },
  }, env);
  const identifier = parseIdentifier(created.id);
  const issueUuid = await issueUuidByIdentifier({
    serverUrl: settings.serverUrl,
    token: settings.token,
    workspaceId,
    identifier,
  });

  await moveOutOfBacklogIfNeeded(settings.serverUrl, settings.token, workspaceId, issueUuid);
  await ensureIssueBriefMatches(
    settings.serverUrl,
    settings.token,
    workspaceId,
    issueUuid,
    serializeStoryBrief({ ...story, tracker_id: created.id }),
  );
  await dispatchStoryToAgent(
    settings.serverUrl,
    settings.token,
    workspaceId,
    issueUuid,
    agentUuid,
  );

  const terminal = await pollTaskUntilTerminal({
    serverUrl: settings.serverUrl,
    token: settings.token,
    workspaceId,
    issueUuid,
    maxWallClockMs: MAX_WALL_CLOCK_MS,
    pollIntervalMs: 5_000,
    messagesCaptureMax: 200,
  });
  const episode = await writeMulticaRunEpisode({
    hiveStateDir: tmpRoot,
    epicHandle: 'multica-execute-routing',
    storyId: 's5-smoke-and-docs',
    issueUuid,
    identifier,
    terminal,
    messagesCaptureMax: 200,
  });

  assert.ok(['passed', 'failed', 'cancelled'].includes(episode.status));
  const marker = await readFile(episode.markerPath, 'utf8');
  assert.match(marker, /^step: multica-run$/m);
  assert.match(marker, /^status: (passed|failed|cancelled)$/m);

  // Sidecar file must exist (size may be 0 — agent may terminate without
  // emitting messages on trivial smoke prompts; the structural loop is
  // what's being verified, not the agent's actual productivity).
  const messagesStat = await stat(episode.messagesPath);
  assert.ok(messagesStat.size >= 0, 'multica-run.messages.jsonl exists');
});
