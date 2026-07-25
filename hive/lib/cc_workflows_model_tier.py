"""Model-tier resolver for cc-workflows dispatch."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from typing import Any


class ModelTierConfigError(ValueError):
    """Raised when model-tier configuration cannot produce a safe model."""


_DISPATCH_KINDS = {"initial", "follow_up", "rerun", "resume"}


def resolve_model_tier(persona: str, config: dict[str, Any] | None = None) -> dict[str, str]:
    if config is None:
        config = {}
    if not isinstance(config, Mapping):
        raise ModelTierConfigError("model config must be a mapping")

    overrides = config.get("model_overrides")
    if overrides is None:
        overrides = {}
    if not isinstance(overrides, Mapping):
        raise ModelTierConfigError("model_overrides must be a mapping")
    if persona in overrides:
        override = overrides[persona]
        if not isinstance(override, str) or not override.strip():
            raise ModelTierConfigError(
                f'model_overrides[{persona!r}] must be a non-empty string'
            )
        return {"tier": override, "source": "model_overrides"}

    tiers = config.get("model_tiers")
    if tiers is None:
        tiers = {}
    if not isinstance(tiers, Mapping):
        raise ModelTierConfigError("model_tiers must be a mapping")
    for tier, personas in tiers.items():
        if not isinstance(tier, str) or not tier.strip():
            raise ModelTierConfigError("model_tiers keys must be non-empty strings")
        if not isinstance(personas, list) or not all(
            isinstance(item, str) for item in personas
        ):
            raise ModelTierConfigError(
                f"model_tiers[{tier!r}] must be a list of persona strings"
            )
        if persona in personas:
            return {"tier": tier, "source": "model_tiers"}
    print(f'[cc-workflows-model-tier] persona "{persona}" unmapped — defaulting to sonnet', file=sys.stderr)
    return {"tier": "sonnet", "source": "default"}


def resolve_agent_options(
    persona: str,
    config: dict[str, Any] | None = None,
    dispatch_kind: str = "initial",
    prior_model: str | None = None,
    prior_source: str | None = None,
) -> dict[str, Any]:
    """Build explicit agent options for initial and resumed dispatches."""
    if dispatch_kind not in _DISPATCH_KINDS:
        raise ModelTierConfigError(
            f"dispatch_kind must be one of {sorted(_DISPATCH_KINDS)}"
        )
    if dispatch_kind == "initial":
        resolved = resolve_model_tier(persona, config)
    else:
        if not isinstance(prior_model, str) or not prior_model.strip():
            raise ModelTierConfigError(
                f"{dispatch_kind} dispatch requires a non-empty prior_model"
            )
        if prior_source not in {"model_overrides", "model_tiers", "default"}:
            raise ModelTierConfigError(
                f"{dispatch_kind} dispatch requires a valid prior_source"
            )
        resolved = {"tier": prior_model, "source": prior_source}
    return {
        **resolved,
        "dispatch_kind": dispatch_kind,
        "agent_options": {"model": resolved["tier"]},
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if "dispatch_kind" in request:
            result = resolve_agent_options(
                request["persona"],
                request.get("config"),
                request["dispatch_kind"],
                request.get("prior_model"),
                request.get("prior_source"),
            )
        else:
            result = resolve_model_tier(request["persona"], request.get("config"))
        print(json.dumps(result))
        return 0
    except (KeyError, TypeError, json.JSONDecodeError, ModelTierConfigError) as error:
        print(f"[cc-workflows-model-tier] invalid request: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
