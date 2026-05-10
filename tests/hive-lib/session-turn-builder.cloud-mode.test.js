/**
 * Cloud-mode gating contract for Sessions-only event builders.
 *
 * Story s9-a5-cloud-mode-dead-code-gating. TDD: written RED before implementation.
 * Run: node tests/hive-lib/session-turn-builder.cloud-mode.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLIENT_PATH = path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js');
const SDK_NAME = '@anthropic-ai/sdk';
const TURN_BUILDER_PATH = path.join(REPO_ROOT, 'hive', 'lib', 'session-turn-builder.js');

function loadClientWithBuilderSpy() {
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;
  const calls = {
    buildCustomToolResult: [],
    buildToolConfirmation: [],
  };

  const turnBuilderStub = {
    buildCustomToolResult(...args) {
      calls.buildCustomToolResult.push(args);
      return { type: 'user.custom_tool_result', args };
    },
    buildToolConfirmation(...args) {
      calls.buildToolConfirmation.push(args);
      return { type: 'user.tool_confirmation', args };
    },
  };

  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === SDK_NAME) return SDK_NAME;
    if (request === './session-turn-builder' && parent && parent.filename === CLIENT_PATH) {
      return TURN_BUILDER_PATH;
    }
    return originalResolve.call(this, request, parent, ...rest);
  };

  Module._load = function (request, parent, ...rest) {
    if (request === SDK_NAME) {
      return function FakeAnthropic() { return { beta: { sessions: {} } }; };
    }
    if (request === './session-turn-builder' && parent && parent.filename === CLIENT_PATH) {
      return turnBuilderStub;
    }
    if (request === TURN_BUILDER_PATH) return turnBuilderStub;
    return originalLoad.call(this, request, parent, ...rest);
  };

  delete require.cache[require.resolve(CLIENT_PATH)];
  const client = require(CLIENT_PATH);

  return {
    client,
    calls,
    restore() {
      Module._resolveFilename = originalResolve;
      Module._load = originalLoad;
      delete require.cache[require.resolve(CLIENT_PATH)];
    },
  };
}

test('buildToolConfirmation is not invoked on messages substrate and is invoked on sessions-cloud', () => {
  const harness = loadClientWithBuilderSpy();
  try {
    assert.equal(typeof harness.client.buildToolConfirmationEvent, 'function');

    const skipped = harness.client.buildToolConfirmationEvent(
      { execution: { substrate: 'messages' } },
      'toolu_msg',
      'allow',
    );
    assert.equal(skipped, null);
    assert.equal(harness.calls.buildToolConfirmation.length, 0);

    const built = harness.client.buildToolConfirmationEvent(
      { execution: { substrate: 'sessions-cloud' } },
      'toolu_cloud',
      'deny',
      'nope',
    );
    assert.deepEqual(built, {
      type: 'user.tool_confirmation',
      args: ['toolu_cloud', 'deny', 'nope'],
    });
    assert.equal(harness.calls.buildToolConfirmation.length, 1);
    assert.deepEqual(harness.calls.buildToolConfirmation[0], ['toolu_cloud', 'deny', 'nope']);
  } finally {
    harness.restore();
  }
});

test('buildCustomToolResult is not invoked on messages substrate and is invoked on sessions-cloud', () => {
  const harness = loadClientWithBuilderSpy();
  try {
    assert.equal(typeof harness.client.buildCustomToolResultEvent, 'function');

    const skipped = harness.client.buildCustomToolResultEvent(
      { execution: { substrate: 'messages' } },
      'ctu_msg',
      'ignored',
    );
    assert.equal(skipped, null);
    assert.equal(harness.calls.buildCustomToolResult.length, 0);

    const built = harness.client.buildCustomToolResultEvent(
      { execution: { substrate: 'sessions-cloud' } },
      'ctu_cloud',
      'ok',
    );
    assert.deepEqual(built, {
      type: 'user.custom_tool_result',
      args: ['ctu_cloud', 'ok'],
    });
    assert.equal(harness.calls.buildCustomToolResult.length, 1);
    assert.deepEqual(harness.calls.buildCustomToolResult[0], ['ctu_cloud', 'ok']);
  } finally {
    harness.restore();
  }
});
