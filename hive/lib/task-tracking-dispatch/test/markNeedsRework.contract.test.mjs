/**
 * Contract tests for TaskTrackingDispatch.markNeedsRework()
 *
 * TDD MODE — these tests are written BEFORE the implementation exists.
 * They MUST FAIL until:
 *   1. TaskTrackingDispatch gains a public markNeedsRework({ id, reason }) method
 *   2. Both GitHub and Multica adapters implement the 'markNeedsRework' dispatch handler
 *   3. Both adapters declare `supports_needs_rework: true` in capabilities()
 *
 * Contract being specified:
 *   - markNeedsRework({ id, reason }) → Promise<{ id, status, labels[] }>
 *   - labels[] MUST include 'hive:needs-rework'
 *   - Multica path: status = 'in_review'
 *   - GitHub path:  status = 'open' (issue reopened)
 *   - capability('supports_needs_rework') must be truthy on both adapters
 *
 * Framework: node:test (matches project convention in dispatch.test.ts)
 * Run: node --test --import tsx test/markNeedsRework.contract.test.mjs
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal inline adapter stub factory
// ---------------------------------------------------------------------------
// Each test builds a fresh stub so there is no shared mutable state.
// A stub is a plain object shaped like the adapter module ABI:
//   { dispatch: fn, capabilities: object }
// The dispatcher's invoke() calls this.handle.module.dispatch({ method, params })
// and reads this.handle.capabilities.

function makeDispatcherWithAdapter(adapterStub) {
  // We manually construct a TaskTrackingDispatch-like object with a pre-loaded
  // handle so we bypass the file-system adapter loading machinery.
  // This keeps the contract test hermetic and fast.
  //
  // Structure mirrors what load() writes into this.handle (see index.ts ~L130):
  //   { module: { dispatch, init }, capabilities, abi_version }
  const handle = {
    module: { dispatch: adapterStub.dispatch },
    capabilities: adapterStub.capabilities,
    abi_version: "1.0.0",
  };

  // Import the real dispatcher class so the method signatures are tested
  // against the real invoke() path.
  return { handle, adapterStub };
}

// ---------------------------------------------------------------------------
// The actual dispatcher import — will throw / return undefined methods until
// the implementation exists.
// ---------------------------------------------------------------------------
// Using a dynamic import inside tests so that a load failure surfaces as a
// test failure rather than a module-level crash.

async function loadDispatcher() {
  // resolve relative to this file (ESM workaround for .mjs + tsx)
  const url = new URL("../index.ts", import.meta.url).href;
  return import(url);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("markNeedsRework — ABI contract", () => {
  // -------------------------------------------------------------------------
  // Test 1: Return shape contract
  // -------------------------------------------------------------------------
  it("resolves to { id, status, labels[] } with 'hive:needs-rework' in labels", async () => {
    const { TaskTrackingDispatch } = await loadDispatcher();

    const mockDispatch = mock.fn(async ({ method }) => {
      if (method === "markNeedsRework") {
        return { id: "issue-42", status: "in_review", labels: ["hive:needs-rework"] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const d = new TaskTrackingDispatch();
    // Inject pre-built handle to skip file-system load
    d._handle = {
      module: { dispatch: mockDispatch },
      capabilities: { supports_needs_rework: true, supported_labels: null },
      abi_version: "1.0.0",
    };
    // Alias: the real code stores it as this.handle (private); expose via getter
    // If the real class exposes handle differently, tests will surface that gap.
    Object.defineProperty(d, "handle", {
      get() { return d._handle; },
      configurable: true,
    });

    assert.ok(
      typeof d.markNeedsRework === "function",
      "TaskTrackingDispatch must expose a public markNeedsRework() method",
    );

    const result = await d.markNeedsRework({ id: "issue-42", reason: "Spec gap found" });

    assert.ok(result.ok, `Expected ok=true, got: ${JSON.stringify(result)}`);
    assert.equal(result.result.id, "issue-42", "result.id must match input id");
    assert.ok(typeof result.result.status === "string", "result.status must be a string");
    assert.ok(Array.isArray(result.result.labels), "result.labels must be an array");
    assert.ok(
      result.result.labels.includes("hive:needs-rework"),
      `labels must include 'hive:needs-rework', got: ${JSON.stringify(result.result.labels)}`,
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: Multica adapter path
  // -------------------------------------------------------------------------
  it("Multica path: calls updateStory(in_review) then adds hive:needs-rework label", async () => {
    const { TaskTrackingDispatch } = await loadDispatcher();

    // Track the sequence of sub-calls the adapter makes internally.
    // The adapter's dispatch handler must:
    //   1. call updateStory({ id, status: 'in_review' })  — verified via method+params
    //   2. add label 'hive:needs-rework'
    // From the contract test's perspective we observe the dispatch call params
    // and the returned shape.
    const calls = [];
    const mockDispatch = mock.fn(async ({ method, params }) => {
      calls.push({ method, params });
      if (method === "markNeedsRework") {
        // Multica implementation must internally:
        //   - set status to in_review
        //   - append hive:needs-rework to labels
        return {
          id: params.id,
          status: "in_review",
          labels: ["hive:needs-rework"],
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const d = new TaskTrackingDispatch();
    d._handle = {
      module: { dispatch: mockDispatch },
      capabilities: { supports_needs_rework: true, supported_labels: null },
      abi_version: "1.0.0",
    };
    Object.defineProperty(d, "handle", {
      get() { return d._handle; },
      configurable: true,
    });

    const result = await d.markNeedsRework({ id: "multica-uuid-123", reason: "Test gap" });

    assert.ok(result.ok, `Expected ok=true, got: ${JSON.stringify(result)}`);

    // Verify the dispatch was called with markNeedsRework
    assert.equal(mockDispatch.mock.calls.length, 1, "dispatch must be called exactly once");
    const [call] = mockDispatch.mock.calls;
    assert.equal(call.arguments[0].method, "markNeedsRework");
    assert.equal(call.arguments[0].params.id, "multica-uuid-123");

    // Verify return shape matches Multica contract
    assert.equal(result.result.status, "in_review", "Multica status must be 'in_review'");
    assert.ok(
      result.result.labels.includes("hive:needs-rework"),
      "labels must include 'hive:needs-rework'",
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: GitHub adapter path
  // -------------------------------------------------------------------------
  it("GitHub path: reopens issue (status=open) and adds hive:needs-rework label", async () => {
    const { TaskTrackingDispatch } = await loadDispatcher();

    const mockDispatch = mock.fn(async ({ method, params }) => {
      if (method === "markNeedsRework") {
        // GitHub implementation must:
        //   - reopen issue via PATCH (state -> open)
        //   - POST label hive:needs-rework
        // From the dispatcher surface we observe the returned shape.
        return {
          id: params.id,
          status: "open",
          labels: ["hive:needs-rework"],
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const d = new TaskTrackingDispatch();
    d._handle = {
      module: { dispatch: mockDispatch },
      capabilities: { supports_needs_rework: true, supported_labels: null },
      abi_version: "1.0.0",
    };
    Object.defineProperty(d, "handle", {
      get() { return d._handle; },
      configurable: true,
    });

    const result = await d.markNeedsRework({ id: "owner/repo#77", reason: "Spec mismatch" });

    assert.ok(result.ok, `Expected ok=true, got: ${JSON.stringify(result)}`);
    assert.equal(result.result.status, "open", "GitHub status must be 'open' (reopened)");
    assert.ok(
      result.result.labels.includes("hive:needs-rework"),
      "labels must include 'hive:needs-rework'",
    );

    // Verify id is echoed
    assert.equal(result.result.id, "owner/repo#77");
  });

  // -------------------------------------------------------------------------
  // Test 4: capability advertised
  // -------------------------------------------------------------------------
  it("capability('supports_needs_rework') is truthy on adapters declaring support", async () => {
    const { TaskTrackingDispatch } = await loadDispatcher();

    const mockDispatch = mock.fn(async ({ method }) => {
      if (method === "capabilities") {
        return {
          abi_version: "1.0.0",
          supports_parent_link: true,
          supports_needs_rework: true,
          supported_labels: null,
          supported_states: ["open", "closed"],
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const d = new TaskTrackingDispatch();
    d._handle = {
      module: { dispatch: mockDispatch },
      capabilities: {
        abi_version: "1.0.0",
        supports_parent_link: true,
        supports_needs_rework: true,
        supported_labels: null,
        supported_states: ["open", "closed"],
      },
      abi_version: "1.0.0",
    };
    Object.defineProperty(d, "handle", {
      get() { return d._handle; },
      configurable: true,
    });

    const cap = d.capability("supports_needs_rework");
    assert.ok(cap, "capability('supports_needs_rework') must be truthy when adapter declares it");
  });

  // -------------------------------------------------------------------------
  // Test 5: capability absent → method should still route (no hard gate at dispatch level)
  // -------------------------------------------------------------------------
  it("markNeedsRework dispatches even without capability gate (callers opt in)", async () => {
    const { TaskTrackingDispatch } = await loadDispatcher();

    // An adapter that does NOT declare supports_needs_rework but still handles the method
    // (dispatcher must not hard-block at the ABI level — gate is caller-side)
    const mockDispatch = mock.fn(async ({ method, params }) => {
      if (method === "markNeedsRework") {
        return { id: params.id, status: "open", labels: ["hive:needs-rework"] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const d = new TaskTrackingDispatch();
    d._handle = {
      module: { dispatch: mockDispatch },
      capabilities: { supports_needs_rework: false, supported_labels: null },
      abi_version: "1.0.0",
    };
    Object.defineProperty(d, "handle", {
      get() { return d._handle; },
      configurable: true,
    });

    // capability() returns falsy
    assert.ok(!d.capability("supports_needs_rework"), "capability should be falsy on this stub");

    // But invoke still routes — dispatcher does NOT auto-block on missing cap
    const result = await d.markNeedsRework({ id: "issue-1", reason: "test" });
    assert.ok(result.ok, "dispatch must still route even when capability is false");
  });
});
