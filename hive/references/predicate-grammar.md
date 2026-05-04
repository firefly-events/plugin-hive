# Predicate Grammar Reference (hde-3a)

The Hive DAG executor evaluates `when:` predicates and a single
`trigger_rule` policy at every step. This document is the canonical
reference for the predicate language and the failure model. It is
deliberately small — adding to it is an **epic-level** change, not a
story-level patch.

## Cultural lock — grammar additions require an epic

> Adding ANY operator, literal type, or evaluator behaviour to this
> grammar requires an epic, not a story.

Argo Workflows shipped a similar predicate language with `==`, `!=`,
`&&`, `||` and a small set of escape hatches. Subsequent quarters added
regex (`=~`), arithmetic (`+ - * /`), function calls (`asInt`,
`success()`, `failure()`), parens, and a generic expression engine. The
language fragmented into "old syntax" and "new syntax", workflows split
across both, and the maintainers spent two years on a migration program
to unify them. We refuse that debt.

The grammar lives behind a high-friction door on purpose. New operators
go through epic review with explicit migration cost analysis even if
they look "tiny".

## Lock summary

* **Grammar lock (user-gate Q5 = `strict_archon`):** strict-Archon
  predicate grammar; no parens, regex, status fns, arithmetic, or
  function calls.
* **trigger_rule lock (user-gate Q3 =
  `skip_propagation_none_failed_min_one_success`):** the only
  supported policy is `none_failed_min_one_success`. Failure does NOT
  cascade as failure under this policy — failed upstreams convert to
  SKIP for the candidate node.
* **Fail-closed:** invalid predicate text and missing fields produce
  False + a `predicate_evaluated` warning event. Predicate failures
  NEVER abort the run.

## Grammar (formal)

```ebnf
expr        = or_expr ;
or_expr     = and_expr , { "||" , and_expr } ;
and_expr    = comparison , { "&&" , comparison } ;
comparison  = atom , [ comp_op , atom ] ;
comp_op     = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
atom        = literal | dotpath ;
literal     = "true" | "false" | "null" | int | float ;
dotpath     = "$" , ident , ( "." , ident )+ ;
ident       = letter , { letter | digit | "_" | "-" } ;
int         = [ "-" ] , digit+ ;
float       = [ "-" ] , digit+ , "." , digit+ ;
```

Whitespace between tokens is insignificant.

## Operators (8 total)

| Operator | Example | Meaning |
|----------|---------|---------|
| `==` | `$step.output.signal == true` | Strict equality (type-checked; `true == 1` is False) |
| `!=` | `$step.output.verdict != null` | Strict inequality |
| `<` | `$step.output.attempts < 3` | Numeric less-than |
| `<=` | `$step.output.attempts <= 3` | Numeric less-or-equal |
| `>` | `$step.output.attempts > 0` | Numeric greater-than |
| `>=` | `$step.output.attempts >= 1` | Numeric greater-or-equal |
| `&&` | `$a.output.x == true && $b.output.y == true` | Logical AND (short-circuits) |
| `\|\|` | `$a.output.x == true \|\| $b.output.y == true` | Logical OR (short-circuits) |

### Precedence

`&&` binds tighter than `||`. There are **no parentheses** to override
this. `a && b || c` parses as `(a && b) || c` and stays that way.
Right-side associativity for `||`/`&&` is left-to-right.

If a predicate genuinely needs `(a || b) && c`, restructure it as two
predicates on two steps, or escalate to an epic to add parentheses.

## Disallowed (will fail-closed to skip)

The lexer rejects each of these and the predicate is treated as False:

* parentheses: `( ... )`
* regex match: `=~`
* status fns: `success()`, `failure()`
* arithmetic: `+`, `-` (binary), `*`, `/`
* any function call: `len(...)`, `asInt(...)`, etc.
* string literals (`"approve"`) — no string literal type today;
  string equality is fail-closed False.

## Field references — `$nodeId.output.field`

Every value reference takes the form `$<node-id>.<segment>(.<segment>)*`.
The first segment SHOULD be `output` so the dot-path resolves into the
upstream node's `outputs` map. Deeper paths are permitted for nested
output structures (`$step.output.metrics.signal`).

### Risk #13 lock — `change_verdict` vs `cycle_verdict`

Predicates that reference a step's change-level verdict MUST use
`$step.output.change_verdict` explicitly. Bare `$step.output.verdict`
is **undefined under this contract** — no field by that name is
guaranteed to exist on the upstream output, and the evaluator returns
False fail-closed if it doesn't.

The same step typically also publishes `$step.output.cycle_verdict`
(loop-level decision) and the two are NOT interchangeable. Always pick
the specific name; never rely on a generic `verdict`.

`change_verdict` is a string-valued field (`"approve"`, `"reject"`,
`"needs_changes"`, …). Compare against the literal string, never a
boolean. A `bool == string` comparison is fail-closed False under
strict-equality rules and would silently never route.

```yaml
# Correct — string equality against the documented value
when: "$verifier.output.change_verdict == \"approve\""

# Wrong — bool vs string, fail-closed False every time
when: "$verifier.output.change_verdict == true"

# Wrong — bare `verdict` is not a defined field
when: "$verifier.output.verdict == true"
```

## Fail-closed semantics

The evaluator returns **False** in every degenerate case:

| Case | Result | Telemetry |
|------|--------|-----------|
| Empty/whitespace predicate | False | `predicate_evaluated` with `fail_closed: true` |
| Disallowed construct (parens, regex, …) | False | `predicate_evaluated` with `fail_closed: true` |
| Trailing tokens after expression | False | `predicate_evaluated` with `fail_closed: true` |
| Dot-path references unknown node | False | `predicate_evaluated` with `result: false` |
| Dot-path field missing on upstream output | False | `predicate_evaluated` with `result: false` |
| Numeric comparison with non-numeric operand | False | `predicate_evaluated` with `result: false` |
| Strict-equality type mismatch (`bool` vs `int`) | False | `predicate_evaluated` with `result: false` |
| Both operands legitimately unequal | False | `predicate_evaluated` with `result: false` |

The walker emits the `predicate_evaluated` event before deciding to
skip the step. Run telemetry (`events/<run_id>.jsonl`) is the audit
surface — predicate failures are visible there, not in stderr.

## trigger_rule — `none_failed_min_one_success`

The single supported policy. Applied at multi-upstream joins
(`depends_on` length > 1).

| Upstream statuses | Decision |
|-------------------|----------|
| At least one COMPLETED | RUN |
| Zero COMPLETED, any FAILED | SKIP (no failure cascade) |
| All SKIPPED | SKIP |
| All PENDING/RUNNING | SKIP (defensive — should not occur in topological order) |

### Why no cascade

A FAILED upstream feeding into a join skips the downstream rather than
failing it. This pairs with per-input `optional` bindings: if the
join needs the failed upstream's output, it can either declare the
binding `optional: true` (gets `None`) or be `optional: true` itself
(skipped silently). The hard-fail path is reserved for non-optional,
non-multi-upstream cases.

Single-upstream nodes do NOT pass through trigger_rule — the legacy
hde-2 behaviour (per-input `optional` lets the binding receive `None`
on upstream failure) is preserved unchanged.

### Why no other policies

`all_success`, `any_success`, `always`, and `one_failed` are NOT
implemented. They each carry semantic gotchas (`all_success` cascades
failures; `always` runs even on cancellation; `one_failed` requires a
notion of "at least one ran") that warrant epic-level evaluation.

## Telemetry contract

Routing emits one `predicate_evaluated` event per `when:` evaluation
with payload:

```json
{
  "expr": "$step.output.signal == true",
  "result": false,
  "fail_closed": true,         // present only on parse failures
  "reason": "..."              // present only on parse failures
}
```

Multi-upstream joins emit `node_skipped` with payload:

```json
{
  "reason": "trigger_rule:none_failed_min_one_success",
  "upstream_statuses": {"a": "completed", "b": "failed"}
}
```

`node_skipped` is also emitted for `when:` skips with
`reason: "when_predicate_false"`.

## Implementation pointers

* Public API: `hive.lib.dag_executor.routing` (`parse`, `evaluate`,
  `none_failed_min_one_success`, AST classes, `Skipped` sentinel).
* AST: `routing/grammar.py` — frozen dataclasses, no behaviour.
* Parser: `routing/parser.py` — recursive-descent, stdlib-only.
* Evaluator: `routing/evaluator.py` — fail-closed wrapper around the
  internal `_eval_node` walker.
* Walker integration: `executor/walker.py` (`_evaluate_when_predicate`,
  `_trigger_rule_decision`).
* Tests: `routing/tests/`.
