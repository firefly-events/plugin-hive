from __future__ import annotations

import json
import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
SKILL_PATH = ROOT / "skills/hive/skills/meta-optimize/SKILL.md"
PLUGIN_PATH = ROOT / ".claude-plugin/plugin.json"


def _load_frontmatter(text: str) -> dict:
    match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    assert match, "SKILL.md must start with YAML frontmatter"
    data = yaml.safe_load(match.group(1))
    assert isinstance(data, dict), "frontmatter must parse to a mapping"
    return data


def test_meta_optimize_skill_exists_and_has_expected_name() -> None:
    assert SKILL_PATH.is_file()

    content = SKILL_PATH.read_text(encoding="utf-8")
    frontmatter = _load_frontmatter(content)

    assert frontmatter.get("name") == "meta-optimize"


def test_plugin_manifest_does_not_reference_maintainer_skills() -> None:
    manifest = PLUGIN_PATH.read_text(encoding="utf-8")
    assert "maintainer-skills/" not in manifest

    parsed = json.loads(manifest)
    assert parsed.get("skills") == "./skills/"


def test_skill_body_excludes_maintainer_only_surface_and_adapter_terms() -> None:
    content = SKILL_PATH.read_text(encoding="utf-8")
    _, body = re.split(r"^---\n.*?\n---\n", content, maxsplit=1, flags=re.DOTALL)

    assert "/meta-meta-optimize" not in body
    assert "DirectCommitAdapter" not in body


def test_skill_body_includes_public_pr_and_prerequisite_language() -> None:
    content = SKILL_PATH.read_text(encoding="utf-8")
    _, body = re.split(r"^---\n.*?\n---\n", content, maxsplit=1, flags=re.DOTALL)

    assert ("PR" in body) or ("pull request" in body)
    assert "metrics" in body
    assert "opt-in" in body
