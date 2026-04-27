# Review Findings: kg-write-path

**Story:** kg-write-path  
**Epic:** memory-autonomy-foundation  
**Reviewer:** review agent  
**Date:** 2026-04-13  
**Verdict:** passed

---

## pre-shutdown-protocol.md

### Item 1 — Sub-step ordering clarity (1a/1b/1c)
**Pass.** The indented 1a/1b/1c labels are unambiguous, and each sub-step opens with a bolded imperative verb (Write, Call, Compile). The inline parenthetical "(not before)" in 1b reinforces the dependency on 1a. No misread risk.

### Item 2 — "Mandatory" label on step ordering
**Pass.** The bolded summary line "**Step 1 ordering is mandatory:** insight files → kg_write() → compile()" appears immediately after the three sub-steps and uses the word "mandatory" explicitly. Agents have both the inline cue in 1b and the summary line — double coverage.

### Item 3 — Session-End Path vs pre-shutdown distinction
**Pass.** The Session-End Path section clearly names the two paths: "The pre-shutdown receiver protocol handles orchestrator-initiated termination; the session-end hook handles natural completion." The contrast is explicit and the mechanisms (pre-shutdown message vs. session-end hook) are named distinctly.

### Item 4 — Circuit-breaker exception scoping
**Pass.** The Circuit-Breaker Exception section states the protocol "does NOT apply" and gives the rationale (immediate termination, runaway behavior). The Session-End Path section closes with "Circuit-breaker kills skip both paths (no insight capture, no KG writes)" — correctly extending the exception to cover both paths. Scope is clear and consistent.

### Item 5 — compile() placement after kg_write()
**Pass.** Sub-step 1c explicitly calls compile() after 1b (kg_write()). The ordering enforces wiki reflecting KG state. The Session-End Path section lists the same order (write files → kg_write() → compile()). Consistent across both occurrences.

---

## knowledge-graph-schema.md

### Item 6 — kg_write() signature alignment
**Pass.** The signature matches the contract described in Receiver Protocol step 1b. All required fields (subject, predicate, object) are marked required; valid_from, source_epic, source_agent are optional with defaults noted. The return type `→ void` is accurate since callers must not depend on KG writes for correctness (per the availability gate). No mismatch found.

### Item 7 — Predicate validation error message concreteness
**Pass.** The error message names the invalid predicate in quotes and enumerates the full allowed list inline:
```
Error: unknown predicate "my-custom-predicate" — must be one of: decided, superseded, assigned_to, blocked_by, depends_on, phase_started, phase_complete, phase_failed, phase_blocked
```
Agents have everything they need to self-correct without consulting the schema table.

### Item 8 — WAL atomicity / rollback clarity
**Pass.** The Atomicity section shows the `BEGIN; ... COMMIT;` block and states "If any insert fails, the transaction is rolled back (no partial writes)." Rollback behavior is explicit. WAL mode is established in the Bootstrap DDL (`PRAGMA journal_mode=WAL`), so the section's reference to "WAL transaction" is grounded.

### Item 9 — Availability gate positioning vs. validation section
**Pass.** The availability gate is a separate named section after Atomicity, covering a distinct failure class (infrastructure unavailability vs. bad predicate input). The two sections handle orthogonal concerns and do not contradict: validation rejects bad data before any DB interaction; the availability gate handles DB-level failures. Ordering is logical.

### Item 10 — Performance note accuracy
**Pass.** The note claims "Writing 20 triples completes in <100ms on standard hardware." Test results show 20 triples inserted in 26ms. The claim is accurate — 26ms is well within the <100ms bound. The note adds useful context ("well within the pre-shutdown 2-turn timeout window") that anchors the performance guarantee to an operational constraint.

---

## Summary

All 10 checklist items pass. Both documents are clear, internally consistent, and cross-reference each other correctly. No blocking issues, no minor optimizations required.
