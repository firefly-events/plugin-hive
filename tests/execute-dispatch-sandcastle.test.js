'use strict';

/**
 * Tests for execute-dispatch sandcastle routing
 *
 * Story: s3-dispatch-routing (sandcastle-adoption-followon)
 * Run:   node tests/execute-dispatch-sandcastle.test.js
 *
 * Design:
 *   execute-dispatch/SKILL.md is prose, not code. These tests encode a
 *   fixture resolver that mirrors the spec's field-source precedence rules
 *   so the logic can be exercised as a pure function with injected env +
 *   config inputs. The fixture is NOT production code — it is a test seam.
 *
 * Covers:
 *   AC-1  env HIVE_EXECUTION_MODE=sandcastle → mode_decision=sandcastle, source=env
 *   AC-2  config execution.mode=sandcastle (env unset) → source=config
 *   AC-3  neither env nor config → source=default, existing resolution unchanged
 *   AC-4  no-regression: sessions mode still wins when sessions_enabled=true
 *   AC-5  no-regression: sequential mode when execution.parallel_teams=false
 *   AC-6  telemetry line includes execution_mode={source}
 *   AC-7  env HIVE_EXECUTION_MODE set to unknown value → not sandcastle (ignored)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Fixture: dispatch resolver mirroring execute-dispatch/SKILL.md prose
// ---------------------------------------------------------------------------

/**
 * Minimal field-source resolver for execution_mode as specified in
 * skills/hive/skills/execute-dispatch/SKILL.md Step 0.
 *
 * @param {object} env     - environment variables map
 * @param {object} config  - parsed root hive.config.yaml (or {})
 * @returns {{ mode_decision: string, mode_reason: string, field_sources: object, telemetry: string }}
 */
function resolveDispatch(env = {}, config = {}) {
  // Step 0 – resolve execution_mode source first (sandcastle gate)
  let executionModeSource = 'default';
  let sandcastleSelected = false;

  if (env.HIVE_EXECUTION_MODE === 'sandcastle') {
    executionModeSource = 'env';
    sandcastleSelected = true;
  } else if (config.execution && config.execution.mode === 'sandcastle') {
    executionModeSource = 'config';
    sandcastleSelected = true;
  }
  // Any other HIVE_EXECUTION_MODE value is ignored (reserved for future modes)

  // Short-circuit: sandcastle wins before sessions / team / sequential
  if (sandcastleSelected) {
    const field_sources = { execution_mode: executionModeSource };
    const telemetry =
      `[telemetry] backend_resolution sessions_enabled=default ` +
      `parallel_teams=default terminal_mux=default executor=default ` +
      `execution_mode=${executionModeSource}`;
    return {
      mode_decision: 'sandcastle',
      mode_reason: `execution-mode-override-${executionModeSource}`,
      field_sources,
      telemetry,
    };
  }

  // Step 0 – resolve the four standard fields (simplified for test fixture)
  const sessionsEnabled =
    env.HIVE_SESSIONS_ENABLED === '1' ||
    env.HIVE_SESSIONS_ENABLED === 'true' ||
    (config.sessions && config.sessions.enabled === true);
  const sessionsSource = env.HIVE_SESSIONS_ENABLED != null ? 'env'
    : (config.sessions && config.sessions.enabled != null ? 'config' : 'default');

  const parallelTeams =
    config.parallel_teams != null ? config.parallel_teams
      : (config.execution && config.execution.parallel_teams != null ? config.execution.parallel_teams : true);

  // Step 1 – standard mode resolution (sandcastle already excluded above)
  let mode_decision;
  let mode_reason;

  if (sessionsEnabled) {
    mode_decision = 'sessions';
    mode_reason = 'sessions-enabled';
  } else if (parallelTeams !== true) {
    mode_decision = 'sequential';
    mode_reason = 'parallel-teams-disabled';
  } else {
    // Simplified: no depth/cmux checks in this fixture — return team
    mode_decision = 'team';
    mode_reason = 'team-checks-pass';
  }

  const field_sources = {
    sessions_enabled: sessionsSource,
    execution_mode: 'default',
  };

  const telemetry =
    `[telemetry] backend_resolution sessions_enabled=${sessionsSource} ` +
    `parallel_teams=default terminal_mux=default executor=default ` +
    `execution_mode=default`;

  return { mode_decision, mode_reason, field_sources, telemetry };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('AC-1: HIVE_EXECUTION_MODE=sandcastle via env → sandcastle, source=env', () => {
  const result = resolveDispatch(
    { HIVE_EXECUTION_MODE: 'sandcastle' },
    {}
  );
  assert.equal(result.mode_decision, 'sandcastle');
  assert.equal(result.mode_reason, 'execution-mode-override-env');
  assert.equal(result.field_sources.execution_mode, 'env');
});

test('AC-2: config execution.mode=sandcastle (env unset) → sandcastle, source=config', () => {
  const result = resolveDispatch(
    {},
    { execution: { mode: 'sandcastle' } }
  );
  assert.equal(result.mode_decision, 'sandcastle');
  assert.equal(result.mode_reason, 'execution-mode-override-config');
  assert.equal(result.field_sources.execution_mode, 'config');
});

test('AC-3: neither env nor config → source=default, mode is not sandcastle', () => {
  const result = resolveDispatch({}, {});
  assert.notEqual(result.mode_decision, 'sandcastle');
  assert.equal(result.field_sources.execution_mode, 'default');
});

test('AC-4 (no-regression): sessions wins when sessions_enabled=true via env', () => {
  const result = resolveDispatch(
    { HIVE_SESSIONS_ENABLED: 'true' },
    {}
  );
  assert.equal(result.mode_decision, 'sessions');
  assert.equal(result.mode_reason, 'sessions-enabled');
  assert.equal(result.field_sources.execution_mode, 'default');
});

test('AC-4b (no-regression): sessions wins when sessions.enabled:true in config', () => {
  const result = resolveDispatch(
    {},
    { sessions: { enabled: true } }
  );
  assert.equal(result.mode_decision, 'sessions');
  assert.equal(result.field_sources.execution_mode, 'default');
});

test('AC-5 (no-regression): sequential when execution.parallel_teams=false', () => {
  const result = resolveDispatch(
    {},
    { execution: { parallel_teams: false } }
  );
  assert.equal(result.mode_decision, 'sequential');
  assert.equal(result.mode_reason, 'parallel-teams-disabled');
});

test('AC-5b (no-regression): default parallel teams route does not require env gate', () => {
  const result = resolveDispatch({}, {});
  assert.equal(result.mode_decision, 'team');
  assert.equal(result.mode_reason, 'team-checks-pass');
});

test('AC-6: telemetry line includes execution_mode={source}', () => {
  const envResult = resolveDispatch({ HIVE_EXECUTION_MODE: 'sandcastle' }, {});
  assert.ok(envResult.telemetry.includes('execution_mode=env'), 'env telemetry token present');

  const configResult = resolveDispatch({}, { execution: { mode: 'sandcastle' } });
  assert.ok(configResult.telemetry.includes('execution_mode=config'), 'config telemetry token present');

  const defaultResult = resolveDispatch({}, {});
  assert.ok(defaultResult.telemetry.includes('execution_mode=default'), 'default telemetry token present');
});

test('AC-7: HIVE_EXECUTION_MODE=unknown-value does not trigger sandcastle', () => {
  const result = resolveDispatch(
    { HIVE_EXECUTION_MODE: 'future-mode-placeholder' },
    {}
  );
  assert.notEqual(result.mode_decision, 'sandcastle');
  assert.equal(result.field_sources.execution_mode, 'default');
});

test('AC-8: env sandcastle takes precedence over config sessions', () => {
  // Even when sessions would win via config, sandcastle env override fires first
  const result = resolveDispatch(
    { HIVE_EXECUTION_MODE: 'sandcastle' },
    { sessions: { enabled: true } }
  );
  assert.equal(result.mode_decision, 'sandcastle');
  assert.equal(result.field_sources.execution_mode, 'env');
});
