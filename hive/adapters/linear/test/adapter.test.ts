// Integration tests for the Linear adapter — ABI 1.0.0
//
// Default: uses an in-process mock fetch to validate request shape + response mapping
// without hitting Linear's GraphQL API. Set LINEAR_API_KEY + LINEAR_TEST_TEAM to
// additionally exercise the real API for happy-path methods.
//
// Run: cd hive/adapters/linear && npm test

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setFetch,
  __resetCache,
  dispatch,
  mapGraphqlError,
  toAbiStory,
  toAbiStorySubset,
  validateStoryId,
  AdapterError,
} from "../index.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fetch infrastructure
// ──────────────────────────────────────────────────────────────────────────────

interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

type MockHandler = (url: string, init: any) => MockResponse | Promise<MockResponse>;

let mockHandler: MockHandler | null = null;
const recordedRequests: Array<{ url: string; init: any; payload: any }> = [];

function installMockFetch() {
  recordedRequests.length = 0;
  const mock = async (url: any, init: any) => {
    const u = typeof url === "string" ? url : url.toString();
    let payload: any = null;
    if (init?.body) {
      try {
        payload = JSON.parse(init.body);
      } catch {
        payload = init.body;
      }
    }
    recordedRequests.push({ url: u, init, payload });
    if (!mockHandler) throw new Error(`no mock handler for ${u}`);
    const resp = await mockHandler(u, init);
    const headers = new Headers(resp.headers ?? {});
    const text = resp.body === undefined ? "" : JSON.stringify(resp.body);
    return {
      status: resp.status,
      headers,
      text: async () => text,
    } as any;
  };
  __setFetch(mock as any);
}

// Standard team metadata response — shared by tests that need it.
const TEAM_METADATA_BODY = {
  data: {
    teams: {
      nodes: [
        {
          id: "team-uuid-abc",
          key: "ACME",
          states: {
            nodes: [
              { id: "state-backlog", name: "Backlog", type: "backlog" },
              { id: "state-todo", name: "Todo", type: "unstarted" },
              { id: "state-progress", name: "In Progress", type: "started" },
              { id: "state-done", name: "Done", type: "completed" },
              { id: "state-canceled", name: "Canceled", type: "canceled" },
            ],
          },
          labels: {
            nodes: [
              { id: "label-bug", name: "bug" },
              { id: "label-enh", name: "enhancement" },
            ],
          },
        },
      ],
    },
  },
};

before(() => {
  if (!process.env.LINEAR_API_KEY) process.env.LINEAR_API_KEY = "test-key";
  if (!process.env.LINEAR_TEAM) process.env.LINEAR_TEAM = "ACME";
  installMockFetch();
});

after(() => {
  __setFetch(globalThis.fetch);
});

beforeEach(() => {
  __resetCache();
  mockHandler = null;
  recordedRequests.length = 0;
});

// ──────────────────────────────────────────────────────────────────────────────
// validateStoryId
// ──────────────────────────────────────────────────────────────────────────────

describe("validateStoryId", () => {
  it("accepts TEAM-123 format", () => {
    assert.doesNotThrow(() => validateStoryId("ACME-1"));
    assert.doesNotThrow(() => validateStoryId("ACME-42"));
    assert.doesNotThrow(() => validateStoryId("ACME-9999"));
    assert.doesNotThrow(() => validateStoryId("A-1"));
    assert.doesNotThrow(() => validateStoryId("ABC_DEF-7"));
  });

  it("rejects malformed ids", () => {
    assert.throws(() => validateStoryId("acme-1"), AdapterError);
    assert.throws(() => validateStoryId("ACME-abc"), AdapterError);
    assert.throws(() => validateStoryId("ACME"), AdapterError);
    assert.throws(() => validateStoryId("-7"), AdapterError);
    assert.throws(() => validateStoryId(""), AdapterError);
    assert.throws(() => validateStoryId("ACME 1"), AdapterError);
    assert.throws(() => validateStoryId(null as any), AdapterError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mapGraphqlError
// ──────────────────────────────────────────────────────────────────────────────

describe("mapGraphqlError", () => {
  it("401 → AUTH_FAILURE regardless of body code", () => {
    const r = mapGraphqlError(401, {}, [{ message: "Authentication required" }]);
    assert.equal(r.error.code, "AUTH_FAILURE");
  });

  it("AUTHENTICATION_ERROR extension code → AUTH_FAILURE", () => {
    const r = mapGraphqlError(
      200,
      {},
      [{ message: "Bad token", extensions: { code: "AUTHENTICATION_ERROR" } }]
    );
    assert.equal(r.error.code, "AUTH_FAILURE");
  });

  it("RATELIMITED with X-RateLimit-Requests-Reset header → RATE_LIMIT", () => {
    const future = Date.now() + 5000;
    const r = mapGraphqlError(
      200,
      { "X-RateLimit-Requests-Reset": String(future) },
      [{ message: "rate limited", extensions: { code: "RATELIMITED" } }]
    );
    assert.equal(r.error.code, "RATE_LIMIT");
    assert.ok(r.error.retry_after_ms! > 0);
    assert.ok(r.error.retry_after_ms! <= 5000);
  });

  it("RATELIMITED on HTTP 400 still maps", () => {
    const r = mapGraphqlError(
      400,
      {},
      [{ message: "rate limited", extensions: { code: "RATELIMITED" } }]
    );
    assert.equal(r.error.code, "RATE_LIMIT");
  });

  it("RATELIMITED falls back to extensions.reset", () => {
    const future = Date.now() + 3000;
    const r = mapGraphqlError(
      200,
      {},
      [{ message: "rate limited", extensions: { code: "RATELIMITED", reset: future } }]
    );
    assert.equal(r.error.code, "RATE_LIMIT");
    assert.ok(r.error.retry_after_ms! > 0);
  });

  it("ENTITY_NOT_FOUND → NOT_FOUND", () => {
    const r = mapGraphqlError(
      200,
      {},
      [{ message: "missing", extensions: { code: "ENTITY_NOT_FOUND" } }]
    );
    assert.equal(r.error.code, "NOT_FOUND");
  });

  it("message containing 'not found' → NOT_FOUND", () => {
    const r = mapGraphqlError(200, {}, [{ message: "Issue not found" }]);
    assert.equal(r.error.code, "NOT_FOUND");
  });

  it("other GraphQL error → UNKNOWN_METHOD", () => {
    const r = mapGraphqlError(200, {}, [{ message: "Something else" }]);
    assert.equal(r.error.code, "UNKNOWN_METHOD");
  });

  it("accepts Headers instance and plain object", () => {
    const h = new Headers({ "X-RateLimit-Requests-Reset": String(Date.now() + 2000) });
    const r = mapGraphqlError(
      200,
      h,
      [{ message: "rate", extensions: { code: "RATELIMITED" } }]
    );
    assert.equal(r.error.code, "RATE_LIMIT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Shape mapping
// ──────────────────────────────────────────────────────────────────────────────

describe("toAbiStory / toAbiStorySubset", () => {
  it("toAbiStory flattens nested labels and parent identifier", () => {
    const issue = {
      identifier: "ACME-5",
      title: "T",
      description: "D",
      state: { name: "In Progress", type: "started" },
      labels: { nodes: [{ name: "bug" }, { name: "enhancement" }] },
      parent: { identifier: "ACME-1" },
      url: "https://linear.app/acme/issue/ACME-5",
    };
    const out = toAbiStory(issue);
    assert.equal(out.id, "ACME-5");
    assert.equal(out.body, "D");
    assert.equal(out.state, "In Progress");
    assert.deepEqual(out.labels, ["bug", "enhancement"]);
    assert.equal(out.parent_id, "ACME-1");
  });

  it("toAbiStorySubset omits body and parent_id", () => {
    const issue = {
      identifier: "ACME-5",
      title: "T",
      state: { name: "Todo" },
      labels: { nodes: [] },
      url: "u",
    };
    const out = toAbiStorySubset(issue);
    assert.equal(out.id, "ACME-5");
    assert.equal((out as any).body, undefined);
    assert.equal((out as any).parent_id, undefined);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Method dispatch
// ──────────────────────────────────────────────────────────────────────────────

describe("capabilities", () => {
  it("returns dynamic states + labels when LINEAR_TEAM is set", async () => {
    mockHandler = () => ({ status: 200, body: TEAM_METADATA_BODY });
    const r = await dispatch({ method: "capabilities", params: {} });
    assert.equal(r.abi_version, "1.0.0");
    assert.equal(r.hierarchy, "hierarchical");
    assert.equal(r.supports_parent_link, true);
    assert.deepEqual(r.supported_states, [
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
      "Canceled",
    ]);
    assert.deepEqual(r.supported_labels, ["bug", "enhancement"]);
    assert.equal(r.metadata.team_field, "teamId");
    assert.equal(r.metadata.project_field, "projectId");
  });

  it("falls back to default states when LINEAR_TEAM unset", async () => {
    const saved = process.env.LINEAR_TEAM;
    delete process.env.LINEAR_TEAM;
    try {
      mockHandler = () => ({ status: 200, body: { data: {} } });
      const r = await dispatch({ method: "capabilities", params: {} });
      assert.deepEqual(r.supported_states, [
        "Backlog",
        "Todo",
        "In Progress",
        "Done",
        "Canceled",
      ]);
      assert.equal(r.supported_labels, null);
    } finally {
      process.env.LINEAR_TEAM = saved;
    }
  });
});

describe("createStory", () => {
  it("happy path resolves labels, posts issueCreate, returns id+url", async () => {
    let call = 0;
    mockHandler = (url, init) => {
      call += 1;
      const payload = JSON.parse(init.body);
      if (call === 1) {
        assert.match(payload.query, /TeamMetadata/);
        return { status: 200, body: TEAM_METADATA_BODY };
      }
      assert.match(payload.query, /IssueCreate/);
      assert.equal(payload.variables.input.teamId, "team-uuid-abc");
      assert.equal(payload.variables.input.title, "Test");
      assert.deepEqual(payload.variables.input.labelIds, ["label-enh"]);
      return {
        status: 200,
        body: {
          data: {
            issueCreate: {
              success: true,
              issue: {
                identifier: "ACME-7",
                url: "https://linear.app/acme/issue/ACME-7",
              },
            },
          },
        },
      };
    };
    const r = await dispatch({
      method: "createStory",
      params: { title: "Test", body: "B", labels: ["enhancement"] },
    });
    assert.equal(r.id, "ACME-7");
    assert.equal(r.url, "https://linear.app/acme/issue/ACME-7");
    assert.equal(call, 2);
  });

  it("with parent_id resolves UUID and passes parentId", async () => {
    let phase = 0;
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      phase += 1;
      if (payload.query.includes("TeamMetadata")) {
        return { status: 200, body: TEAM_METADATA_BODY };
      }
      if (payload.query.includes("Issue($id")) {
        // resolveIssueUuid
        return { status: 200, body: { data: { issue: { id: "parent-uuid" } } } };
      }
      assert.match(payload.query, /IssueCreate/);
      assert.equal(payload.variables.input.parentId, "parent-uuid");
      return {
        status: 200,
        body: {
          data: {
            issueCreate: {
              success: true,
              issue: { identifier: "ACME-8", url: "u" },
            },
          },
        },
      };
    };
    const r = await dispatch({
      method: "createStory",
      params: { title: "X", body: "Y", labels: [], parent_id: "ACME-1" },
    });
    assert.equal(r.id, "ACME-8");
    assert.ok(phase >= 3);
  });

  it("401 surfaces AUTH_FAILURE", async () => {
    mockHandler = () => ({ status: 401, body: { message: "Bad token" } });
    await assert.rejects(
      dispatch({
        method: "createStory",
        params: { title: "T", body: "B", labels: [] },
      }),
      (e: AdapterError) => e.code === "AUTH_FAILURE"
    );
  });
});

describe("updateStatus", () => {
  it("resolves state name + issue uuid, sends issueUpdate", async () => {
    let phase = 0;
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      phase += 1;
      if (payload.query.includes("TeamMetadata")) {
        return { status: 200, body: TEAM_METADATA_BODY };
      }
      if (payload.query.includes("Issue($id")) {
        return { status: 200, body: { data: { issue: { id: "issue-uuid-7" } } } };
      }
      assert.match(payload.query, /IssueUpdate/);
      assert.equal(payload.variables.id, "issue-uuid-7");
      assert.equal(payload.variables.input.stateId, "state-done");
      return {
        status: 200,
        body: {
          data: {
            issueUpdate: {
              success: true,
              issue: {
                identifier: "ACME-7",
                title: "T",
                description: "B",
                state: { name: "Done", type: "completed" },
                labels: { nodes: [{ name: "bug" }] },
                parent: null,
                url: "u",
              },
            },
          },
        },
      };
    };
    const r = await dispatch({
      method: "updateStatus",
      params: { id: "ACME-7", state: "Done" },
    });
    assert.equal(r.id, "ACME-7");
    assert.equal(r.state, "Done");
    assert.deepEqual(r.labels, ["bug"]);
    assert.equal(r.parent_id, null);
    assert.equal(phase, 3);
  });

  it("unknown state name → OPERATION_UNSUPPORTED", async () => {
    mockHandler = () => ({ status: 200, body: TEAM_METADATA_BODY });
    await assert.rejects(
      dispatch({
        method: "updateStatus",
        params: { id: "ACME-7", state: "BogusState" },
      }),
      (e: AdapterError) => e.code === "OPERATION_UNSUPPORTED"
    );
  });

  it("invalid story id → NOT_FOUND", async () => {
    mockHandler = () => ({ status: 200, body: TEAM_METADATA_BODY });
    await assert.rejects(
      dispatch({
        method: "updateStatus",
        params: { id: "acme-7", state: "Done" },
      }),
      (e: AdapterError) => e.code === "NOT_FOUND"
    );
  });
});

describe("listOpen", () => {
  it("filters by team + open states and returns subset shape", async () => {
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      assert.match(payload.query, /ListOpen/);
      assert.equal(payload.variables.teamKey, "ACME");
      return {
        status: 200,
        body: {
          data: {
            issues: {
              nodes: [
                {
                  identifier: "ACME-10",
                  title: "First",
                  state: { name: "Todo" },
                  labels: { nodes: [] },
                  url: "u10",
                },
                {
                  identifier: "ACME-11",
                  title: "Second",
                  state: { name: "In Progress" },
                  labels: { nodes: [{ name: "bug" }] },
                  url: "u11",
                },
              ],
            },
          },
        },
      };
    };
    const r = await dispatch({ method: "listOpen", params: {} });
    assert.equal(r.stories.length, 2);
    assert.equal(r.stories[0].id, "ACME-10");
    assert.equal((r.stories[0] as any).body, undefined);
    assert.equal((r.stories[0] as any).parent_id, undefined);
    assert.deepEqual(r.stories[1].labels, ["bug"]);
  });

  it("respects limit", async () => {
    mockHandler = () => ({
      status: 200,
      body: {
        data: {
          issues: {
            nodes: Array.from({ length: 5 }, (_, i) => ({
              identifier: `ACME-${i + 1}`,
              title: `t${i}`,
              state: { name: "Todo" },
              labels: { nodes: [] },
              url: "u",
            })),
          },
        },
      },
    });
    const r = await dispatch({ method: "listOpen", params: { limit: 2 } });
    assert.equal(r.stories.length, 2);
  });
});

describe("getStory", () => {
  it("returns full story shape", async () => {
    mockHandler = () => ({
      status: 200,
      body: {
        data: {
          issue: {
            identifier: "ACME-42",
            title: "Big one",
            description: "details",
            state: { name: "In Progress", type: "started" },
            labels: { nodes: [{ name: "bug" }] },
            parent: { identifier: "ACME-1" },
            url: "https://linear.app/acme/issue/ACME-42",
          },
        },
      },
    });
    const r = await dispatch({ method: "getStory", params: { id: "ACME-42" } });
    assert.equal(r.id, "ACME-42");
    assert.equal(r.body, "details");
    assert.equal(r.parent_id, "ACME-1");
  });

  it("ENTITY_NOT_FOUND surfaces NOT_FOUND", async () => {
    mockHandler = () => ({
      status: 200,
      body: {
        errors: [{ message: "missing", extensions: { code: "ENTITY_NOT_FOUND" } }],
      },
    });
    await assert.rejects(
      dispatch({ method: "getStory", params: { id: "ACME-999" } }),
      (e: AdapterError) => e.code === "NOT_FOUND"
    );
  });

  it("malformed id rejected without hitting fetch", async () => {
    mockHandler = () => {
      throw new Error("should not be called");
    };
    await assert.rejects(
      dispatch({ method: "getStory", params: { id: "not-an-id" } }),
      (e: AdapterError) => e.code === "NOT_FOUND"
    );
  });
});

describe("addComment", () => {
  it("resolves issue uuid then creates comment", async () => {
    let phase = 0;
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      phase += 1;
      if (payload.query.includes("Issue($id")) {
        return { status: 200, body: { data: { issue: { id: "issue-uuid-7" } } } };
      }
      assert.match(payload.query, /CommentCreate/);
      assert.equal(payload.variables.input.issueId, "issue-uuid-7");
      assert.equal(payload.variables.input.body, "hello");
      return {
        status: 200,
        body: {
          data: {
            commentCreate: { success: true, comment: { id: "comment-uuid-1" } },
          },
        },
      };
    };
    const r = await dispatch({
      method: "addComment",
      params: { id: "ACME-7", body: "hello" },
    });
    assert.equal(r.comment_id, "comment-uuid-1");
    assert.equal(phase, 2);
  });

  it("RATELIMITED with reset header surfaces RATE_LIMIT", async () => {
    const future = Date.now() + 3000;
    mockHandler = () => ({
      status: 200,
      headers: { "X-RateLimit-Requests-Reset": String(future) },
      body: {
        errors: [{ message: "rate", extensions: { code: "RATELIMITED" } }],
      },
    });
    await assert.rejects(
      dispatch({ method: "addComment", params: { id: "ACME-7", body: "x" } }),
      (e: AdapterError) => e.code === "RATE_LIMIT" && (e.retry_after_ms ?? 0) > 0
    );
  });
});

describe("linkStories", () => {
  it("makes single mutation after resolving parent + child UUIDs", async () => {
    let issueLookups = 0;
    let mutations = 0;
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      if (payload.query.includes("Issue($id")) {
        issueLookups += 1;
        const which = payload.variables.id;
        return {
          status: 200,
          body: { data: { issue: { id: `${which}-uuid` } } },
        };
      }
      mutations += 1;
      assert.match(payload.query, /IssueUpdate/);
      assert.equal(payload.variables.id, "ACME-8-uuid");
      assert.equal(payload.variables.input.parentId, "ACME-3-uuid");
      return {
        status: 200,
        body: { data: { issueUpdate: { success: true } } },
      };
    };
    const r = await dispatch({
      method: "linkStories",
      params: { parent_id: "ACME-3", child_id: "ACME-8" },
    });
    assert.deepEqual(r, {});
    assert.equal(issueLookups, 2);
    assert.equal(mutations, 1);
  });
});

describe("setAssignee", () => {
  it("passes assignee_id through after UUID resolution", async () => {
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      if (payload.query.includes("Issue($id")) {
        return { status: 200, body: { data: { issue: { id: "issue-uuid-7" } } } };
      }
      assert.equal(payload.variables.id, "issue-uuid-7");
      assert.equal(payload.variables.input.assigneeId, "user-uuid-alice");
      return { status: 200, body: { data: { issueUpdate: { success: true } } } };
    };
    const r = await dispatch({
      method: "setAssignee",
      params: { id: "ACME-7", assignee_id: "user-uuid-alice" },
    });
    assert.deepEqual(r, {});
  });

  it("null clears assignee", async () => {
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      if (payload.query.includes("Issue($id")) {
        return { status: 200, body: { data: { issue: { id: "issue-uuid-7" } } } };
      }
      assert.equal(payload.variables.input.assigneeId, null);
      return { status: 200, body: { data: { issueUpdate: { success: true } } } };
    };
    await dispatch({
      method: "setAssignee",
      params: { id: "ACME-7", assignee_id: null },
    });
  });
});

describe("dispatch", () => {
  it("unknown method → UNKNOWN_METHOD", async () => {
    mockHandler = () => ({ status: 200, body: { data: {} } });
    await assert.rejects(
      dispatch({ method: "nonexistent", params: {} }),
      (e: AdapterError) => e.code === "UNKNOWN_METHOD"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Team metadata caching — within one subprocess
// ──────────────────────────────────────────────────────────────────────────────

describe("team metadata caching", () => {
  it("caches across handler calls within the same subprocess", async () => {
    let metadataFetches = 0;
    let issueLookups = 0;
    mockHandler = (_url, init) => {
      const payload = JSON.parse(init.body);
      if (payload.query.includes("TeamMetadata")) {
        metadataFetches += 1;
        return { status: 200, body: TEAM_METADATA_BODY };
      }
      if (payload.query.includes("Issue($id")) {
        issueLookups += 1;
        return { status: 200, body: { data: { issue: { id: "issue-uuid" } } } };
      }
      if (payload.query.includes("IssueUpdate")) {
        return {
          status: 200,
          body: {
            data: {
              issueUpdate: {
                success: true,
                issue: {
                  identifier: "ACME-7",
                  title: "t",
                  description: "d",
                  state: { name: "Done", type: "completed" },
                  labels: { nodes: [] },
                  parent: null,
                  url: "u",
                },
              },
            },
          },
        };
      }
      return { status: 200, body: { data: {} } };
    };

    await dispatch({ method: "updateStatus", params: { id: "ACME-7", state: "Done" } });
    await dispatch({ method: "updateStatus", params: { id: "ACME-7", state: "Done" } });
    await dispatch({ method: "capabilities", params: {} });

    assert.equal(metadataFetches, 1, "team metadata should be fetched once and cached");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Optional: real-API tests gated on LINEAR_TEST_TEAM=<team-key>
// ──────────────────────────────────────────────────────────────────────────────

const REAL_TEAM = process.env.LINEAR_TEST_TEAM;
const REAL_KEY = process.env.LINEAR_API_KEY;
const RUN_REAL = REAL_TEAM && REAL_KEY && REAL_KEY !== "test-key";
if (RUN_REAL) {
  describe("real API (gated on LINEAR_TEST_TEAM)", () => {
    before(() => {
      __setFetch(globalThis.fetch);
      process.env.LINEAR_TEAM = REAL_TEAM!;
    });
    after(() => {
      installMockFetch();
    });

    it("capabilities is callable", async () => {
      const r = await dispatch({ method: "capabilities", params: {} });
      assert.equal(r.abi_version, "1.0.0");
      assert.equal(r.hierarchy, "hierarchical");
    });
  });
}
