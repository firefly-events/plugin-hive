# Test Results: kg-write-path

## AC1: Ordering documented — PASS
Step 1 in the Receiver Protocol has explicit ordered sub-steps: 1a (write insight files) → 1b (call kg_write()) → 1c (call compile()). The ordering is explicitly labelled "mandatory."

## AC2: Session-end path — PASS
The "Session-End Path (Natural Completion)" section exists and documents that the same three sub-steps from Receiver Protocol step 1 apply when a session ends naturally (not via shutdown_request).

## AC3: kg_write signature — PASS
The `kg_write() Behavioral Contract` section exists in knowledge-graph-schema.md with the full triple array signature including subject, predicate, object, valid_from, source_epic, and source_agent fields.

## AC4: Predicate validation — PASS
The contract documents that unknown predicates are rejected immediately with an error naming the invalid predicate, including an example error message listing all valid predicates.

## AC5: WAL atomicity — PASS
The contract shows the BEGIN/INSERT/COMMIT transaction pattern with explicit note that any insert failure rolls back the transaction (no partial writes).

## AC6: 20-triple timing — PASS (26ms)
Elapsed: 0.026s total (26ms). Well under the 2-second timeout window. SQLite in WAL mode is highly performant for this workload.

## AC7: Triples appear — PASS
`SELECT COUNT(*) FROM triples WHERE source_epic='test-epic'` returned 20. All inserted triples are present.

## AC8: Predicate rejection — PASS (DB-level FK enforcement)
Inserting a triple with predicate `unknown-predicate` with `PRAGMA foreign_keys=ON` raises: `Error: stepping, FOREIGN KEY constraint failed (19)`. The FK constraint on the `predicates` table enforces vocabulary at the database level, not just protocol level.

## Summary: 8/8 passed. Overall: PASS
