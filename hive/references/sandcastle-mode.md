# Sandcastle Mode

**Status:** canonical reference (foundation — schema only)
**Epic:** `autonomous-cycle-loop`
**Story:** `s0-1-schema-and-config-bump`
**Companion docs:**

- [`test-scenario-schema.md`](test-scenario-schema.md) — the YAML shape the autonomous loop replays through each sandcastle
- [`sandcastle-adoption-guide.md`](sandcastle-adoption-guide.md) — end-user reference for adopting `sandcastle` as a Hive execution mode
- [`sandcastle-gh-dispatch.md`](sandcastle-gh-dispatch.md) — GitHub-Actions dispatch path (the existing single-sandcastle-per-issue flow)

## 1. Purpose

This reference fixes the semantics of the `autonomous_cycle_loop.sandcastle_mode` configuration knob introduced by story `s0-1-schema-and-config-bump`. It does **not** define the loop itself — the runner that consumes this knob lands in a later story of the `autonomous-cycle-loop` epic. Pre-shipping the semantics here lets downstream stories cite a stable contract instead of inventing one as they land.

Until that runner ships, the knob is inert: every Hive invocation behaves as if `autonomous_cycle_loop.enabled: false` and no consumer reads `sandcastle_mode` at all.

## 2. The knob

```yaml
autonomous_cycle_loop:
  sandcastle_mode: shared       # shared | dedicated
```

Two values, both legal at all times:

| Value | Meaning |
|---|---|
| `shared`     | The autonomous loop reuses a **single** sandcastle container for every test scenario in a run. The container is created once at loop start and torn down once at loop end; each scenario replays inside the same container with state carried forward between scenarios (workspace, env, mounted credentials). |
| `dedicated` | The autonomous loop spawns a **fresh** sandcastle container per test scenario. Container lifetime equals scenario lifetime; no state crosses the boundary between scenarios. |

`shared` is the default because the cold-start cost of spinning a sandcastle (image pull, codex auth mount, container init) dominates the per-scenario wall-time for the small scenarios the loop is designed to replay.

## 3. When to choose which

### 3.1 Prefer `shared` when

- The scenarios are **read-only** or otherwise side-effect-free, so cross-scenario state has no observable consequence.
- The scenarios deliberately exercise **cumulative behavior** — e.g., "scenario A creates an epic, scenario B replays /standup against it." Sharing the container is the only way the second scenario sees the first's writes.
- Wall-time matters more than isolation (CI lanes, fast feedback during loop tuning).

### 3.2 Prefer `dedicated` when

- Two scenarios in the same run write to **overlapping paths** with different expected starting states (e.g., both seed `.pHive/triage/queue.yaml` from empty).
- A scenario installs or mutates **global tools** (codex auth, npm globals, system packages) and a later scenario must not inherit that.
- The loop is being used to characterize **first-run** behavior — `shared` masks first-run vs. steady-state distinctions because the container's state diverges from a clean image after scenario 1.

## 4. Interaction with the existing single-sandcastle dispatch

The GitHub-Actions dispatch flow defined in `.github/workflows/hive-dispatch.yml` (and documented in [`sandcastle-gh-dispatch.md`](sandcastle-gh-dispatch.md)) spawns **one** sandcastle per labeled issue. That path is **unrelated** to this knob: it does not consult `autonomous_cycle_loop.*` and never will. `sandcastle_mode` governs only the autonomous-cycle-loop runner introduced in a later story of the `autonomous-cycle-loop` epic.

The two flows are intentionally separate:

| Flow | Sandcastles per invocation | Governed by |
|---|---|---|
| GH-Actions dispatch (`hive:ready` label) | exactly one | the workflow YAML; `sandcastle_mode` ignored |
| Autonomous cycle loop (this knob) | one (`shared`) or N (`dedicated`) | `autonomous_cycle_loop.sandcastle_mode` |

A sandcastle running inside the GH-Actions dispatch path **must not** invoke the autonomous cycle loop — the outer container is already the isolation boundary, and nested sandcastle spawning is unsupported (see `HIVE_EXECUTION_MODE=team` enforcement in the bridge script).

## 5. Field-source precedence

Resolution follows the standard Hive precedence:

1. `HIVE_AUTONOMOUS_CYCLE_LOOP_SANDCASTLE_MODE` env var, if set to a legal value
2. Root `hive.config.yaml` → `autonomous_cycle_loop.sandcastle_mode`
3. Shipped baseline `hive/hive.config.yaml` → `autonomous_cycle_loop.sandcastle_mode`
4. Default: `shared`

An illegal value (anything other than `shared` or `dedicated`) is a configuration error. The runner that lands in a later story rejects the config at load time rather than silently falling back to the default — silent fallback would mask typo-class bugs ("share" vs "shared") that only manifest as wrong-mode behavior at runtime.

## 6. Status — what this story does and does not ship

This story (`s0-1-schema-and-config-bump`) ships:

- the YAML block in both config layers
- this document fixing the semantics
- a cross-reference from [`test-scenario-schema.md`](test-scenario-schema.md)

This story does **not** ship:

- the runner that consumes the knob
- env-var resolution
- the legal-value validator
- any test scenarios under `.pHive/test-scenarios/`

Those land in subsequent stories of the `autonomous-cycle-loop` epic. The schema fixed here is the contract those stories build against.
