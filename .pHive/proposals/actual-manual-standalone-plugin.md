# Proposal — Actual-Manual as its own plugin (vision-cursor testing)

Status: scope decided 2026-06-16, spike-first (not yet built)
Source: extraction discussion off feat/actual-manual-tier (epic shipped, PR #295)
Supersedes the in-plugin-hive bridge surface as the long-term home for this tier.

## Why spin it off

The actual-manual tier carries a heavyweight, platform-specific prerequisite
stack that does not belong in an otherwise cross-platform orchestration plugin:

- Playwright (Node) + browser binaries
- `mlx-lm` (Python, Apple-Silicon-only) — **undeclared in any manifest today**
- Qwen2.5-VL-7B-4bit weights (~5GB, pulled from HF cache at first run)
- MLX sidecar lifecycle

CLAUDE.md already names this a "bridged-indefinite, isolated" surface. Extraction
finishes what the charter started: Hive's default install stays lean; the vision
stack installs cleanly only for those who opt in.

## What it does (product definition)

**Selectorless, vision-grounded, real-cursor flow testing for web.** Instead of
CSS selectors, a local vision model (Qwen2.5-VL) is the eyes and a real cursor is
the hands: screenshot → model grounds pixel coords → real click → model judges
"did the expected result happen," with DOM/network truth-signals authoritative
when declared. Catches pixel/visual failures DOM-based tools cannot see.

### In scope (v1)
- Web, Apple Silicon, local-only (no cloud inference)
- Hybrid per-step pass/fail verdict (vision judge + truth-signals)
- Standalone-usable (own CLI / scenario format) AND Hive-integrated

### Out of scope (v1, explicit follow-ons)
- Mobile / Maestro binding
- Visual-regression diffing, screenshot timelines
- CI / headless MLX provisioning (unsolved; design-discussion.md:74-75)

## Architecture — three layers (engine/agent split CONFIRMED)

1. **Engine (deterministic, structured-in only).** The hardened flow-runner
   (`runFlow` / `runActualFlow`), MLX sidecar lifecycle, bindings loader/validator.
   No LLM in the core. Fully testable headless. Hive and standalone share ONE engine.

2. **Synthesis agent (LLM).** Compiles intent into the engine's structured input.
   Autonomy = **synthesize a flow from a bare goal** (DECIDED: option #2): given a
   URL + natural-language goal ("log in, compose a post, confirm it appears"), the
   agent explores the page, decomposes into steps, decides native-vs-vision per
   step, declares truth-signals, and emits a scenario + overlay.

3. **Approval gate (REQUIRED — new primitive).** The synthesized test plan is
   rendered human-readable (ordered steps, what it will click, what it will verify)
   and MUST be approved before any browser action runs. This is what makes
   autonomous synthesis safe: the agent proposes, a human (or, in Hive, the
   orchestrator) disposes. Approve / edit / reject.

   Flow: `bare goal + URL → agent explores → synthesized plan → APPROVAL GATE →
   engine executes → hybrid report`.

## Two trigger faces, one agent

| | Trigger | Input | Compile + gate |
| --- | --- | --- | --- |
| **In Hive** | Specialist-trigger pulls the agent into the test team when UI work detected (reuse `specialist-triggers.md` machinery + ui-in-planning pattern) | Pre-structured story + scenario + overlay | Compile near-identity; gate may route to orchestrator or auto-pass on pre-authored plans |
| **Standalone** | `@`-agent in any session, own CLI, or slash-command | Loose: URL + English goal (± creds/session) | Full synthesis; gate surfaces plan to the human |

Standalone is just Hive's structured input minus the structure — the agent backfills it.

## Packaging (own plugin)

- New standalone Claude Code plugin (name TBD — e.g. `plugin-actual-manual` /
  product codename). Own marketplace entry, own installer, own release cadence.
- Engine + sidecar + bindings + agent + gate move out of plugin-hive into it.
- **Hive keeps a thin integration seam:** `/test actual` detects the plugin present
  → routes to it; absent → fails fast pointing at the installer. (Discovery
  mechanism — by plugin id vs registered-capability manifest vs config flag — still
  OPEN; lean toward registered-capability so Hive does not hardcode the plugin name.)
- **Installer ("just works"):** form OPEN (Python `setup`/`doctor` CLI is the
  leading candidate, matches am-5 sidecar-is-Python). Responsibilities: assert
  Apple Silicon/macOS → venv + pin `mlx-lm` → `playwright install chromium` →
  warm Qwen weights (flagged, ~5GB) → write resolved config → `probe_ready` green.

## Open decisions (carry into the spike)

1. Plugin name / product identity.
2. Hive↔plugin discovery contract (plugin-id detect vs capability manifest vs config).
3. Installer form factor (Python CLI vs brew vs npm postinstall).
4. Approval-gate UX in Hive context (orchestrator approval vs human vs auto-pass policy).
5. Scenario/overlay format for standalone authors (strict YAML vs looser authored form).

## Recommended next step — packaging + loop spike (spike-first, per decision)

Bounded spike proving the two riskiest things before committing to a build:

1. **Clean-install-just-works:** the engine + sidecar packaged as its own plugin,
   installer run on a fresh machine, `probe_ready` green, one scripted flow passes.
2. **Synthesis → gate → engine loop:** agent takes a bare goal + URL on one real
   web flow, synthesizes a plan, surfaces it at the approval gate, runs on approval,
   returns a hybrid verdict.

Decide the open packaging questions (1-3) from spike evidence, then plan the epic.
