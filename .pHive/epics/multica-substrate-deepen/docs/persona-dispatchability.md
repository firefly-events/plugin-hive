# Persona Dispatchability Classification

**Criterion:** "Produces useful output from one bounded task input without spawning subagents."

**Dispatchable subset count: 22 of 25**

Harness-only personas (3): `orchestrator`, `team-lead`, `pair-programmer`

Consumed by W1.2 (agents.yaml expansion) to determine bootstrap subset.

---

## Dispatchable (22)

| Persona | Verdict | Rationale |
|---------|---------|-----------|
| `accessibility-specialist` | dispatchable | Receives bounded input (component/file), produces a11y-remediated code using read+edit tools; no coordination needed |
| `analyst` | dispatchable | Receives bounded input (idea/epic), produces testable requirements doc using read-only tools |
| `animations-specialist` | dispatchable | Receives bounded input (design brief/component), produces animation implementation using read+write tools |
| `architect` | dispatchable | Receives bounded input (problem statement), produces architecture design doc using read-only tools |
| `backend-developer` | dispatchable | Receives bounded input (story spec), produces backend implementation using read+write tools |
| `developer` | dispatchable | Receives bounded input (story spec), produces implementation using read+write tools; deprecated — prefer `frontend-developer` or `backend-developer` |
| `frontend-developer` | dispatchable | Receives bounded input (story spec), produces UI implementation using read+write tools |
| `idiomatic-reviewer` | dispatchable | Receives bounded input (code files), produces idiomatic review report using read-only tools |
| `peer-validator` | dispatchable | Receives bounded input (story set), produces cross-story consistency + integration-risk report using read-only tools; no subagents needed. Borderline per grill H3 — confirmed dispatchable by design discussion §2 Q2: "Peer-validator is dispatchable as a verifier." Provisional classification; formal test-dispatch confirmation pending W1.2 gate. |
| `performance-reviewer` | dispatchable | Receives bounded input (code), produces complexity/allocation review using read-only tools |
| `researcher` | dispatchable | Receives bounded input (research query), produces research brief from codebase/sources using read tools |
| `reviewer` | dispatchable | Receives bounded input (diff/PR), produces independent review report using read-only tools |
| `security-reviewer` | dispatchable | Receives bounded input (code), produces OWASP-framed security verdict using read-only tools |
| `technical-writer` | dispatchable | Receives bounded input (raw data/brief), produces structured document using read+write tools; self-described "short-lived" |
| `test-architect` | dispatchable | Receives bounded input (acceptance criteria), produces test strategy and test cases using read+write tools |
| `test-inspector` | dispatchable | Receives bounded input (test suite), produces coverage gap report using read-only tools |
| `test-scout` | dispatchable | Receives bounded input (story + codebase), produces test context brief using read+bash tools |
| `test-sentinel` | dispatchable | Receives bounded input (test failures), produces triage report with severity routing using read+bash tools |
| `test-worker` | dispatchable | Receives bounded input (test script), executes and captures results using read+bash tools |
| `tester` | dispatchable | Receives bounded input (story spec), produces test suite and execution results using read+write tools |
| `tpm` | dispatchable | Receives bounded input (epic/requirements), produces horizontal/vertical delivery plan using read-only tools |
| `ui-designer` | dispatchable | Receives bounded input (design brief), produces wireframes and UI specs via Frame0 CLI using bash tools |

---

## Harness-Only (3)

| Persona | Verdict | Rationale |
|---------|---------|-----------|
| `orchestrator` | harness-only | Uses `TeamCreate` + `SendMessage` to coordinate teams and assign stories; by definition spawns subagents — the coordination IS its output |
| `team-lead` | harness-only | Uses `TeamCreate` + `SendMessage` to manage per-team execution; spawns and manages agent teams as core function |
| `pair-programmer` | harness-only | Sidecar role — "contrarian... challenges assumptions during implementation"; requires an active co-execution session with another agent and produces no standalone artifact from a single bounded input |

---

## Notes for W1.2

- `developer` is deprecated; include for backward compatibility only if required by existing workflows.
- `peer-validator` is provisionally dispatchable; if formal test dispatch fails (unable to complete a validation task from a single bounded story-set input), reclassify as harness-only and revise Phase A verifier list accordingly.
- Provider routing per design discussion §2 Phase A: creators get `provider: codex` (if S0.1 positive) else `provider: claude`; verifiers (`reviewer`, `peer-validator`, `security-reviewer`, `idiomatic-reviewer`, `performance-reviewer`, `test-inspector`) stay `provider: claude` + `model: claude-opus-4-7`.

---

_Authored by `developer` agent — story w1-1-persona-dispatchability-doc, epic multica-substrate-deepen_
_Reviewed by: pending architect review before W1.2_
