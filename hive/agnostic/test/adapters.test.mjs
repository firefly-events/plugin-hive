// adapters.test.mjs — unit tests for the runner-agnostic PLAN adapters. Pure, no model spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeKind, buildRunArgs, parseRunOutput } from "../adapters.mjs";
import { extractIdeaFromPrompt, buildDecomposePrompt } from "../plan-agnostic.mjs";

test("resolveRuntimeKind maps runtimes to CLI kinds", () => {
  assert.equal(resolveRuntimeKind("claude"), "claude");
  assert.equal(resolveRuntimeKind("anthropic"), "claude");
  assert.equal(resolveRuntimeKind("gemini"), "opencode");
  assert.equal(resolveRuntimeKind("codex"), "opencode");
  assert.equal(resolveRuntimeKind("opencode"), "opencode");
});

test("buildRunArgs — opencode initial turn writes .pHive via --auto and json format", () => {
  const { cmd, args, kind } = buildRunArgs({
    runtime: "gemini",
    model: "google/gemini-3.1-pro-preview",
    prompt: "DECOMPOSE ...",
    sessionId: null,
    cwd: "/w",
  });
  assert.equal(kind, "opencode");
  assert.match(cmd, /opencode$/);
  assert.deepEqual(args.slice(0, 3), ["run", "--model", "google/gemini-3.1-pro-preview"]);
  assert.ok(args.includes("--format") && args.includes("json"));
  assert.ok(args.includes("--auto"));
  assert.ok(args.includes("--dir") && args.includes("/w"));
  assert.ok(!args.includes("--session"));
  assert.equal(args[args.length - 1], "DECOMPOSE ...");
});

test("buildRunArgs — opencode continuation turn passes --session", () => {
  const { args } = buildRunArgs({ runtime: "gemini", model: "google/gemini-3.1-pro-preview", prompt: "yes", sessionId: "ses_123", cwd: "/w" });
  const i = args.indexOf("--session");
  assert.ok(i >= 0 && args[i + 1] === "ses_123");
});

test("buildRunArgs — claude uses -p/--output-format json and resume/session-id", () => {
  const fresh = buildRunArgs({ runtime: "claude", model: "claude-haiku-4-5", prompt: "p", sessionId: null });
  assert.equal(fresh.cmd.replace(/.*\//, ""), "claude");
  assert.ok(fresh.args.includes("-p"));
  assert.ok(fresh.args.includes("--output-format") && fresh.args.includes("json"));
  assert.ok(fresh.args.includes("--session-id"));
  const resumed = buildRunArgs({ runtime: "claude", model: "m", prompt: "p", sessionId: "abc" });
  const ri = resumed.args.indexOf("--resume");
  assert.ok(ri >= 0 && resumed.args[ri + 1] === "abc");
});

test("buildRunArgs rejects empty prompt", () => {
  assert.throws(() => buildRunArgs({ runtime: "gemini", prompt: "" }));
});

test("parseRunOutput — claude single JSON object", () => {
  const stdout = JSON.stringify({ session_id: "s1", result: "done", is_error: false });
  assert.deepEqual(parseRunOutput({ runtime: "claude", stdout }), { session_id: "s1", result: "done" });
});

test("parseRunOutput — opencode NDJSON extracts sessionID and final text", () => {
  const lines = [
    JSON.stringify({ type: "step_start", sessionID: "ses_9", part: { sessionID: "ses_9" } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", sessionID: "ses_9" } }),
    "not-json-noise",
    JSON.stringify({ type: "text", part: { type: "text", text: "PLAN_WRITTEN epic=x stories=3" } }),
  ].join("\n");
  const out = parseRunOutput({ runtime: "gemini", stdout: lines });
  assert.equal(out.session_id, "ses_9");
  assert.match(out.result, /PLAN_WRITTEN epic=x stories=3/);
});

test("extractIdeaFromPrompt strips /plugin-hive:plan and flags", () => {
  assert.equal(extractIdeaFromPrompt("/plugin-hive:plan Add CSV export --skip-sign-off --lite"), "Add CSV export");
  assert.equal(extractIdeaFromPrompt("Add CSV export"), "Add CSV export");
  assert.equal(extractIdeaFromPrompt("/hive:plan Build a thing --lite"), "Build a thing");
});

test("buildDecomposePrompt substitutes placeholders and carries the decompose contract", () => {
  const p = buildDecomposePrompt({ idea: "Add CSV export", epicId: "add-csv-export", targetCodebase: "/repo" });
  assert.ok(!p.includes("__IDEA__") && !p.includes("__EPIC_ID__") && !p.includes("__TARGET_CODEBASE__"));
  assert.match(p, /Add CSV export/);
  assert.match(p, /add-csv-export/);
  assert.match(p, /DECOMPOSE, DO NOT IMPLEMENT/);
  assert.match(p, /\.pHive\/epics\/add-csv-export\/epic\.yaml/);
  assert.match(p, /stories\/<story-id>\.yaml/);
});
