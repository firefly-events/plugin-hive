/**
 * openai-compat-backend.mjs — headless OpenAI-compatible chat-completions dispatcher
 *
 * The runner-agnostic sibling of codex-backend.mjs. Where codex-backend spawns the
 * local `codex exec` CLI, this backend talks HTTP to any OpenAI-compatible
 * /chat/completions endpoint. ONE adapter covers many providers/models:
 *
 *   - OpenRouter  → https://openrouter.ai/api/v1            (Kimi K3, and 300+ models)
 *   - Gemini      → https://generativelanguage.googleapis.com/v1beta/openai
 *                   (Google's OpenAI-compat surface; our paid GEMINI_API_KEY)
 *
 * It returns the SAME terminal-shaped object as runCodexExec so it drops straight
 * into writeMulticaRunEpisode (episode-sync.mjs) — status/notes/messages/usage/etc.
 *
 * Backend-token grammar (resolved in multica-story-dispatch/index.mjs resolveBackend):
 *   gemini                       → provider=gemini,     model=gemini-3.1-pro-preview
 *   gemini:<model>               → provider=gemini,     model=<model>
 *   openrouter:<model>           → provider=openrouter, model=<model>
 *   kimi (alias)                 → openrouter:moonshotai/kimi-k3
 *
 * Keys are read from the environment ONLY (never hard-coded):
 *   OPENROUTER_API_KEY   (OpenRouter lane)
 *   GEMINI_API_KEY       (Gemini lane; GOOGLE_GENERATIVE_AI_API_KEY accepted as fallback)
 *
 * Invocation contract:
 *   runOpenAICompat(prompt, opts?) → Promise<Terminal>
 */

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes, matches codex-backend

/**
 * Provider registry. Each entry knows its base URL and which env var holds the key.
 * `defaultModel` is used when the backend token names the provider but not a model.
 */
export const PROVIDERS = {
  openrouter: {
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    keyEnvs: ['OPENROUTER_API_KEY'],
    defaultModel: 'moonshotai/kimi-k3',
    // OpenRouter asks for these attribution headers (optional but polite).
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/mdostal/plugin-hive-fork',
      'X-Title': 'plugin-hive runner-agnostic backend',
    },
  },
  gemini: {
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnvs: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    defaultModel: 'gemini-3.1-pro-preview',
    extraHeaders: {},
  },
};

/**
 * Convenience aliases resolved BEFORE the provider:model split.
 * Keeps hive.config.yaml terse ("kimi" instead of the full slug).
 */
const ALIASES = {
  kimi: 'openrouter:moonshotai/kimi-k3',
  'kimi-k3': 'openrouter:moonshotai/kimi-k3',
};

/**
 * Parse a backend token into { provider, model }.
 * Accepts: 'gemini' | 'gemini:<model>' | 'openrouter:<model>' | alias.
 * `openrouter:` models legitimately contain a '/', so only the FIRST ':' splits.
 *
 * @param {string} backendToken
 * @returns {{ provider: string, model: string }}
 */
export function parseBackendToken(backendToken) {
  const raw = ALIASES[backendToken] ?? String(backendToken).trim();
  const idx = raw.indexOf(':');
  const provider = idx === -1 ? raw : raw.slice(0, idx);
  const modelPart = idx === -1 ? '' : raw.slice(idx + 1);
  const preset = PROVIDERS[provider];
  if (!preset) {
    throw Object.assign(new Error(`unknown OpenAI-compat provider '${provider}' (token='${backendToken}')`), {
      code: 'UNKNOWN_PROVIDER',
    });
  }
  return { provider, model: modelPart || preset.defaultModel };
}

/**
 * Resolve the API key for a provider from its candidate env vars.
 * Returns null when no key is set (caller surfaces a clean failed-terminal).
 */
function resolveKey(preset) {
  for (const name of preset.keyEnvs) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Low-level call: POST /chat/completions, return the parsed JSON body.
 * Injectable `_fetch` for tests.
 *
 * @param {{ provider: string, model: string, prompt: string, timeoutMs?: number,
 *          maxTokens?: number, system?: string, _fetch?: typeof fetch }} args
 * @returns {Promise<object>} raw OpenAI-compatible response body
 */
export async function callChatCompletions({
  provider,
  model,
  prompt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens = 8192,
  system = null,
  _fetch = fetch,
}) {
  const preset = PROVIDERS[provider];
  if (!preset) throw Object.assign(new Error(`unknown provider '${provider}'`), { code: 'UNKNOWN_PROVIDER' });
  const key = resolveKey(preset);
  if (!key) {
    throw Object.assign(
      new Error(`no API key for provider '${provider}' (checked: ${preset.keyEnvs.join(', ')})`),
      { code: 'NO_API_KEY' },
    );
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await _fetch(`${preset.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...preset.extraHeaders,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    if (!res.ok) {
      const msg = body?.error?.message || body?._raw || `HTTP ${res.status}`;
      throw Object.assign(new Error(`${provider} HTTP ${res.status}: ${msg}`), { code: `HTTP_${res.status}` });
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the assistant text from an OpenAI-compatible response.
 * @param {object} body
 * @returns {string}
 */
export function extractContent(body) {
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  // Some providers return an array of content parts.
  if (Array.isArray(content)) return content.map((p) => p?.text ?? '').join('');
  return '';
}

/**
 * Run an OpenAI-compatible chat completion headlessly and return a terminal object
 * in the episode-record shape (identical contract to runCodexExec).
 *
 * @param {string} prompt — the full story brief / review prompt
 * @param {{
 *   backend?: string,      // backend token, e.g. 'openrouter:moonshotai/kimi-k3' | 'gemini'
 *   provider?: string,     // OR pass provider+model explicitly (skips token parse)
 *   model?: string,
 *   agentName?: string,
 *   system?: string,
 *   maxTokens?: number,
 *   timeoutMs?: number,
 *   workDir?: string,
 *   _fetch?: typeof fetch,
 * }} opts
 * @returns {Promise<object>} terminal
 */
export async function runOpenAICompat(prompt, opts = {}) {
  const startedAt = new Date().toISOString();
  let provider = opts.provider;
  let model = opts.model;
  if (!provider) {
    ({ provider, model } = parseBackendToken(opts.backend ?? 'gemini'));
  }
  const agentName = opts.agentName || `${provider}:${model}`;

  let body;
  try {
    body = await callChatCompletions({
      provider,
      model,
      prompt,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxTokens: opts.maxTokens ?? 8192,
      system: opts.system ?? null,
      _fetch: opts._fetch ?? fetch,
    });
  } catch (err) {
    return {
      status: 'failed',
      notes: err?.message ?? String(err),
      messages: [],
      task_id: null,
      agent_id: null,
      agent_name: agentName,
      work_dir: opts.workDir ?? null,
      attempts: 1,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      thread_id: null,
      usage: null,
      backend: opts.backend ?? `${provider}:${model}`,
      model,
    };
  }

  const completedAt = new Date().toISOString();
  const content = extractContent(body);
  const usage = body?.usage ?? null;
  const returnedModel = body?.model ?? model;
  const failed = !content;

  return {
    status: failed ? 'failed' : 'completed',
    notes: failed ? `${provider} returned empty content` : content.slice(0, 200),
    messages: content ? [{ type: 'agent_message', text: content }] : [],
    task_id: null,
    agent_id: null,
    agent_name: agentName,
    work_dir: opts.workDir ?? null,
    attempts: 1,
    started_at: startedAt,
    completed_at: completedAt,
    thread_id: body?.id ?? null,
    usage,
    backend: opts.backend ?? `${provider}:${model}`,
    model: returnedModel,
  };
}

export default runOpenAICompat;
