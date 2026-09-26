// hive/lib/cc-manifest-adapter.mjs
//
// Reference CC adapter for Hive process manifests.
//
// Reads a manifest's adapters section and resolves the CC skill path for the
// running substrate. This is how the CC plugin materialises today's skill-file
// dispatch path from a runtime-neutral manifest without changing any current
// behaviour: the existing skills/plan/SKILL.md (and its multica/cc-workflows
// siblings) continue to run exactly as before; this module just makes the
// routing decision discoverable and testable.
//
// Usage:
//   const { manifest } = await getManifest('plan');
//   const skillPath = resolveCCSkill(manifest, 'multica');
//   // → 'skills/hive/skills/plan-mode-multica/SKILL.md'
//
// Non-CC executors do NOT call this module; they inspect manifest.adapters
// directly and pick the adapter type they understand (e.g. dag-workflow).

/**
 * Resolve the CC skill path for the given substrate.
 *
 * @param {object} manifest   A validated process manifest object.
 * @param {string} substrate  Substrate key: 'default' | 'multica' | 'cc-workflows' | …
 * @returns {string}  Repo-relative path to the SKILL.md file.
 * @throws  If no cc-skill adapter is found for the substrate or its fallback.
 */
export function resolveCCSkill(manifest, substrate = 'default') {
  const adapters = manifest.adapters ?? {};
  const adapter = adapters[substrate] ?? adapters['default'];

  if (!adapter) {
    throw new Error(
      `cc-manifest-adapter: no adapter found for substrate "${substrate}" in manifest "${manifest.id}"`
    );
  }
  if (adapter.type !== 'cc-skill') {
    throw new Error(
      `cc-manifest-adapter: adapter "${substrate}" in manifest "${manifest.id}" has type "${adapter.type}", not "cc-skill"`
    );
  }
  return adapter.skill;
}

/**
 * List every substrate that has a cc-skill adapter in the manifest.
 *
 * @param {object} manifest
 * @returns {Array<{substrate: string, skill: string}>}
 */
export function listCCSkillAdapters(manifest) {
  return Object.entries(manifest.adapters ?? {})
    .filter(([, a]) => a.type === 'cc-skill')
    .map(([substrate, a]) => ({ substrate, skill: a.skill }));
}
