# Research Brief — c-5b Skill Citation Swap + Prose-Runbook-Fallback Telemetry

**RESEARCH_BRIEF_FOR:** `c-5b-skill-citation-swap-and-fallback-telemetry`
**Wave:** W4 | **Methodology:** classic | **Branch:** `feat/task-tracking-adapter-abi`
**Depends on:** c-5a (shipped — dispatch module + config schema)

---

## SOURCES_READ

1. `/Users/don/Documents/plugin-hive-adapter-abi/hive/lib/task-tracking-dispatch/index.ts` — c-5a `TaskTrackingDispatch` class (lines 1-330)
2. `/Users/don/Documents/plugin-hive-adapter-abi/hive/lib/task-tracking-dispatch/README.md` — public surface, error mapping, telemetry doc
3. `/Users/don/Documents/plugin-hive-adapter-abi/skills/kickoff/SKILL.md` (26 lines — short stub; protocol lives in `hive/references/kickoff-protocol.md`)
4. `/Users/don/Documents/plugin-hive-adapter-abi/skills/plan/SKILL.md` (758 lines — heavy logic; tracker-relevant sections identified below)
5. `/Users/don/Documents/plugin-hive-adapter-abi/skills/execute/SKILL.md` (225 lines — session-registry-driven; status writes at sessions/index.yaml)
6. `/Users/don/Documents/plugin-hive-adapter-abi/hive/references/kickoff-protocol.md` — Linear/GitHub references at L171, L175, L188, L252, L261, L277, L290, L661, L771, L834, L933
7. `/Users/don/Documents/plugin-hive-adapter-abi/.pHive/epics/task-tracking-adapter-abi/stories/c-5b-skill-citation-swap-and-fallback-telemetry.yaml` (own spec)
8. `/Users/don/Documents/plugin-hive-adapter-abi/.pHive/epics/catalog-hygiene-and-borrows/stories/w1-warning-lift.yaml` (only existing gate-mode warning-text precedent — Epic B a-33/a-35 stories not yet drafted)
9. `/Users/don/Documents/plugin-hive-adapter-abi/.pHive/epics/structural-refactor-and-gate-lift/epic.yaml` — Epic B a-33 / a-35 / a-36 line items only (no story YAMLs yet)
10. `/Users/don/Documents/plugin-hive-adapter-abi/.pHive/metrics/metrics-event.schema.md` — canonical JSONL row shape

**Confirmed absent on disk:**
- `hive/references/gate-lift-telemetry.md` — the c-5b story cites Epic B a-36; **the doc does not exist yet**. Telemetry shape must inherit `.pHive/metrics/metrics-event.schema.md` and mirror c-5a's `task-tracking-no-adapter` event.
- `.pHive/epics/structural-refactor-and-gate-lift/stories/a-33-*.yaml` / `a-35-*.yaml` — Epic B stories not drafted; warning shape can only be **inferred** from `w1-warning-lift` precedent.
- `.pHive/metrics/events/` directory itself.

---

## PATTERNS_OBSERVED

### P1 — Top-level skill files have ZERO existing tracker citations

`grep -n "task_tracking|task-tracking-adapter|linearis|Linear ticket|Linear issue|prose-runbook"` against `skills/kickoff/SKILL.md`, `skills/plan/SKILL.md`, `skills/execute/SKILL.md` returns **no matches**. The c-5b story is titled "citation **swap**" but the actual mechanical change is **citation insertion** — adding new dispatch-driven paragraphs at appropriate workflow points, not editing existing prose-runbook references. The "prose-runbook" concept lives only in epic/story YAMLs and audit docs under `.pHive/`, not in the live skill files.

### P2 — Tracker references exist in `hive/references/kickoff-protocol.md`, not in SKILL.md

`kickoff/SKILL.md` is a 26-line stub that delegates to `hive/references/kickoff-protocol.md`. The protocol file at lines 171/175/188/252/261/277/290/661/771/834/933 contains the live tracker references:
- L171/175: CI/CD + Linear/Jira detection during brownfield discovery
- L188: CLI integration detection (`linearis`)
- L252/261/277/290: "Meta-team GitHub sync" Q6 (sets `meta_team.github_forwarding`) — **separate concern from c-5b** (this is metrics/meta-improvement forwarding, not task-tracking adapter)
- L661: "Task tracking config (Linear team, project, user ID)" — **the actual tracker-load point**
- L771/834/933: `linearis` CLI matrix entries

The c-5b citation insertion lands in the kickoff-protocol's tracker-config step (around L661), with a thin redirect from `skills/kickoff/SKILL.md` if needed.

### P3 — `skills/plan/SKILL.md` story-publish point

Tracker-relevant lines:
- L32: callback that advances triage `prioritized → plan-ready` and writes `linked_epic` / `linked_story`
- L329-331: "Write detailed story files" step + self-containment rule explicitly mentioning external trackers (Linear)
- L564: `stories: [auth-flow]  # topic areas at raise time; backfilled to canonical story IDs`
- L721: Mermaid diagrams "render natively in GitHub, Linear"

The `createStory` dispatch call belongs immediately **after** the step that writes the local story YAML (around L329-331), capturing the returned `{id, url}` into story metadata. The actual call site is the "publish stories" handoff at the end of plan — currently implicit, since no external publication step exists.

### P4 — `skills/execute/SKILL.md` story-status-update point

Tracker-relevant lines:
- L139: `{story_id -> surface_id, status, depends_on}` map (in-memory)
- L155: append session record with `status: pending`
- L159: `status: active`, `last_active_at: {NOW}`
- L171 (6c-6): `status: completed` / `failed` on session close
- L206: "Story state is derived from [episode] markers — do NOT free-write `status:` in story YAMLs"

The `updateStatus` dispatch calls belong at the three session lifecycle transitions: **pending → active (L159)**, **active → completed/failed (L171)**. L206 is critical: the story-YAML `status:` field is deprecated; dispatch updates an external tracker, not the local YAML. Sessions remain local-state-of-record.

### P5 — c-5a no-adapter telemetry write — the model to mirror

`hive/lib/task-tracking-dispatch/index.ts:285-318`:
- `console.warn("[hive] task-tracking adapter is unset. Set task_tracking.adapter in hive.config.yaml to enable. (gate_mode=warning — skipping tracker ops)")`
- Writes JSONL event with `event_id`, `timestamp`, `run_id`, `metric_type: "task-tracking-no-adapter"`, `method`, `gate_mode: "warning"`
- Best-effort: `mkdirSync` + `appendFileSync`, errors swallowed
- File path: `<state_dir>/metrics/events/task-tracking-no-adapter-<ISO-sanitized>.jsonl`
- Emitted at most once per process (`noAdapterWarningEmitted` flag)

### P6 — JSONL convention from `.pHive/metrics/metrics-event.schema.md`

Required fields: `event_id` (UUID), `timestamp` (ISO 8601), `run_id`, `metric_type`. Optional: `swarm_id`, `story_id`, `proposal_id`, `phase`, `agent`. Files live at `.pHive/metrics/events/*.jsonl`. The c-5b story spec's proposed payload `{event, skill, method, adapter, gate_mode, timestamp}` is **missing** `event_id`, `run_id`, `metric_type` — must be augmented to comply with the canonical schema.

### P7 — Warning text precedent (w1-warning-lift)

The only shipped gate-warning template:

> `"Warning: Hive not initialized for this project. Run /hive:kickoff for full context. Proceeding with defaults."`

Pattern: `Warning: <what's missing>. <Remediation hint>. <What's happening now>.` c-5a already mirrors this: `"[hive] task-tracking adapter is unset. Set task_tracking.adapter in hive.config.yaml to enable. (gate_mode=warning — skipping tracker ops)"`.

---

## CONSTRAINTS

- **No story-YAML `status:` writes from execute.** L206 says story state is derived from episode markers. Dispatch updates the external tracker only; episode markers remain the local source of truth.
- **No skill-side adapter branching.** AC #8: "No skill-side logic branches on adapter type." All `if adapter == github/linear` logic stays inside dispatch + adapters.
- **Hard mode is byte-equivalent.** `gate_mode: hard` + no adapter → skill blocks exactly as today. The c-5a `handleNoAdapter` already returns `NO_ADAPTER` non-recoverable in hard mode; callers must propagate that to a halt.
- **Deprecation-pointer prose stays.** AC #4: "Prose-runbook citations in the three skills no longer drive runtime — they may remain as deprecation pointers awaiting c-6 cleanup." Since there are no existing in-skill prose-runbook references (P1), this AC is **already satisfied vacuously** — the c-5b implementation just inserts new dispatch citations without removing anything.
- **Telemetry is best-effort.** Mirror c-5a: `mkdirSync` + `appendFileSync` wrapped in try/catch, never block the caller.
- **Emission frequency:** c-5a emits no-adapter telemetry **once per process**. Prose-runbook-fallback should emit **per terminal-under-warning occurrence** — each terminal failure is a distinct migration signal, unlike the static "no adapter" condition.

---

## RISKS

| # | Severity | Risk | Mitigation |
|---|----------|------|------------|
| R1 | Medium | The c-5b story spec's JSONL payload `{"event": "prose_runbook_fallback", ...}` uses `event` field, not the canonical `metric_type`. Naive implementation would diverge from c-5a + `metrics-event.schema.md`. | Use `metric_type: "prose-runbook-fallback"` (hyphenated, like sibling `task-tracking-no-adapter`); add `event_id` + `run_id` per schema. |
| R2 | Medium | `hive/references/gate-lift-telemetry.md` is cited as the convention authority but does not exist on disk yet (Epic B a-36 not drafted). | Inherit from `.pHive/metrics/metrics-event.schema.md` + c-5a's `writeNoAdapterTelemetry` pattern; document the lineage in the implementation. |
| R3 | Medium | Smoke-test step 1 needs `GITHUB_TEST_REPO` + `GITHUB_TOKEN` provisioned. CI likely lacks credentials. | Smoke skips with documented reason when env unset; document local-dev run path; do not gate review on CI smoke pass. |
| R4 | Low | Telemetry emitter placed inside dispatch couples fallback semantics to dispatch internals — adapter-specific. Placing it in skill caller forces every skill to know the rule. | Place emitter in **dispatch** (mirrors c-5a `writeNoAdapterTelemetry`). Skill caller passes `skill: "kickoff"` as opt-in context arg; dispatch decides when to fire. |
| R5 | Low | Per-skill warning text drifts from w1 precedent over time. | Reviewer step 4 explicitly verifies warning shape against the w1 template. |
| R6 | Medium | `kickoff/SKILL.md` is a 26-line stub — citation belongs in `hive/references/kickoff-protocol.md` near L661, not in SKILL.md itself. Wrong target file produces a non-functional swap. | AC interpretation: "skills/kickoff/SKILL.md citation" includes its delegated protocol doc. Add the dispatch.load() instruction at kickoff-protocol L~661 (tracker config write), retain a brief pointer in SKILL.md if surface-level visibility is required. |
| R7 | Low | Unexpected JS exception from adapter (non-ABI-shaped) bypasses fallback emit. | c-5a maps these to `INTERNAL_ERROR`; treat `INTERNAL_ERROR` and `TIMEOUT` as terminal-under-warning triggers like any ABI terminal code. |

---

## FINDINGS

### F1 — Citation targets per skill (file:line — current text → new pattern sketch)

**kickoff/SKILL.md (26 lines) + hive/references/kickoff-protocol.md:**
- `skills/kickoff/SKILL.md:26` — current: `**Instructions:** Read hive/references/kickoff-protocol.md ...`
  - No edit needed at this line; protocol delegation already happens.
- `hive/references/kickoff-protocol.md:~661` — current: `Task tracking config (Linear team, project, user ID)`
  - **New pattern:** After capturing task_tracking config, instruct the kickoff orchestrator to:
    ```ts
    import { TaskTrackingDispatch } from "@hive/task-tracking-dispatch";
    const dispatch = new TaskTrackingDispatch();
    await dispatch.load(config.task_tracking);
    // Validates adapter loads + capabilities probe succeeds.
    // gate_mode: warning + no adapter → loud warning, kickoff proceeds.
    // gate_mode: hard + no adapter → kickoff halts via NO_ADAPTER terminal.
    ```
  - Handle scope: in-process; subsequent skills re-instantiate `TaskTrackingDispatch` and call `load()` with the same config — c-5a's module-scoped cache short-circuits the re-load. No cross-skill handle storage needed.

**plan/SKILL.md (758 lines):**
- `skills/plan/SKILL.md:329-331` — current step 13 "Write detailed story files":
  - **New pattern:** Append a sub-step "13a. Publish each story to the configured tracker":
    ```ts
    const r = await dispatch.invoke("createStory", {
      title: story.title,
      body: renderStoryBody(story),
      labels: story.labels ?? [],
      team_value: config.task_tracking.team_value,
      project_value: config.task_tracking.project_value,
    });
    if (r.ok) {
      story.tracker_id = r.result.id;
      story.tracker_url = r.result.url;
    } else if (r.code === "NO_ADAPTER" && gateMode === "warning") {
      // dispatch already emitted warning + telemetry; continue without tracker_id.
    } else if (r.recoverable) {
      // RATE_LIMIT — sleep r.retry_after_ms and retry once
    } else {
      // Terminal under warning → prose-runbook-fallback emitted by dispatch; continue.
      // Terminal under hard → halt plan.
    }
    ```
  - Optional parent linkage: if `dispatch.capability("supports_parent_link")` and epic has a tracker_id, call `linkStories({parent_id: epic.tracker_id, child_id: story.tracker_id})`.

**execute/SKILL.md (225 lines):**
- `skills/execute/SKILL.md:155` — session record append `status: pending`:
  - **New pattern:** After local session record append, if story has `tracker_id`:
    ```ts
    await dispatch.invoke("updateStatus", { id: story.tracker_id, state: "in_progress" });
    ```
- `skills/execute/SKILL.md:159` — `status: active`: same as above (or fold the two; sessions/stories have distinct semantics — `pending → active` represents "agent attached", but for tracker we map to `in_progress` once).
- `skills/execute/SKILL.md:171` (6c-6) — `status: completed / failed`:
  - **New pattern:**
    ```ts
    const trackerState = sessionStatus === "completed" ? "done" : "cancelled";
    await dispatch.invoke("updateStatus", { id: story.tracker_id, state: trackerState });
    ```

### F2 — Recommended fallback-telemetry location: **inside dispatch module**

Place a new private method `writeFallbackTelemetry(method, code, skill?)` on `TaskTrackingDispatch`, called from `invoke()` immediately before returning a terminal-under-warning result. Pattern mirrors c-5a `writeNoAdapterTelemetry`:

```ts
// In invoke(), after adapter throws terminal AdapterError:
if (this.config?.gate_mode !== "hard") {
  this.writeFallbackTelemetry(method, code, params?._skill_context);
}
return { ok: false, recoverable: false, code, message, retry_after_ms };
```

Skills pass `_skill_context: "kickoff" | "plan" | "execute"` in the params object as an opt-in (dispatch strips it before forwarding to the adapter to avoid polluting the ABI).

**Rationale:** centralizing in dispatch keeps skills oblivious to adapter-specific terminal codes (`AUTH_FAILURE`, `NOT_FOUND`, `TIMEOUT`, `INTERNAL_ERROR`, `OPERATION_UNSUPPORTED`). c-5a's `handleNoAdapter` already proves the pattern works module-side. Skill-side emission would force three duplicate try/catch blocks and tangle the error-code knowledge across the codebase. AC #8 ("no skill-side adapter branching") tilts decisively toward dispatch-side emission.

### F3 — Fallback event shape (canonical-schema-compliant)

```json
{
  "event_id": "<crypto.randomUUID()>",
  "timestamp": "2026-05-12T18:42:11.123Z",
  "run_id": "<process.env.HIVE_RUN_ID or 'unknown'>",
  "metric_type": "prose-runbook-fallback",
  "skill": "<kickoff|plan|execute|null>",
  "method": "<createStory|updateStatus|linkStories|...>",
  "adapter": "<github|linear|/abs/path|null>",
  "code": "<AUTH_FAILURE|RATE_LIMIT|TIMEOUT|INTERNAL_ERROR|OPERATION_UNSUPPORTED|NOT_FOUND>",
  "gate_mode": "warning"
}
```

File path: `<state_dir>/metrics/events/prose-runbook-fallback-<ISO-sanitized>.jsonl`. One event per terminal occurrence (not deduplicated). Best-effort write; errors swallowed.

**Deltas from the c-5b story spec payload:**
- Story spec uses `event:`; this brief uses `metric_type:` per `metrics-event.schema.md` (canonical).
- Adds `event_id`, `run_id` (schema requires).
- Adds `code` (terminal ABI code — critical migration signal).
- Promotes `adapter` to required string (uses `null` literal when unset, not field omission).

### F4 — Warning text templates (per skill, mirrors w1 + c-5a)

c-5b AC #5 step 5 says "Add per-skill warning text when the fallback fires (matches the a-33/a-35 warning shape pattern)." Since a-33/a-35 stories aren't drafted, inherit from w1's template `Warning: <missing>. <remediation>. <current behavior>.`:

| Skill | Template |
|-------|----------|
| kickoff | `[hive] task-tracking dispatch failed during kickoff (<code> on <method>). Run /hive:kickoff with task_tracking.adapter set, or check tracker credentials. (gate_mode=warning — kickoff proceeding without tracker setup)` |
| plan | `[hive] task-tracking dispatch failed during plan (<code> on createStory for story <story-id>). Stories will be written to local YAML only; configure task_tracking.adapter to publish to tracker. (gate_mode=warning — plan proceeding without tracker publish)` |
| execute | `[hive] task-tracking dispatch failed during execute (<code> on updateStatus for story <story-id>). Local session state unchanged; tracker is now drift-prone. (gate_mode=warning — execute proceeding without tracker update)` |

The dispatch module emits a single generic `console.warn` (mirrors c-5a); skill callers may augment by logging the more specific template above using context they have (story-id, etc.) — that's a thin skill-side wrap consistent with AC #8 (no branching on adapter type).

### F5 — Smoke test path

**Existing tests in repo:** `hive/lib/task-tracking-dispatch/test/dispatch.test.ts` (unit, mock adapters, no network). No end-to-end smoke harness exists at `.pHive/tests/` or sibling paths.

**Recommended smoke script:** create `hive/lib/task-tracking-dispatch/test/smoke-github.mjs`:

```js
// Run: GITHUB_TEST_REPO=owner/repo GITHUB_TOKEN=ghp_... node smoke-github.mjs
import { TaskTrackingDispatch } from "../index.ts";

if (!process.env.GITHUB_TEST_REPO || !process.env.GITHUB_TOKEN) {
  console.log("SKIP: GITHUB_TEST_REPO + GITHUB_TOKEN env unset");
  process.exit(0);
}

const [owner, repo] = process.env.GITHUB_TEST_REPO.split("/");
const d = new TaskTrackingDispatch();
await d.load({
  adapter: "github",
  gate_mode: "warning",
  github: { token: process.env.GITHUB_TOKEN, owner, repo },
  state_dir: ".pHive",
});

const r = await d.invoke("createStory", {
  title: `c-5b smoke ${new Date().toISOString()}`,
  body: "Created by c-5b smoke test. Safe to close.",
  labels: ["hive-smoke"],
});

if (!r.ok) { console.error("FAIL:", r); process.exit(1); }
console.log("PASS: created", r.result?.url ?? r.result);
```

Document in dispatch README as the `npm run smoke:github` target. Pair with a `smoke-linear.mjs` analog (env `LINEAR_API_KEY` + `LINEAR_TEAM`).

**Additional smoke scenarios required by c-5b AC** (verify in `dispatch.test.ts` extensions, not real-API):
1. gate_mode=warning + adapter unset → c-5a `task-tracking-no-adapter` event written (covered by c-5a tests).
2. gate_mode=hard + adapter unset → NO_ADAPTER terminal returned (covered by c-5a tests).
3. gate_mode=warning + adapter throws AUTH_FAILURE → `prose-runbook-fallback` event written, `console.warn` fired, returns terminal-non-recoverable.
4. gate_mode=hard + adapter throws AUTH_FAILURE → no fallback event written, returns terminal-non-recoverable.
5. Skill-side branching grep: `grep -nE 'if .* (github|linear)' skills/{kickoff,plan,execute}/SKILL.md` → 0 hits.

### F6 — Files to create / modify

**Modify:**
1. `hive/lib/task-tracking-dispatch/index.ts` — add `writeFallbackTelemetry(method, code, skill?)`; call from `invoke()` on terminal-under-warning.
2. `hive/lib/task-tracking-dispatch/README.md` — document the new `prose-runbook-fallback` event under "Telemetry"; explain `_skill_context` opt-in param.
3. `hive/lib/task-tracking-dispatch/test/dispatch.test.ts` — assertions for fallback event emit (scenarios 3 + 4 above).
4. `skills/plan/SKILL.md` — insert step 13a after L329-331 (createStory dispatch).
5. `skills/execute/SKILL.md` — insert dispatch.invoke at L155/159 (pending→in_progress) and L171 (completed/cancelled).
6. `hive/references/kickoff-protocol.md` — insert dispatch.load() at the task-tracking config write point (~L661).

**Create:**
7. `hive/lib/task-tracking-dispatch/test/smoke-github.mjs` — end-to-end smoke harness.
8. `hive/lib/task-tracking-dispatch/test/smoke-linear.mjs` — Linear smoke harness analog.

**Do NOT modify:**
- `skills/kickoff/SKILL.md` — 26-line stub; the delegated protocol doc is the real target. Optional 1-line addendum if visibility is required.
- Story-YAML `status:` writes in execute — L206 marks them deprecated; dispatch handles external state only.
- Any prose-runbook references in `.pHive/epics/` story YAMLs / docs — those are planning artifacts, not runtime.

### F7 — Open questions for implementer (low-risk; safe defaults available)

| # | Question | Recommended default |
|---|----------|---------------------|
| Q1 | Should `_skill_context` be a top-level invoke param (`dispatch.invoke(method, params, { skill: "plan" })`) instead of polluting `params`? | **Yes — separate options arg.** Cleaner ABI hygiene; no need for dispatch to strip skill context before forwarding. |
| Q2 | Per-process emit-once for fallback (like no-adapter) or per-occurrence? | **Per-occurrence.** Each terminal failure is a distinct migration signal; aggregator in c-6/Epic-B-a-36 needs the volume. |
| Q3 | Should execute call `updateStatus` to `in_progress` on session pending **and** active, or just on active? | **Just on active (L159 transition).** Pending is "session record exists"; in_progress mirrors "agent attached". |
| Q4 | Failed-session state mapping — GitHub has no `cancelled` state, only `closed`. | Defer to adapter — pass `state: "cancelled"`; let github adapter map `cancelled` → `closed` with a label. |
| Q5 | If `dispatch.invoke` returns `RATE_LIMIT` (recoverable), should plan/execute retry inline or defer? | **Defer.** Skill-side retry loop adds complexity; log + continue + telemetry. Re-publish on next plan run if `story.tracker_id` empty. |

---

## RECOMMENDED IMPLEMENTATION ORDER

1. **Extend dispatch module first** (F2 + F3). New `writeFallbackTelemetry` + invoke() integration + tests. Mechanical change, fully unit-testable.
2. **Insert plan/SKILL.md citation** at L329-331 (createStory). Most visible value: stories get tracker URLs.
3. **Insert execute/SKILL.md citations** at L159 + L171 (updateStatus). Closes the lifecycle loop.
4. **Insert kickoff-protocol.md citation** at L~661 (load + capabilities probe). Pre-flight validation surfaces config errors early.
5. **Write smoke harness** (F5). Document skip-on-no-env semantics.
6. **Verify Open Questions** Q1-Q5 inline with implementer before merge.

**End of brief. Ready for `developer` step.**
