"""CLI wrapper around KG emit helpers for skill-prompt-driven emission sites.

Invocation:
    python3 -m hive.lib.kg_emit_cli \
        --subject <id> --predicate <name> --object <text> \
        --source-epic <id> --source-agent <name> [--no-sanitize]

Designed for use from markdown skill steps and persona prompts where the
emission gate is prompt-driven (e.g. tpm.md escalation-raise, plan.md
waiting-on-user gates). Mirrors the kg_emit.py module surface but exposes it
as a Bash-callable command so non-Python skill code can fan out priority-
predicate emissions without a subprocess into a custom Node bridge.

Exits 0 in all cases except argparse errors. Silent on knob==off and on
missing sqlite — same semantics as emit_kg_event so callers can `set -e`
without fear.
"""

from __future__ import annotations

import argparse
import json
import sys

from hive.lib.kg_emit import emit_kg_event, emit_superseded, sanitize_obj


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="kg_emit_cli",
        description="Emit one KG lifecycle triple from a skill prompt or shell context.",
    )
    parser.add_argument("--subject", required=True)
    parser.add_argument("--predicate", required=True)
    parser.add_argument(
        "--mode",
        choices=("event", "supersede"),
        default="event",
        help="Emit a normal lifecycle event or a superseded provenance edge.",
    )
    parser.add_argument("--object", dest="obj")
    parser.add_argument("--new-object", dest="obj")
    parser.add_argument(
        "--prior-object",
        dest="prior_object",
        help="Prior object to invalidate when --mode supersede is used.",
    )
    parser.add_argument("--source-epic", required=True, dest="source_epic")
    parser.add_argument("--source-agent", required=True, dest="source_agent")
    parser.add_argument(
        "--no-sanitize",
        action="store_true",
        help="Skip sanitize_obj on the --object argument (caller pre-sanitized).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the emit result as JSON to stdout.",
    )
    args = parser.parse_args(argv)

    if not args.obj:
        parser.error("--object is required (--new-object is also accepted)")
    if args.mode == "supersede" and not args.prior_object:
        parser.error("--prior-object is required when --mode supersede")

    obj = args.obj if args.no_sanitize else sanitize_obj(args.obj)

    try:
        if args.mode == "supersede":
            prior_object = args.prior_object if args.no_sanitize else sanitize_obj(args.prior_object)
            result = emit_superseded(
                subject=args.subject,
                predicate=args.predicate,
                prior_object=prior_object,
                new_object=obj,
                source_epic=args.source_epic,
                source_agent=args.source_agent,
            )
        else:
            result = emit_kg_event(
                subject=args.subject,
                predicate=args.predicate,
                obj=obj,
                source_epic=args.source_epic,
                source_agent=args.source_agent,
            )
    except Exception as exc:  # pragma: no cover — emit_kg_event already swallows
        result = {"emitted": False, "metadata": None, "error": str(exc)}

    if args.json:
        sys.stdout.write(json.dumps(result, default=str))
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
