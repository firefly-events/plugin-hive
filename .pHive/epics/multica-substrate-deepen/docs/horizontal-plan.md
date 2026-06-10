# Horizontal Plan — Multica Substrate-Deepen

**Epic:** `multica-substrate-deepen`
**Status:** Post-grill, post-user-decision
**Decisions locked:** Large scope, Mode D-a (read-only export), Squad-evaluation fires at PR-open / ticket-to-review (NOT at merge), Autopilots conservative (metrics-check + visual-qa only)

## Architectural layers touched

The epic spans seven horizontal layers. Each layer is a coherent change surface; cross-layer dependencies are enumerated below.

### L1 — Multica server (read-only inspection)

**Inspected, not modified.** No commits go upstream into `~/Code/spikes/multica`. The epic treats Multica server as ground truth and probes it via:
- `multica agent create --help` exhaustive flag inspection
- `~/Code/spikes/multica/cmd/cli/` source for codex-provider enum confirmation
- `~/Code/spikes/multica/server/internal/handler/issue.go` (and squad/autopilot/skill equivalents) for endpoint shape

**Outputs from this layer:** three written findings (S0.1/S0.2/S0.3) at `.pHive/epics/multica-substrate-deepen/docs/spike-findings/`.

### L2 — Adapter (`hive/adapters/multica/`)

**Modified.** ABI bumps from 1.0.0 → 1.1.0 if Phase B = squad-eval-wire (Q3 ≠ roster-only).

- New methods: `getSquadActivity(issueId)`, `updateIssueStatus(issueId, status)` (for PR-open → review state transition)
- Updated friction-notes.md with ABI 1.1.0 deltas
- README updated with squad-eval contract

**Cross-layer dependency:** S0.2 spike output (L1) determines exact method signatures.

### L3 — Bootstrap (`hive/lib/multica-bootstrap/`)

**Modified.** `reconcileAgents` extended for N-persona batch operations.

- Single `agent list` call, diff against agents.yaml, batched upserts
- New: squad reconcile (`reconcileSquads` — three squads created/patched against `.pHive/multica/squads.yaml`)
- New: autopilot reconcile (`reconcileAutopilots` — autopilots created from `.pHive/multica/autopilots.yaml`)
- New: skill reconcile (`reconcileSkills` — runtime copies imported from skill bundles)

**Cross-layer dependency:** new YAML schemas (L7) gate the reconciler shape.

### L4 — Dispatch (`hive/lib/multica-story-dispatch/`)

**Modified.** `serializeStoryBrief` conditional on S0.1.

- If codex-native: drop `codexInstruction` flag entirely; brief carries no rescue indirection
- If codex-not-native: leave intact
- New: `recordSquadEvaluation(issueId, evaluation)` called from `/execute` integrate step at PR-open moment
- Episode marker schema extended with `squad_evaluation` field

### L5 — Execute skill (`skills/hive/skills/execute-mode-multica/SKILL.md`)

**Modified.** Step 3 (episode marker per terminal) extended to fire squad-evaluation at integrate-complete moment (NOT at merge).

- New sub-step: after `git push` and PR-open, write `squad activity` record via adapter `getSquadActivity` + `updateIssueStatus(in_review)`
- Conditional on squad presence in `.pHive/multica/squads.yaml`

### L6 — Plan skill (`skills/plan/SKILL.md`)

**Touched lightly.** Phase D step (currently absent for Mode D-a) added — once Mode D-a tooling exists, plan emits a manifest of substrate files for each story's skill dependencies.

### L7 — Configuration (`.pHive/multica/` + new YAML schemas)

**Modified + new files.**

- `.pHive/multica/agents.yaml` — expanded 3 → ~20 (dispatchable subset)
- `.pHive/multica/squads.yaml` (NEW) — three squads with leader + member personas
- `.pHive/multica/autopilots.yaml` (NEW) — two autopilots (metrics-check + visual-qa)
- `.pHive/multica/skills-export.yaml` (NEW) — manifest of which plugin-hive skills get exported + their substrate dependencies
- `hive/references/multica-squads-schema.md` (NEW) — schema doc
- `hive/references/multica-autopilots-schema.md` (NEW) — schema doc
- `hive/references/multica-skills-export-schema.md` (NEW) — schema doc
- `hive/references/squad-evaluation-contract.md` (NEW) — substrate-signal contract

## Cross-layer dependency edges

```
L1 (spikes) ──┬──> L2 (adapter)         # S0.2 shapes squad-read methods
              ├──> L3 (bootstrap)       # S0.1 shapes persona provider routing
              └──> L7 (config)          # S0.3 shapes skill-export visibility flag

L7 (config schemas) ──> L3 (bootstrap reconcilers)
L2 (adapter ABI 1.1.0) ──> L4 (dispatch squad-eval) ──> L5 (execute step 3)
L7 (agents.yaml expansion) ──> L3 (reconcileAgents N-persona)
L7 (skills-export.yaml) ──> L6 (plan emits manifests) + L3 (reconcileSkills materializes)
```

## Layer ownership

| Layer | Primary persona | Verifier |
|---|---|---|
| L1 spikes | researcher | architect |
| L2 adapter | backend-developer | reviewer |
| L3 bootstrap | backend-developer | reviewer |
| L4 dispatch | backend-developer | reviewer |
| L5 execute skill | technical-writer | architect + reviewer |
| L6 plan skill | technical-writer | reviewer |
| L7 config schemas | technical-writer | architect |

## Why this horizontal cut

- L1 is read-only inspection — feasibility-first per `feedback_test_offtheshelf_before_rewriting`.
- L2-L4 form a tight backend stack that all change together when ABI bumps; treating them as one wave avoids partial-state confusion.
- L5-L6 are skill-layer changes (process / scaffolding) consumed by `/execute` and `/plan` themselves.
- L7 is configuration substrate — schemas land first, reconcilers come second.
