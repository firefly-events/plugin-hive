// tests/hive-lib/sandcastle-provider-loader.test.mjs
//
// Unit tests for hive/lib/sandcastle-provider-loader.mjs.
//
// Scope: the loader's responsibility is to surface an async, ESM-friendly
// createSandcastleProvider() that threads deps into the CJS factory. The CJS
// factory itself has 60 of its own unit tests; here we cover only the
// loader's contract:
//   1. Export shape (async function + SANDCASTLE_RANGE constant)
//   2. Deps override seam works (returns the CJS factory's provider object)
//   3. Caching: deps loader only invoked once across multiple calls
//   4. Reset seam clears the cache
//   5. Real-import path resolves the actual sandcastle module surface

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSandcastleProvider,
  SANDCASTLE_RANGE,
} from "../../hive/lib/sandcastle-provider-loader.mjs";

const stubSandboxProvider = { kind: "stub" };
const stubWorktreeFn = () => ({ kind: "wt-stub" });

function makeStubDeps() {
  return {
    podmanFactory: () => stubSandboxProvider,
    dockerFactory: () => stubSandboxProvider,
    createWorktreeFn: stubWorktreeFn,
  };
}

test("loader exports SANDCASTLE_RANGE string", () => {
  assert.equal(typeof SANDCASTLE_RANGE, "string");
  assert.match(SANDCASTLE_RANGE, /^>=0\.5\.\d+ <0\.6\.0$/);
});

test("loader exports createSandcastleProvider as async function", () => {
  assert.equal(typeof createSandcastleProvider, "function");
  // Async functions have an AsyncFunction constructor
  assert.equal(
    createSandcastleProvider.constructor.name,
    "AsyncFunction",
  );
});

test("deps override seam returns { sandboxProvider, createWorktree }", async () => {
  const provider = await createSandcastleProvider(
    {
      imageName: "test:img",
      // Inject a stub versionResolver so preflight passes without
      // touching a real sandcastle install. The CJS factory accepts
      // versionResolver via _deps in its second arg.
    },
    {
      _depsOverride: {
        ...makeStubDeps(),
        versionResolver: () => "0.5.10",
      },
      _reset: true, // start from clean cache
    },
  );
  assert.equal(provider.sandboxProvider, stubSandboxProvider);
  assert.equal(typeof provider.createWorktree, "function");
});

test("deps override path does not require real sandcastle install", async () => {
  // If the loader were ignoring _depsOverride and falling through to the
  // dynamic import, this would either throw (missing sandcastle) or
  // succeed only by accident on a host that happens to have sandcastle
  // installed. We assert the stub path is honored.
  let podmanFactoryCallCount = 0;
  const deps = {
    podmanFactory: () => {
      podmanFactoryCallCount++;
      return stubSandboxProvider;
    },
    dockerFactory: () => stubSandboxProvider,
    createWorktreeFn: stubWorktreeFn,
    versionResolver: () => "0.5.10",
  };

  await createSandcastleProvider(
    { imageName: "test:a" },
    { _depsOverride: deps, _reset: true },
  );
  assert.equal(podmanFactoryCallCount, 1);

  await createSandcastleProvider(
    { imageName: "test:b" },
    { _depsOverride: deps },
  );
  assert.equal(
    podmanFactoryCallCount,
    2,
    "factory called per provider construction, not cached",
  );
});

test("docker opt-in path uses injected dockerFactory", async () => {
  const dockerStub = { kind: "docker-stub" };
  const deps = {
    podmanFactory: () => stubSandboxProvider,
    dockerFactory: () => dockerStub,
    createWorktreeFn: stubWorktreeFn,
    versionResolver: () => "0.5.10",
  };

  const provider = await createSandcastleProvider(
    { useDocker: true, imageName: "test:img" },
    { _depsOverride: deps, _reset: true },
  );

  assert.equal(provider.sandboxProvider, dockerStub);
});

test("createWorktree threads through to injected createWorktreeFn", async () => {
  let capturedStoryId;
  const deps = {
    podmanFactory: () => stubSandboxProvider,
    dockerFactory: () => stubSandboxProvider,
    createWorktreeFn: async ({ branchStrategy }) => {
      capturedStoryId = branchStrategy.branch;
      return { kind: "wt", branch: branchStrategy.branch };
    },
    versionResolver: () => "0.5.10",
  };

  const provider = await createSandcastleProvider(
    { imageName: "test:img" },
    { _depsOverride: deps, _reset: true },
  );

  const wt = await provider.createWorktree("story-x");
  assert.equal(capturedStoryId, "story-x");
  assert.equal(wt.branch, "story-x");
});

test("real-import path: resolves @ai-hero/sandcastle when installed", async (t) => {
  // Skip if sandcastle is not resolvable from this checkout; CI may not
  // install it. The validation we care about (the workaround for D2) is
  // exercised by the production code path under Class-A.
  try {
    await import("@ai-hero/sandcastle/package.json", { with: { type: "json" } });
  } catch {
    // package.json subpath is intentionally not exported — that's the
    // whole reason this loader exists. We fall through to the real test.
  }

  let provider;
  try {
    provider = await createSandcastleProvider(
      { imageName: "test:no-build-needed" },
      { _reset: true },
    );
  } catch (e) {
    if (e && /Cannot find package '@ai-hero\/sandcastle'/.test(String(e))) {
      t.skip("sandcastle not installed in this environment");
      return;
    }
    throw e;
  }
  assert.equal(typeof provider.sandboxProvider, "object");
  assert.equal(typeof provider.createWorktree, "function");
});
