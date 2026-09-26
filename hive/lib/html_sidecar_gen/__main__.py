"""CLI entry point: python -m hive.lib.html_sidecar_gen <path.md|.html>"""

from __future__ import annotations

import sys

from .render import generate_markdown_sidecar, generate_sidecar


def main() -> None:
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m hive.lib.html_sidecar_gen <path.md>  (or <path.html> for inverse direction)\n")
        sys.exit(1)

    input_path = sys.argv[1]
    if input_path.endswith(".html"):
        # Inverse direction: HTML → markdown. Print the result path.
        result = generate_markdown_sidecar(input_path)
        if result:
            sys.stdout.write(result + "\n")
    else:
        # Forward direction: markdown → HTML sidecar. generate_sidecar emits
        # the sidecar path (and epic index path when applicable) to stdout itself.
        generate_sidecar(input_path)


if __name__ == "__main__":
    main()
