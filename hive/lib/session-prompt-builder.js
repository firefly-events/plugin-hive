/**
 * Session Prompt Builder
 *
 * Two exports:
 *
 *   buildPrompt({ story_context, epic_id, matched_specialists })
 *     Legacy: assembles the FIRST USER MESSAGE content string (per spec §4).
 *     Caller: hive/scripts/session-invoke.mjs.
 *
 *   buildSystemPrompt({ story_id, agent_role, kg, memories, persona, ... })
 *     New (s6/A3): assembles the SYSTEM SLOT string per spec §2 template,
 *     including prior_knowledge_block (§3) + kg_decision_context_block (§6).
 *     Returns { system: string } — runtime-agnostic, consumed by both the
 *     Messages-API loop and the Sessions-API cloud adapter.
 */

import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const MAX_CHARS = 4000;
const KG_SQLITE_PATH = path.join(os.homedir(), '.claude', 'hive', 'kg.sqlite');
const ENTITY_ALLOWLIST = /^[a-zA-Z0-9\-_]+$/;
const SYSTEM_PROMPT_BUDGET_DEFAULT = 4000; // matches tokens.system_prompt_budget per spec §3 (chars proxy for now)
const REFERENCE_TRUNCATE_CHARS = 200;

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

/**
 * Validate an entity string against the allowlist used for KG queries.
 * AC7: SQL-meta and shell-meta payloads must be rejected before reaching
 * the SQL builder. Returns true iff value contains only [a-zA-Z0-9\-_].
 * @param {string} value
 * @returns {boolean}
 */
function isAllowlistedEntity(value) {
  return typeof value === 'string' && ENTITY_ALLOWLIST.test(value);
}

/**
 * Apply §3 truncation rules to a memory list, returning rendered entries
 * plus a truncation count.
 *
 * Rules (in order):
 *   1. override + pitfall: always retained in full
 *   2. reference + codebase: truncated to first 200 chars
 *   3. drop oldest by last_verified first if still over budget
 *
 * @param {Array} memories
 * @param {number} budgetChars  budget for the assembled system: string
 * @param {number} reservedChars  chars already consumed (persona, KG block, domain note)
 * @returns {{ rendered: string[], truncated: number }}
 */
function applyMemoryTruncation(memories, budgetChars, reservedChars) {
  const ALWAYS_FULL = new Set(['override', 'pitfall']);
  const TRUNCATABLE = new Set(['reference', 'codebase']);

  const renderEntry = (m, body) =>
    `**[${m.name}]** (type: ${m.type}, last verified: ${m.last_verified || 'unknown'})\n${body}`;

  let truncatedCount = 0;
  const prepared = memories.map((m) => {
    if (TRUNCATABLE.has(m.type) && (m.content || '').length > REFERENCE_TRUNCATE_CHARS) {
      truncatedCount++;
      return {
        mem: m,
        rendered: renderEntry(m, (m.content || '').slice(0, REFERENCE_TRUNCATE_CHARS)),
        droppable: true,
        truncatedAtRender: true,
      };
    }
    return { mem: m, rendered: renderEntry(m, m.content || ''), droppable: !ALWAYS_FULL.has(m.type) };
  });

  // Drop-order: ascending last_verified (oldest first); missing timestamp = oldest.
  const sortKey = (m) => m.last_verified || '';
  const droppableSorted = prepared
    .filter((p) => p.droppable)
    .sort((a, b) => sortKey(a.mem).localeCompare(sortKey(b.mem)));

  const totalChars = () => {
    const kept = prepared.filter((p) => !p.dropped);
    if (kept.length === 0) return 0;
    return kept.reduce((acc, p) => acc + p.rendered.length, 0)
      + ((kept.length - 1) * '\n\n---\n\n'.length);
  };

  let dropIdx = 0;
  while (reservedChars + totalChars() > budgetChars && dropIdx < droppableSorted.length) {
    const victim = droppableSorted[dropIdx++];
    if (!victim.dropped) {
      victim.dropped = true;
      if (!victim.truncatedAtRender) truncatedCount++;
    }
  }

  const rendered = prepared.filter((p) => !p.dropped).map((p) => p.rendered);
  return { rendered, truncated: truncatedCount };
}

/**
 * Run the §6 two-call merge: query_decisions for story_id and agent_role,
 * dedupe by (subject, predicate, object, valid_from), order story-scoped
 * before role-scoped, sort each group by valid_from descending.
 *
 * @param {Object} kg                 KG handle exposing query_decisions(filter)
 * @param {string|null} story_id      sanitized story id (allowlist-passed)
 * @param {string|null} agent_role    sanitized agent role (allowlist-passed)
 * @returns {Array} merged ordered triples
 */
function mergeDecisionTriples(kg, story_id, agent_role) {
  if (!kg || typeof kg.query_decisions !== 'function') return [];

  const safeQuery = (entity) => {
    if (!entity) return [];
    try {
      const out = kg.query_decisions({ entity });
      return Array.isArray(out) ? out : [];
    } catch {
      return [];
    }
  };

  const storyTriples = safeQuery(story_id);
  const roleTriples = safeQuery(agent_role);

  const tripleKey = (t) => `${t.subject}|${t.predicate}|${t.object}|${t.valid_from}`;
  const seen = new Set();

  const sortByValidFromDesc = (a, b) =>
    (b.valid_from || '').localeCompare(a.valid_from || '');

  const dedupedStory = [];
  for (const t of [...storyTriples].sort(sortByValidFromDesc)) {
    const k = tripleKey(t);
    if (!seen.has(k)) {
      seen.add(k);
      dedupedStory.push(t);
    }
  }

  const dedupedRole = [];
  for (const t of [...roleTriples].sort(sortByValidFromDesc)) {
    const k = tripleKey(t);
    if (!seen.has(k)) {
      seen.add(k);
      dedupedRole.push(t);
    }
  }

  return [...dedupedStory, ...dedupedRole];
}

function renderDecisionTriples(triples) {
  if (!triples.length) return '';
  const lines = triples.map((t) => {
    const since = t.valid_from ? ` (since ${t.valid_from}` : '';
    const via = t.source_epic ? `, via ${t.source_epic})` : (since ? ')' : '');
    return `- ${t.subject} ${t.predicate} ${t.object}${since}${via}`;
  });
  return `\n\n### Decision Context (from knowledge graph)\n\n${lines.join('\n')}`;
}

/**
 * Build the SYSTEM-SLOT string for a session per spec §2 template.
 *
 * Composes: persona + prior_knowledge_block (§3) + kg_decision_context (§6)
 *           + domain-access note. Output is runtime-agnostic — same {system}
 *           is consumed by the Messages-API loop and the Sessions-API
 *           cloud adapter.
 *
 * AC7 (security): story_id and agent_role are validated against
 *   /^[a-zA-Z0-9\-_]+$/ BEFORE either reaches kg.query_decisions().
 *   Values that fail validation are coerced to null and skip the
 *   corresponding query (returns empty rows rather than executing).
 *
 * @param {Object}   params
 * @param {string}   params.story_id
 * @param {string}   params.agent_role
 * @param {Object}   params.kg                 KG handle with query_decisions()
 * @param {Array}    [params.memories=[]]      memory entries from MemoryStore.read()
 * @param {string}   [params.persona='']       persona text (verbatim)
 * @param {string[]} [params.domain_patterns=[]] write-allowed domain globs
 * @param {number}   [params.budget_chars]     system: budget (default 4000)
 * @returns {{ system: string }} runtime-agnostic composed system slot
 */
function buildSystemPrompt({
  story_id,
  agent_role,
  kg,
  memories = [],
  persona = '',
  domain_patterns = [],
  budget_chars = SYSTEM_PROMPT_BUDGET_DEFAULT,
}) {
  // AC7 — sanitize entity inputs before any KG call.
  const safeStoryId = isAllowlistedEntity(story_id) ? story_id : null;
  const safeAgentRole = isAllowlistedEntity(agent_role) ? agent_role : null;

  const triples = mergeDecisionTriples(kg, safeStoryId, safeAgentRole);
  const decisionBlock = renderDecisionTriples(triples);

  const domainLine = domain_patterns.length
    ? domain_patterns.join(', ')
    : '(none — read-only)';
  const domainNote = `\n\n## Domain Access\n\nYou may modify files matching: ${domainLine}\n\nAll other paths are read-only. Do not modify files outside your domain without explicit instruction.`;

  // Reserved budget = persona + KG decision block + domain note + section
  // headers ("## Prior Knowledge\n\nN memories loaded for {role}:\n\n" + delimiters).
  const headerStub = `\n\n---\n\n## Prior Knowledge\n\n0 memories loaded for ${agent_role || 'unknown'}:\n\n`;
  const reservedChars = persona.length + headerStub.length + decisionBlock.length + domainNote.length + 32;

  const { rendered, truncated } = applyMemoryTruncation(memories, budget_chars, reservedChars);

  let priorBlock;
  if (rendered.length === 0 && !decisionBlock) {
    priorBlock = '';
  } else if (rendered.length === 0) {
    priorBlock = decisionBlock;
  } else {
    const memHeader = `\n\n---\n\n## Prior Knowledge\n\n${rendered.length} memories loaded for ${agent_role || 'unknown'}:\n\n`;
    const memBody = rendered.length ? rendered.join('\n\n---\n\n') : '';
    const truncationSignal = truncated > 0
      ? `\n\n[${truncated} memories truncated for length]`
      : '';
    priorBlock = memHeader + memBody + truncationSignal + decisionBlock;
  }

  const system = persona + priorBlock + domainNote;
  return { system };
}

// ─── Mnemosyne memory injection (PAN-7194) ──────────────────────────────────
// Claude runners receive prior memory via the merged mnemosyne pre-recall HOOK
// (settings.hooks.json). NON-Claude runners (codex/kimi/gemini) do NOT fire
// Claude Code hooks — they assemble their first-message prompt HERE. To give
// every runner runner-agnostic parity, buildPromptWithMemory() appends a small,
// size-capped, DISCRETE "## Recalled Memory" block to the end of the standard
// buildPrompt() output. It is:
//   - cache-safe: appended as its own trailing block; story_context and the
//     KG block are never reordered.
//   - size-capped: MEMORY_BUNDLE_MAX_CHARS (small delta, not whole files).
//   - fail-open: a recall miss OR a down/unreachable service is NOT a failure —
//     the block is silently skipped and the plain buildPrompt() output returns.
//
// Transport mirrors mnemosyne/hooks/lib/mnemo-client.mjs recall() HTTP path:
// POST {MNEMOSYNE_URL}/recall with { query, scope, hits }. Inlined here (rather
// than importing the cross-repo ESM .mjs) so this CommonJS module stays
// self-contained and dependency-free.

const MNEMOSYNE_URL = process.env.MNEMOSYNE_URL || 'http://127.0.0.1:8477';
const MEMORY_BUNDLE_MAX_CHARS = Number(process.env.HIVE_MEMORY_BUNDLE_MAX_CHARS || 1500);
const MEMORY_HTTP_TIMEOUT_MS = Number(process.env.MNEMOSYNE_HTTP_TIMEOUT_MS || 8000);
const MEMORY_EXCERPT_CHARS = 200;
const MEMORY_DEFAULT_HITS = 5;

/**
 * Reach the Mnemosyne service over HTTP and return its native recall shape
 * ({ total_hits, scopes: [{ scope, hits: [...] }] }). NEVER throws — any error
 * (service down, timeout, non-2xx, bad JSON) resolves to an empty result so the
 * caller falls open. Mirrors mnemo-client.mjs recall() service path.
 *
 * @param {string} query
 * @param {string} [scope]
 * @param {Object} [opts]
 * @param {number} [opts.hits]
 * @param {boolean} [opts.escalate]
 * @returns {Promise<{total_hits:number, scopes:Array}>}
 */
async function recallMemory(query, scope, opts = {}) {
  if (!query || typeof fetch !== 'function') return { total_hits: 0, scopes: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MEMORY_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(MNEMOSYNE_URL + '/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: String(query),
        scope: scope || undefined,
        hits: opts.hits || MEMORY_DEFAULT_HITS,
        escalate: !!opts.escalate,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { total_hits: 0, scopes: [] };
    const json = await res.json();
    return json && Array.isArray(json.scopes) ? json : { total_hits: 0, scopes: [] };
  } catch {
    return { total_hits: 0, scopes: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive a compact recall query from the story spec: the first non-empty line
 * (markdown heading markers stripped), else the leading slice. Capped so we
 * send a topic, not the whole spec.
 * @param {string} storyContext
 * @returns {string}
 */
function deriveMemoryQuery(storyContext) {
  const text = String(storyContext || '').trim();
  if (!text) return '';
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const base = firstLine.replace(/^#+\s*/, '').trim() || text;
  return base.slice(0, REFERENCE_TRUNCATE_CHARS);
}

/**
 * Render a recall result into a small pointer bundle (NOT whole files): one
 * line per hit with layer, confidence, source, optional line-range and a short
 * excerpt. Deduped, score-ordered, and hard-capped at maxChars. Returns '' on
 * a miss so the caller can skip the section entirely.
 * @param {{scopes:Array}} recallResult
 * @param {number} [maxChars]
 * @returns {string}
 */
function formatMemoryBundle(recallResult, maxChars = MEMORY_BUNDLE_MAX_CHARS) {
  if (!recallResult || !Array.isArray(recallResult.scopes)) return '';
  const hits = [];
  const seen = new Set();
  for (const s of recallResult.scopes) {
    for (const h of (s.hits || [])) {
      const key = `${h.full_path || h.source || h.location || ''}#${h.chunk_index ?? (Array.isArray(h.chunk_span) ? h.chunk_span.join('-') : '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ ...h, layer: s.scope || h.collection || '?' });
    }
  }
  if (!hits.length) return '';
  hits.sort((a, b) => {
    const ak = a.match_type === 'keyword' ? 1 : 0;
    const bk = b.match_type === 'keyword' ? 1 : 0;
    if (ak !== bk) return bk - ak; // keyword-exact first
    return (b.score || 0) - (a.score || 0);
  });

  const lines = [];
  for (const h of hits) {
    const src = h.source || h.full_path || h.location || '(unknown)';
    const span = Array.isArray(h.chunk_span) && h.chunk_span.length === 2
      ? ` lines ${h.chunk_span[0]}-${h.chunk_span[1]}` : '';
    const conf = h.match_type === 'keyword'
      ? 'keyword-exact'
      : (h.score != null ? `score ${Number(h.score).toFixed(2)}` : 'score ?');
    let entry = `- [${h.layer} · ${conf}] ${src}${span}`;
    const ex = String(h.text || '').replace(/\s+/g, ' ').trim();
    if (ex) entry += `\n  > ${ex.slice(0, MEMORY_EXCERPT_CHARS)}`;
    const candidate = lines.length ? lines.join('\n') + '\n' + entry : entry;
    if (candidate.length > maxChars) break; // hard size cap
    lines.push(entry);
  }
  return lines.join('\n');
}

/**
 * Runner-agnostic prompt builder: the standard buildPrompt() output PLUS a
 * trailing, size-capped "## Recalled Memory" block sourced from Mnemosyne.
 * This is what NON-Claude runners use so they reach parity with Claude's
 * hook-injected memory.
 *
 * story_context validation still throws (via buildPrompt) so callers keep their
 * existing required-field behavior. The memory fetch itself NEVER throws: a miss
 * or an error falls open to the plain buildPrompt() string.
 *
 * @param {Object} params  same shape as buildPrompt(): { story_context, epic_id, matched_specialists }
 * @param {Object} [opts]
 * @param {string} [opts.scope]   mnemosyne scope (else MNEMOSYNE_SCOPE / service default)
 * @param {number} [opts.hits]
 * @param {number} [opts.maxChars]
 * @param {Function} [opts.recall]  injectable recaller (for tests); defaults to recallMemory
 * @returns {Promise<string>}
 */
async function buildPromptWithMemory(params, opts = {}) {
  const base = buildPrompt(params); // sync, unchanged; validates story_context (may throw)
  const recall = opts.recall || recallMemory;
  try {
    const query = deriveMemoryQuery(params && params.story_context);
    if (!query) return base;
    const scope = opts.scope || (params && params.scope) || process.env.MNEMOSYNE_SCOPE || undefined;
    const result = await recall(query, scope, { hits: opts.hits || MEMORY_DEFAULT_HITS });
    const bundle = formatMemoryBundle(result, opts.maxChars || MEMORY_BUNDLE_MAX_CHARS);
    if (!bundle) return base; // a memory miss is NOT a failure
    return `${base}\n\n## Recalled Memory\n${bundle}`;
  } catch {
    return base; // never let memory recall break prompt assembly
  }
}


// exposed for unit-level reuse + future spec-test additions (isAllowlistedEntity)
export {
  buildPrompt,
  buildPromptWithMemory,
  recallMemory,
  queryDecisions,
  buildSystemPrompt,
  isAllowlistedEntity,
};
