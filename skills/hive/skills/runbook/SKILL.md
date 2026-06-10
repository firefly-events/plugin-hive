---
name: runbook
description: Author an operational runbook — prerequisites, step-by-step procedure, verification, rollback, and escalation. Use when an operational or recovery task needs a repeatable, follow-exactly document.
---

# Hive Runbook

Produce an **operational runbook**: a procedure an on-call or operator can follow
under pressure, step by step, to perform or recover an operation safely. Optimize
for follow-exactly clarity — the reader may be tired, unfamiliar, or mid-incident.

**Input:** `$ARGUMENTS` (or upstream findings) describing the operation, its
preconditions, the steps, and how to verify and undo it.

## When to use

- A deploy, migration, recovery, or maintenance task must be repeatable by others.
- An incident-response procedure needs to be written down before it's needed.

For a design decision use `adr`; for system design use `architecture-doc`. A
runbook is purely operational.

## Sections (produce in this order)

1. **Purpose & scope** — what this runbook does, and when to reach for it (the trigger condition).
2. **Prerequisites** — access, credentials, tools, and state required before starting. The reader confirms these first.
3. **Procedure** — numbered, ordered steps. Each step: the exact command/action, the expected result, and a caution if a step is destructive or irreversible. One action per step.
4. **Verification** — how to confirm success: the checks to run and the expected outputs.
5. **Rollback** — exact steps to undo, if the operation fails or must be reverted. If irreversible, say so loudly and state the safeguard.
6. **Troubleshooting** — common failure modes mapped to their fix.
7. **Escalation** — who/what to escalate to (role, channel, dashboard) when the runbook doesn't resolve it.

## Tone & style

- Imperative and unambiguous: "Run X. Confirm Y. If Z, stop and escalate."
- Exact commands in code blocks, copy-paste runnable. No "roughly" or "should".
- Flag every destructive/irreversible step explicitly before it appears.
- One action per numbered step — never bundle.

## Output

One runbook per task. Default path: `docs/runbooks/<kebab-name>.md`, or as the
task specifies.

## What this skill is NOT

- **Not a design doc.** Rationale and architecture belong in `architecture-doc` / `adr`.
- **Not narrative.** It is a procedure to execute, not prose to read through.
- **Not optional-step guidance.** If a step is conditional, state the condition explicitly.
