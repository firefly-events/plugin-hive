/**
 * Fixture rot smoke for the Sessions-API branch.
 *
 * Run: node tests/hive-lib/sessions-cloud.fixture-rot.smoke.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLIENT_PATH = path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'sessions-cloud');
const RECORDING_PATH = path.join(FIXTURE_DIR, 'session-recording.ndjson');
const SDK_NAME = '@anthropic-ai/sdk';

function hasRecordedFixture() {
  return fs.existsSync(RECORDING_PATH);
}

function parseRecording() {
  const raw = fs.readFileSync(RECORDING_PATH, 'utf8').trim();
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      err.message = `invalid JSON on recording line ${index + 1}: ${err.message}`;
      throw err;
    }
  });
}

function loadClientWithSdkStub(fakeAnthropic) {
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;
  let client;

  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === SDK_NAME) return SDK_NAME;
    return originalResolve.call(this, request, parent, ...rest);
  };

  Module._load = function (request, parent, ...rest) {
    if (request === SDK_NAME) return fakeAnthropic;
    return originalLoad.call(this, request, parent, ...rest);
  };

  try {
    delete require.cache[require.resolve(CLIENT_PATH)];
    client = require(CLIENT_PATH);
  } finally {
    Module._resolveFilename = originalResolve;
    Module._load = originalLoad;
    delete require.cache[require.resolve(CLIENT_PATH)];
  }

  return {
    client,
    restore() {
      delete require.cache[require.resolve(CLIENT_PATH)];
    },
  };
}

test('sessions-cloud fixture rot smoke exercises the full Sessions-API branch when fixture is present', async (t) => {
  if (!hasRecordedFixture()) {
    t.skip('pre-condition: maintainer-fixture-absent');
    return;
  }

  const [metadata, ...records] = parseRecording();
  assert.equal(metadata.type, 'fixture_metadata', 'recording must start with a fixture metadata header');

  const createRequest = records.find((record) => record.type === 'create.request');
  const createResponse = records.find((record) => record.type === 'create.response');
  const sendRequest = records.find((record) => record.type === 'send.request');
  const streamEvents = records.filter((record) => record.type === 'stream.event');

  assert.ok(createRequest && createResponse, 'recording must include create.request and create.response');
  assert.ok(sendRequest, 'recording must include send.request');
  assert.ok(streamEvents.length > 0, 'recording must include at least one stream.event');

  const fakeAnthropic = function FakeAnthropic() {
    return {
      beta: {
        sessions: {
          async create(body) {
            assert.deepEqual(body, createRequest.body, 'createSession request must match the recorded fixture');
            return createResponse.body;
          },
          events: {
            async send(sessionId, body) {
              assert.equal(sessionId, sendRequest.session_id, 'sendEvents session id must match the recorded fixture');
              assert.deepEqual(body, sendRequest.body, 'sendEvents payload must match the recorded fixture');
            },
            async stream(sessionId) {
              assert.equal(sessionId, sendRequest.session_id, 'streamEvents session id must match the recorded fixture');
              return (async function* () {
                for (const record of streamEvents) yield record.event;
              }());
            },
          },
        },
      },
    };
  };

  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'fixture-test-key';
  const harness = loadClientWithSdkStub(fakeAnthropic);
  try {
    const sessionClient = harness.client;
    const sessionId = await sessionClient.createSession(
      createRequest.body.agent,
      createRequest.body.environment_id,
    );
    assert.equal(sessionId, createResponse.body.id, 'createSession returns the recorded session id');

    await sessionClient.sendEvents(sendRequest.session_id, sendRequest.body.events);

    const streamed = [];
    for await (const event of sessionClient.streamEvents(sendRequest.session_id)) {
      streamed.push(event);
    }
    assert.deepEqual(
      streamed,
      streamEvents.map((record) => record.event),
      'streamEvents must replay the recorded fixture',
    );
  } finally {
    harness.restore();
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
