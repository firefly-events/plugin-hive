# Form Factor Decision — Task-Tracking Adapter ABI

## Summary

**Selected form factor: CLI contract** — chosen for lowest user-facing complexity (any language, no TS build toolchain), direct fit to Hive's existing CLI-mediated invocation model, and strongest pluggability for custom adapter authors. MCP receives a mandatory dual sketch per AC §5 (three tied axes), and must be revisited if persistent-IPC performance becomes a gate in a later story.

---

## Evaluation Rubric

Scores are 1–5; 5 = best fit for Hive's needs.

---

### Axis 1: Pluggability

How easy is it for a third party to add a new adapter? Lower friction = higher score.

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| TS interface | 2 | Author must write TypeScript, compile to ESM/CJS, publish as npm package or local module. Build toolchain required. Dynamic import pattern not yet in Hive. |
| MCP server | 4 | Author writes any language, exposes JSON-RPC over stdio. MCP SDKs exist for TS, Python, Go, Rust. Hive side needs a persistent MCP client — not yet built, but well-specified. |
| CLI contract | 4 | Author writes any language, implements a single executable that accepts a JSON payload on stdin and writes JSON to stdout. Zero Hive-side infrastructure required beyond `spawnSync`. |

**Tied: MCP and CLI both score 4.**

---

### Axis 2: Cross-process boundary

Does the form factor provide process isolation (crash in adapter cannot crash Hive)?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| TS interface | 1 | In-process. An unhandled exception or an infinite loop in the adapter can bring down the Hive process. No isolation. |
| MCP server | 5 | Out-of-process by design. Crash in MCP server is caught at transport layer. Hive retains control. |
| CLI contract | 5 | Out-of-process by design. Each invocation is an isolated child process. Crash surfaces as non-zero exit code. |

**Tied: MCP and CLI both score 5.**

---

### Axis 3: Hive-side invocation cost

Measured benchmark values (Node v25.9.0, macOS, all figures from live bench or authoritative IPC estimate):

| Invocation path | Latency | Source |
|-----------------|---------|--------|
| In-process TS function call | 0.39 ns | Live bench, Node v25.9.0 |
| MCP persistent IPC round-trip | ~0.1–0.5 ms | Authoritative estimate (Node IPC over pipe) |
| MCP cold spawn + initialize + call | ~62–70 ms | Spawn (52ms) + init (~10ms) + call (~0.5ms) |
| CLI subprocess spawn (Node spawnSync) | 52.4 ms | Live bench, Node v25.9.0, spawnSync, N=20 |

Notes:
- Story YAML cited "~10ms subprocess spawn"; measured reality on macOS Node v25 is **52.4ms**. Lighter runtimes (Go single binary) may approach 10–20ms.
- Task-tracking calls are user-paced (createStory, updateStatus). At human interaction cadence, 52ms per call is imperceptible.
- MCP persistent server amortizes spawn cost across calls; CLI does not. If call volume is high (batch operations), MCP persistent IPC wins on throughput.

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| TS interface | 5 | 0.39 ns — effectively free. Irrelevant at human interaction cadence but unambiguously best. |
| MCP server | 4 | 0.1–0.5ms persistent (excellent); 62–70ms cold (acceptable). Persistent mode requires Hive to manage MCP client lifecycle. |
| CLI contract | 3 | 52ms per call. Imperceptible at human cadence; becomes a concern at >20 calls/session in automated mode. |

---

### Axis 4: User-facing complexity

What does a custom adapter author actually write? Lower cognitive load = higher score.

#### TS interface adapter stub (10–15 lines)

```typescript
// my-tracker-adapter.ts
import type { TaskTrackingAdapter } from "hive/adapter-abi";

export const adapter: TaskTrackingAdapter = {
  capabilities: {
    hierarchy: "flat",
    supports_parent_link: false,
    metadata: { team_field: null, project_field: "board" },
  },

  async createStory({ title, body, labels, parent_id }) {
    const issue = await myTrackerClient.issues.create({ title, body, labels });
    return { id: issue.id, url: issue.url };
  },
};
```

Author must: install Hive as a dependency (or type-only peer), compile TypeScript, register module path in hive.config.yaml. Dynamic import dispatch not yet built in Hive — this is **currently unimplementable** without new infrastructure.

#### MCP server adapter stub (10–15 lines)

```python
# my_tracker_adapter/server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
import json, sys

app = Server("my-tracker-adapter")

@app.tool()
async def create_story(title: str, body: str, labels: list[str], parent_id: str | None = None):
    issue = my_tracker.create(title=title, body=body, labels=labels)
    return {"id": issue.id, "url": issue.url}

if __name__ == "__main__":
    stdio_server(app)
```

Author must: implement MCP JSON-RPC protocol (or use an SDK), expose capability declaration as a resource or tool, register server command in hive.config.yaml. Hive must manage persistent MCP client — **not yet built**.

#### CLI contract adapter stub (10–15 lines)

```bash
#!/usr/bin/env bash
# my-tracker-adapter
# Reads JSON payload from stdin, writes JSON result to stdout.
set -euo pipefail

payload=$(cat)
method=$(echo "$payload" | jq -r '.method')

if [[ "$method" == "capabilities" ]]; then
  echo '{"hierarchy":"flat","supports_parent_link":false,"metadata":{"team_field":null,"project_field":"board"}}'
elif [[ "$method" == "createStory" ]]; then
  title=$(echo "$payload" | jq -r '.params.title')
  id=$(my-tracker-cli create --title "$title" --json | jq -r '.id')
  echo "{\"id\":\"$id\",\"url\":\"https://tracker.example.com/issues/$id\"}"
fi
```

Author must: write any executable (bash, Python, Go, etc.), handle `capabilities` and `createStory` methods, register executable path in hive.config.yaml. No build toolchain, no SDK, no Hive dependency.

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| TS interface | 2 | Requires TS toolchain, Hive type dependency, ESM/CJS configuration. High friction for non-TS authors. |
| MCP server | 3 | MCP SDKs reduce boilerplate, but protocol understanding required. Hive client lifecycle not yet built. |
| CLI contract | 5 | Any language, any runtime, minimal ceremony. stdin/stdout JSON is the lowest common denominator. |

---

### Axis 5: Hierarchy-agnostic carry

How cleanly does each form factor express flat / hierarchical / mixed capability?

#### Capability declaration stub — TS interface

```typescript
capabilities: {
  hierarchy: "mixed",           // "flat" | "hierarchical" | "mixed"
  supports_parent_link: true,
  metadata: {
    team_field: "owner",        // GitHub owner
    project_field: "project",   // GitHub Project board
  },
},
```

#### Capability declaration stub — MCP resource

```json
{
  "uri": "hive://adapter/capabilities",
  "content": {
    "hierarchy": "mixed",
    "supports_parent_link": true,
    "metadata": {
      "team_field": "owner",
      "project_field": "project"
    }
  }
}
```

#### Capability declaration stub — CLI `capabilities` method

```json
{
  "hierarchy": "mixed",
  "supports_parent_link": true,
  "metadata": {
    "team_field": "owner",
    "project_field": "project"
  }
}
```

All three form factors express the enum cleanly. GitHub requires `"mixed"` (flat issues + hierarchical Projects); using an enum (not a boolean) is mandatory. Linear uses `"hierarchical"`. Atoshell-if-revisited uses `"flat"`.

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| TS interface | 5 | Static typing enforces enum; compile-time error if wrong value. |
| MCP server | 4 | JSON schema validation at tool registration; no compile-time check. |
| CLI contract | 4 | JSON schema validated at runtime by Hive dispatcher; clear contract. |

**Tied: MCP and CLI both score 4.**

---

## Aggregate Scores

| Axis | TS | MCP | CLI | Tied? |
|------|-----|-----|-----|-------|
| 1. Pluggability | 2 | 4 | 4 | MCP = CLI |
| 2. Cross-process boundary | 1 | 5 | 5 | MCP = CLI |
| 3. Hive-side invocation cost | 5 | 4 | 3 | — |
| 4. User-facing complexity | 2 | 3 | 5 | — |
| 5. Hierarchy-agnostic carry | 5 | 4 | 4 | MCP = CLI |
| **Total** | **15** | **20** | **21** | |

---

## Decision

**Selected form factor: CLI contract**

**Rationale:**

1. CLI scores highest overall (21 vs MCP 20 vs TS 15).
2. CLI's winning margin is Axis 4 (user-facing complexity: 5 vs MCP's 3). This axis is the most consequential for adoption — a single-file bash or Python script with no dependencies is the lowest barrier for custom adapter authors.
3. CLI matches Hive's existing invocation model (linearis shell commands). No new Hive infrastructure is required — `spawnSync` already exists conceptually in the codebase pattern.
4. TS interface is eliminated at Axis 2 (no process isolation) and Axis 4 (TS toolchain required) and because dispatch infrastructure does not yet exist in Hive.
5. MCP is competitive (20 points) but loses on Axis 4 and requires Hive to manage persistent MCP client lifecycle — infrastructure not yet built.

**Tied-axis handling per AC §5:**

Three axes are tied between MCP and CLI (Axes 1, 2, 5). AC §5 requires a mandatory dual sketch when three or more axes tie between two candidates. Both CLI and MCP sketches are provided in `hive/references/task-tracking-adapter-abi-sketch.md`. The CLI sketch is the primary input to c-2 specification; the MCP sketch is retained for reference and for potential future migration if persistent-IPC performance becomes a gate.

**When to revisit MCP:**
- If batch-operation story (not currently in scope) requires >20 ABI calls per session.
- If a future adapter ecosystem emerges where MCP SDK support provides materially lower integration burden than CLI stdin/stdout.

---

## Rework risk

**Severity: High** (per epic risks §1)

Risk: CLI chosen but MCP would have been better — e.g., if a c-3/c-4 implementation reveals that 52ms per call blocks automated story-creation loops.

Mitigation:
- MCP dual sketch is preserved and spec-complete (see ABI sketch document).
- ABI method signatures are form-factor-neutral — `createStory(params) → result` shape works for both CLI and MCP.
- If migration to MCP is needed after c-3/c-4, Hive-side dispatcher is the only change; adapter authors keep the same JSON contract.
- 52ms at human cadence is imperceptible. Automated loops calling >20 stories/session are out of scope for 2.0.
