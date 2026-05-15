// hive/lib/sandcastle-provider-loader.mjs
//
// ESM sibling of hive/lib/sandcastle-provider.js.
//
// @ai-hero/sandcastle ships ESM-only: its package.json `exports` field has no
// `require` keys, so the CJS factory's default loaders
// (`require('@ai-hero/sandcastle/sandboxes/podman')` etc.) throw
// ERR_PACKAGE_PATH_NOT_EXPORTED on every modern Node version. This loader
// resolves the deps once via ESM dynamic import and threads them into the
// CJS factory through its `_deps` test seam.
//
// Consumers that live in ESM land (most /execute paths under Sandcastle mode)
// should `import { createSandcastleProvider }` from THIS file. Consumers that
// live in CJS and provide their own dep loaders may still call the underlying
// CJS factory directly — but the validation in story s4-merge-validation
// confirmed the no-`_deps` happy path is unreachable.
//
// Behaviour:
//   - First call awaits three dynamic ESM imports and caches them
//   - Subsequent calls reuse the cached deps; each call still constructs a
//     fresh provider via the CJS factory (no provider caching)
//   - The factory is otherwise unchanged: preflight runs first, then logger
//     wrapping, then sandbox provider construction
//
// Test seam:
//   `createSandcastleProvider(options, { _depsOverride })` — pass a
//   pre-built deps object to skip the dynamic ESM import entirely. Used by
//   unit tests that mock the sandcastle surface.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjsFactory = require("./sandcastle-provider.js");

let cachedDeps;

async function loadDeps() {
  if (cachedDeps) return cachedDeps;

  const [pkg, podmanMod, dockerMod] = await Promise.all([
    import("@ai-hero/sandcastle"),
    import("@ai-hero/sandcastle/sandboxes/podman"),
    import("@ai-hero/sandcastle/sandboxes/docker"),
  ]);

  cachedDeps = {
    podmanFactory: podmanMod.podman,
    dockerFactory: dockerMod.docker,
    createWorktreeFn: pkg.createWorktree,
  };
  return cachedDeps;
}

/**
 * ESM-aware Sandcastle provider factory.
 *
 * @param {object} options — same shape as the CJS factory's first arg.
 * @param {object} [seam]  — test-only. `seam._depsOverride` bypasses the
 *                           dynamic ESM import; `seam._reset` clears cache.
 * @returns {Promise<{ sandboxProvider: object, createWorktree: Function }>}
 */
export async function createSandcastleProvider(options, seam) {
  if (seam && seam._reset) cachedDeps = undefined;
  const deps = (seam && seam._depsOverride) || (await loadDeps());
  return cjsFactory.createSandcastleProvider(options, deps);
}

export const SANDCASTLE_RANGE = cjsFactory.SANDCASTLE_RANGE;
