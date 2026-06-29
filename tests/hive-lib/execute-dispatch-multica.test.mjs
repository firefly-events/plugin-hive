// tests/hive-lib/execute-dispatch-multica.test.mjs
//
// Unit tests for the prose-defined execute-dispatch execution_mode resolver.
// The skill is markdown, so this file keeps a small inline implementation of
// the documented decision logic and asserts the multica acceptance criteria.

import { test } from "node:test";
import assert from "node:assert/strict";

const PARALLEL_GATE_MODES = new Set([
  "team",
  "team-cmux",
  "sessions",
  "sandcastle",
  "multica",
]);

function truthy(value) {
  return value === true || value === "1" || value === "true";
}

function resolveExecutionMode({
  env = {},
  config = {},
  argumentsText = "",
  hasPeerDepth = false,
  unblockedStories = [],
} = {}) {
  const envMode = env.HIVE_EXECUTION_MODE;
  const configMode = config.execution?.mode;
  const fieldSources = { execution_mode: "default" };
  let modeDecision;
  let modeReason;

  if (envMode === "sandcastle" || envMode === "multica") {
    fieldSources.execution_mode = "env";
    modeDecision = envMode;
    modeReason = "execution-mode-override-env";
  } else if (configMode === "sandcastle" || configMode === "multica") {
    fieldSources.execution_mode = "config";
    modeDecision = configMode;
    modeReason = "execution-mode-override-config";
  }

  if (!modeDecision) {
    if (
      truthy(env.HIVE_SESSIONS_ENABLED) ||
      config.sessions?.enabled === true
    ) {
      modeDecision = "sessions";
      modeReason = "sessions-enabled";
    } else if (config.execution?.parallel_teams === false) {
      modeDecision = "sequential";
      modeReason = "parallel-teams-disabled";
    } else if (!hasPeerDepth) {
      modeDecision = "sequential";
      modeReason = "no-peer-depth";
    } else if (argumentsText.includes("--sequential")) {
      modeDecision = "sequential";
      modeReason = "sequential-flag";
    } else if (config.execution?.terminal_mux === "cmux") {
      modeDecision = "team-cmux";
      modeReason = "team-checks-pass-cmux";
    } else {
      modeDecision = "team";
      modeReason = "team-checks-pass";
    }
  }

  return {
    mode_decision: modeDecision,
    mode_reason: modeReason,
    field_sources: fieldSources,
    parallel_gate_runs:
      PARALLEL_GATE_MODES.has(modeDecision) && unblockedStories.length > 1,
  };
}

test("AC1: env HIVE_EXECUTION_MODE=multica selects multica override", () => {
  const result = resolveExecutionMode({
    env: { HIVE_EXECUTION_MODE: "multica" },
  });

  assert.equal(result.mode_decision, "multica");
  assert.equal(result.mode_reason, "execution-mode-override-env");
});

test("AC2: config execution.mode=multica selects multica override", () => {
  const result = resolveExecutionMode({
    config: { execution: { mode: "multica" } },
  });

  assert.equal(result.mode_decision, "multica");
  assert.equal(result.mode_reason, "execution-mode-override-config");
});

test("AC3: env multica wins over config sandcastle", () => {
  const result = resolveExecutionMode({
    env: { HIVE_EXECUTION_MODE: "multica" },
    config: { execution: { mode: "sandcastle" } },
  });

  assert.equal(result.mode_decision, "multica");
  assert.equal(result.mode_reason, "execution-mode-override-env");
});

test("AC4: unknown config execution.mode falls through without error", () => {
  const result = resolveExecutionMode({
    config: { execution: { mode: "bogus" } },
    hasPeerDepth: true,
  });

  assert.equal(result.field_sources.execution_mode, "default");
  assert.equal(result.mode_decision, "team");
  assert.equal(result.mode_reason, "team-checks-pass");
});

test("AC5: multica participates in the Step 1.5 parallel gate", () => {
  const result = resolveExecutionMode({
    config: { execution: { mode: "multica" } },
    unblockedStories: [{ id: "a" }, { id: "b" }, { id: "c" }],
  });

  assert.equal(result.mode_decision, "multica");
  assert.equal(result.parallel_gate_runs, true);
});

test("AC6: no execution_mode override defaults to parallel when peer depth exists", () => {
  const result = resolveExecutionMode({ hasPeerDepth: true });

  assert.equal(result.field_sources.execution_mode, "default");
  assert.equal(result.mode_decision, "team");
  assert.equal(result.mode_reason, "team-checks-pass");
});

test("AC7: execution.parallel_teams=false routes to sequential", () => {
  const result = resolveExecutionMode({
    config: { execution: { parallel_teams: false } },
    hasPeerDepth: true,
  });

  assert.equal(result.field_sources.execution_mode, "default");
  assert.equal(result.mode_decision, "sequential");
  assert.equal(result.mode_reason, "parallel-teams-disabled");
});
