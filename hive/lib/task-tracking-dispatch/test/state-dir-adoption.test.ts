// State-dir resolver adoption tests (story sdr-5) for the no-adapter JSONL
// telemetry path. With no injected config.state_dir, the events directory
// must follow Q2 precedence: HIVE_STATE_DIR env > root-config paths.state_dir
// > default `.pHive`. Injected state_dir (the existing test seam) keeps
// winning over both tiers.
//
// Run (from hive/lib/task-tracking-dispatch): npm test

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TaskTrackingDispatch } from "../index.ts";

const RESOLVER_ENV_KEYS = ["HIVE_STATE_DIR", "CONFIG_FILE", "HIVE_ROOT"];

// realpath so macOS /var → /private/var symlinks don't confuse path asserts
// (the resolver canonicalizes its output).
function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ttd-sdr5-")));
}

function writeStateDirConfig(root: string, stateDir: string): void {
  fs.writeFileSync(
    path.join(root, "hive.config.yaml"),
    `paths:\n  state_dir: ${stateDir}\n`,
    "utf8",
  );
}

async function inDir<T>(
  dir: string,
  envOverride: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const prevCwd = process.cwd();
  const prevEnv: Record<string, string | undefined> = {};
  for (const key of RESOLVER_ENV_KEYS) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, envOverride);
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
    for (const key of RESOLVER_ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
  }
}

function listNoAdapterEvents(root: string, stateDir: string): string[] {
  const eventsDir = path.join(root, stateDir, "metrics", "events");
  if (!fs.existsSync(eventsDir)) return [];
  return fs
    .readdirSync(eventsDir)
    .filter((f) => f.startsWith("task-tracking-no-adapter-"));
}

// Silence the paired console warning while exercising the telemetry write.
async function withQuietWarn<T>(fn: () => Promise<T>): Promise<T> {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = origWarn;
  }
}

async function invokeNoAdapter(): Promise<void> {
  const d = new TaskTrackingDispatch();
  await d.load({ adapter: null, gate_mode: "warning" });
  const r = await d.invoke("createStory", {});
  assert.equal(r.ok, false);
}

const PERMUTATIONS: Array<{
  label: string;
  env: Record<string, string>;
  config: string | null;
  expected: string;
}> = [
  { label: "env only — env path wins", env: { HIVE_STATE_DIR: "env-state" }, config: null, expected: "env-state" },
  { label: "config only — configured path used, not .pHive", env: {}, config: "custom-state", expected: "custom-state" },
  { label: "env + config — env override beats config", env: { HIVE_STATE_DIR: "env-state" }, config: "custom-state", expected: "env-state" },
  { label: "neither — default .pHive unchanged", env: {}, config: null, expected: ".pHive" },
];

describe("no-adapter telemetry state-dir resolution (Q2)", () => {
  beforeEach(() => {
    TaskTrackingDispatch.__resetNoAdapterWarningForTests();
  });

  for (const perm of PERMUTATIONS) {
    it(perm.label, async () => {
      const root = makeTmpDir();
      if (perm.config) writeStateDirConfig(root, perm.config);

      await inDir(root, perm.env, () => withQuietWarn(invokeNoAdapter));

      assert.equal(listNoAdapterEvents(root, perm.expected).length, 1);
      if (perm.expected !== ".pHive") {
        assert.equal(listNoAdapterEvents(root, ".pHive").length, 0);
      }
    });
  }

  it("injected config.state_dir stays honored over env + config", async () => {
    const root = makeTmpDir();
    writeStateDirConfig(root, "custom-state");
    const injected = path.join(root, "injected-state");

    await inDir(root, { HIVE_STATE_DIR: "env-state" }, () =>
      withQuietWarn(async () => {
        const d = new TaskTrackingDispatch();
        await d.load({ adapter: null, gate_mode: "warning", state_dir: injected });
        const r = await d.invoke("createStory", {});
        assert.equal(r.ok, false);
      }),
    );

    assert.equal(listNoAdapterEvents(root, "injected-state").length, 1);
    assert.equal(listNoAdapterEvents(root, "env-state").length, 0);
    assert.equal(listNoAdapterEvents(root, "custom-state").length, 0);
  });
});
