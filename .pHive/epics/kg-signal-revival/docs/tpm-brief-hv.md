# TPM Brief — KG Signal Revival H/V Planning

**Author:** tpm
**Phase:** B2 (Horizontal/Vertical planning input to technical-writer)
**Date:** 2026-05-13
**Status:** Brief for writer render. Writer produces final `horizontal-plan.md` and `vertical-plan.md` using horizontal-plan and vertical-plan skills.

---

## Process note

This brief is produced **without** the prior Phase A research brief or Phase B design discussion (those phases did not run before B2 was dispatched to TPM). Brief is anchored on the orchestrator's diagnostic context. If a Phase A/B artifact is produced later, the writer should reconcile and revise.

## Epic classification

**Type:** Config/routing/instrumentation epic with secondary runtime-behavior layer.

**Working-state reading:** **Pragmatic** at all slice boundaries except the meta-optimize tuning slice (apply strict there — it observably changes proposal output).

**Stop-ship test per slice:** "If we shipped immediately after this slice alone, would planning still work, would no half-instrumentation be dangling, would the KG remain queryable?"

## Epic one-line promise

> "Hive's KG and ChromaDB pipelines emit, persist, and surface enough signal that `/meta-optimize` consumes KG-derived planning proposals, decisions have an audit trail, and cross-project learnings reach the current project's planning gates."

## Subsystem seam analysis

The task #6 description gives 7 horizontal layers. Mapping to subsystem seams:

| Subsystem | Sub-layers (from task #6 layers) |
|---|---|
| **Emit** (write-path instrumentation) | (1) instrumentation in agent personas/skills, (2) lifecycle write paths in workflow steps |
| **Persist** (storage warm-up) | (3) ChromaDB warm + collection bootstrap |
| **Reference** (cross-project state) | (4) multi-project registry expansion |
| **Consume** (read-path signal) | (5) telemetry/hit-rate surfacing, (6) retrospection UX, (7) meta-optimize tuning |

Four subsystems → expect 6-10 slices once sub-layers split.

## B0 sliver — REQUIRED

**Trigger fires.** Consumer (meta-optimize, retrospection UX, telemetry) shapes what predicates carry, what registry rows look like, what fields ChromaDB metadata needs.

If we instrument predicates before defining consumer query surface, we **re-emit** later — expensive, breaks decision audit trail (mid-epic predicate rename = orphan triples).

**B0 = consumer-contract sliver, docs-only, ~2 stories:**

- **B0.1** `consumer-contracts.md`: For each of the 8 unused lifecycle predicates (superseded, assigned_to, blocked_by, depends_on, phase_started, phase_complete, phase_failed, phase_blocked) — name the consumer query that needs it. If no consumer queries it, defer instrumentation. (Trims emit scope.)
- **B0.2** `registry-and-chroma-contract.md`: Required registry row shape for cross-project lookups. Required ChromaDB collection schema + metadata fields for retrospection UX. Required telemetry envelope for hit-rate (KG-proposed vs accepted ratio per cycle).

B0 gates: emit-subsystem schema slices and ChromaDB collection slice. B0 does NOT gate parallel work (e.g., registry directory scaffold).

## Horizontal layer map (for writer to render via horizontal-plan skill)

The writer should produce a table of architecture layers × items × cross-layer dependencies. Layers in row order:

1. **KG SQLite (kg.sqlite)** — predicate schema, triple write API, query helpers
2. **ChromaDB wrapper (`hive/lib/chromadb-wrapper.js`)** — bootstrap, collection lifecycle, embedding write/read
3. **Project registry (`~/.claude/hive/projects.yaml`)** — schema, add/list/lookup operations
4. **Agent personas / skills** — emit-site instrumentation (where triples get written from workflow steps)
5. **Workflow steps (`hive/skills/*/step-*.md`)** — lifecycle-event-bearing steps that fire predicate writes
6. **/meta-optimize routing** — KG-proposal-source step (kg-augmented-meta-signal landed it at step-02c-kg-signal — verify state)
7. **Retrospection UX** — slash command(s) or output surface that lets user query KG
8. **Telemetry / hit-rate** — counters for proposals_from_kg, accepted_proposals_from_kg, predicate-emission counts, ChromaDB query latency

Cross-layer dependencies the writer must enumerate:
- L1↔L4: which persona emits which predicate (B0.1 names them)
- L1↔L5: which workflow step fires which lifecycle predicate
- L2↔L7: ChromaDB collection shape ↔ retrospection UX queries (B0.2 names them)
- L3↔L6: registry row shape ↔ what meta-optimize reads when surfacing cross-project proposals (B0.2)
- L8↔L1,L2,L3: telemetry envelope shape ↔ what each emit/persist subsystem records (B0.2)

## Vertical slice plan (for writer to render via vertical-plan skill)

Proposed slice sequence — writer may restructure if subsystem seams suggest otherwise (per `adjudicating-writer-pushback`):

### Min-viable-ship cut (named per `min-viable-ship-identification`)

**Cut = B0 + S1 + S2 + S3 + S5.** Delivers epic promise without S4 (cross-project registry expansion) or S6 (retrospection UX). S4 and S6 are scope-class expansion.

### Slice sequence

| # | Name | Subsystem | Sub-layer | WHAT WORKS | COMMIT |
|---|---|---|---|---|---|
| **B0** | Consumer contracts | (docs) | — | The 2 contract docs exist; emit-side schema work has a target to validate against. Inspectable; no runtime change. | `docs(kg-signal): consumer + storage contracts` |
| **S1** | Lifecycle predicate schema + emit foundation | Emit | sub-layer 1 (schema) | KG accepts the new predicate set; one persona emits one new predicate end-to-end (e.g., architect emits `depends_on`); rest are scaffolded but not yet wired. | `feat(kg): lifecycle predicate schema + architect emit` |
| **S2** | Lifecycle predicate full instrumentation | Emit | sub-layer 2 (personas + steps) | Remaining personas/steps emit their contracted predicates. KG triple count grows on every plan/execute cycle. (Parallelizable with S3.) | `feat(kg): full lifecycle predicate emit` |
| **S3** | ChromaDB bootstrap + collection | Persist | — | `chromadb-wrapper.js` initializes a real collection on first use; embeds at least one document type (e.g., decision records). Queryable from a test harness. (Parallelizable with S2.) | `feat(chroma): bootstrap + decision collection` |
| **S4** | Multi-project registry expansion | Reference | — | `projects.yaml` schema supports multiple projects; lookup helper resolves cross-project queries; one second project registered as fixture. **OUT OF MIN-SHIP CUT** — scope-class expansion. | `feat(registry): multi-project schema + lookup` |
| **S5** | Meta-optimize KG tuning + telemetry | Consume | sub-layer 1 (meta-optimize, telemetry) | `/meta-optimize` produces ≥1 KG-derived proposal in a real cycle. Telemetry counters record `proposals_from_kg` and `accepted_proposals_from_kg`. STRICT working-state reading. | `feat(meta-optimize): KG signal + hit-rate telemetry` |
| **S6** | Retrospection UX | Consume | sub-layer 2 (UX) | User-facing surface (slash command or planning-step output) lets user query decisions/predicates from KG/ChromaDB. **OUT OF MIN-SHIP CUT.** | `feat(retro): KG retrospection surface` |

### Sequencing rationale

- B0 first — schema-shape risk dominates.
- S1 before S2 — high-blast-radius KG schema migration ships first as a thin slice (one persona, one predicate). Reviewer can scrutinize the diff. S2 is then mechanical replication.
- S2 ∥ S3 — different subsystems, no shared files. Parallelization opportunity per `invisible-parallelism-in-sequential-plans`.
- S4 deferred — cross-project value depends on having >1 project actively producing KG signal. Premature without S5 driving signal volume.
- S5 next — first slice with strict working-state (observable runtime change). All emit/persist subsystems are required inputs.
- S6 last — UX layer reads from now-warm KG + ChromaDB. Deferrable.

### Moldability notes (for vertical-plan §6)

- **If scope compresses:** drop S6 first (UX is expansion). Then S4 (cross-project is expansion).
- **If S3 (ChromaDB) hits resource cost issue:** S5 telemetry can ship without ChromaDB hits; meta-optimize KG signal works from SQLite predicates alone. ChromaDB becomes its own follow-on epic.
- **If S2 reveals a missed predicate:** B0.1 was wrong; pause S2, revise B0.1, resume. Catching it at S2 (mechanical replication) is the cheapest place.

### Open questions for design-discussion gate (escalate up if writer can't resolve from research brief)

1. Is `kg-augmented-meta-signal` step-02c-kg-signal still wired in the current `/meta-optimize` skill, or did it regress? (Affects whether S5 is "wire it up" or "verify + tune".)
2. ChromaDB resource cost — is local bootstrap feasible for a single user's dev loop, or does S3 require an opt-in flag? (Affects S3 thinness.)
3. Predicate over-emission risk (raised in initial brief) — does B0.1 sufficiently constrain it, or do we need an emit-side rate limit slice?
4. Cross-project signal — when a second project's KG informs the current project's planning, what's the trust boundary? (May escalate `security:plan-audit`.)

## Escalation flags to consider

TPM is not raising flags at this brief stage (no security/perf/UI surface change yet defined enough to flag). Reserved decision until structured outline review (Phase B3).

Candidate triggers to evaluate at B3:
- `security:plan-audit` — if S4 cross-project signal crosses a trust boundary
- `performance:audit` — if S3 ChromaDB warm-up adds non-trivial latency to planning gates

## Writer brief — what to render

1. **horizontal-plan.md** using the horizontal-plan skill. Layers above, items per layer, cross-layer dependencies enumerated. Use the dependency list as input.
2. **vertical-plan.md** using the vertical-plan skill. Slice sequence above with WHAT WORKS / COMMIT statements per slice. Include the overlay diagram (layers × slices). Name the epic classification (config/routing) and working-state reading (pragmatic) in §1 Slicing Strategy. Write the min-viable-ship cut into §6 Moldability.
3. If the subsystem-seam analysis above suggests a slice restructure (e.g., S2 should split into emit-persona vs emit-step sub-layers, or S5 should split into routing vs telemetry), the writer SHOULD restructure — but flag the restructure explicitly in §1 so TPM can audit the substantive merits per `adjudicating-writer-pushback`.

**Lock from this brief (do not reopen during render):**
- Epic classification = config/routing/instrumentation (pragmatic working-state)
- B0 sliver = REQUIRED, docs-only, ~2 stories
- Min-viable-ship cut = B0 + S1 + S2 + S3 + S5
- S4 and S6 explicitly out of cut

**Open for writer judgment:**
- Slice count and sub-layer splits within the subsystem seams
- Exact WHAT WORKS phrasing
- Whether B0.1 and B0.2 collapse into one B0 story or stay two
