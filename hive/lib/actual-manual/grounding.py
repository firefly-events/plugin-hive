"""
Grounding + verify parse helpers — Python side of the actual-manual tier.

Story: am-4-flow-runner-bridge (actual-manual-tier)

Canonical logic for:
  parse_coords(raw)           — extract (x, y, found) from an MLX locate response
  parse_verdict(raw)          — extract (pass, why) from an MLX verify response
  eval_truth_signal(signal, value) — normalise a truth-signal result to a bool

These mirror the inline parsing in flow-runner.mjs and serve as the reference
implementation for Python-native orchestrators (e.g. the MLX sidecar lifecycle,
future Maestro bindings, or test harnesses that don't want the Node stack).

Design invariants carried from spike Arm D:
  - Coord parse: extract first two integers from raw; found = x>0 and y>0.
    Model returns {"x":0,"y":0} when the element is absent — not a visibility flag.
  - Verdict parse: fail-closed. Any negative signal → fail. Never pass on ambiguity.
  - Truth-signal: signal name is authoritative; value is already evaluated by the
    Node runner (DOM eval / network flag). Python normalises to bool.

CLI (for testing/debugging):
  python3 grounding.py parse-coords   '<raw mlx response>'
  python3 grounding.py parse-verdict  '<raw mlx response>'
  python3 grounding.py eval-truth     '<signal-name>' '<true|false>'
"""

from __future__ import annotations

import json
import re
import sys


# ─── Coord parsing ────────────────────────────────────────────────────────────

def parse_coords(raw: str) -> dict:
    """
    Extract x, y from an MLX locate response.

    The model should return JSON like {"x":123,"y":456}.
    We strip any surrounding markdown/prose and grab the first two integers.
    found=False when x==0 and y==0 (the model's "not present" convention).

    Returns:
        {"x": int, "y": int, "found": bool, "raw": str}
    """
    text = str(raw)
    ints = [int(m) for m in re.findall(r"-?\d+", text)]
    x = ints[0] if len(ints) > 0 else 0
    y = ints[1] if len(ints) > 1 else 0
    return {"x": x, "y": y, "found": x > 0 and y > 0, "raw": text.strip()[:140]}


# ─── Verdict parsing ──────────────────────────────────────────────────────────

_NEG_RE = re.compile(
    r'"?pass"?\s*[:=]\s*false'
    r'|^\s*```?\s*(?:json)?\s*false'
    r'|\bnot (?:shown|visible|present|happen|posted|confirmed|enabled|completed)\b'
    r'|\bno confirmation\b',
    re.IGNORECASE | re.MULTILINE,
)
_POS_RE = re.compile(
    r'"?pass"?\s*[:=]\s*true'
    r'|\b(?:confirmed|success|is shown|does appear|did happen|now shows)\b',
    re.IGNORECASE,
)
_WHY_RE = re.compile(r'"why"\s*:\s*"([^"]+)"', re.IGNORECASE)


def parse_verdict(raw: str) -> dict:
    """
    Extract pass/why from an MLX verify response.

    Fail-closed: any negative signal → pass=False.
    A verify must not pass on ambiguity.

    Returns:
        {"pass": bool, "why": str}
    """
    s = str(raw)
    fail = bool(_NEG_RE.search(s))
    succeed = bool(_POS_RE.search(s))
    passed = False if fail else succeed

    m = _WHY_RE.search(s)
    if m:
        why = m.group(1)
    else:
        why = re.sub(r"```[a-z]*|[{}\"']", " ", s).strip()[:140]

    return {"pass": passed, "why": why}


# ─── Truth-signal normalisation ───────────────────────────────────────────────

_KNOWN_SIGNALS = {"cta_enabled", "posted"}


def eval_truth_signal(signal: str, value: object) -> dict:
    """
    Normalise a truth-signal result to a typed verdict dict.

    value is the already-evaluated raw value from the Node runner
    (DOM boolean for cta_enabled, network boolean for posted).

    Returns:
        {"signal": str, "pass": bool}

    Raises ValueError for unknown signals.
    """
    if signal not in _KNOWN_SIGNALS:
        raise ValueError(
            f"unknown truth signal {signal!r}; known: {sorted(_KNOWN_SIGNALS)}"
        )
    if isinstance(value, str):
        value = value.lower() not in ("false", "0", "no", "")
    return {"signal": signal, "pass": bool(value)}


# ─── CLI ──────────────────────────────────────────────────────────────────────

def _cli() -> None:
    if len(sys.argv) < 3:
        print(
            "usage:\n"
            "  python3 grounding.py parse-coords  '<raw>'\n"
            "  python3 grounding.py parse-verdict '<raw>'\n"
            "  python3 grounding.py eval-truth    '<signal>' '<true|false>'",
            file=sys.stderr,
        )
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "parse-coords":
        print(json.dumps(parse_coords(sys.argv[2])))
    elif cmd == "parse-verdict":
        print(json.dumps(parse_verdict(sys.argv[2])))
    elif cmd == "eval-truth":
        if len(sys.argv) < 4:
            print("eval-truth requires <signal> and <value>", file=sys.stderr)
            sys.exit(1)
        raw_val = sys.argv[3].lower() not in ("false", "0", "no")
        print(json.dumps(eval_truth_signal(sys.argv[2], raw_val)))
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    _cli()
