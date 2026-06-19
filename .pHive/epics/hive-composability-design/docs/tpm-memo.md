# TPM Sequencing Memo — hive-composability-design

**Prepared for:** design discussion (Phase B)
**Scope:** short sequencing input — not full H/V (that's Phase B2)
**Source:** `research-brief.md` §4, §7, §10, §11
**Date:** 2026-04-16

---

## 1. First-slice viability — the slicing hint fails a stress test

The brief's §11 hint ("one epic, one planning run, lite mode end-to-end, with visually rich design discussion + structured outline") bundles **Workstream A (lite path) + Workstream D (rich outputs)** into Slice 1. Stress-testing this against the brief's own evidence:

- §4-D: "the design discussion must establish the format contract (Mermaid vs HTML vs image generation approach per artifact type) **before any Workstream D story can be written**" (§11 echo). This makes Workstream D's own design discussion a blocker for Workstream D implementation — a format contract must exist before any rich output can render.
- §7 Decision 3 defers HTML-primary vs. markdown-with-embedded-HTML "until we can measure." Slice 1 cannot measure without a reference render to measure against.
- §4-A "lite mode" is a docs/instructions change at `skills/plan/SKILL.md:120-134` (single insertion point per §9). Its cost is low and independent of format.

**Real minimum viable first slice:** Split the bundled hint into two ordered slices:

- **Slice 1 (format contract, thin):** *Design-discussion output contract only* — decide Mermaid-vs-HTML-vs-image per **design discussion document only** (not structured outline, not PRD). Produce one rendered reference design-discussion artifact for this epic as the proof. This is the thinnest Workstream D + design-discussion skill change that can ship.
- **Slice 2 (lite end-to-end):** Wire `--lite` into `skills/plan/SKILL.md` so the epic's own second planning run can demonstrate lite mode + rich design discussion + structured outline on a single thread.

Structured-outline and PRD format contracts defer to later slices. This preserves §11's "MVP-spine" intent but corrects the hidden ordering: **format contract for design discussion ships before lite mode goes end-to-end**, because lite mode's whole point is a visually rich design-discussion pass, and that needs the contract rendered first.

---

## 2. Cross-epic sequencing with `memory-autonomy-foundation`

Research brief §8 open question 4 flagged `session-prompt-spec` (S7) existence as unverified. **Verified today: `hive/references/session-system-prompt-spec.md` exists (11.5KB, last edited 2026-04-14).** Recent git log confirms Phase 1 and most of Phase 2 of memory-autonomy have landed (kg-import, session-registry, story-execution-migration, specialist-trigger-migration, session-resilience, session-runtime-bridge — all merged).

**Prerequisite classification for Workstream B:**

| Memory-autonomy story | Hard prereq (can't start) | Soft prereq (can start, can't ship) |
|---|---|---|
| `session-prompt-spec` (S7) | Hard — governs memory-context injection contract | — |
| `kg-write-path`, `kg-read-path` | — | Soft — B2 story can design against schema |
| `chromadb-wrapper`, `chromadb-integration` | — | Soft — B2 can stub `isAvailable()` |
| `session-end-integration` | — | Soft — B2 needs 3-op close working at merge time |

All hard prereqs appear satisfied today. **Planning and structural work on Workstreams A, C, D can proceed in parallel with any remaining memory-autonomy Phase 2 work**; Workstream B story YAML authoring can begin now, but merging B stories must wait on the specific Phase 2 stories above where they are still open.

**Planner action (for H/V):** surface `session-prompt-spec` as a named cross-epic dependency in the horizontal plan's Cross-Layer Dependencies section per §10, and verify at story-YAML-authoring time (not before) that the remaining Phase 2 stories have merged.

---

## 3. Workstream ordering rationale — propose a revision

The brief proposes A + D first, then B + C. After stress-test:

- **Workstream C is nearly free** per §4-C and §9-C: frontmatter `model:` is already live, `model_overrides: {}` is empty but plumbed, Haiku guardrail is a documentation change. Scope is (a) document the contract, (b) populate config, (c) clarify precedence, (d) enforce guardrail. This is a **2–3-slice parallel quick win**, not a later workstream. It has zero dependency on A, B, or D.
- **Workstream A lite mode** has no dependency on D once the format contract exists. It parallelizes with D-after-slice-1.
- **Workstream B** remains last because it depends on memory-autonomy Phase 2 at merge time.

**Revised ordering proposal (for H/V):**

1. **Slice 1 — Design-discussion format contract** (D seed + design-discussion skill update)
2. **Slice 2 — Lite mode end-to-end** (A core) — runs on this epic's own next plan run as verification
3. **Slice 3 — Model tiering docs + config** (C, parallelizable with slice 2) — the quick win
4. **Slice 4 — Structured outline + H/V rich formats** (D expansion)
5. **Slice 5 — PRD HTML vehicle** (D expansion, optional per epic)
6. **Slices 6+ — Respawn-per-task lifecycle + memory bridging** (B, gated on mem-autonomy Phase 2)

**Inter-workstream dependency the brief understates:** §11 names `--lite` mode as independent of the format contract, but lite mode's *value* is a visually-rich design discussion in lite scope. Without the format contract, lite mode ships as "plain-markdown lite" and the demo loses its selling point. Treat the format contract as a soft prereq for lite mode's **user-facing milestone** (hard prereq for the demo; soft prereq for the code change itself).

---

## 4. Risk-to-sequence

- **Risk 1 — Decision 3 deferral (HTML-primary vs. markdown-embedded-HTML) is load-bearing for D.** The design discussion must pick a working default before Slice 1 ships. "Deferred until we can measure" is incompatible with "Slice 1 renders a reference artifact." Recommendation: design discussion forces the call for design-discussion doc only (per §7 default: markdown-with-embedded-HTML), leaves structured outline/PRD unresolved.
- **Risk 2 — Open Question 1 (effort-estimator thresholds) blocks lite-mode auto-promotion.** Lite can ship with manual `--lite` flag only. Auto-promotion is a later slice. Don't bundle.
- **Risk 3 — Workstream B merge gate.** If any memory-autonomy Phase 2 story (session-end-integration specifically) regresses or stalls, B stories pile up. Mitigation: plan B as the last 2–3 slices, not the first non-trivial ones.
- **Risk 4 — Terminal-degradation (§4-D open)** is a design-discussion question. If unresolved, HTML artifacts render as raw markup in terminal viewers — bad DX for agents reading their own outputs. Must be addressed in the design discussion.

**If the epic is cut in half — minimum that still ships value:**
Slices 1 + 2 + 3 (format contract for design discussion + lite mode + model tiering docs). That's the composability + model-economy + design-awareness MVP. Workstreams B and the D-expansion slices can split off as a follow-on epic without breaking the value story. The design-discussion gate invariant holds in the minimum cut because doc-production is always-on by definition.

---

**Net:** the single-slice hint in §11 is too ambitious; split it into a format-contract slice and a lite-mode slice. Promote C to a slice-3 quick win. Keep B last, gated on memory-autonomy Phase 2 merges. Force Decision 3 (HTML-primary vs. markdown-embedded) to resolve for design-discussion doc only during the design discussion. Minimum-ships-value cut is slices 1–3.
