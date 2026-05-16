'use strict';

/**
 * hive/lib/sandcastle-worker-schema.js
 *
 * Zod schema for the sandcastle worker's Output.object() structured result.
 *
 * Story: s2-sandcastle-worker-prompt (sandcastle-ops-layer)
 *
 * Contract: the prompt at .sandcastle/prompts/worker-issue-pickup.md emits a
 * JSON object inside its completion signal. Sandcastle's Output.object()
 * runs this schema's `parse()` to produce a typed RunResult.output.
 *
 * Shape (locked in story YAML AC):
 *   issue_number      number|null  — the issue worked (null when idle)
 *   pr_number         number|null  — the PR opened (null when failed/idle)
 *   status            "shipped" | "failed" | "idle"
 *   reason            string?       — populated on failed/idle
 *   branch            string?       — populated on shipped (agent/issue-<n>)
 *   duration_seconds  number?       — optional metric
 *
 * BYO zod: zod is a sandcastle peer dependency. When sandcastle is installed,
 * zod resolves; when it isn't, this module throws a clear error pointing at
 * the install command. Mirrors the BYO pattern in
 * hive/lib/external/github-issues-adapter.js (js-yaml).
 */

let z = null;
try {
  z = require('zod').z;
} catch {
  z = null;
}

function getZod() {
  if (!z) {
    throw new Error(
      '[sandcastle-worker-schema] zod not available — install @ai-hero/sandcastle ' +
      '(which depends on zod) or run: npm install --no-save zod'
    );
  }
  return z;
}

function buildSchema(zodLib) {
  const Z = zodLib || getZod();
  return Z.object({
    issue_number: Z.number().int().positive().nullable(),
    pr_number: Z.number().int().positive().nullable(),
    status: Z.enum(['shipped', 'failed', 'idle']),
    reason: Z.string().optional(),
    branch: Z.string().optional(),
    duration_seconds: Z.number().optional(),
  });
}

// Lazy export: ResultSchema is built on first access so tests can inject
// their own zod instance via buildSchema(testZod) without paying the import
// cost at require() time when zod is missing.
let cached = null;
function getResultSchema() {
  if (!cached) {
    cached = buildSchema();
  }
  return cached;
}

module.exports = {
  buildSchema,
  get ResultSchema() {
    return getResultSchema();
  },
};
