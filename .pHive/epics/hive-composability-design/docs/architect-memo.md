# Architect Stress-Test Memo: hive-composability-design

**Author:** architect (planning team)
**Date:** 2026-04-16
**Purpose:** Surface sequencing hazards, format-contract gaps, and undecided seams for the design discussion. Not a design doc.
**Reads against:** `state/epics/hive-composability-design/docs/research-brief.md` and `state/research-brief-hive-composability-design.md`.

---

## 1. Workstream B — respawn-per-task + memory bridging

### 1a. What "depends on memory-autonomy-foundation" actually means

Direct inspection of `state/epics/memory-autonomy-foundation/stories/*.yaml` shows every story is `status: pending` in YAML, but `git log --oneline` shows at least seven Phase 1/2 stories have already merged (session-prompt-spec, session-runtime-bridge, session-registry, session-resilience, story-execution-migration, specialist-trigger-migration, kg-import). **The story YAMLs are stale relative to git reality.** Planners must not use YAML status as the sequencing source of truth for this dependency — use git log.

**Gating matrix for Workstream B:**

| Memory-autonomy story | Required before B story? | Why |
|---|---|---|
| `session-prompt-spec` (S7) | MUST be merged first | Governs system-prompt injection contract B must call into. **Already merged (`204a1b6`).** |
| `story-execution-migration` (S9) | MUST be merged first | Session-based execute path is the *only* surface respawn-per-task plugs into. Already merged (`967a1d4`). |
| `kg-write-path`, `kg-read-path` | MUST be merged first for KG-backed bridging | step 5e KG decision-context injection in agent-spawn needs these. |
| `chromadb-wrapper`, `chromadb-integration` | SHOULD be merged first; degradation path exists | L3 semantic rerank is optional per `agent-spawn/SKILL.md:73-74`. Workstream B can ship with L0/L1 fallback and upgrade when L3 lands. |
| `session-end-integration` | CAN be parallel-developed | 3-op session close is orthogonal to the bridge-on-spawn path. |
| `autonomous-loop-validation` | Not a prerequisite | Validation work, not a consumed interface. |

**Sequencing verdict:** B's critical-path is only S7 + S9 + kg-write/read-path. Everything else is parallel-safe. That's a much tighter bottleneck than the research brief implies.

### 1b. Is the existing respawn summary rich enough as a memory-bridging carrier?

`skills/hive/skills/respawn/SKILL.md:74-113` defines the summary schema. Sections are: Current Position, Work Completed, Work Remaining, Non-Obvious Context, Active Blockers, Open Questions. **This schema was designed for context-pressure respawn — same agent, same step, mid-flight handoff.** It is not designed for cross-story memory bridging.

Gaps for per-task respawn bridging:
- **No structured insights field.** Bridging assumes the new agent reads `state/insights/` and `state/episodes/`; the summary's "Non-Obvious Context" is freeform prose, not a queryable insights pointer.
- **No "what the *previous story* established" slot.** Per-task respawn crosses story boundaries (story N → story N+1), not step boundaries. The schema assumes a single `story_id`.
- **No decision-context handoff.** The KG decision-context block (`agent-spawn/SKILL.md:117-127`) is loaded at spawn from the graph, not from the summary — so KG replaces some bridging need but not prior-story codebase observations.

**Recommendation:** Workstream B needs a *separate* carrier — call it a **story-handoff summary** — not a reused respawn summary. Same directory is fine (`state/respawn-summaries/`) but a different filename convention (e.g. `{agent}-handoff-{to-story-id}.md`) and a schema that points at insights + episodes explicitly. Conflating the two will cause the existing schema to drift in confusing ways.

### 1c. Mode collision at the step 7b injection point

`agent-spawn/SKILL.md:188-206` — `respawn_summary_path` is a single optional parameter. Today it means "this is a context-pressure respawn, load continuation context." If per-task respawn reuses the same parameter, the prompt preamble text ("You are continuing work from a previous instance of yourself (respawn iteration {N})") is *wrong* for cross-story handoff — the new agent is not continuing the same step, it is starting a new story with prior context.

**Two viable approaches:**
- **(i) Two parameters, shared code:** `respawn_summary_path` (context-pressure) + `handoff_summary_path` (per-task). Step 7b reads either, but uses different preamble text. Shared carrier directory, shared parser.
- **(ii) One parameter, tagged payload:** Keep `respawn_summary_path` but add a frontmatter field `mode: context-pressure | story-handoff` that controls preamble generation.

(i) is cleaner — preamble intent is part of the *call*, not part of the file. It also keeps context-pressure respawn unchanged for backwards-compat. Recommend (i).

### 1d. Sequencing hazard — restated for the plan YAMLs

Workstream B stories that (1) extend step 7b, (2) define the handoff schema, or (3) wire into the session execute path must sequence **after** `session-prompt-spec` and `story-execution-migration` land. Both are already merged, but the plan YAML authoring still needs to cite them as `depends_on` so the dep graph stays honest. If the plan lands before those YAML statuses are refreshed, the dependency graph will look circular/inverted.

---

## 2. Workstream D — rich planning outputs

### 2a. Token measurement is a prerequisite story, not an implementation detail

Decision #3 defers the HTML-primary vs. markdown-with-embedded-HTML choice to "whichever costs fewer tokens once we can measure." **Nothing in the codebase measures artifact-read token cost today.** No telemetry in plan/execute skills. The measurement stack does not exist.

This is a story, not a footnote. Candidate: `doc-token-telemetry` — a minimal probe that (a) counts tokens in a produced artifact via `@anthropic-ai/tokenizer` or equivalent, (b) logs to `state/telemetry/` when artifacts are written. Small, but it gates the format decision. Without it, every D-adjacent story re-litigates the format choice.

### 2b. Where HTML artifacts live on disk

No precedent exists. Options:

- **Sidecar pattern.** `design-discussion.md` + `design-discussion.html` in the same directory. Markdown is canonical; HTML is generated from markdown + embedded blocks on write. Read path decides which to open.
- **Single file with inline HTML.** Markdown-with-embedded-HTML-blocks. GitHub renders it; terminal degrades to raw tags visible.
- **HTML-primary with markdown extracted.** HTML canonical, markdown generated (or skipped).

The existing brand system (`state/brand/brand-guide.html`) uses the sidecar pattern (`brand-system.yaml` + `brand-guide.html`). That's the only in-repo precedent for HTML artifacts, and it's a clean separation. **Workstream D should follow it.** Canonical artifact is the markdown (or YAML); HTML is a rendered sibling generated from it.

### 2c. Terminal degradation — markdown-embedded is safer

HTML-primary with a markdown fallback is theoretically equivalent to markdown-with-embedded-HTML, but practically worse for terminal users:
- `cat design-discussion.md` in a terminal with inline `<img>` tags shows the tags as text. Ugly, but readable.
- `cat design-discussion.html` shows the full HTML scaffolding. Unreadable.
- A grep across planning docs (common in hive workflows) breaks completely on HTML-primary.

**This is not format-neutral.** Markdown-with-embedded-HTML preserves the grep/read-in-terminal workflow that the rest of the skill surface depends on. The token measurement might still favor HTML-primary on some dimension, but the terminal workflow cost is already asymmetric before measurement.

Recommend the design discussion treat markdown-with-embedded-HTML as the strong default, not just a placeholder, and measurement must beat it by a meaningful margin to flip it.

### 2d. Mermaid migration for horizontal-plan / vertical-plan

ASCII diagrams at `skills/hive/skills/horizontal-plan/SKILL.md:89-109` and `skills/hive/skills/vertical-plan/SKILL.md:97-122` are templates in the skill itself — they are not renderings of a data structure. Migrating them to Mermaid is a two-step change:

1. Update the skill's example output block to show Mermaid.
2. Update the skill's prompt text to tell the authoring agent to emit Mermaid instead of ASCII.

**There is no data model to migrate.** The ASCII is generated per-epic by the agent reading the epic graph, not from a structured source. Mermaid adoption is a prose-template change, reversible, and cheap. Existing horizontal/vertical plan docs in-repo (e.g. `memory-autonomy-foundation/docs/vertical-plan.md`) stay as-is unless explicitly regenerated — there's no schema migration.

### 2e. Format-contract gap

Decision #3 defers the format choice. **But the format contract — what kinds of embedded content are allowed, how images are sourced, how Mermaid blocks are delimited — must be decided *in the design discussion* of this epic.** If it isn't, every Workstream D story ends up debating image sourcing (Frame0? placeholder? user-supplied?) and Mermaid-vs-image-vs-HTML scope on its own.

Recommend the design discussion produce a one-page **format contract** artifact (not deferred) covering: allowed embedded content per doc type, image source policy, Mermaid delimiter convention, and the sidecar-HTML generation rule.

---

## 3. Other architectural risks and seams

- **Phase-scoped lifecycle default.** The brief says lifecycle default "varies by phase" — long-running for design/planning, respawn-per-task for development. Nothing in `hive.config.yaml` today has phase-scoped config keys. Workstream B needs to decide: one key with phase-scoped overrides, or multiple keys (`planning.teammate_lifecycle`, `execution.teammate_lifecycle`). The latter matches existing config shape (`planning.collaborative_review` at `:134-136`).
- **Effort estimator signals are not architectural today.** Workstream A's effort estimator needs a real signal source. `SCALE ASSESSMENT` from `design-discussion/SKILL.md:97-110` produces qualitative output ("small/medium/large"), not quantitative signals. The planner must decide whether to parse that prose or introduce a structured scale-assessment schema. Prose-parsing is fragile; structured is a breaking change for the design-discussion output contract. Surface in planning.
- **Lite-mode sign-off collapse.** "Auto-skip redundant sign-offs when only one persona weighs in" requires knowing, at plan time, who will weigh in. Today the plan skill decides persona participation after design discussion. Collapsing requires either (a) doing persona resolution earlier, or (b) collapsing at runtime in execute, not plan. (b) is cheaper and safer.
- **Design-discussion doc-production vs. review separation.** The brief notes these are "currently coupled" — concretely, they're the same skill. Separating them is a skill-level refactor: `design-discussion/SKILL.md` today produces the doc *and* runs the collaborative review. Splitting is a breaking contract change (callers relying on one skill doing both). This is a bigger plumbing change than the brief suggests and warrants its own story.
- **Respawn summary staleness / story YAML drift.** General observation: the YAMLs say `pending` while seven merged commits indicate otherwise. This is a process gap upstream of this epic, but it bites this epic directly because our B dep-graph relies on memory-autonomy status. Recommend the plan include a one-shot "refresh memory-autonomy-foundation story statuses from git" task before writing any B story YAML.

---

## 4. TL;DR for planning

- **B's real critical path is just S7 + S9 + KG read/write paths — all already merged.** Tighter than the brief implies. The dep-graph problem is stale YAMLs, not actual blockers.
- **B needs a new carrier (`story-handoff summary`), not a reused respawn summary.** Two concerns, two schemas, same directory.
- **Step 7b should take two parameters, not one tagged payload.** Cleaner, backwards-compatible.
- **Workstream D needs a `doc-token-telemetry` prerequisite story** before Decision #3 can resolve.
- **Sidecar HTML (follow brand-system precedent), markdown canonical, markdown-with-embedded-HTML preferred** — terminal degradation asymmetry already argues against HTML-primary pre-measurement.
- **A format-contract artifact is a design-discussion output** — do not let it drift into per-story debates.
- **Refresh memory-autonomy-foundation story statuses from git** before writing any B story YAML.
