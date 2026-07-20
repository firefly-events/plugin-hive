"""Model-tier resolver for cc-workflows dispatch."""

from __future__ import annotations

import json
import sys
from typing import Any


def resolve_model_tier(persona: str, config: dict[str, Any] | None = None) -> dict[str, str]:
    config = config or {}
    overrides = config.get("model_overrides") or {}
    if overrides.get(persona):
        return {"tier": overrides[persona], "source": "model_overrides"}
    tiers = config.get("model_tiers") or {}
    for tier, personas in tiers.items():
        if isinstance(personas, list) and persona in personas:
            return {"tier": tier, "source": "model_tiers"}
    print(f'[cc-workflows-model-tier] persona "{persona}" unmapped — defaulting to sonnet', file=sys.stderr)
    return {"tier": "sonnet", "source": "default"}


def main() -> int:
    request = json.load(sys.stdin)
    print(json.dumps(resolve_model_tier(request["persona"], request.get("config"))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
