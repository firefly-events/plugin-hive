---
name: security-review
description: OWASP Top 10 security review procedure — binary passed/needs_revision verdict. Authoritative procedure bound to hive/agents/security-reviewer.md; owns the security lane's finding categories, severities, and output contract.
---

# Hive Security Review

**Authoritative OWASP review procedure, NOT inline persona prose.** This skill is bound to `hive/agents/security-reviewer.md`'s `skills:` frontmatter entry and governs how a security review runs once that binding is resolved and loaded — see `hive/lib/skill_binding.py::resolve_skill_binding`. It owns the OWASP Top 10 taxonomy, finding categories/severities, and the binary `passed | needs_revision` output contract for the security-review lane. It does NOT own the separate plan-audit team verdict (`approved | needs_revision | needs_redesign`) emitted by `hive/workflows/security-audit.workflow.yaml`'s `synthesis` step — that vocabulary stays workflow-owned and is out of scope here (see "What this skill is NOT").

**Input:** `$ARGUMENTS` contains the implementation artifacts, diff, or story scope under review — the same input the `security-critique` step of `hive/workflows/security-audit.workflow.yaml` already passes as `implementation_artifacts`, or the diff/files the `--security` review dimension (`skills/review/SKILL.md` step 6b) already passes.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

If the kickoff checks pass, proceed silently.

## Process

1. **Scope the review.** Read the story spec or `$ARGUMENTS` scope and identify the attack surface being changed. Read the implementation files, plus any auth/input-handling files they touch. Stay strictly in the security lane — do not surface style, performance, or correctness findings.
2. **Evaluate against the OWASP Top 10 dimensions.** Each dimension below is a finding category:
   - **`injection`** — SQL injection, command injection, LDAP injection, template injection; user input reaching query/command constructors
   - **`auth`** — missing auth checks on endpoints, privilege escalation paths, insecure session handling, weak token validation
   - **`secrets`** — secrets hardcoded or logged, unencrypted PII at rest or in transit, insecure transmission (HTTP vs HTTPS)
   - **`input-validation`** — missing validation at API boundaries, type coercion risks, uncontrolled deserialization
   - **`xss`** — reflected, stored, and DOM-based cross-site scripting; unsafe innerHTML/dangerouslySetInnerHTML usage
   - **`csrf`** — missing CSRF tokens or SameSite cookies on state-changing endpoints
   - **`ssrf`** — user-controlled URLs passed to server-side HTTP calls without allowlist
   - **`dependency`** — known CVEs in imported packages; suspicious version pins or packages
   - **`misconfiguration`** — debug modes enabled in production, overly permissive CORS, exposed stack traces, directory listing
   - **`logging`** — missing audit trails for security-relevant events (login, permission changes, data access)
3. **Classify each finding by severity.** Exactly two severities — no third tier:
   - **Critical** — a vulnerability exists. Blocks integration. Must be fixed.
   - **Informational** — hardening opportunity or defense-in-depth note. Does not block integration; remains non-blocking regardless of count.
4. **Compute the binary verdict.** This is the sole gating rule — do not invent inline conditionals:
   - **`passed`** — no critical findings. Informational findings never block.
   - **`needs_revision`** — one or more critical findings exist. `needs_optimization` does not exist in this lane; a vulnerability is present or it is not.
5. **Produce the Security Review Report** in the exact shape below, citing exact `file:line` for every finding:

   ```markdown
   ## Security Review Verdict: passed | needs_revision

   ## Findings

   ### Critical
   - **[category]** `path/to/file.ts:42` — Vulnerability description and attack vector.
     **Suggestion:** Concrete remediation.

   ### Informational
   - **[category]** `path/to/file.ts:15` — Hardening opportunity or defense-in-depth note.
     **Suggestion:** Concrete improvement.

   ## Summary
   Brief assessment of the security posture and what must change before integration.
   ```

6. **Emit the skill-owned invocation marker.** Wherever the calling seam records step outputs (the DAG `AgentHandler`'s `config.skill_binding` opt-in, or a step-file/episode marker for sequential/team callers), the marker is `skill_invoked: skills/security-review/SKILL.md` — durable evidence that this skill, not residual persona prose, governed the run. A caller that spawns `hive/agents/security-reviewer.md` without resolving and loading this binding has an inert binding, not a working security review; that caller fails closed per `hive/lib/skill_binding.py::SkillBindingError` rather than falling back to inline persona procedure.

## What this skill is NOT

- **Not the security-reviewer persona.** `hive/agents/security-reviewer.md` supplies identity, the read-only domain boundary, memory, and communication style. This skill is the procedure; the persona is not a substitute procedure and must not be spawned in its place without loading this file.
- **Not the plan-audit team verdict.** `hive/workflows/security-audit.workflow.yaml`'s `synthesis` step emits a separate `approved | needs_revision | needs_redesign` verdict for pre-execution architectural plan review. That vocabulary, sequencing, and retries are workflow-owned and unchanged by this skill — this skill governs only the binary `passed | needs_revision` implementation-review contract used at the `security-critique` step and at the `security:impl-audit` sidecar spawn.
- **Not a general code review.** Security-reviewer stays in the OWASP lane exclusively; style, performance, and general correctness are `hive/agents/reviewer.md` + `skills/review/SKILL.md`'s remit.
- **Not catalog dispatch.** This skill does not add or change `hive/references/specialist-triggers.md` routing. `placement` and `responds_with.type` remain the only routing signals; a null `skill:` catalog field is not wired into `/execute`.

## Atomic-skill invariants

- **Top-level skill** at `skills/security-review/SKILL.md` (auto-discovered), within the 800-line skill-size cap.
- **Single binding target** — bound exclusively to `hive/agents/security-reviewer.md` via that persona's `skills:` frontmatter entry.
- **Binary verdict only** — `passed | needs_revision`. No third value; informational findings never gate.
- **Fail-closed** — a missing binding or unreadable skill file raises `SkillBindingError` at the calling seam; there is no persona-only fallback.
- **Stateless across invocations** — each review run produces one Security Review Report; no incremental state carried between runs.

## Hand-off

1. A caller (the `security-critique` step of `hive/workflows/security-audit.workflow.yaml`, or the `--security` dimension of `skills/review/SKILL.md` step 6b, or the `security:impl-audit` sidecar) resolves `hive.lib.skill_binding.resolve_skill_binding("hive/agents/security-reviewer.md", "<matching use-when trigger>")`.
2. This skill's Process governs the run and produces the Security Review Report plus the `skill_invoked` marker.
3. The caller's own workflow owns what happens next: `security-audit.workflow.yaml`'s `synthesis` step folds the critique into its plan-audit verdict; `skills/review/SKILL.md` step 6b appends the security block as a labeled, non-gating dimension below the baseline review verdict; the `security:impl-audit` sidecar appends reviewer comments to the story output.
4. This skill ends at step 2. Verdict consumption, aggregation, and status projection are the caller's remit, not this skill's.

## Out of scope

- Plan-audit synthesis, severity remapping (major/moderate/minor), or threat-model narrative — that vocabulary belongs to `hive/workflows/security-audit.workflow.yaml`'s `synthesis` step only.
- Catalog `skill:` dispatch or trigger-ID-specific routing — routing stays on `placement` + `responds_with.type`.
- Auto-remediation — this skill surfaces findings; it does not write fixes.
- Non-security dimensions (performance, style, correctness) — those are separate reviewer personas and skills.

## See also

- [`hive/agents/security-reviewer.md`](../../hive/agents/security-reviewer.md) — bound persona (identity, domain, memory, communication style)
- [`hive/workflows/security-audit.workflow.yaml`](../../hive/workflows/security-audit.workflow.yaml) — `security-critique` step resolves this binding; `synthesis` step owns the separate plan-audit verdict
- [`skills/review/SKILL.md`](../review/SKILL.md) — baseline code-review skill; step 6b's `--security` dimension is this skill's other caller
- [`hive/lib/skill_binding.py`](../../hive/lib/skill_binding.py) — the shared match-resolve-load-invoke resolver
- [`hive/references/specialist-triggers.md`](../../hive/references/specialist-triggers.md) — `security:plan-audit` and `security:impl-audit` trigger entries (placement/routing unchanged by this skill)
- [`skills/write-skill/template.md`](../write-skill/template.md) — canonical full SKILL.md format this file follows
