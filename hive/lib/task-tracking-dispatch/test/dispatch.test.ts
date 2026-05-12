// Unit tests for @hive/task-tracking-dispatch.
//
// Strategy:
//   - For most behavior tests we use mock-adapter ESM fixtures shipped in
//     test/fixtures/. Mock state is reset between cases via __reset().
//   - Built-in adapter resolution is exercised against the real
//     hive/adapters/{github,linear}/index.ts paths but stops at capabilities
//     (no network mocks here — capabilities is a pure return).
//   - We force fresh module instances per scenario by copying the fixture to
//     a unique tmp path when independence matters (ESM import cache is keyed
//     by URL).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TaskTrackingDispatch,
  __resetHandleCache,
  __handleCacheSize,
} from "../index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const MOCK_GOOD = path.join(FIXTURES_DIR, "mock-good.ts");
const MOCK_NO_DISPATCH = path.join(FIXTURES_DIR, "mock-no-dispatch.ts");
const MOCK_WRONG_ABI = path.join(FIXTURES_DIR, "mock-wrong-abi.ts");

// Built-in adapter paths — sanity-check that resolveAdapterPath() finds them.
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const GITHUB_ADAPTER = path.join(REPO_ROOT, "hive/adapters/github/index.ts");
const LINEAR_ADAPTER = path.join(REPO_ROOT, "hive/adapters/linear/index.ts");

let copyCounter = 0;
function copyFixtureToTmp(srcPath: string, suffix = ".ts"): string {
  copyCounter += 1;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttd-fixture-"));
  const dest = path.join(tmpDir, `fixture-${copyCounter}${suffix}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

async function loadMockState(adapterPath: string) {
  // Re-import the just-loaded fixture via its file URL to grab __state /
  // __reset. ESM caches by URL so this returns the same module instance the
  // dispatcher loaded.
  const mod: any = await import(pathToFileURL(adapterPath).href);
  return mod;
}

before(() => {
  // Make sure built-in adapters exist where we expect them.
  assert.ok(
    fs.existsSync(GITHUB_ADAPTER),
    `expected github adapter at ${GITHUB_ADAPTER}`,
  );
  assert.ok(
    fs.existsSync(LINEAR_ADAPTER),
    `expected linear adapter at ${LINEAR_ADAPTER}`,
  );
});

beforeEach(() => {
  __resetHandleCache();
});

describe("load() — built-in adapter resolution", () => {
  it("resolves the github built-in key to a loadable module", async () => {
    const d = new TaskTrackingDispatch();
    // Ensure the github adapter has a token (avoid `gh auth token` shell-out
    // during the capabilities call — capabilities is pure, but defense in
    // depth).
    if (!process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = "test-token";
    await d.load({
      adapter: "github",
      state_dir: ".pHive-test",
      gate_mode: "warning",
    });
    assert.equal(d.hasAdapter, true);
    assert.equal(d.abiVersion, "1.0.0");
    assert.equal(d.capability("hierarchy"), "mixed");
    assert.equal(d.capability("supports_parent_link"), true);
  });

  it("throws a clear error when the adapter key/path is not found", async () => {
    const d = new TaskTrackingDispatch();
    await assert.rejects(
      d.load({ adapter: "nonexistent", state_dir: ".pHive-test" }),
      /Adapter not found: nonexistent/,
    );
  });
});

describe("load() — custom adapter path", () => {
  it("loads a custom adapter from an absolute path", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({
      adapter: fixture,
      state_dir: ".pHive-test",
      gate_mode: "warning",
    });
    assert.equal(d.hasAdapter, true);
    assert.equal(d.abiVersion, "1.0.0");
    const mock: any = await loadMockState(fixture);
    assert.equal(
      mock.__state.initCalls,
      1,
      "init() should be called once when present",
    );
  });

  it("throws when the adapter module does not export dispatch()", async () => {
    const fixture = copyFixtureToTmp(MOCK_NO_DISPATCH);
    const d = new TaskTrackingDispatch();
    await assert.rejects(
      d.load({ adapter: fixture, state_dir: ".pHive-test" }),
      /does not export dispatch\(\)/,
    );
  });

  it("throws when the adapter declares an unsupported ABI major version", async () => {
    const fixture = copyFixtureToTmp(MOCK_WRONG_ABI);
    const d = new TaskTrackingDispatch();
    await assert.rejects(
      d.load({ adapter: fixture, state_dir: ".pHive-test" }),
      /ABI version 2\.0\.0 incompatible/,
    );
  });
});

describe("invoke() — happy path + error mapping", () => {
  it("returns {ok: true, result} on success", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({ adapter: fixture, state_dir: ".pHive-test" });
    const r = await d.invoke("createStory", { title: "Hello" });
    assert.equal(r.ok, true);
    assert.deepEqual(
      (r as any).result,
      { id: "mock/repo#42", method: "createStory", params: { title: "Hello" } },
    );
  });

  it("maps RATE_LIMIT to recoverable result with retry_after_ms", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({ adapter: fixture, state_dir: ".pHive-test" });
    const mock: any = await loadMockState(fixture);
    mock.__state.mode = "rate-limit";
    const r = await d.invoke("createStory", {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.recoverable, true);
    assert.equal(r.code, "RATE_LIMIT");
    assert.equal(r.retry_after_ms, 1500);
  });

  it("maps AUTH_FAILURE to non-recoverable terminal result", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({ adapter: fixture, state_dir: ".pHive-test" });
    const mock: any = await loadMockState(fixture);
    mock.__state.mode = "auth-fail";
    const r = await d.invoke("createStory", {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.recoverable, false);
    assert.equal(r.code, "AUTH_FAILURE");
  });

  it("maps uncaught adapter errors to INTERNAL_ERROR", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({ adapter: fixture, state_dir: ".pHive-test" });
    const mock: any = await loadMockState(fixture);
    mock.__state.mode = "uncaught";
    const r = await d.invoke("createStory", {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "INTERNAL_ERROR");
    assert.match(r.message, /kaboom/);
  });

  it("maps slow adapter to TIMEOUT", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({
      adapter: fixture,
      state_dir: ".pHive-test",
      adapter_timeout_ms: 50,
    });
    const mock: any = await loadMockState(fixture);
    mock.__state.mode = "slow";
    const r = await d.invoke("createStory", {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "TIMEOUT");
  });

  it("blocks linkStories when supports_parent_link=false", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    // Pre-flip the mode BEFORE load() so capabilities reports false.
    const preMod: any = await import(pathToFileURL(fixture).href);
    preMod.__state.mode = "missing-parent";
    await d.load({ adapter: fixture, state_dir: ".pHive-test" });
    assert.equal(d.capability("supports_parent_link"), false);
    const r = await d.invoke("linkStories", {
      parent_id: "a",
      child_id: "b",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "OPERATION_UNSUPPORTED");
  });
});

describe("capability() — cached capabilities", () => {
  it("returns fields from the cached capabilities object", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const d = new TaskTrackingDispatch();
    await d.load({ adapter: fixture, state_dir: ".pHive-test" });
    assert.equal(d.capability("hierarchy"), "mixed");
    assert.equal(d.capability("supports_parent_link"), true);
    assert.deepEqual(d.capability("supported_states"), ["open", "closed"]);
    assert.equal(d.capability("nonexistent_field"), undefined);
  });

  it("returns undefined when no adapter is loaded", async () => {
    const d = new TaskTrackingDispatch();
    await d.load({ adapter: null, state_dir: ".pHive-test" });
    assert.equal(d.hasAdapter, false);
    assert.equal(d.capability("hierarchy"), undefined);
  });
});

describe("no-adapter behavior", () => {
  it("gate_mode=warning emits warning + JSONL telemetry once, returns NO_ADAPTER", async () => {
    const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), "ttd-state-"));
    const d = new TaskTrackingDispatch();
    await d.load({
      adapter: null,
      state_dir: tmpState,
      gate_mode: "warning",
    });

    // Capture console.warn output.
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => {
      warnings.push(msg);
    };
    try {
      const r1 = await d.invoke("createStory", {});
      const r2 = await d.invoke("updateStatus", {});
      assert.equal(r1.ok, false);
      assert.equal(r2.ok, false);
      if (!r1.ok) assert.equal(r1.code, "NO_ADAPTER");
      if (!r2.ok) assert.equal(r2.code, "NO_ADAPTER");
    } finally {
      console.warn = origWarn;
    }

    assert.equal(warnings.length, 1, "warning should be emitted exactly once");
    assert.match(warnings[0], /task-tracking adapter is unset/);

    // JSONL telemetry — exactly one event file written.
    const eventsDir = path.join(tmpState, "metrics", "events");
    const files = fs
      .readdirSync(eventsDir)
      .filter((f) => f.startsWith("task-tracking-no-adapter-"));
    assert.equal(files.length, 1, "exactly one JSONL telemetry file expected");
    const raw = fs.readFileSync(path.join(eventsDir, files[0]), "utf8");
    const event = JSON.parse(raw.trim());
    assert.equal(event.metric_type, "task-tracking-no-adapter");
    assert.equal(event.method, "createStory");
    assert.equal(event.gate_mode, "warning");
    assert.ok(event.event_id);
    assert.ok(event.timestamp);
  });

  it("gate_mode=hard returns NO_ADAPTER without writing telemetry", async () => {
    const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), "ttd-state-"));
    const d = new TaskTrackingDispatch();
    await d.load({
      adapter: null,
      state_dir: tmpState,
      gate_mode: "hard",
    });
    const r = await d.invoke("createStory", {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "NO_ADAPTER");
    assert.match(r.message, /gate_mode=hard/);

    const eventsDir = path.join(tmpState, "metrics", "events");
    assert.ok(
      !fs.existsSync(eventsDir) ||
        fs.readdirSync(eventsDir).filter((f) =>
          f.startsWith("task-tracking-no-adapter-"),
        ).length === 0,
      "hard mode should not emit telemetry",
    );
  });
});

describe("handle cache", () => {
  it("shares the same handle across two load() calls with equivalent config", async () => {
    const fixture = copyFixtureToTmp(MOCK_GOOD);
    const config = {
      adapter: fixture,
      state_dir: ".pHive-test",
      gate_mode: "warning" as const,
    };
    const d1 = new TaskTrackingDispatch();
    await d1.load(config);
    assert.equal(__handleCacheSize(), 1);

    const mock: any = await loadMockState(fixture);
    const initBefore = mock.__state.initCalls;
    const dispatchCallsBefore = mock.__state.dispatchCalls.length;

    const d2 = new TaskTrackingDispatch();
    await d2.load(config);
    assert.equal(__handleCacheSize(), 1, "cache size should remain 1");
    assert.equal(
      mock.__state.initCalls,
      initBefore,
      "init() should NOT be called again on cache hit",
    );
    assert.equal(
      mock.__state.dispatchCalls.length,
      dispatchCallsBefore,
      "capabilities should NOT be re-fetched on cache hit",
    );

    // Both instances share the same capability data.
    assert.equal(d2.hasAdapter, true);
    assert.equal(d2.capability("hierarchy"), "mixed");
  });
});
