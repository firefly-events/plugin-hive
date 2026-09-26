// hive/lib/process-manifest-loader.mjs
//
// Discover-and-load for Hive process manifests.
//
// Scans hive/manifests/*.process.yaml, validates each against the
// process-manifest schema, and caches a registry keyed by workflow id.
// Follows the sandcastle-provider-loader.mjs discover-and-load precedent:
// lazy init on first call, module-level cache, explicit test seam.
//
// A non-CC executor can call loadManifests() to enumerate every registered
// workflow and inspect its steps, gates, and adapters without any CC-specific
// context — that is the point of this layer.
//
// Test seam:
//   loadManifests({ _manifestsDir })  — override the scan directory
//   loadManifests({ _reset: true })   — clear the module-level cache
//   Both seam keys may be combined.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFESTS_DIR = resolve(__dirname, '..', 'manifests');
const MANIFEST_SUFFIX = '.process.yaml';

let cachedRegistry;

// ---------------------------------------------------------------------------
// Internal structural validator
// ---------------------------------------------------------------------------

function assertString(val, path) {
  if (typeof val !== 'string' || val.trim() === '') {
    throw new Error(`process-manifest: ${path} must be a non-empty string`);
  }
}

function assertKebab(val, path) {
  assertString(val, path);
  if (!/^[a-z][a-z0-9-]*$/.test(val)) {
    throw new Error(`process-manifest: ${path} must be kebab-case (got "${val}")`);
  }
}

function assertSemver(val, path) {
  assertString(val, path);
  if (!/^\d+\.\d+(\.\d+)?$/.test(val)) {
    throw new Error(`process-manifest: ${path} must be semver x.y or x.y.z (got "${val}")`);
  }
}

const VALID_NODE_TYPES = new Set(['agent', 'user_gate', 'gate', 'reconcile']);
const VALID_ADAPTER_TYPES = new Set(['cc-skill', 'dag-workflow', 'inline']);

function validateStep(step, index) {
  const loc = `steps[${index}]`;
  assertKebab(step.id, `${loc}.id`);
  assertString(step.role, `${loc}.role`);

  if (step.node_type !== undefined && !VALID_NODE_TYPES.has(step.node_type)) {
    throw new Error(
      `process-manifest: ${loc}.node_type must be one of ${[...VALID_NODE_TYPES].join('|')} (got "${step.node_type}")`
    );
  }

  if (!Array.isArray(step.depends_on ?? [])) {
    throw new Error(`process-manifest: ${loc}.depends_on must be an array`);
  }

  if (step.node_type === 'gate' && typeof step.gate !== 'string') {
    throw new Error(`process-manifest: ${loc} is a gate node but has no 'gate' assertion string`);
  }

  if (step.retry !== undefined) {
    if (typeof step.retry.max_attempts !== 'number' || step.retry.max_attempts < 1) {
      throw new Error(`process-manifest: ${loc}.retry.max_attempts must be a positive integer`);
    }
  }
}

function validateAdapter(adapter, substrate) {
  const loc = `adapters.${substrate}`;
  if (!VALID_ADAPTER_TYPES.has(adapter.type)) {
    throw new Error(
      `process-manifest: ${loc}.type must be one of ${[...VALID_ADAPTER_TYPES].join('|')} (got "${adapter.type}")`
    );
  }
  if (adapter.type === 'cc-skill') {
    assertString(adapter.skill, `${loc}.skill`);
    if (!adapter.skill.endsWith('.md')) {
      throw new Error(`process-manifest: ${loc}.skill must end with .md (got "${adapter.skill}")`);
    }
  }
  if (adapter.type === 'dag-workflow') {
    assertString(adapter.workflow, `${loc}.workflow`);
    if (!adapter.workflow.endsWith('.yaml')) {
      throw new Error(`process-manifest: ${loc}.workflow must end with .yaml (got "${adapter.workflow}")`);
    }
  }
}

function validateManifest(manifest, source) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`process-manifest: ${source} did not parse to an object`);
  }
  assertKebab(manifest.id, 'id');
  assertString(manifest.name, 'name');
  assertSemver(manifest.version, 'version');

  if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
    throw new Error(`process-manifest: steps must be a non-empty array`);
  }
  manifest.steps.forEach((step, i) => validateStep(step, i));

  if (!manifest.adapters || typeof manifest.adapters !== 'object') {
    throw new Error(`process-manifest: adapters must be an object`);
  }
  if (!('default' in manifest.adapters)) {
    throw new Error(`process-manifest: adapters.default is required`);
  }
  for (const [substrate, adapter] of Object.entries(manifest.adapters)) {
    validateAdapter(adapter, substrate);
  }

  // Step id uniqueness
  const stepIds = manifest.steps.map((s) => s.id);
  const dupes = stepIds.filter((id, i) => stepIds.indexOf(id) !== i);
  if (dupes.length > 0) {
    throw new Error(`process-manifest: duplicate step ids: ${dupes.join(', ')}`);
  }

  // depends_on references must name real step ids
  const stepIdSet = new Set(stepIds);
  for (const step of manifest.steps) {
    for (const dep of step.depends_on ?? []) {
      if (!stepIdSet.has(dep)) {
        throw new Error(
          `process-manifest: step "${step.id}" depends_on unknown step "${dep}"`
        );
      }
    }
  }

  // Filename stem must match manifest id
  const stem = basename(source, MANIFEST_SUFFIX);
  if (stem !== manifest.id) {
    throw new Error(
      `process-manifest: filename stem "${stem}" does not match manifest id "${manifest.id}" in ${source}`
    );
  }
}

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

function buildRegistry(manifestsDir) {
  const registry = new Map();

  if (!existsSync(manifestsDir)) {
    return registry;
  }

  const files = readdirSync(manifestsDir).filter((f) => f.endsWith(MANIFEST_SUFFIX));

  for (const file of files) {
    const filePath = join(manifestsDir, file);
    let manifest;
    try {
      const raw = readFileSync(filePath, 'utf8');
      manifest = parseYaml(raw);
    } catch (err) {
      throw new Error(`process-manifest-loader: failed to parse ${file}: ${err.message}`);
    }
    validateManifest(manifest, file);
    registry.set(manifest.id, { manifest, source: filePath });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the manifest registry (Map<id, {manifest, source}>).
 * Result is cached after the first call.
 *
 * @param {object} [seam]
 * @param {string}  [seam._manifestsDir]  Override the scan directory (tests only).
 * @param {boolean} [seam._reset]         Clear the cache before loading (tests only).
 */
export function loadManifests(seam = {}) {
  if (seam._reset) cachedRegistry = undefined;
  if (cachedRegistry && !seam._manifestsDir) return cachedRegistry;

  const dir = seam._manifestsDir ?? MANIFESTS_DIR;
  const registry = buildRegistry(dir);

  if (!seam._manifestsDir) cachedRegistry = registry;
  return registry;
}

/**
 * Look up a single manifest by workflow id.
 * Throws if not found.
 *
 * @param {string} id       Workflow id (e.g. 'plan').
 * @param {object} [seam]   Same seam keys as loadManifests().
 * @returns {{ manifest: object, source: string }}
 */
export function getManifest(id, seam = {}) {
  const registry = loadManifests(seam);
  const entry = registry.get(id);
  if (!entry) {
    const known = [...registry.keys()].join(', ') || '(none)';
    throw new Error(`process-manifest-loader: no manifest for workflow "${id}". Known: ${known}`);
  }
  return entry;
}

/**
 * List all registered workflows as a plain array.
 * Safe to call with no arguments — uses the cached registry.
 *
 * @param {object} [seam]
 * @returns {Array<{id: string, name: string, description: string, source: string}>}
 */
export function listWorkflows(seam = {}) {
  const registry = loadManifests(seam);
  return [...registry.values()].map(({ manifest, source }) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? '',
    source,
  }));
}
