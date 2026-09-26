/**
 * backend-dispatch-openai-compat.test.mjs
 *
 * Tests for the runner-agnostic OpenAI-compatible backend (Kimi K3 via OpenRouter,
 * Gemini via Google's OpenAI-compat surface) and the resolver tokens that route to it.
 *
 * Covers:
 *   1. resolvePersonaBackend: gemini / gemini:<model> / openrouter:<model> / kimi(-k3) alias
 *      resolve without falling through to 'claude'; existing lanes unchanged.
 *   2. openai-compat-backend: parseBackendToken (provider/model split + aliases + defaults)
 *   3. openai-compat-backend: extractContent helper
 *   4. openai-compat-backend: runOpenAICompat with mocked fetch (integration contract)
 *   5. openai-compat-backend: error / missing-key handling → failed terminal (never throws)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePersonaBackend } from '../index.mjs';
import {
  parseBackendToken,
  extractContent,
  runOpenAICompat,
  PROVIDERS,
} from '../../openai-compat-backend.mjs';

// ── 1. Backend resolution ──────────────────────────────────────────────────────

test('resolvePersonaBackend: gemini resolves without falling through to claude', () => {
  assert.equal(resolvePersonaBackend('security-reviewer', { 'security-reviewer': 'gemini' }), 'gemini');
});

test('resolvePersonaBackend: gemini:<model> passthrough', () => {
  assert.equal(
    resolvePersonaBackend('a', { a: 'gemini:gemini-3.6-flash' }),
    'gemini:gemini-3.6-flash',
  );
});

test('resolvePersonaBackend: openrouter:<model> passthrough (slug may contain slash)', () => {
  assert.equal(
    resolvePersonaBackend('a', { a: 'openrouter:moonshotai/kimi-k3' }),
    'openrouter:moonshotai/kimi-k3',
  );
});

test('resolvePersonaBackend: kimi and kimi-k3 alias to the OpenRouter Kimi K3 slug', () => {
  assert.equal(resolvePersonaBackend('a', { a: 'kimi' }), 'openrouter:moonshotai/kimi-k3');
  assert.equal(resolvePersonaBackend('a', { a: 'kimi-k3' }), 'openrouter:moonshotai/kimi-k3');
});

test('resolvePersonaBackend: existing lanes unchanged (claude/codex/opencode/multica/default/unknown)', () => {
  assert.equal(resolvePersonaBackend('a', { a: 'codex' }), 'codex');
  assert.equal(resolvePersonaBackend('a', { a: 'claude' }), 'claude');
  assert.equal(resolvePersonaBackend('a', { a: 'opencode' }), 'multica:opencode');
  assert.equal(resolvePersonaBackend('a', { a: 'multica:gemini' }), 'multica:gemini');
  assert.equal(resolvePersonaBackend('a', {}), 'claude');
  assert.equal(resolvePersonaBackend('a', { a: 'totally-bogus' }), 'claude');
});

// ── 2. parseBackendToken ────────────────────────────────────────────────────────

test('parseBackendToken: bare provider uses its default model', () => {
  assert.deepEqual(parseBackendToken('gemini'), { provider: 'gemini', model: 'gemini-3.1-pro-preview' });
});

test('parseBackendToken: gemini:<model> overrides the default', () => {
  assert.deepEqual(parseBackendToken('gemini:gemini-3.6-flash'), {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
  });
});

test('parseBackendToken: openrouter model slug keeps its slash (only first colon splits)', () => {
  assert.deepEqual(parseBackendToken('openrouter:moonshotai/kimi-k3'), {
    provider: 'openrouter',
    model: 'moonshotai/kimi-k3',
  });
});

test('parseBackendToken: kimi alias resolves to the OpenRouter Kimi K3 slug', () => {
  assert.deepEqual(parseBackendToken('kimi'), { provider: 'openrouter', model: 'moonshotai/kimi-k3' });
});

test('parseBackendToken: unknown provider throws UNKNOWN_PROVIDER', () => {
  assert.throws(() => parseBackendToken('nope:x'), (e) => e.code === 'UNKNOWN_PROVIDER');
});

test('PROVIDERS registry exposes gemini + openrouter with key env candidates', () => {
  assert.ok(PROVIDERS.gemini.keyEnvs.includes('GEMINI_API_KEY'));
  assert.ok(PROVIDERS.openrouter.keyEnvs.includes('OPENROUTER_API_KEY'));
  assert.equal(PROVIDERS.openrouter.defaultModel, 'moonshotai/kimi-k3');
});

// ── 3. extractContent ────────────────────────────────────────────────────────────

test('extractContent: string content', () => {
  assert.equal(extractContent({ choices: [{ message: { content: 'hello' } }] }), 'hello');
});

test('extractContent: array content parts are joined', () => {
  assert.equal(
    extractContent({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }),
    'ab',
  );
});

test('extractContent: empty when no choices', () => {
  assert.equal(extractContent({}), '');
});

// ── 4. runOpenAICompat with mocked fetch (integration contract) ──────────────────

function mockFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, text: async () => JSON.stringify(body) });
}

test('runOpenAICompat: completed terminal carries model + usage + agent_message (OpenRouter/Kimi)', async () => {
  const _fetch = mockFetch({
    id: 'gen-123',
    model: 'moonshotai/kimi-k3',
    choices: [{ message: { content: 'BUG: off-by-one' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
  });
  const saved = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  let term;
  try {
    term = await runOpenAICompat('review this', { backend: 'openrouter:moonshotai/kimi-k3', _fetch });
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
  }
  assert.equal(term.status, 'completed');
  assert.equal(term.model, 'moonshotai/kimi-k3');
  assert.equal(term.backend, 'openrouter:moonshotai/kimi-k3');
  assert.equal(term.usage.total_tokens, 15);
  assert.equal(term.messages[0].type, 'agent_message');
  assert.match(term.messages[0].text, /off-by-one/);
  assert.equal(term.attempts, 1);
  assert.equal(term.task_id, null);
});

test('runOpenAICompat: gemini token resolves default model in terminal', async () => {
  const _fetch = mockFetch({
    id: 'g1',
    model: 'gemini-3.1-pro-preview',
    choices: [{ message: { content: 'CLEAN' } }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  });
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let term;
  try {
    term = await runOpenAICompat('review', { backend: 'gemini', _fetch });
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  }
  assert.equal(term.status, 'completed');
  assert.equal(term.model, 'gemini-3.1-pro-preview');
});

// ── 5. Error / missing-key handling: failed terminal, never throws ───────────────

test('runOpenAICompat: no API key → failed terminal (never throws)', async () => {
  const savedOR = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const term = await runOpenAICompat('x', { backend: 'openrouter:moonshotai/kimi-k3' });
    assert.equal(term.status, 'failed');
    assert.match(term.notes, /no API key/i);
    assert.equal(term.usage, null);
  } finally {
    if (savedOR !== undefined) process.env.OPENROUTER_API_KEY = savedOR;
  }
});

test('runOpenAICompat: HTTP error → failed terminal (never throws)', async () => {
  const savedOR = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  const _fetch = mockFetch({ error: { message: 'rate limited' } }, { ok: false, status: 429 });
  try {
    const term = await runOpenAICompat('x', { backend: 'openrouter:moonshotai/kimi-k3', _fetch });
    assert.equal(term.status, 'failed');
    assert.match(term.notes, /429|rate limited/i);
  } finally {
    if (savedOR === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedOR;
  }
});
