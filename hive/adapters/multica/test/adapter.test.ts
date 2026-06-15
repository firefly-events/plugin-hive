// Integration tests for the Multica adapter — ABI 1.1.0
//
// Spawns the adapter as a child process, feeding JSON on stdin and asserting
// JSON on stdout + exit code. Uses a mock HTTP server (node:http) on an
// ephemeral port to simulate Multica — no live daemon required.
//
// Run: cd hive/adapters/multica && npm test

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as cp from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_PATH = path.resolve(__dirname, "../index.ts");

// ──────────────────────────────────────────────────────────────────────────────
// Mock server infrastructure
// ──────────────────────────────────────────────────────────────────────────────

const WORKSPACE_UUID = "ws-uuid-1234";
const WORKSPACE_SLUG = "plugin-hive";
const ISSUE_UUID = "issue-uuid-5678";
const ISSUE_IDENTIFIER = "PLU-1";
const COMMENT_UUID = "comment-uuid-9012";

type MockHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void;

let mockHandler: MockHandler | null = null;
let serverUrl = "";
let server: http.Server;

function defaultHandler(req: http.IncomingMessage, res: http.ServerResponse, body: string): void {
  const url = req.url ?? "";

  // GET /api/workspaces — return workspace list
  if (req.method === "GET" && url === "/api/workspaces") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ id: WORKSPACE_UUID, slug: WORKSPACE_SLUG }]));
    return;
  }

  // POST /api/issues?workspace_id=... — create issue
  if (req.method === "POST" && url.startsWith(`/api/issues?workspace_id=`)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: ISSUE_UUID,
        identifier: "PLU-42",
        title: "T",
        description: "B",
        status: "todo",
        labels: ["hive:ready"],
        parent_issue_id: null,
      }),
    );
    return;
  }

  // GET /api/issues?workspace_id=...&identifier=... — resolve issue uuid
  if (req.method === "GET" && url.includes("/api/issues?workspace_id=") && url.includes("identifier=")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify([
        {
          id: ISSUE_UUID,
          identifier: ISSUE_IDENTIFIER,
          title: "Existing issue",
          status: "todo",
        },
      ]),
    );
    return;
  }

  // PUT /api/issues/:uuid?workspace_id=... — update issue status
  if (req.method === "PUT" && url.includes(`/api/issues/${ISSUE_UUID}`)) {
    let parsed: any = {};
    try { parsed = JSON.parse(body); } catch { /* empty */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: ISSUE_UUID,
        identifier: ISSUE_IDENTIFIER,
        status: parsed.status ?? "done",
      }),
    );
    return;
  }

  // POST /api/issues/:uuid/comments?workspace_id=... — add comment
  if (req.method === "POST" && url.includes(`/api/issues/${ISSUE_UUID}/comments`)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: COMMENT_UUID, content: "test comment" }));
    return;
  }

  // GET /api/issues/:uuid/timeline?workspace_id=... — squad activity
  if (req.method === "GET" && url.includes(`/api/issues/${ISSUE_UUID}/timeline`)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        entries: [
          {
            type: "comment",
            action: "created",
            actor_type: "member",
            actor_id: "member-old",
            created_at: "2026-01-01T00:00:00Z",
            details: {},
          },
          {
            type: "activity",
            action: "squad_leader_evaluated",
            actor_type: "agent",
            actor_id: "agent-uuid-abc",
            created_at: "2026-06-10T12:00:00Z",
            details: { outcome: "action", reason: "Story meets acceptance criteria" },
          },
          {
            type: "activity",
            action: "squad_leader_evaluated",
            actor_type: "agent",
            actor_id: "agent-uuid-xyz",
            created_at: "2026-06-09T08:00:00Z",
            details: { outcome: "no_action", reason: null },
          },
        ],
        next_cursor: null,
      }),
    );
    return;
  }

  // GET /api/issues/:uuid/timeline — GET /api/issues/:uuid/timeline (bare UUID path, no match above)
  // Fallback — 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `No mock for ${req.method} ${url}` }));
}

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          if (mockHandler) {
            mockHandler(req, res, body);
          } else {
            defaultHandler(req, res, body);
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Helper: spawn adapter + feed stdin
// ──────────────────────────────────────────────────────────────────────────────

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runAdapter(
  request: object,
  overrideEnv: Record<string, string | undefined> = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
      ),
      MULTICA_SERVER_URL: serverUrl,
      MULTICA_TOKEN: "test-token",
      ...Object.fromEntries(
        Object.entries(overrideEnv).filter(([, v]) => v !== undefined) as [string, string][],
      ),
    };
    // Remove undefined overrides (used to unset keys)
    for (const [k, v] of Object.entries(overrideEnv)) {
      if (v === undefined) delete env[k];
    }

    const child = cp.spawn("npx", ["tsx", ADAPTER_PATH], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// AC1: createStory — happy path
// ──────────────────────────────────────────────────────────────────────────────
describe("AC1: createStory", () => {
  it("returns id=plugin-hive/PLU-42 and url on stdout, exit 0", async () => {
    const result = await runAdapter({
      method: "createStory",
      params: { title: "T", body: "B", labels: ["hive:ready"] },
    });

    assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.result, "Response must have 'result' key");
    assert.ok(
      typeof parsed.result.id === "string" && parsed.result.id.startsWith("plugin-hive/PLU-"),
      `id should be 'plugin-hive/PLU-N', got: ${parsed.result.id}`,
    );
    assert.ok(
      typeof parsed.result.url === "string" && parsed.result.url.includes("/plugin-hive/issues/"),
      `url should include workspace/issues path, got: ${parsed.result.url}`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC2: updateStory — transitions status to 'done'
// ──────────────────────────────────────────────────────────────────────────────
describe("AC2: updateStory", () => {
  it("returns {id, status:'done'} on stdout, exit 0", async () => {
    const result = await runAdapter({
      method: "updateStory",
      params: { id: "plugin-hive/PLU-1", status: "done" },
    });

    assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.result, "Response must have 'result' key");
    assert.ok(
      typeof parsed.result.id === "string",
      `result.id must be a string, got: ${JSON.stringify(parsed.result.id)}`,
    );
    assert.strictEqual(parsed.result.status, "done", `status must be 'done', got: ${parsed.result.status}`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC3: addComment — response includes comment_id
// ──────────────────────────────────────────────────────────────────────────────
describe("AC3: addComment", () => {
  it("returns response with comment_id, exit 0", async () => {
    const result = await runAdapter({
      method: "addComment",
      params: { id: "plugin-hive/PLU-1", body: "A test comment from Hive" },
    });

    assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.result, "Response must have 'result' key");
    assert.ok(
      typeof parsed.result.comment_id === "string" && parsed.result.comment_id.length > 0,
      `result.comment_id must be a non-empty string, got: ${JSON.stringify(parsed.result.comment_id)}`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC4: AUTH_FAILURE — missing PAT
// ──────────────────────────────────────────────────────────────────────────────
describe("AC4: AUTH_FAILURE", () => {
  it("exits 1 with AUTH_FAILURE and stderr explanation when token absent", async () => {
    // Use a temporary HOME with no config.json so the adapter cannot fall back
    // to ~/.multica/config.json for credentials.
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "multica-test-no-auth-"));
    let result;
    try {
      result = await runAdapter(
        { method: "createStory", params: { title: "T" } },
        {
          MULTICA_TOKEN: undefined,
          MULTICA_SERVER_URL: serverUrl,
          HOME: tmpHome,
          USERPROFILE: tmpHome, // Windows compat guard
        },
      );
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }

    assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, "Response must have 'error' key");
    assert.strictEqual(
      parsed.error.code,
      "AUTH_FAILURE",
      `Expected AUTH_FAILURE, got: ${parsed.error.code}`,
    );
    assert.ok(
      result.stderr.length > 0 || parsed.error.message.length > 0,
      "stderr or error.message should explain how to fix auth",
    );
  });

  it("exits 1 with AUTH_FAILURE when server returns 401", async () => {
    // Intercept ALL paths — workspace lookup AND issue create — with 401
    mockHandler = (_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Unauthorized" }));
    };

    try {
      // Use tmpHome to block config.json fallback, ensuring fresh workspace lookup
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "multica-test-no-auth-"));
      let result;
      try {
        result = await runAdapter(
          { method: "createStory", params: { title: "T" } },
          { MULTICA_TOKEN: "invalid-token", HOME: tmpHome, USERPROFILE: tmpHome },
        );
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }

      assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.error, "Response must have 'error' key");
      assert.strictEqual(parsed.error.code, "AUTH_FAILURE");
    } finally {
      mockHandler = null;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC5: UNKNOWN_METHOD — unsupported method
// ──────────────────────────────────────────────────────────────────────────────
describe("AC5: UNKNOWN_METHOD", () => {
  it("exits 1 with UNKNOWN_METHOD for unsupported method", async () => {
    const result = await runAdapter({ method: "deleteEverything", params: {} });

    assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, "Response must have 'error' key");
    assert.strictEqual(
      parsed.error.code,
      "UNKNOWN_METHOD",
      `Expected UNKNOWN_METHOD, got: ${parsed.error.code}`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC7: getSquadActivity — happy path (most recent eval returned)
// ──────────────────────────────────────────────────────────────────────────────
describe("AC7: getSquadActivity — happy path", () => {
  it("returns most recent squad_leader_evaluated entry, exit 0", async () => {
    const result = await runAdapter({
      method: "getSquadActivity",
      params: { id: "plugin-hive/PLU-1" },
    });

    assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.result, "Response must have 'result' key");
    assert.strictEqual(parsed.result.actor_type, "agent");
    assert.strictEqual(parsed.result.actor_id, "agent-uuid-abc");
    assert.strictEqual(parsed.result.outcome, "action");
    assert.strictEqual(parsed.result.reason, "Story meets acceptance criteria");
    assert.strictEqual(parsed.result.created_at, "2026-06-10T12:00:00Z");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC8: getSquadActivity — empty timeline → null
// ──────────────────────────────────────────────────────────────────────────────
describe("AC8: getSquadActivity — no eval activity returns null", () => {
  it("returns null when no squad_leader_evaluated entries exist, exit 0", async () => {
    mockHandler = (req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/api/workspaces") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: WORKSPACE_UUID, slug: WORKSPACE_SLUG }]));
        return;
      }
      if (req.method === "GET" && url.includes("/api/issues?workspace_id=") && url.includes("identifier=")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: ISSUE_UUID, identifier: ISSUE_IDENTIFIER, title: "T", status: "todo" }]));
        return;
      }
      if (req.method === "GET" && url.includes(`/api/issues/${ISSUE_UUID}/timeline`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ entries: [], next_cursor: null }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: `No mock for ${req.method} ${url}` }));
    };

    try {
      const result = await runAdapter({
        method: "getSquadActivity",
        params: { id: "plugin-hive/PLU-1" },
      });

      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.ok("result" in parsed, "Response must have 'result' key");
      assert.strictEqual(parsed.result, null, `Expected null, got: ${JSON.stringify(parsed.result)}`);
    } finally {
      mockHandler = null;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC9: getSquadActivity — auth failure on timeline fetch
// ──────────────────────────────────────────────────────────────────────────────
describe("AC9: getSquadActivity — AUTH_FAILURE on timeline fetch", () => {
  it("exits 1 with AUTH_FAILURE when timeline endpoint returns 401", async () => {
    mockHandler = (req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/api/workspaces") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: WORKSPACE_UUID, slug: WORKSPACE_SLUG }]));
        return;
      }
      if (req.method === "GET" && url.includes("/api/issues?workspace_id=") && url.includes("identifier=")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: ISSUE_UUID, identifier: ISSUE_IDENTIFIER, title: "T", status: "todo" }]));
        return;
      }
      if (req.method === "GET" && url.includes(`/api/issues/${ISSUE_UUID}/timeline`)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Unauthorized" }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: `No mock for ${req.method} ${url}` }));
    };

    try {
      const result = await runAdapter({
        method: "getSquadActivity",
        params: { id: "plugin-hive/PLU-1" },
      });

      assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.error, "Response must have 'error' key");
      assert.strictEqual(parsed.error.code, "AUTH_FAILURE");
    } finally {
      mockHandler = null;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getSquadActivity — malformed outcome → TRANSPORT
// ──────────────────────────────────────────────────────────────────────────────
describe("getSquadActivity — malformed outcome rejected", () => {
  function timelineMock(details: unknown): MockHandler {
    return (req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/api/workspaces") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: WORKSPACE_UUID, slug: WORKSPACE_SLUG }]));
        return;
      }
      if (req.method === "GET" && url.includes("/api/issues?workspace_id=") && url.includes("identifier=")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: ISSUE_UUID, identifier: ISSUE_IDENTIFIER, title: "T", status: "todo" }]));
        return;
      }
      if (req.method === "GET" && url.includes(`/api/issues/${ISSUE_UUID}/timeline`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ entries: [{
          type: "activity",
          action: "squad_leader_evaluated",
          actor_type: "agent",
          actor_id: "agent-uuid-abc",
          created_at: "2026-06-10T12:00:00Z",
          details,
        }], next_cursor: null }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: `No mock for ${req.method} ${url}` }));
    };
  }

  for (const [label, details] of [
    ["unknown enum", { outcome: "bogus", reason: "x" }],
    ["missing outcome", { reason: "no outcome" }],
  ] as const) {
    it(`exits 1 with TRANSPORT for ${label}`, async () => {
      mockHandler = timelineMock(details);
      try {
        const result = await runAdapter({
          method: "getSquadActivity",
          params: { id: "plugin-hive/PLU-1" },
        });
        assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}. stderr: ${result.stderr}`);
        const parsed = JSON.parse(result.stdout);
        assert.ok(parsed.error, "Response must have 'error' key");
        assert.strictEqual(parsed.error.code, "TRANSPORT");
      } finally {
        mockHandler = null;
      }
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AC6: RATE_LIMIT — 429 response
// ──────────────────────────────────────────────────────────────────────────────
describe("AC6: RATE_LIMIT", () => {
  it("exits 1 with RATE_LIMIT and retry_after_ms from Retry-After header", async () => {
    // Intercept ALL paths with 429 so the adapter hits it regardless of whether
    // workspace_id was cached from ~/.multica/config.json.
    mockHandler = (_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "30" });
      res.end(JSON.stringify({ message: "Too many requests" }));
    };

    try {
      // Use tmpHome to force a fresh workspace lookup via the mock server
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "multica-test-no-auth-"));
      let result;
      try {
        result = await runAdapter(
          { method: "createStory", params: { title: "T", body: "B", labels: [] } },
          { HOME: tmpHome, USERPROFILE: tmpHome },
        );
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }

      assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);

      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.error, "Response must have 'error' key");
      assert.strictEqual(
        parsed.error.code,
        "RATE_LIMIT",
        `Expected RATE_LIMIT, got: ${parsed.error.code}`,
      );
      assert.strictEqual(
        parsed.error.retry_after_ms,
        30000,
        `retry_after_ms should be 30000 (30s * 1000), got: ${parsed.error.retry_after_ms}`,
      );
    } finally {
      mockHandler = null;
    }
  });

  it("exits 1 with RATE_LIMIT and retry_after_ms=null when Retry-After header absent", async () => {
    // Intercept ALL paths with 429 (no Retry-After header)
    mockHandler = (_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Too many requests" }));
    };

    try {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "multica-test-no-auth-"));
      let result;
      try {
        result = await runAdapter(
          { method: "createStory", params: { title: "T", body: "B", labels: [] } },
          { HOME: tmpHome, USERPROFILE: tmpHome },
        );
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }

      assert.strictEqual(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);

      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.error, "Response must have 'error' key");
      assert.strictEqual(parsed.error.code, "RATE_LIMIT");
      assert.strictEqual(
        parsed.error.retry_after_ms,
        null,
        `retry_after_ms should be null when header absent, got: ${parsed.error.retry_after_ms}`,
      );
    } finally {
      mockHandler = null;
    }
  });
});
