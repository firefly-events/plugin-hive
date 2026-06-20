"""Package entrypoint: enables ``python -m hive.lib.artifact_lifecycle``.

Delegates to :func:`cli.main`; used by ``hive/scripts/artifact-lifecycle-weekly.sh``
and the documented invocation in ``cli.py``.
"""

from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
