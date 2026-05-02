"""Run-id primitive for the DAG executor.

`make_run_id(workflow_slug)` returns `"{ulid}-{workflow_slug}"`.

Why ULID + workflow_slug:
  * ULID embeds a millisecond timestamp in its first 48 bits and
    Crockford-base32-encodes the whole 128 bits, so lexicographic
    sort on the string is equivalent to chronological sort on the
    underlying timestamp. No separate timestamp field is needed.
  * Within the same millisecond, the random suffix is monotonically
    incremented (per ULID spec §"Monotonicity"), so 100 calls in tight
    succession yield 100 lexicographically-ordered, unique strings.
  * `workflow_slug` is human-readable context appended after the ULID
    so a glance at `events/{run_id}.jsonl` tells you which workflow
    produced the file. Keeping the ULID as the prefix preserves the
    sortability — `sort` over the directory still orders by creation.

`python-ulid` is not in the repo's runtime dependencies (no root
`package.json`-equivalent for Python pulls it in either; the
plugin-hive philosophy is bring-your-own-enhancements). To keep this
primitive zero-dep, we ship a small Crockford base32 ULID helper
inline. It is faithful to the spec: 48-bit ms timestamp + 80-bit
random with monotonic-within-ms incrementing.
"""

from __future__ import annotations

import os
import threading
import time

# Crockford's base32 alphabet — no I, L, O, U.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_lock = threading.Lock()
_last_ms: int = 0
_last_random: int = 0  # 80-bit integer of the random portion


def _encode_crockford(value: int, length: int) -> str:
    """Encode `value` as a Crockford-base32 string of exactly `length` chars."""
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def _new_ulid_int() -> int:
    """Generate the 128-bit integer for a monotonic ULID.

    The first 48 bits are the current Unix-epoch milliseconds. The
    remaining 80 bits are random unless this call lands in the same
    millisecond as the previous call, in which case the previous random
    value is incremented by 1 to preserve monotonic ordering.
    """
    global _last_ms, _last_random  # noqa: PLW0603 — module-level monotonic state

    now_ms = int(time.time() * 1000)
    with _lock:
        if now_ms <= _last_ms:
            # Same millisecond (or clock jitter went backwards): bump the
            # previous random portion to keep the ULID strictly monotonic.
            ms = _last_ms
            random_part = (_last_random + 1) & ((1 << 80) - 1)
        else:
            ms = now_ms
            random_part = int.from_bytes(os.urandom(10), "big")
        _last_ms = ms
        _last_random = random_part

    return (ms << 80) | random_part


def new_ulid() -> str:
    """Generate a new 26-character Crockford-base32 ULID string."""
    return _encode_crockford(_new_ulid_int(), 26)


def make_run_id(workflow_slug: str) -> str:
    """Compose an executor run id: `{ULID}-{workflow_slug}`.

    `workflow_slug` is appended verbatim. The caller is responsible for
    passing a slug that is filesystem-safe (no `/`, no `..`, no
    leading dot) — `hive.lib.metrics` validates this when the run_id
    is later used for an events file path.
    """
    if not isinstance(workflow_slug, str) or not workflow_slug:
        raise ValueError("workflow_slug must be a non-empty string")
    return f"{new_ulid()}-{workflow_slug}"
