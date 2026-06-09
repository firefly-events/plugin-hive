# d-5 review insight — "extensible-minimum" decomposes into three orthogonal contract axes

When reviewing payload-contract documentation that uses "extensible-minimum" as
its posture, the right verification approach is to verify **three orthogonal
axes**, not the single phrase:

1. **Minimum cardinality** — exactly N named fields, no more, no fewer in the
   canonical minimum. Count + name each one.
2. **Field-named (not file-glob)** — naming discipline prevents working-state
   leak (the actual security/correctness risk). Without this, the minimum
   becomes "whatever happens to live in the directory."
3. **Add-only/reversible** — future fields must not break existing consumers.
   This is the "extensible" half.

If any one axis is missing, the contract is brittle — the other two cannot
compensate. For d-5: all three were present and independently testable (the
5-describe-block structure happens to map 1:1 to verification axes plus
toggle-conditional bundling + cross-references).

**Reviewer takeaway**: when a story uses a hyphenated compound posture
("extensible-minimum", "deny-by-default", "fail-closed"), decompose the
compound into orthogonal axes BEFORE checking the implementation. The
compound name often hides 2-3 independent invariants.
