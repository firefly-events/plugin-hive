/**
 * backend-dispatch-codex.test.mjs
 *
 * Tests for the `codex` backend resolution and headless dispatch path (DOS-334).
 *
 * Covers:
 *   1. resolvePersonaBackend: 'codex' resolves without falling through to 'claude'
 *   2. codex-backend: JSONL parsing helpers (unit)
 *   3. codex-backend: runCodexExec with mocked spawn (integration contract)
 *   4. codex-backend: error / timeout handling
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { resolvePersonaBackend } from '../index.mjs';
import {
  parseJsonl,
  extractAgentMessage,
  extractThreadId,
  extractUsage,
  eventsToMessages,
  runCodexExec,
} from '../../codex-backend.mjs';

// ── 1. Backend resolution ──────────────────────────────────────────────────────

test('resolvePersonaBackend: codex resolves without falling through to claude', () => {
  assert.equal(resolvePersonaBackend('dev', { dev: 'codex' }), 'codex');
});

test('resolvePersonaBackend: codex is distinct from multica:<runtime> tokens', () => {
  assert.notEqual(resolvePersonaBackend('dev', { dev: 'codex' }), 'claude');
  assert.notEqual(resolvePersonaBackend('dev', { dev: 'codex' }), 'multica:codex');
});

test('resolvePersonaBackend: unknown backend still falls back to claude', () => {
  assert.equal(resolvePersonaBackend('dev', { dev: 'llama' }), 'claude');
});

// ── 2. JSONL parsing helpers ───────────────────────────────────────────────────

const SAMPLE_EVENTS = [
  { type: 'thread.started', thread_id: 'tid-001' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Thinking…' } },
  {
    type: 'item.started',
    item: { id: 'item_1', type: 'command_execution', command: 'ls /tmp', aggregated_output: '', exit_code: null, status: 'in_progress' },
  },
  {
    type: 'item.completed',
    item: { id: 'item_1', type: 'command_execution', command: 'ls /tmp', aggregated_output: 'a\nb\n', exit_code: 0, status: 'completed' },
  },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done. Found 2 files.' } },
  { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20, reasoning_output_tokens: 0 } },
];

const SAMPLE_JSONL = SAMPLE_EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n';

test('parseJsonl: parses valid JSONL lines into objects', () => {
  const events = parseJsonl(SAMPLE_JSONL);
  assert.equal(events.length, SAMPLE_EVENTS.length);
  assert.equal(events[0].type, 'thread.started');
});

test('parseJsonl: skips non-JSON lines silently (e.g. "Reading additional input...")', () => {
  const mixed = 'Reading additional input from stdin...\n' + SAMPLE_JSONL;
  const events = parseJsonl(mixed);
  assert.equal(events.length, SAMPLE_EVENTS.length);
});

test('parseJsonl: returns empty array for empty input', () => {
  assert.deepEqual(parseJsonl(''), []);
  assert.deepEqual(parseJsonl('\n\n'), []);
});

test('extractAgentMessage: returns the last agent_message text', () => {
  const events = parseJsonl(SAMPLE_JSONL);
  assert.equal(extractAgentMessage(events), 'Done. Found 2 files.');
});

test('extractAgentMessage: returns empty string when no agent_message', () => {
  assert.equal(extractAgentMessage([{ type: 'turn.started' }]), '');
});

test('extractThreadId: extracts thread_id from thread.started event', () => {
  const events = parseJsonl(SAMPLE_JSONL);
  assert.equal(extractThreadId(events), 'tid-001');
});

test('extractThreadId: returns null when no thread.started event', () => {
  assert.equal(extractThreadId([{ type: 'turn.started' }]), null);
});

test('extractUsage: extracts usage from turn.completed event', () => {
  const events = parseJsonl(SAMPLE_JSONL);
  const usage = extractUsage(events);
  assert.equal(usage.input_tokens, 100);
  assert.equal(usage.output_tokens, 20);
});

test('eventsToMessages: extracts agent_message and command_execution items', () => {
  const events = parseJsonl(SAMPLE_JSONL);
  const messages = eventsToMessages(events);
  // item_started (in_progress) is filtered out since it's not 'item.completed'
  assert.equal(messages.length, 3); // item_0 agent_msg, item_1 cmd, item_2 agent_msg
  assert.equal(messages[0].type, 'agent_message');
  assert.equal(messages[0].text, 'Thinking…');
  assert.equal(messages[1].type, 'command_execution');
  assert.equal(messages[1].command, 'ls /tmp');
  assert.equal(messages[1].exit_code, 0);
  assert.equal(messages[2].type, 'agent_message');
  assert.equal(messages[2].text, 'Done. Found 2 files.');
});

// ── 3. runCodexExec with mocked spawn ─────────────────────────────────────────

/**
 * Build a fake spawn that returns the given stdout and exit code,
 * allowing tests to verify the exact command/args without hitting the real CLI.
 */
function fakeSpawn(stdout, exitCode = 0, stderrText = '') {
  const captured = [];
  const fn = (cmd, args, _opts) => {
    captured.push({ cmd, args });

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    process.nextTick(() => {
      child.stdout.emit('data', stdout);
      if (stderrText) child.stderr.emit('data', stderrText);
      child.emit('close', exitCode);
    });

    return child;
  };
  fn.captured = captured;
  return fn;
}

test('runCodexExec: invokes codex exec with --json --ephemeral --skip-git-repo-check', async () => {
  const _spawn = fakeSpawn(SAMPLE_JSONL);
  await runCodexExec('Do the thing', { _spawn });
  const [call] = _spawn.captured;
  assert.equal(call.args[0], 'exec');
  assert.ok(call.args.includes('--json'), 'missing --json');
  assert.ok(call.args.includes('--ephemeral'), 'missing --ephemeral');
  assert.ok(call.args.includes('--skip-git-repo-check'), 'missing --skip-git-repo-check');
  assert.equal(call.args.at(-1), 'Do the thing');
});

test('runCodexExec: passes --sandbox when sandbox option provided', async () => {
  const _spawn = fakeSpawn(SAMPLE_JSONL);
  await runCodexExec('Prompt', { sandbox: 'read-only', _spawn });
  const { args } = _spawn.captured[0];
  const sandboxIdx = args.indexOf('--sandbox');
  assert.ok(sandboxIdx >= 0, '--sandbox flag missing');
  assert.equal(args[sandboxIdx + 1], 'read-only');
});

test('runCodexExec: passes -C workDir when workDir option provided', async () => {
  const _spawn = fakeSpawn(SAMPLE_JSONL);
  await runCodexExec('Prompt', { workDir: '/repo/path', _spawn });
  const { args } = _spawn.captured[0];
  const cdIdx = args.indexOf('-C');
  assert.ok(cdIdx >= 0, '-C flag missing');
  assert.equal(args[cdIdx + 1], '/repo/path');
});

test('runCodexExec: returns completed status when codex exits 0 with agent message', async () => {
  const _spawn = fakeSpawn(SAMPLE_JSONL);
  const result = await runCodexExec('Prompt', { agentName: 'reviewer', _spawn });
  assert.equal(result.status, 'completed');
  assert.equal(result.agent_name, 'reviewer');
  assert.equal(result.task_id, null);
  assert.equal(result.agent_id, null);
  assert.equal(result.attempts, 1);
  assert.equal(result.thread_id, 'tid-001');
  assert.ok(result.usage?.input_tokens === 100);
  assert.ok(result.messages.length > 0);
  assert.ok(typeof result.started_at === 'string');
  assert.ok(typeof result.completed_at === 'string');
});

test('runCodexExec: returns failed status when codex exits non-zero', async () => {
  const _spawn = fakeSpawn(SAMPLE_JSONL, 1);
  const result = await runCodexExec('Prompt', { _spawn });
  assert.equal(result.status, 'failed');
});

test('runCodexExec: returns failed status when codex exits 0 but no agent_message', async () => {
  const noMessageJsonl = [
    JSON.stringify({ type: 'thread.started', thread_id: 'tid-x' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 0 } }),
  ].join('\n') + '\n';
  const _spawn = fakeSpawn(noMessageJsonl, 0);
  const result = await runCodexExec('Prompt', { _spawn });
  assert.equal(result.status, 'failed');
});

test('runCodexExec: returns failed status on spawn error', async () => {
  const fn = (cmd, args, _opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => child.emit('error', new Error('ENOENT: codex not found')));
    return child;
  };
  const result = await runCodexExec('Prompt', { _spawn: fn });
  assert.equal(result.status, 'failed');
  assert.match(result.notes, /ENOENT/);
});

test('runCodexExec: episode-record shape has all required fields', async () => {
  const _spawn = fakeSpawn(SAMPLE_JSONL);
  const result = await runCodexExec('Prompt', { _spawn });
  for (const field of ['status', 'notes', 'messages', 'task_id', 'agent_id', 'agent_name', 'work_dir', 'attempts', 'started_at', 'completed_at']) {
    assert.ok(field in result, `missing field: ${field}`);
  }
});

// ── 4. No cmux dependency ──────────────────────────────────────────────────────

test('codex-backend: module does not import or invoke cmux', async () => {
  // Check that cmux is not imported or spawned. Comments explaining the
  // absence of cmux are allowed; executable cmux calls are not.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(__dirname, '../../codex-backend.mjs'), 'utf8');
  // Strip single-line and block comments before checking for cmux usage.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/[^\n]*/g, '');         // line comments
  assert.doesNotMatch(stripped, /cmux/, 'codex-backend.mjs must not call or import cmux');
});
