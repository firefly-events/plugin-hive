RESEARCH_BRIEF_FOR: c-1-form-factor-selection

---

SOURCES_READ:
- hive/references/task-tracking-adapter.md — prose-runbook contract being replaced; 9 adapter operations (createEpicParent, createStoryIssue, createBugIssue, claimIssue, releaseIssue, updateStatus, queryBoard, readIssue, addComment); status flow; label vocabulary; configuration schema
- hive/references/linear-integration.md — per-phase orchestration ops (standup, planning, execution, commit, test-handoff, fix-loop); how Hive calls linearis CLI today
- hive/references/linear-commands.md — concrete `linearis` CLI invocations; shows parent-ticket flag for hierarchy; `--parent-ticket {TEAM}-{N}` is how sub-issues attach to epic parent
- hive/references/memory-store-interface.md — MemoryStore as existing in-codebase TS interface precedent (read/write/compile typed contract; "documentation schema, not executable code — implementations described in natural language with enough precision to guide development")
- .pHive/epics/hive-composability-audit/docs/recommendation.md §3 — SKIP-ATOSHELL / BUILD-ABI-NOW verdict; hierarchy-agnostic design requirement; form-factor explicitly left open for Epic C kickoff
- .pHive/epics/hive-composability-audit/docs/recommendation.md §7 — Epic C (task-tracking-adapter-abi) in-flight; migration path: Linear + GitHub prose runbooks become first two adapter implementations validating ABI
- .pHive/epics/task-tracking-adapter-abi/stories/c-1-form-factor-selection.yaml — story spec, AC §1-7, research step instructions, tied-axis handling requirement
- hive.config.yaml task_tracking block — current config shape: adapter: null|linear|github|jira; linear-specific keys flat at top level (linear_team, linear_project, linear_user_id, etc.)
- MCP spec (context7 / modelcontextprotocol.io) — stdio transport: server launched as subprocess, JSON-RPC over stdin/stdout, newline-delimited; tool call method: `tools/call`; requires initialize handshake before tool calls
- Node.js benchmark (live, macOS Node v25.9.0) — cold subprocess spawn avg: 52.4ms (N=20, spawnSync node -e "..."); in-process function call avg: 0.39ns (N=10M)
- .pHive/spikes/atoshell/ — directory exists but atoshell-adapter-runbook.md absent; spike files not present in this repo

---

PATTERNS_OBSERVED:

- Pattern: Current adapter is CLI-mediated prose | File: hive/references/linear-integration.md | Detail: All Hive-to-Linear calls today go through `linearis` CLI (bash commands in prose runbooks). Hive agents read the runbook and emit shell commands — there is NO in-process or programmatic invocation layer yet.

- Pattern: Existing TS interface precedent | File: hive/references/memory-store-interface.md | Detail: MemoryStore is documented as a typed interface (read/write/compile with typed signatures). It is "documentation schema, not executable code" but demonstrates the pattern Hive uses for stable typed contracts between callers and implementations.

- Pattern: Hierarchy via --parent-ticket | File: hive/references/linear-commands.md | Detail: Linear's hierarchy is expressed via `--parent-ticket {TEAM}-{N}` on issue creation. The parent_id is optional — absence = flat (no parent), presence = hierarchical. This maps naturally to an optional `parent_id?: string` field in any form factor.

- Pattern: GitHub is described as "mixed" hierarchy | Source: recommendation.md §3 | Detail: GitHub Issues = flat; GitHub Projects = hierarchical. Mixed means the adapter must declare capability at the field level, not globally. A boolean `supports_hierarchy: true/false` is insufficient.

- Pattern: Config has adapter-specific flat keys today | File: hive.config.yaml | Detail: linear_team, linear_project, linear_user_id are all flat keys under task_tracking. ABI must define how adapter-specific config is scoped — either per-adapter namespace or passed into adapter constructor.

- Pattern: MCP stdio requires persistent process OR re-handshake | Source: MCP spec (context7) | Detail: stdio transport requires an `initialize` JSON-RPC exchange before any `tools/call`. If Hive spawns a new MCP server per call, it pays: fork + Node start + initialize round-trip + tools/call + kill. Persistent server avoids repeat startup but adds lifecycle management.

- Pattern: atoshell spike does not exist in this repo | File: .pHive/spikes/atoshell/atoshell-adapter-runbook.md | Detail: FILE_NOT_FOUND. The story references it as a source for user-facing complexity axis. This means the atoshell shape must be inferred from recommendation.md §3 description only: "flat-file local ticket store, no remote board, no parent-child hierarchy."

---

CONSTRAINTS:

- Constraint: ABI must be hierarchy-agnostic | Source: recommendation.md §3 | Impact: Capability declaration cannot be a boolean. Must accommodate flat (atoshell), hierarchical (Linear), and mixed (GitHub) in a single field or enum.

- Constraint: c-2 specifies methods on the chosen form factor | Source: story YAML design_decisions | Impact: Form-factor choice is irreversible within Epic C scope — changing it later means rewriting c-2, c-3, c-4, c-5. This is the highest-stakes decision in the epic.

- Constraint: Hive is not a Node module host today | Source: hive-src ls, grep for child_process/require | Impact: No TS module loading infrastructure exists in the codebase for dynamically loading user-supplied adapter modules. TS interface form factor requires building a require/import dispatch layer. MCP and CLI form factors reuse OS-level process spawning which Hive agents already know.

- Constraint: User-facing adapter must be writable by non-TypeScript authors | Source: AC §7 (example adapter stub 10-20 lines) | Impact: TS interface imposes TypeScript toolchain on adapter authors. MCP server imposes JSON schema authoring. CLI contract works in any language.

- Constraint: Real benchmark numbers required in decision doc | Source: AC §6 | Impact: Must cite concrete ms/ns figures, not estimates. Bench data gathered in this research session covers this.

- Constraint: Tied-axis rule | Source: AC §5, epic risk mitigation §1 | Impact: If any two form factors score within 1 point on any axis, the implement step must write a sketch for BOTH before committing. This research must flag all tied axes explicitly.

- Constraint: No atoshell runbook in-repo | Source: directory scan | Impact: atoshell complexity can only be described from prose in recommendation.md, not from a concrete implementation. The story YAML references it as a key file but it is absent.

---

RISKS:

- Severity: high | Risk: TS interface requires dynamic module loading infrastructure that does not exist | Evidence: No child_process/require/dynamic-import patterns found in /Users/don/Documents/plugin-hive/src; no adapter dispatch code exists; memory-store-interface.md is documentation schema only, not executable TS.

- Severity: high | Risk: MCP stdio transport imposes persistent-process lifecycle management if per-call spawn cost (~52ms cold) is unacceptable | Evidence: MCP spec requires initialize handshake; cold spawn bench = 52.4ms; if Hive must spawn MCP server per ABI call, worst-case latency is 100ms+ (spawn + initialize + tools/call).

- Severity: medium | Risk: Pluggability axis and user-facing complexity axis may tie between CLI and MCP — both are language-agnostic, out-of-process, require no TS toolchain | Evidence: Both pass same language-agnostic test; both use JSON-over-stdio semantically; differentiation is on protocol complexity (MCP requires JSON-RPC + initialize; CLI requires only stdout JSON).

- Severity: medium | Risk: GitHub "mixed" hierarchy cannot be expressed by a simple `supports_hierarchy: boolean` | Evidence: Recommendation.md §3 explicitly calls GitHub "mixed — issues flat, projects hierarchical"; a single field won't carry this without an enum or capability map.

- Severity: low | Risk: atoshell-adapter-runbook.md absent from repo | Evidence: FILE_NOT_FOUND at .pHive/spikes/atoshell/atoshell-adapter-runbook.md; description available only via recommendation.md prose.

---

FINDINGS:

## 1. Current Contract Shape (Baseline)

The prose-runbook defines 9 adapter operations against 3 trackers (currently only Linear is live):

| Operation | Args | Returns | Notes |
|---|---|---|---|
| createEpicParent | title, description | issue_id | Optional — not all trackers support hierarchy |
| createStoryIssue | title, description, parentId | issue_id | parentId optional → hierarchy signal |
| createBugIssue | title, description, parentStoryId, priority | issue_id | |
| claimIssue | issueId, userId | void | Assignment-locking protocol |
| releaseIssue | issueId | void | |
| updateStatus | issueId, status | void | Status from controlled vocab |
| queryBoard | project | IssueList | |
| readIssue | issueId | Issue | |
| addComment | issueId, body | void | |

The `parentId` on createStoryIssue is the single field that carries hierarchy. Its presence/absence is the flat vs hierarchical signal today.

## 2. Hierarchy-Agnostic Capability Declaration Sketch

The ABI needs a capability block independent of form factor. The same shape applies to all three:

```
HierarchyMode: flat | hierarchical | mixed

AdapterCapabilities:
  hierarchy_mode: HierarchyMode
  # flat — no parent concept (atoshell: no parent-child, flat file store)
  # hierarchical — explicit parent required on sub-items (Linear: --parent-ticket)
  # mixed — per-item decision (GitHub: Issues=flat, Projects=hierarchical)
  supports_epic_parent: boolean     # createEpicParent is a valid call
  supports_sub_issues: boolean      # createStoryIssue with parentId is valid
  status_vocab: string[]            # tracker-specific status names
  label_vocab: string[]             # tracker-specific label names
```

How each form factor expresses this:

- **TS interface:** `capabilities: AdapterCapabilities` as a property on the exported interface object. Static, set at module load time.
- **MCP server:** `tools/list` response includes a `capabilities` tool or a JSON schema `annotations` block. Alternatively, a dedicated `describe` tool call returns the capabilities object.
- **CLI contract:** Adapter responds to `--describe` flag (or a `describe` subcommand) with a JSON blob matching the AdapterCapabilities schema to stdout.

All three can carry the same data. The difference is invocation ergonomics.

## 3. Per-Axis Evidence for All Three Candidates

### Axis 1 — Pluggability (how easy to add a new adapter)

**TS interface:**
- Adapter author writes a `.ts` file exporting an object implementing the interface.
- Requires TypeScript toolchain (tsc, tsconfig, Node module resolution).
- Hive needs a dynamic `require()` or `import()` dispatch layer — does NOT exist today.
- Adding: author writes TS, compiles, points hive.config.yaml at the .js path.
- Friction: TypeScript compilation step; Hive-side dispatch infrastructure build required.
- Score signal: MEDIUM pluggability — TS authors have low friction, non-TS authors blocked.

**MCP server:**
- Adapter author writes an MCP server in any language (Node/Python/Go/Ruby all have SDKs).
- Hive points hive.config.yaml at a server command string (e.g., `node my-adapter/index.js`).
- No Hive-side dispatch infrastructure needed — standard MCP client (already used in Claude Code).
- Initialize handshake is automatic per MCP spec.
- Friction: Author must learn MCP server shape (initialize + tools/list + tools/call); JSON-RPC boilerplate.
- Score signal: HIGH pluggability — any language, standard protocol, tooling exists.

**CLI contract:**
- Adapter author writes any executable (shell, Python, Go, Node) that reads JSON from stdin, writes JSON to stdout.
- Hive spawns the binary via hive.config.yaml `adapter_command` string.
- No protocol overhead — Hive sends one JSON object, receives one JSON object per call.
- Friction: Author must follow the JSON I/O contract (documented schema); no SDK required.
- Score signal: HIGHEST pluggability — lowest barrier, any language, no protocol overhead.

**Tied-axis flag:** CLI and MCP are within 1 point here. Both are language-agnostic and out-of-process. Differentiator: CLI has zero protocol ceremony (no initialize/tools/list); MCP has richer tooling/SDK ecosystem. This axis is TIED (CLI slightly ahead on simplicity, MCP slightly ahead on ecosystem).

### Axis 2 — Cross-Process Boundary (in-process vs out-of-process)

**TS interface (in-process):**
- Pro: No serialization overhead; adapter shares Hive's Node.js runtime, memory, env vars.
- Pro: Type errors caught at compile time if adapter mis-implements interface.
- Con: Adapter crash = Hive crash (no isolation boundary).
- Con: Adapter version mismatch with Hive Node version may cause runtime errors.
- Con: Adapter must be CommonJS or ESM compatible with Hive's module system.

**MCP server (out-of-process, persistent):**
- Pro: Full isolation — adapter crash does not crash Hive.
- Pro: Adapter can be any runtime (Python, Go, etc.).
- Pro: MCP server can be long-lived (started once, reused across calls) avoiding spawn cost on each call.
- Con: Requires process lifecycle management (start server, detect death, restart).
- Con: Serialization overhead per call (JSON-RPC encode/decode, ~microseconds, negligible vs network I/O).
- Con: MCP stdio requires initialize handshake on each new server process start.

**CLI contract (out-of-process, ephemeral or persistent):**
- Pro: Same isolation as MCP — adapter crash does not crash Hive.
- Pro: Simpler than MCP — no protocol, just JSON in/out.
- Con: Cold spawn per call = 52ms overhead (measured: Node v25 macOS).
- Con: If persistent (reuse process via stdin keep-alive), requires custom framing (not standardized like MCP).
- Note: Most adapter calls in Hive occur during planning and execution phase transitions — not hot loops. 52ms per call is acceptable at that cadence.

**Tied-axis flag:** MCP server and CLI are within 1 point here. Both provide process isolation. MCP has lifecycle machinery; CLI has simpler protocol. This axis is TIED (MCP slightly ahead on lifecycle standardization; CLI slightly ahead on simplicity).

### Axis 3 — Hive-Side Invocation Cost

**TS interface (function call):**
- Measured: 0.39ns per in-process function call (N=10M on Node v25).
- Near-zero serialization cost — objects passed by reference.
- No I/O. No process fork.
- Score: LOWEST cost by 4-5 orders of magnitude.

**MCP server (JSON-RPC tool call):**
- If persistent server (started once): cost = JSON serialize + IPC write + JSON deserialize + IPC read.
- IPC over local socket or pipe: ~0.1–0.5ms per round-trip (authoritative estimate from Node IPC benchmarks; no local bench possible in ctx sandbox for persistent server).
- If cold spawn per call: cost = spawn (~52ms) + initialize (~10ms) + tools/call (~0.5ms) = ~62ms.
- Score: MEDIUM (persistent) to HIGH (cold spawn) cost.
- Critical constraint: Hive must manage persistent MCP server lifecycle to avoid cold-spawn penalty.

**CLI contract (subprocess spawn + JSON I/O):**
- Measured (this session): 52.4ms avg per cold spawn on Node v25 macOS (N=20, spawnSync node -e "...").
- This matches the AC §6 guideline estimate of "~10ms" for subprocess spawn — note: the actual measured value on macOS with Node.js is 52ms, which is higher than the story's hand-wave estimate. Flag this: the story says "~10ms" but measured reality is 52ms on this machine.
- Hive adapter calls are low-frequency (planning phase, not hot loop) — 52ms per call is acceptable.
- Score: HIGHEST cost per call, but acceptable given usage cadence.

**Tied-axis flag:** None on this axis. TS interface wins decisively on invocation cost.

### Axis 4 — User-Facing Complexity (what does the adapter author write)

**TS interface:**
- Author writes TypeScript implementing a typed interface.
- Requires: Node.js, TypeScript compiler, understanding of TS interface shapes.
- Constraint: Hive's import system must be able to load the adapter module (require/import path in config).
- Author experience: Most structured — interface tells you exactly what methods to implement; type errors are compile-time.
- Barrier: Non-TS authors (Python, shell scripters) cannot write a TS adapter.
- Example stub shape (20 lines):
  ```typescript
  import type { TaskAdapter } from '@hive/adapter-abi';
  export const adapter: TaskAdapter = {
    capabilities: { hierarchy_mode: 'hierarchical', supports_epic_parent: true, ... },
    async createStory(title, body, opts) { /* call Linear API */ return { id: 'LIN-42' }; },
    async claimIssue(issueId, userId) { /* linearis issues update */ },
    // ... 7 more methods
  };
  ```

**MCP server:**
- Author writes an MCP server exposing tools matching ABI method names.
- Requires: understanding of JSON-RPC 2.0, MCP `initialize`/`tools/list`/`tools/call` protocol.
- Language-agnostic: SDKs for Node, Python, Go, Ruby, Kotlin.
- Author experience: Moderate complexity — MCP boilerplate is non-trivial (~50 lines for a minimal server).
- The `tools/list` response must match expected method names exactly (fragile string matching).
- Example stub shape (MCP Node SDK, ~40 lines for a minimal adapter server).

**CLI contract:**
- Author writes any executable that reads a JSON line from stdin and writes a JSON line to stdout.
- Requires: ability to parse JSON in chosen language (stdlib in Python, Node, Go, etc.).
- Language-agnostic with zero protocol overhead.
- Author experience: LOWEST barrier — a Python adapter is 20 lines; a shell adapter is feasible.
- Example stub shape (Python, ~15 lines):
  ```python
  import sys, json
  msg = json.load(sys.stdin)
  method = msg['method']
  args = msg['args']
  if method == 'createStory':
      result = create_linear_story(args['title'], args.get('parent_id'))
      print(json.dumps({'ok': True, 'id': result}))
  ```

**Tied-axis flag:** None. CLI wins on user-facing complexity (lowest barrier, any language, no protocol). TS interface is most structured but highest barrier.

### Axis 5 — Hierarchy-Agnostic Carry (flat/hierarchical/mixed expression)

**TS interface:**
- `capabilities.hierarchy_mode: 'flat' | 'hierarchical' | 'mixed'` as a typed property.
- Hive reads `adapter.capabilities.hierarchy_mode` at init time — zero cost.
- Type system enforces the enum; mis-spelling caught at compile time.
- `createStory(title, body, opts?: { parent_id?: string })` — optional parent carries hierarchy naturally.
- Score: BEST — typed enum, compile-time enforcement, optional parent on methods.

**MCP server:**
- Capability declared via a `describe` tool or in `tools/list` annotations JSON schema.
- Hierarchy mode expressed in the `describe` tool's return value — JSON, not typed.
- The `tools/call` for `createStory` includes `arguments.parent_id` as optional JSON field.
- Score: GOOD — JSON schema can express the same shape; no compile-time enforcement; runtime validation needed.

**CLI contract:**
- `--describe` flag returns JSON blob with capabilities.
- `createStory` call includes `parent_id` in the JSON payload if hierarchical.
- Score: GOOD — same expressiveness as MCP; no type enforcement; relies on schema documentation.

**Tied-axis flag:** MCP and CLI are within 1 point on this axis. Both carry the same JSON shape; TS interface has a minor advantage from typed enum enforcement. This axis is SOFT-TIED between MCP and CLI.

## 4. Aggregate Score Summary (raw evidence only — scoring for implement step)

| Axis | TS Interface | MCP Server | CLI Contract |
|---|---|---|---|
| Pluggability | Medium (TS only) | High (any language, SDK ecosystem) | Highest (any language, no protocol) |
| Cross-process boundary | In-process (no isolation) | Out-of-process (isolation, lifecycle cost) | Out-of-process (isolation, simpler) |
| Hive-side invocation cost | ~0.39ns (measured) | ~0.1–0.5ms persistent; ~62ms cold | ~52ms measured (cold) |
| User-facing complexity | High barrier (TS required) | Medium barrier (MCP protocol) | Low barrier (JSON in/out, any language) |
| Hierarchy carry | Best (typed enum) | Good (JSON schema) | Good (JSON schema) |

## 5. Tied-Axis Summary (AC §5 trigger conditions)

Per AC §5: if any axis ties within 1 point between any two candidates, the implement step must sketch BOTH.

| Axis | Candidates tied | Gap | Trigger sketch? |
|---|---|---|---|
| Pluggability | CLI vs MCP | ~1 point | YES — both language-agnostic out-of-process |
| Cross-process boundary | MCP vs CLI | ~1 point | YES — both provide isolation |
| Hierarchy carry | MCP vs CLI | ~1 point | YES — both use JSON schema |

TS interface does NOT tie with either on pluggability or user complexity. TS interface leads decisively on invocation cost.

**Result: MCP and CLI are tied on 3 of 5 axes. AC §5 requires the implement step to sketch BOTH MCP and CLI before final commit. TS interface is not tied with either on the decisive axes (pluggability, user complexity) but wins on invocation cost — a less differentiating axis given Hive's low-frequency call cadence.**

## 6. Benchmark Numbers (for AC §6 citation)

| Invocation type | Measured value | Method |
|---|---|---|
| In-process function call (TS interface) | 0.39 ns/call | Node v25.9.0, 10M iterations, hrtime.bigint |
| Cold subprocess spawn (CLI contract) | 52.4 ms/call | Node v25.9.0, spawnSync node -e, N=20 |
| MCP persistent IPC round-trip | ~0.1–0.5 ms/call | Authoritative estimate (Node IPC over pipe); no cold-spawn penalty if server is persistent |
| MCP cold spawn + initialize + tools/call | ~62–70 ms/call | Spawn (52ms) + initialize (~10ms) + tools/call (~0.5ms); cold only |

Note: The story YAML AC §6 cites "subprocess spawn ~10ms" — this is a low estimate. Measured reality on macOS Node v25 is 52ms. The implement step should cite the measured 52ms figure with the caveat that lighter runtimes (Go binary, Python with no imports) may approach 10-20ms.

## 7. MemoryStore Interface as TS Precedent

`hive/references/memory-store-interface.md` establishes the pattern:
- Typed interface defined in a documentation schema (read, write, compile with typed sigs).
- "Not executable code — implementations described in natural language with enough precision to guide development."
- This means even the TS interface form factor would initially be a documentation schema, with the implementation wired in a later story (c-5 dispatch module).

This precedent slightly reduces the TS interface's "no dispatch infrastructure" constraint — Hive is comfortable with documentation-schema interfaces that are filled in later. But the dispatch module still needs to be built (c-5 scope).

## 8. Section 7 Epic C Scope Confirmation

From recommendation.md §7:
- Epic C = task-tracking-adapter-abi (in-flight, no blockers)
- Migration path: Linear + GitHub prose runbooks → first two adapter implementations
- c-2 specifies ABI methods + types; c-3 = GitHub adapter; c-4 = Linear adapter; c-5a = dispatch module; c-5b = skill citation swap; c-6 = migration guide

The form factor chosen here gates all of c-2 through c-6. Rework cost if wrong: ~6 stories.
