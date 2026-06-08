# ADR: Language & runtime strategy for Hive

**Status:** Accepted (2026-06-08, maintainer)  
**Date:** 2026-06-08  
**Author:** analyst  
**Evidence source:** `.pHive/proposals/language-strategy-research.md`

> **Maintainer decision (2026-06-08):**
> - **Direction: Option B — Python-first with bridges.**
> - **Sandcastle: optional maintainer-only execution mode** — stays behind a Node bridge, outside the Python core; not long-term-core.
> - **Charter home: `CLAUDE.md`** becomes the project/architecture charter; the current context-mode routing rules move to a separate file (e.g. `.claude/context-mode.md`) that `CLAUDE.md` references.
> - Open decisions 3 (adapter ABI), 4 (Multica platform constraint), 5 (lockfile policy) deferred to the migration epic when scheduled.
> - **Cross-epic:** `state-dir-resolver` sdr-1 must be re-specced Python-primary + shell/Node shims (not co-equal 3-runtime) before `/execute`.

---

## 1. Context

### Current runtime split

| Language family | Files | Primary clusters |
|----------------|-------|-----------------|
| Python | 157 | DAG executor (81), meta-experiment (18), metrics (6), KG/scope helpers, config.py |
| JS / MJS / TS | 135 | Misc JS helpers (34), tests (53), multica-story-dispatch (5), task-tracking-dispatch (7), adapters (6), multica-bootstrap (5), scripts (11), workflow helpers (6), skill runners (4) |
| Shell | 23 | hooks (8), sidecar scripts, tests, state migration |

Python is the plurality owner of workflow execution: DAG graph loading, scheduling, routing, run-state persistence, telemetry, metrics, KG, scope drift, and meta-experiment logic all live in Python. JS/TS concentrates in integration surfaces: Multica dispatch, Anthropic session management, Sandcastle, task-tracking adapters, and operational bootstrap.

### The CLAUDE.md gap

`CLAUDE.md` (root) is a context-mode routing rulebook, not an architecture charter. No single document declares the supported implementation languages, runtime ownership by subsystem, npm/Python dependency policy, adapter ABI contract, or migration conventions. This absence lets the split grow organically and makes the two-config-reader symptom (`config.js` / `config.py`) nearly inevitable.

### Why this matters now

Cluster C gates Clusters A and B. The `state-dir-resolver` epic (PLU-247..256) already exhibits the problem concretely: its `sdr-1` resolver is a three-runtime resolver (shell + Node + Python) that exists *because* of the split. Every new feature that needs to read state-dir or config must navigate the same seam. A decision made here locks the direction for all downstream work.

---

## 2. Decision drivers

1. **Cross-runtime drift risk** — `config.js` and `config.py` implement similar but non-identical parsers. Without a charter, parity erodes silently.
2. **Maintenance burden of two config readers** — any config-schema change requires parallel edits in two languages.
3. **Dependency governance** — no root `package.json` or lockfile; npm runtime dependencies are implicitly installed without a central audit surface.
4. **State-dir-resolver simplification** — a Python-first direction collapses `sdr-1`'s three-runtime resolver to one; a status-quo direction leaves it multi-headed indefinitely.
5. **Contributor onboarding** — every contributor needs both Node and Python toolchains today; the split is invisible in documentation.

---

## 3. The pivotal fork

### Option A — Literal pure-Python (zero Node at runtime)

**Scope:** Reimplement all JS/TS runtime seams in Python. Remove Node from the execution path entirely. Shell hooks either convert to Python subprocesses or remain as thin shell shims.

**Cost by migration tier (from research):**
- *Trivial* ports: `git_flow.mjs`, audit scripts, skill runners, meta-team helpers. These use only fs/path/process/YAML — straightforward Python equivalents.
- *Medium* ports: `multica-bootstrap`, `multica-agents-config`, session builders/registry/episode/prompt/turn, `config.js` callers, KG scripts, operational helpers.
- *Hard* ports: `multica-story-dispatch` (index.mjs, episode-sync.mjs, distill.mjs), `task-tracking-dispatch` + adapters, full Anthropic session stack (session-client, messages-session, SSE reader, session-end SQLite closeout).
- *Blocked/conditional*: Sandcastle provider/loader/worker path. `@ai-hero/sandcastle` is a JS/TS package; no Python equivalent exists. Option A's viability depends entirely on whether Sandcastle is optional (see §5).

**Risk:** High. Removing JS before Multica dispatch is replaced breaks every Multica-routed story. The session stack requires a real Anthropic Python SDK rewrite, not a translation. Sandcastle is a categorical blocker unless its status changes.

**End-state:** Cleanest. Single-runtime Python core; shell shims retained for Claude Code hook ABI only.

---

### Option B — Python-first with bridges (recommended)

**Scope:** Python owns all new logic; shell hooks stay shell; Node is retained only where JS-native dependencies make replacement disproportionately costly: `@ai-hero/sandcastle` and, optionally, the Anthropic session stack.

**Cost by migration tier:**
- *Trivial* tier ported first: `git_flow.mjs`, skill runners, meta-team helpers, audit scripts. Low risk, immediate dedup. These ship without blocking anything.
- *Medium* tier ported in wave 2: `multica-bootstrap`, `multica-agents-config`, session builders/registry, `config.js` callers. Larger surface but no hard external dependencies.
- *Hard seams deferred/bridged*: `multica-story-dispatch`, task-tracking adapters, `session-client`/`messages-session`. These remain Node until either (a) a Python port is greenlit or (b) Multica platform context makes HTTP-only Python clients viable.
- *Sandcastle bridge*: Node process retained explicitly for Sandcastle. Python calls into it via subprocess/IPC if needed, rather than reimplementing sandbox factories.

**Charter outcome:** A `CLAUDE.md`-adjacent architecture charter declares Python as the canonical language for new business logic; the charter names the bridged surfaces explicitly so contributors know what is intentionally dual-runtime and what is a migration target.

**Risk:** Medium. The thin JS surface remains; it shrinks over time rather than disappearing on a cliff. The drift risk is bounded by the charter and a shared cross-runtime config/resolver conformance fixture.

**End-state:** Python-dominant codebase with a small, named JS boundary. Contributor onboarding is Python-first; JS knowledge is required only for the named bridge surfaces.

---

### Option C — Status quo + governance

**Scope:** Accept the current split as-is. Add the missing charter, a root `package.json` + lockfile, and a shared cross-runtime config/resolver conformance fixture to bound drift.

**Cost:** Lowest. No migrations; only documentation and tooling additions.

**Risk:** Low in the short term. Cross-runtime drift continues at its current rate, but with guardrails. `sdr-1`'s three-runtime resolver is not simplified — it becomes the accepted pattern.

**End-state:** Current split frozen in documentation. Lower short-term cost; higher long-term complexity tax as new features must account for the two-runtime config/state surface.

---

## 4. Option comparison

| Dimension | A (pure-Python) | B (Python-first) | C (status quo + governance) |
|-----------|----------------|-----------------|----------------------------|
| Sandcastle | Blocked until status resolved | Bridge retained | Unchanged |
| Multica dispatch | Must reimplement before JS removal | Deferred/bridged | Unchanged |
| sdr-1 simplification | Full collapse possible | Partial (Python path primary) | None |
| Charter achievable? | Yes, after full migration | Yes, immediately | Yes, but permissive |
| Contributor onboarding | Python-only (post migration) | Python-first (now) | Same as today |
| Timeline risk | High (blocked seams) | Low (phased, bounded) | None |
| Long-term complexity | Lowest | Low | Medium (drift accumulates) |

---

## 5. Sandcastle as the hinge

Sandcastle (`@ai-hero/sandcastle`) is the single non-incidental JS dependency: it provides sandbox factories (Podman/Docker) consumed via ESM/CJS bridges across four files (`sandcastle-provider.js`, `sandcastle-provider-loader.mjs`, `sandcastle-worker-runner.js`, `sandcastle-log-redaction.js`). The upstream issue-191 gate (`gate-claudecode-sandcastle.mjs`) is already in place, indicating the maintainer is watching Sandcastle's production status.

**Option A's viability is conditional on one question:** Is Sandcastle long-term-core, or an optional maintainer-only execution mode that can remain outside a pure-Python core? If the former, Option A requires either a Python sandbox replacement or an explicit Node bridge — narrowing it toward Option B in practice. If the latter, Option A becomes feasible but is still the highest-cost path.

This question is a sign-off gate (see §8).

---

## 6. Recommendation

**Adopt Option B — Python-first with bridges.**

### Justification

- Python already owns the most mature runtime cluster (DAG executor, 81 files, full test suite). Declaring Python-first formalizes what is already structurally true.
- The hard JS seams (Multica dispatch, Sandcastle, session stack) are removable only after non-trivial rewrite work. Blocking the charter on that work delays Clusters A and B unnecessarily.
- The trivial and medium migration tiers (git_flow.mjs, skill runners, multica-bootstrap, session builders) are low-risk, immediately actionable, and produce immediate dedup benefits regardless of what happens to the hard seams.
- A thin, explicitly named JS bridge surface is far less harmful than an undocumented split: contributors know where the seam is, and the charter can lock it.

### Phased path

**Wave 1 — Trivial ports (low risk, immediate dedup):**
- `hive/lib/git_flow.mjs` → Python
- `hive/scripts/audit-episode-markers.mjs`, `gate-mode-audit.mjs` → Python or retired
- `skills/context-snapshot/run.mjs`, `skills/triage/run.mjs` → Python entrypoints
- `hive/workflows/steps/meta-team-cycle/*.mjs` → Python helpers

**Wave 2 — Medium ports:**
- `hive/lib/multica-bootstrap/` and `multica-agents-config/` → Python
- Session builders (registry, episode-writer, prompt-builder, turn-builder) → Python
- `hive/lib/config.js` callers → consolidate to `config.py`; retire `config.js`
- JS KG scripts (`kg-bootstrap-from-projects.js`, `kg-import-cycle-state.js`) → Python

**Wave 3 — Hard seams (deferred; bridge until greenlit):**
- `hive/lib/multica-story-dispatch/` — retain Node; Python port is a dedicated epic when maintainer confirms no Multica platform constraint on Node clients
- `hive/lib/task-tracking-dispatch/` + adapters — retain Node; port when adapter ABI language contract is decided
- Session client / messages-session / SSE / session-end — retain Node; Python Anthropic SDK is the replacement path

**Bridge (indefinite):**
- Sandcastle provider/worker path — Node bridge retained; revisit when Sandcastle status is resolved

**`sdr-1` direction:** Build the state-dir-resolver's `sdr-1` Python resolver as the primary resolver under this direction. The shell and Node resolvers become compatibility shims for surfaces not yet migrated, not co-equal participants.

---

## 7. Consequences

**Gets simpler:**
- New business logic has one canonical language (Python); no decision required per feature
- `config.js` and `config.py` consolidate to one reader over time, eliminating drift risk
- `sdr-1` resolver reduces from three-runtime to Python-primary; shell shims remain only for hook ABI
- Contributor toolchain requirement becomes Python-first; Node is optional for bridge surface only
- Dependency governance: root `package.json` + lockfile scopes npm to the bridge surface only, making the audit surface explicit and bounded

**Stays dual-runtime (by design):**
- Claude Code hook scripts remain shell (hook ABI is Claude Code's constraint, not ours)
- Sandcastle, Multica dispatch, and task-tracking adapters remain Node until hard-seam ports are greenlit
- Anthropic session stack remains Node until Python SDK rewrite is greenlit

**The charter must lock:**
- Python is the default language for new business logic
- Node is permitted only in named bridge surfaces (Sandcastle, Multica dispatch, session stack, task-tracking adapters); new Node files outside these surfaces require explicit maintainer approval
- Shell is permitted only for Claude Code hook entrypoints and OS sidecar scripts that must run in the host environment
- A cross-runtime config/resolver conformance fixture validates that `config.py` and any remaining JS config callers agree on schema
- npm dependencies must be declared in a root `package.json` + lockfile; transitive implicit installs are not permitted

---

## 8. Open decisions for the maintainer

These questions cannot be resolved from the codebase alone. They are the sign-off gate before any migration work begins.

1. **Literal vs. Python-first:** Is "pure-Python" a hard goal (zero Node at runtime, eventually) or a directional goal (Python-first, bridges acceptable long-term)? This determines whether Option A or B is the target end-state.

2. **Sandcastle's status:** Is `@ai-hero/sandcastle` long-term-core to Hive's execution model, or an optional maintainer-only execution mode? If the former, what is the acceptable replacement path for a Python execution substrate? If the latter, what is the timeline for removing it from the critical path?

3. **Task-tracking adapter ABI:** Should task-tracking adapters remain ESM/TypeScript CLI/process ABI modules, or is a Python-native adapter ABI acceptable? This determines whether the adapter ports are medium or hard cost.

4. **Multica dispatch platform constraint:** Does the Multica platform require Node clients, or is the current JS implementation incidental? If incidental, the `multica-story-dispatch` port becomes a medium-tier effort (HTTP client rewrite only).

5. **Lockfile/dependency policy:** Where should the root `package.json` and lockfile live, and who owns the npm dependency audit? Should per-adapter `package.json` files consolidate into the root?

6. **Charter document location:** Should the architecture charter live in `CLAUDE.md` (extending the current routing rules), in a new `ARCHITECTURE.md`, or in `.pHive/CONTEXT.md` (extending the existing glossary)?
