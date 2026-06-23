# Review: tic-tac-toe build + KISS/YAGNI persona evaluation

**Date:** 2026-06-22
**Subject:** Code-quality review of the throwaway ttt game built via DAG-on-Multica
(plan→execute, 4 stories, all review-PASSED), with a deliberate over-engineering
lens; and an evaluation of adding KISS/YAGNI to the developer personas.
**Artifact under review:** `/tmp/ttt-play` (consumer repo, branch `feat/tttgame`):
`game.js` (35 LOC), `ui.js` (39), `index.html` (26), `styles.css` (80),
`game.test.js` (7KB), `ui-shell.test.js` (8KB).

---

## 1. Scenario-replay (highest-fidelity functional check) — 7/7 PASS

Drove the real `game.js` through interaction scenarios:

| # | Scenario | Result |
|---|----------|--------|
| S1 | X wins top row (0,1,2) | PASS — status=won, winner=X |
| S2 | O wins anti-diagonal (2,4,6) | PASS — status=won, winner=O |
| S3 | Full board, no line → draw | PASS — status=draw, winner=null |
| S4 | Move on occupied cell | PASS — rejected, same state returned |
| S5 | Move after terminal state | PASS — rejected, same state returned |
| S6 | Fresh game (reset) | PASS — empty board, X to move, playing |
| S7 | Turn alternation X→O→X | PASS |

Game logic is correct and complete for the rules of tic-tac-toe.

---

## 2. Code-quality review — over-engineering lens

**Verdict: PASS. High quality. Near-zero over-engineering.** For a simple game the
code is appropriately simple. This is the headline finding and it directly informs §3.

### What it gets right (cite-worthy)

- **`game.js` is pure + immutable.** `createGame`/`winner`/`isDraw`/`move` are pure
  functions; `move` returns a new state, never mutates. Terminal + occupied guards in
  one line (`if (state.status !== 'playing' || state.board[index] !== null) return state`).
  No classes, no state machine library, no event emitter — none of which a 9-cell game
  needs. `WINNING_LINES` as an 8-row table is the canonical clean approach, **not**
  over-engineering (the alternative — nested row/col/diag loops — is more code and less
  readable).
- **`index.html` hand-writes 9 cells** instead of generating them in JS. This is the
  **KISS-correct** call: a loop to emit 9 fixed elements is more machinery than markup.
  Good instinct.
- **`ui.js` uses event delegation** (one listener on `#grid` + `closest('.cell')`)
  rather than 9 per-cell listeners. Minimal and idiomatic.
- **Clean separation:** logic (`game.js`) has zero DOM; UI (`ui.js`) holds all DOM. The
  pure core is why scenario-replay could drive it headlessly.

### Minor nits (all trivial; none worth a revision bounce)

- `ui.js` keeps module-level mutable `state` and runs `render()` + attaches listeners
  at import time (side-effects on import). Fine for a single-instance page; it does
  force `ui-shell.test.js` to drive it through a DOM. A tiny `init()` would marginally
  improve testability — but extracting it here would be **gold-plating** for a 39-line
  file. Correctly left simple.
- `styles.css`: `.cell` sets both `width:100px` and `min-width:80px` (mild redundancy);
  `cursor:pointer` appears in both `.cell` and `.cell:hover`. Cosmetic.
- `isDraw` is exported but only consumed internally + by tests. Harmless; arguably
  useful as a tested seam.

**Complexity budget:** the most "complex" thing in the codebase is an 8-entry constant
array. There is nothing to cut. The dev agents produced minimal code **without** any
explicit KISS instruction — which is the key data point for §3.

---

## 3. Should we add KISS / YAGNI to the developer personas?

Evaluated `hive/agents/backend-developer.md` and `frontend-developer.md` (the real
builders; `developer.md` is deprecated). KISS/YAGNI currently appear only in
`analyst.md`, `ad-creative.md`, `team-lead.md` — **never in a dev persona.**

### YAGNI is already covered — do NOT add it

Both personas already encode YAGNI as **Scope discipline**, just under a different name:

- Quality standards → *"Scope discipline: Diff contains only changes traceable to story
  requirements — no unsolicited refactoring."*
- *"implement exactly what is described — scope is fixed by the story."*
- *"Implement the most conservative interpretation when specs are ambiguous."*

That is YAGNI (don't build features you weren't asked for). Adding a bullet literally
named "YAGNI" would be redundant restatement — ironically un-KISS.

### KISS is the genuine gap — recommend adding it (narrowly)

Scope discipline stops you adding **out-of-scope** work. It says nothing about the
**internal complexity of in-scope work**. The real over-engineering failure mode it
does NOT catch: taking a story that legitimately needs feature X and building X with a
factory + strategy + config layer when a 10-line function would do. Scope is clean; the
implementation is bloated. Nothing in the current persona pushes back on that.

The ttt build didn't hit this — but ttt was tiny and tightly specified. The risk rises
with ambiguity and story size, exactly where "most conservative interpretation" leaves
architectural latitude.

**Recommendation:** add ONE quality-standard bullet to both dev personas (and the
deprecated `developer.md` for completeness), framed as internal simplicity with a
concrete test — not a buzzword:

```markdown
- **Simplicity (KISS):** Choose the simplest implementation that satisfies the
  acceptance criteria. Prefer functions over classes, data over control flow, and
  standard-library/existing utilities over new abstractions. Do not add layers,
  patterns, configuration, or generality the story does not require — a reviewer
  should not be able to delete code and keep all criteria passing.
```

Rationale for this exact wording:
- "the simplest implementation that satisfies the AC" — ties simplicity to the spec, so
  it can't be used as an excuse to under-deliver.
- The deletion test ("a reviewer should not be able to delete code and keep all criteria
  passing") is an operational, checkable definition — the same test a reviewer/idiomatic
  reviewer can apply, so it pairs with the review phase.
- It targets *internal* complexity, which Scope discipline misses, without duplicating
  Scope discipline or YAGNI.

### Net

- Add KISS (1 bullet, 2 personas + deprecated). **Skip YAGNI** — already present as
  Scope discipline.
- Low risk: it reinforces behavior the agents already exhibited on ttt and gives the
  reviewer a shared simplicity yardstick. Pairs naturally with `idiomatic-reviewer.md`.

---

## 4. Follow-up (optional)

- If we add the KISS bullet, mirror a "flag over-engineering / unnecessary abstraction"
  check into `reviewer.md` / `idiomatic-reviewer.md` so the gate enforces what the
  persona now asks for (persona sets intent; reviewer enforces).
