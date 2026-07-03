"""Additive reference-passing layer (c-generalize-loop C2).

Hive's primary data-passing mechanism is the typed point-to-point
``InputBinding`` (``executor/walker.py`` ``_resolve_one``): a node
receives exactly what the DAG wires to it. That typed contract is the
audit surface and is preserved unchanged.

This module adds an *additive*, opt-in reference layer on top of it. A
node may write an output to a filesystem POINTER — a plain path relative
to the run working directory — and a downstream node may declare a
``source: reference`` binding that resolves the pointer LAZILY, reading
the content at input-resolution time.

Design decisions (story c-generalize-loop):
  * Pointer format is a filesystem path relative to the run working
    directory (design-discussion §6 Q3). Absolute paths are honored
    as-is; relative paths resolve under the working dir.
  * NO Open-Prose SDK dependency. The concept (filesystem pointer, lazy
    resolution) is adopted with the Python standard library only — there
    is no third-party import anywhere in this module.
  * A missing pointer at resolution time raises ``MissingReferenceError``
    naming the pointer — never a silent ``None``.
"""

from __future__ import annotations

from pathlib import Path

from .errors import HandlerError


class MissingReferenceError(HandlerError):
    """A ``source: reference`` binding pointed at a file that does not exist.

    Raised at input-resolution time (lazy resolution) so the failure is
    loud and names the missing pointer rather than resolving to ``None``.
    """

    def __init__(self, pointer: str, base_dir: str | Path | None) -> None:
        self.pointer = pointer
        self.base_dir = str(base_dir) if base_dir is not None else None
        super().__init__(
            f"reference pointer {pointer!r} does not exist "
            f"(resolved under run working dir {self.base_dir!r})"
        )


def _resolve_path(base_dir: str | Path | None, pointer: str) -> Path:
    """Resolve ``pointer`` against ``base_dir``.

    An absolute pointer is returned unchanged; a relative pointer resolves
    under ``base_dir`` (falling back to the process CWD when unset).
    """

    p = Path(pointer)
    if p.is_absolute():
        return p
    base = Path(base_dir) if base_dir else Path.cwd()
    return base / p


def write_reference(base_dir: str | Path | None, pointer: str, content: str) -> Path:
    """Write ``content`` to the filesystem pointer, creating parent dirs.

    Returns the resolved absolute path. This is the producing side of the
    reference layer: a node materialises an output to ``pointer`` for a
    downstream ``source: reference`` binding to read lazily.
    """

    path = _resolve_path(base_dir, pointer)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def read_reference(base_dir: str | Path | None, pointer: str) -> str:
    """Read the content behind a reference pointer.

    Raises ``MissingReferenceError`` (naming the pointer) when the pointer
    does not resolve to an existing file — never returns ``None`` silently.
    """

    if not pointer:
        raise MissingReferenceError(pointer, base_dir)
    path = _resolve_path(base_dir, pointer)
    if not path.is_file():
        raise MissingReferenceError(pointer, base_dir)
    return path.read_text(encoding="utf-8")
