// Integration tests for the GitHub adapter — ABI 1.0.0
//
// Default: uses an in-process mock fetch to validate request shape + response mapping
// without hitting the live API. Set GITHUB_TEST_REPO=<owner>/<repo> to additionally
// exercise the real GitHub API for happy-path methods.
//
// Run: cd hive/adapters/github && npm test
//        (requires `tsx` for TypeScript loader)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  __setFetch,
  dispatch,
  encodeStoryId,
  decodeStoryId,
  mapHttpError,
  AdapterError,
} from "../index.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fetch infrastructure
// ──────────────────────────────────────────────────────────────────────────────

type MockResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: any;
};

type MockHandler = (url: string, init: any) => MockResponse | Promise<MockResponse>;

let mockHandler: MockHandler | null = null;
const recordedRequests: Array<{ url: string; init: any }> = [];

function installMockFetch() {
  recordedRequests.length = 0;
  const mock = async (url: any, init: any) => {
    const u = typeof url === "string" ? url : url.toString();
    recordedRequests.push({ url: u, init });
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

before(() => {
  // Ensure the adapter has a token in mock mode (avoid `gh auth token` shell-out).
  if (!process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = "test-token";
  installMockFetch();
});

after(() => {
  __setFetch(globalThis.fetch);
});

// ──────────────────────────────────────────────────────────────────────────────
// ID encode / decode
// ──────────────────────────────────────────────────────────────────────────────

describe("ID encode/decode", () => {
  it("round-trips owner/repo#number", () => {
    const id = encodeStoryId("firefly-events", "plugin-hive", 42);
    assert.equal(id, "firefly-events/plugin-hive#42");
    const decoded = decodeStoryId(id);
    assert.deepEqual(decoded, {
      owner: "firefly-events",
      repo: "plugin-hive",
      number: 42,
    });
  });

  it("rejects malformed ids", () => {
    assert.throws(() => decodeStoryId("not-a-real-id"), AdapterError);
    assert.throws(() => decodeStoryId("owner/repo"), AdapterError);
    assert.throws(() => decodeStoryId("owner#42"), AdapterError);
  });

  it("preserves hyphens and dots", () => {
    const id = encodeStoryId("my-org", "my.repo", 7);
    assert.deepEqual(decodeStoryId(id), {
      owner: "my-org",
      repo: "my.repo",
      number: 7,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mapHttpError — tri-modal rate-limit + auth/404
// ──────────────────────────────────────────────────────────────────────────────

describe("mapHttpError", () => {
  it("401 → AUTH_FAILURE", () => {
    const e = mapHttpError(401, {}, { message: "Bad credentials" });
    assert.equal(e.code, "AUTH_FAILURE");
    assert.equal(e.retry_after_ms, null);
  });

  it("404 → NOT_FOUND", () => {
    const e = mapHttpError(404, {}, { message: "Not Found" });
    assert.equal(e.code, "NOT_FOUND");
  });

  it("429 → RATE_LIMIT with retry_after_ms", () => {
    const e = mapHttpError(429, { "retry-after": "5" }, { message: "Too many" });
    assert.equal(e.code, "RATE_LIMIT");
    assert.equal(e.retry_after_ms, 5000);
  });

  it("403 + x-ratelimit-remaining:0 → RATE_LIMIT (primary)", () => {
    const future = Math.floor(Date.now() / 1000) + 30;
    const e = mapHttpError(
      403,
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(future) },
      { message: "rate limit exceeded" }
    );
    assert.equal(e.code, "RATE_LIMIT");
    assert.ok(e.retry_after_ms! > 0);
  });

  it("403 + retry-after → RATE_LIMIT (secondary)", () => {
    const e = mapHttpError(403, { "retry-after": "60" }, { message: "abuse" });
    assert.equal(e.code, "RATE_LIMIT");
    assert.equal(e.retry_after_ms, 60000);
  });

  it("403 alone → AUTH_FAILURE", () => {
    const e = mapHttpError(403, {}, { message: "Forbidden" });
    assert.equal(e.code, "AUTH_FAILURE");
  });

  it("422 → UNKNOWN_METHOD (friction-noted)", () => {
    const e = mapHttpError(422, {}, { message: "Validation Failed" });
    assert.equal(e.code, "UNKNOWN_METHOD");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Dispatch tests — capabilities + 7 methods
// ──────────────────────────────────────────────────────────────────────────────

describe("capabilities", () => {
  it("returns ABI 1.0.0 mixed adapter shape", async () => {
    mockHandler = () => ({ status: 200, body: {} }); // never called
    const r = await dispatch({ method: "capabilities", params: {} });
    assert.equal(r.abi_version, "1.0.0");
    assert.equal(r.hierarchy, "mixed");
    assert.equal(r.supports_parent_link, true);
    assert.deepEqual(r.supported_states, ["open", "closed"]);
    assert.equal(r.supported_labels, null);
    assert.equal(r.metadata.team_field, "owner");
    assert.equal(r.metadata.project_field, "repo");
  });
});

describe("createStory", () => {
  it("happy path posts to /issues and returns id+url", async () => {
    mockHandler = (url, init) => {
      assert.match(url, /\/repos\/acme\/widgets\/issues$/);
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.title, "Test");
      return {
        status: 201,
        body: { number: 7, html_url: "https://github.com/acme/widgets/issues/7" },
      };
    };
    const r = await dispatch({
      method: "createStory",
      params: {
        title: "Test",
        body: "Body",
        labels: ["bug"],
        team_value: "acme",
        project_value: "widgets",
      },
    });
    assert.equal(r.id, "acme/widgets#7");
    assert.equal(r.url, "https://github.com/acme/widgets/issues/7");
  });

  it("401 surfaces AUTH_FAILURE", async () => {
    mockHandler = () => ({ status: 401, body: { message: "Bad credentials" } });
    await assert.rejects(
      dispatch({
        method: "createStory",
        params: {
          title: "T",
          body: "B",
          labels: [],
          team_value: "acme",
          project_value: "widgets",
        },
      }),
      (e: AdapterError) => e.code === "AUTH_FAILURE"
    );
  });
});

describe("updateStatus", () => {
  it("happy path PATCHes state and returns full story", async () => {
    mockHandler = (url, init) => {
      assert.match(url, /\/repos\/acme\/widgets\/issues\/7$/);
      assert.equal(init.method, "PATCH");
      assert.equal(JSON.parse(init.body).state, "closed");
      return {
        status: 200,
        body: {
          number: 7,
          title: "T",
          body: "B",
          state: "closed",
          labels: [{ name: "bug" }],
          html_url: "https://github.com/acme/widgets/issues/7",
        },
      };
    };
    const r = await dispatch({
      method: "updateStatus",
      params: { id: "acme/widgets#7", state: "closed" },
    });
    assert.equal(r.id, "acme/widgets#7");
    assert.equal(r.state, "closed");
    assert.deepEqual(r.labels, ["bug"]);
    assert.equal(r.parent_id, null);
  });

  it("rejects unsupported state with OPERATION_UNSUPPORTED", async () => {
    mockHandler = () => ({ status: 200, body: {} });
    await assert.rejects(
      dispatch({
        method: "updateStatus",
        params: { id: "acme/widgets#7", state: "in_progress" },
      }),
      (e: AdapterError) => e.code === "OPERATION_UNSUPPORTED"
    );
  });
});

describe("listOpen", () => {
  it("filters out pull_request entries", async () => {
    mockHandler = () => ({
      status: 200,
      body: [
        {
          number: 10,
          title: "Real issue",
          state: "open",
          labels: [],
          html_url: "https://github.com/acme/widgets/issues/10",
        },
        {
          number: 11,
          title: "Pull request",
          state: "open",
          labels: [],
          pull_request: { url: "..." },
          html_url: "https://github.com/acme/widgets/pull/11",
        },
        {
          number: 12,
          title: "Another issue",
          state: "open",
          labels: ["enh"],
          html_url: "https://github.com/acme/widgets/issues/12",
        },
      ],
    });
    const r = await dispatch({
      method: "listOpen",
      params: { team_value: "acme", project_value: "widgets" },
    });
    assert.equal(r.stories.length, 2);
    assert.equal(r.stories[0].id, "acme/widgets#10");
    assert.equal(r.stories[1].id, "acme/widgets#12");
    // subset shape: no body, no parent_id
    assert.equal((r.stories[0] as any).body, undefined);
    assert.equal((r.stories[0] as any).parent_id, undefined);
  });

  it("respects limit", async () => {
    mockHandler = () => ({
      status: 200,
      body: Array.from({ length: 5 }, (_, i) => ({
        number: i + 1,
        title: `t${i}`,
        state: "open",
        labels: [],
        html_url: "x",
      })),
    });
    const r = await dispatch({
      method: "listOpen",
      params: { limit: 2, team_value: "acme", project_value: "widgets" },
    });
    assert.equal(r.stories.length, 2);
  });
});

describe("getStory", () => {
  it("returns full story shape", async () => {
    mockHandler = () => ({
      status: 200,
      body: {
        number: 42,
        title: "x",
        body: "y",
        state: "open",
        labels: [{ name: "bug" }],
        html_url: "https://github.com/acme/widgets/issues/42",
        sub_issue_of: {
          number: 10,
          repository: { owner: { login: "acme" }, name: "widgets" },
        },
      },
    });
    const r = await dispatch({
      method: "getStory",
      params: { id: "acme/widgets#42" },
    });
    assert.equal(r.id, "acme/widgets#42");
    assert.equal(r.parent_id, "acme/widgets#10");
    assert.equal(r.body, "y");
  });

  it("404 → NOT_FOUND", async () => {
    mockHandler = () => ({ status: 404, body: { message: "Not Found" } });
    await assert.rejects(
      dispatch({ method: "getStory", params: { id: "acme/widgets#999" } }),
      (e: AdapterError) => e.code === "NOT_FOUND"
    );
  });
});

describe("addComment", () => {
  it("POSTs and returns comment_id", async () => {
    mockHandler = (url, init) => {
      assert.match(url, /\/issues\/7\/comments$/);
      assert.equal(JSON.parse(init.body).body, "hello");
      return { status: 201, body: { id: 1234567 } };
    };
    const r = await dispatch({
      method: "addComment",
      params: { id: "acme/widgets#7", body: "hello" },
    });
    assert.equal(r.comment_id, "1234567");
  });

  it("429 surfaces RATE_LIMIT with retry_after_ms", async () => {
    mockHandler = () => ({
      status: 429,
      headers: { "retry-after": "3" },
      body: { message: "Too Many" },
    });
    await assert.rejects(
      dispatch({
        method: "addComment",
        params: { id: "acme/widgets#7", body: "x" },
      }),
      (e: AdapterError) => e.code === "RATE_LIMIT" && e.retry_after_ms === 3000
    );
  });
});

describe("linkStories", () => {
  it("makes 2 calls: GET child then POST sub_issues", async () => {
    let call = 0;
    mockHandler = (url, init) => {
      call += 1;
      if (call === 1) {
        // GET child issue to resolve integer id
        assert.match(url, /\/repos\/acme\/widgets\/issues\/8$/);
        return { status: 200, body: { id: 99999, number: 8 } };
      } else {
        assert.match(url, /\/repos\/acme\/widgets\/issues\/3\/sub_issues$/);
        assert.equal(init.method, "POST");
        assert.equal(JSON.parse(init.body).sub_issue_id, 99999);
        return { status: 201, body: {} };
      }
    };
    const r = await dispatch({
      method: "linkStories",
      params: { parent_id: "acme/widgets#3", child_id: "acme/widgets#8" },
    });
    assert.deepEqual(r, {});
    assert.equal(call, 2);
  });
});

describe("setAssignee", () => {
  it("wraps single assignee_id in array", async () => {
    mockHandler = (url, init) => {
      assert.equal(init.method, "PATCH");
      assert.deepEqual(JSON.parse(init.body).assignees, ["alice"]);
      return { status: 200, body: {} };
    };
    const r = await dispatch({
      method: "setAssignee",
      params: { id: "acme/widgets#7", assignee_id: "alice" },
    });
    assert.deepEqual(r, {});
  });

  it("null clears assignees", async () => {
    mockHandler = (url, init) => {
      assert.deepEqual(JSON.parse(init.body).assignees, []);
      return { status: 200, body: {} };
    };
    await dispatch({
      method: "setAssignee",
      params: { id: "acme/widgets#7", assignee_id: null },
    });
  });
});

describe("dispatch", () => {
  it("unknown method → UNKNOWN_METHOD", async () => {
    mockHandler = () => ({ status: 200, body: {} });
    await assert.rejects(
      dispatch({ method: "nonexistent", params: {} }),
      (e: AdapterError) => e.code === "UNKNOWN_METHOD"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Optional: real-API tests gated on GITHUB_TEST_REPO=<owner>/<repo>
// ──────────────────────────────────────────────────────────────────────────────

const REAL = process.env.GITHUB_TEST_REPO;
if (REAL) {
  describe("real API (gated on GITHUB_TEST_REPO)", () => {
    let testIssueId: string | null = null;
    const [owner, repo] = REAL.split("/");

    before(() => {
      // Switch back to real fetch for live tests.
      __setFetch(globalThis.fetch);
    });
    after(() => {
      installMockFetch();
    });

    it("capabilities is callable", async () => {
      const r = await dispatch({ method: "capabilities", params: {} });
      assert.equal(r.abi_version, "1.0.0");
    });

    it("createStory + getStory + updateStatus round-trip", async () => {
      const created = await dispatch({
        method: "createStory",
        params: {
          title: "[hive-adapter test] " + new Date().toISOString(),
          body: "Created by adapter integration test. Safe to close.",
          labels: [],
          team_value: owner,
          project_value: repo,
        },
      });
      testIssueId = created.id;
      const got = await dispatch({ method: "getStory", params: { id: created.id } });
      assert.equal(got.id, created.id);
      const closed = await dispatch({
        method: "updateStatus",
        params: { id: created.id, state: "closed" },
      });
      assert.equal(closed.state, "closed");
    });
  });
}
