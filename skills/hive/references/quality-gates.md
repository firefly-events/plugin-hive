# Quality Gates

Quality gates classify agent outputs into tiers and route them accordingly. Every workflow step that produces a reviewable artifact passes through a gate.

## Three-Tier System

| Tier | Score Range | Routing | Description |
|------|------------|---------|-------------|
| **Auto-pass** | ≥ 0.9 | Proceed immediately | High-confidence output from trusted agent pairs |
| **Peer review** | 0.3 – 0.9 | Validation handshake | Moderate confidence — another agent reviews |
| **Human escalation** | < 0.3 | Push to task tracker | Low confidence or policy violation — human decides |

Thresholds are configurable per workflow in `hive.config.yaml` (future) or inline in workflow YAML.

Default thresholds:
```yaml
quality_gates:
  auto_pass_threshold: 0.9
  human_escalation_threshold: 0.3
```

## Gate Evaluation

After a review or test step produces output, the gate evaluates:

1. **Review verdict** — did the reviewer say `passed`, `needs_optimization`, or `needs_revision`?
2. **Test results** — did all tests pass?
3. **Trust score** — what's the trust level for this agent pair? (see Trust Scoring below)
4. **Policy compliance** — does the output satisfy structural/consistency policies? (see Gate Control Plane below)

The gate combines these signals into a composite score (0.0–1.0) and routes based on tier thresholds.

### Simplified Scoring (initial implementation)

Until the full policy engine is built, use this simplified approach:

| Signal | Score Mapping |
|--------|--------------|
| Review: `passed` + all tests pass | 1.0 |
| Review: `needs_optimization` + all tests pass | 0.7 |
| Review: `needs_revision` | 0.4 |
| Tests fail | 0.2 |
| Agent error or timeout | 0.0 |

Trust scores adjust these: high-trust pairs get a +0.1 bonus, low-trust pairs get a -0.1 penalty. Capped at [0.0, 1.0].

## Integration with Execute Flow

In ORCHESTRATOR.md execute flow, after review and test steps:

```
1. Step completes with output
2. Gate evaluates output → composite score
3. Route based on tier:
   - Auto-pass (≥0.9): proceed to next step
   - Peer review (0.3–0.9): run validation handshake
   - Human escalation (<0.3): push to task tracker, halt story
4. If retry configured (see workflow-schema.md): attempt retry loop before escalating
```

---

## Validation Handshake

The three-step protocol for peer review tier. Uses the `peer-validator` agent persona.

### Protocol

**Step 1 — Submit:** The producing agent's output is packaged with the story's acceptance criteria as validation criteria.

**Step 2 — Validate:** The peer-validator agent receives the output and criteria. For each criterion, it finds specific evidence in the output that satisfies or fails the criterion. Returns structured findings (see `agents/peer-validator.md` for output format).

**Step 3 — Verify:** The orchestrator or team lead reviews the peer-validator's findings:
- All criteria pass → promote to auto-pass tier, proceed
- Some criteria fail with low severity → proceed with warnings
- Critical criteria fail → route to retry (if configured) or human escalation

### Handshake Inputs

```yaml
handshake:
  output: "{the agent's work product}"
  criteria:
    - id: ac-1
      description: "Given X, when Y, then Z"
      severity: critical    # critical, major, minor
    - id: ac-2
      description: "..."
      severity: major
  submitter: developer
  validator: peer-validator
```

### When It Runs

- Only for outputs in the peer review tier (score 0.3–0.9)
- Skipped for auto-pass tier (high trust, score ≥0.9)
- Skipped for human escalation tier (goes directly to human)

---

## Trust Scoring

Per-agent-pair trust scores that adapt based on validation accuracy.

### Score Model

- **Range:** 0.0 to 1.0
- **Initial:** 0.5 (neutral — new agent pairs start here)
- **Storage:** `skills/hive/agents/memories/{agent}/trust-scores.yaml`

### Update Rules

After each validation handshake:

| Outcome | Score Change |
|---------|-------------|
| Validator correctly identified real issues | Validator trust +0.05 |
| Validator missed issues found later | Validator trust -0.1 |
| Submitter's work passed validation cleanly | Submitter trust +0.05 |
| Submitter's work had critical failures | Submitter trust -0.1 |

### Trust Decay

For task types not recently validated, trust decays toward neutral (0.5):
- **Decay rate:** 5% per 7 days (configurable)
- **Floor:** 0.3 (trust never decays below the peer review threshold)
- **Purpose:** prevents stale high-trust scores from auto-passing degraded agents

### Adaptive Validation

| Trust Level | Behavior |
|-------------|----------|
| ≥ 0.8 (high) | Skip full handshake — auto-pass with spot checks |
| 0.5–0.8 (moderate) | Standard three-step handshake |
| ≤ 0.5 (low) | Full handshake always enforced, findings reviewed by orchestrator |

### Trust Score Storage

```yaml
# skills/hive/agents/memories/developer/trust-scores.yaml
pairs:
  - submitter: developer
    validator: reviewer
    score: 0.75
    last_validated: "2026-03-25T14:00:00Z"
    task_type: implementation
  - submitter: developer
    validator: peer-validator
    score: 0.6
    last_validated: "2026-03-20T10:00:00Z"
    task_type: implementation
```

---

## Gate Control Plane

YAML-defined quality policies per workflow. Different workflows have different quality criteria.

### Policy File Location

```
skills/hive/gate-policies/{workflow-name}.yaml
```

### Policy Schema

```yaml
# skills/hive/gate-policies/development-classic.yaml
name: development-classic-gates
workflow: development.classic

policies:
  - name: structural-completeness
    evaluator: structural
    applies_to: [implement, test]
    config:
      implementation:
        required: ["exported function or class", "no TODO/FIXME left"]
      tests:
        required: ["at least one test per acceptance criterion"]

  - name: convention-compliance
    evaluator: consistency
    applies_to: [implement]
    source: cycle-state
    checks:
      - "naming follows cycle-state naming conventions"
      - "technology matches cycle-state technology decisions"

  - name: coverage-minimum
    evaluator: coverage
    applies_to: [test]
    rule: "every acceptance criterion has at least one test"
```

### Evaluator Types

| Evaluator | What It Checks |
|-----------|---------------|
| `structural` | Required sections/artifacts present in output |
| `consistency` | Output aligns with cycle state decisions |
| `coverage` | Requirements are fully covered by tests/implementation |
| `custom` | User-defined rules (future) |

### Integration

The gate engine loads the policy file for the current workflow. After each step, it runs applicable policies (filtered by `applies_to`). Policy failures contribute to the composite gate score:

- All policies pass → no score penalty
- Minor policy failures → -0.1 per failure
- Major policy failures → -0.3 per failure
- Critical policy failures → force to human escalation tier regardless of score
