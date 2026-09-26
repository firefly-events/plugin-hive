"""Agent skill-binding resolver — the shared match-resolve-load-invoke seam.

Agent persona frontmatter (`hive/references/agent-config-schema.md`) may
declare a `skills:` list of `{path, use-when}` entries. A binding is only a
declaration — it does nothing on its own. Every call site that spawns an
agent for a step where a skill governs the procedure (e.g. the reviewer
persona bound to `skills/review/SKILL.md`) must resolve, load, and invoke
the matched skill through this module rather than reading persona prose as
a substitute authority.

Fail-closed by design: a required binding that is missing or points at an
unreadable file raises ``SkillBindingError`` rather than falling back to
inline persona prose. Callers preserve their own bounded-retry contract
around that failure — this module does not retry.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import yaml

_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
_ENV_VAR_RE = re.compile(r"\$(?:\{(?P<braced>[^}]+)\}|(?P<plain>[A-Za-z_][A-Za-z0-9_]*))")


class SkillBindingError(Exception):
    """Raised when a required skill binding is missing, malformed, or unreadable."""


@dataclass(frozen=True)
class ResolvedSkill:
    persona_path: str
    skill_path: str
    use_when: str
    content: str


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def _expand(path: str, *, plugin_root: str | os.PathLike[str] | None = None) -> str:
    """Expand environment variables, optionally pinning the plugin root.

    ``plugin_root`` deliberately overrides ambient ``CLAUDE_PLUGIN_ROOT`` for
    both ``$VAR`` syntaxes.  This gives orchestrator callers a way to resolve
    plugin-owned bindings from the root they already trust instead of from
    inherited process state.  Other variables retain ``expandvars``'s legacy
    behavior: defined variables expand and undefined variables remain literal.
    """

    raw = path.strip()

    def replace(match: re.Match[str]) -> str:
        name = match.group("braced") or match.group("plain")
        if name == "CLAUDE_PLUGIN_ROOT" and plugin_root is not None:
            return os.fspath(plugin_root)
        return os.environ.get(name, match.group(0))

    return _ENV_VAR_RE.sub(replace, raw)


class _UniqueKeySafeLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects duplicate mapping keys.

    PyYAML otherwise silently keeps the last occurrence, which could let a
    duplicated ``path`` or ``use-when`` change a binding's authority without
    the resolver noticing the malformed declaration.
    """


def _construct_unique_mapping(
    loader: _UniqueKeySafeLoader,
    node: yaml.MappingNode,
    deep: bool = False,
) -> dict[object, object]:
    mapping: dict[object, object] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise SkillBindingError("YAML frontmatter contains an unhashable mapping key") from exc
        if duplicate:
            raise SkillBindingError(f"YAML frontmatter contains duplicate key {key!r}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def _resolve_within_roots(path: str, allowed_roots: Sequence[str]) -> str | None:
    """Return the real on-disk path for ``path`` if — with all symlinks
    resolved — it lands inside one of ``allowed_roots``; ``None`` otherwise.

    ``os.path.realpath`` is deliberate: a bound skill path may be an absolute
    escape, a ``..``-traversal, OR a symlink whose target sits outside the
    repository. Comparing lexically (e.g. ``abspath``) would miss the symlink
    case — the exfiltration repro used exactly that. A relative path is
    resolved against each root (not the process CWD), so an in-repo binding
    like ``skills/review/SKILL.md`` still works while an absolute/traversing
    escape is caught."""
    is_abs = os.path.isabs(path)
    for root in allowed_roots:
        root_real = os.path.realpath(root)
        candidate = path if is_abs else os.path.join(root_real, path)
        real = os.path.realpath(candidate)
        try:
            if os.path.commonpath([real, root_real]) == root_real:
                return real
        except ValueError:
            continue  # different drives / mixed abs+rel — not contained
    return None


def parse_skills_bindings(
    persona_text: str,
    *,
    plugin_root: str | os.PathLike[str] | None = None,
) -> list[dict[str, str]]:
    """Extract the `skills:` list from an agent persona's YAML frontmatter.

    Returns an empty list for `skills: []` or a frontmatter with no
    `skills:` key at all — both are valid "no binding declared" states.
    """
    match = _FRONTMATTER_RE.match(persona_text)
    if not match:
        raise SkillBindingError("persona file has no YAML frontmatter block")

    frontmatter = match.group(1)
    try:
        document = yaml.load(frontmatter, Loader=_UniqueKeySafeLoader)
    except SkillBindingError:
        raise
    except yaml.YAMLError as exc:
        raise SkillBindingError(f"persona YAML frontmatter is malformed: {exc}") from exc

    if not isinstance(document, Mapping):
        raise SkillBindingError("persona YAML frontmatter must be a mapping")
    if "skills" not in document:
        return []

    raw_entries = document["skills"]
    if not isinstance(raw_entries, list):
        raise SkillBindingError("persona YAML frontmatter 'skills' must be a list")

    entries: list[dict[str, str]] = []
    for index, raw_entry in enumerate(raw_entries):
        if not isinstance(raw_entry, Mapping):
            raise SkillBindingError(f"skills entry {index} must be a mapping")
        path = raw_entry.get("path")
        use_when = raw_entry.get("use-when")
        if not isinstance(path, str) or not path.strip():
            raise SkillBindingError(
                f"skills entry {index} must contain a non-empty string 'path'"
            )
        if not isinstance(use_when, str) or not use_when.strip():
            raise SkillBindingError(
                f"skills entry {index} must contain a non-empty string 'use-when'"
            )
        entries.append(
            {
                "path": _expand(path, plugin_root=plugin_root),
                "use_when": use_when.strip(),
            }
        )
    return entries


def resolve_skill_binding(
    persona_path: str,
    trigger: str,
    *,
    require_binding: bool = True,
    allowed_roots: Sequence[str] | None = None,
    plugin_root: str | os.PathLike[str] | None = None,
) -> ResolvedSkill | None:
    """Resolve the skill bound to ``persona_path`` for the given ``trigger``.

    ``trigger`` is matched against each binding's ``use-when`` by substring
    (case-insensitive) — the same coarse match the orchestrator performs by
    hand today, made deterministic and testable.

    Fails closed:
    - persona file missing/unreadable -> ``SkillBindingError``
    - ``require_binding`` is True and no entry matches -> ``SkillBindingError``
    - MORE THAN ONE entry matches with distinct skill paths -> ``SkillBindingError``
      (ambiguous authority: refuse rather than let frontmatter order silently
      pick the governing skill — a short trigger like "code review" must not
      quietly select one of two reviewer bindings)
    - a matching entry's ``path`` does not resolve to a readable file -> ``SkillBindingError``
    - ``allowed_roots`` given and the bound skill path (symlinks resolved)
      escapes every root -> ``SkillBindingError`` (a persona must not bind an
      absolute / traversed / symlinked path outside the repository and have
      its contents injected into an external agent prompt)

    Pass the caller's trusted plugin directory as ``plugin_root`` to expand a
    persona's ``${CLAUDE_PLUGIN_ROOT}`` without consulting the ambient value
    of that variable. Callers that know their plugin root should always do so.

    When ``require_binding`` is False and no entry matches, returns ``None``
    (used by generic call sites that inject a skill only when one applies).
    """
    try:
        persona_text = _read_text(persona_path)
    except OSError as exc:
        raise SkillBindingError(f"cannot read persona file {persona_path!r}: {exc}") from exc

    entries = parse_skills_bindings(persona_text, plugin_root=plugin_root)
    trigger_lower = trigger.lower()

    matches = [
        entry
        for entry in entries
        if entry["use_when"].lower() in trigger_lower
        or trigger_lower in entry["use_when"].lower()
    ]

    if not matches:
        if require_binding:
            raise SkillBindingError(
                f"no skills binding on {persona_path!r} matches trigger {trigger!r}"
            )
        return None

    distinct_paths = {entry["path"] for entry in matches}
    if len(distinct_paths) > 1:
        raise SkillBindingError(
            f"ambiguous skill binding on {persona_path!r} for trigger {trigger!r}: "
            f"{len(matches)} entries match distinct skills {sorted(distinct_paths)!r} "
            "— narrow the use-when conditions so exactly one governs"
        )

    matched = matches[0]
    skill_path = matched["path"]

    # Path to actually READ from. With containment enabled this is the
    # symlink-resolved, root-confined real path; without it, the declared
    # path as-given (legacy standalone use).
    read_path = skill_path
    if allowed_roots is not None:
        resolved = _resolve_within_roots(skill_path, allowed_roots)
        if resolved is None:
            raise SkillBindingError(
                f"bound skill {skill_path!r} declared on {persona_path!r} resolves "
                f"outside the allowed roots {list(allowed_roots)!r} — refusing to "
                "inject out-of-repository file content into an agent prompt"
            )
        read_path = resolved

    if not os.path.isfile(read_path):
        raise SkillBindingError(
            f"bound skill {skill_path!r} declared on {persona_path!r} is unreadable"
        )

    try:
        skill_content = _read_text(read_path)
    except OSError as exc:
        raise SkillBindingError(f"bound skill {skill_path!r} is unreadable: {exc}") from exc

    return ResolvedSkill(
        persona_path=persona_path,
        skill_path=skill_path,
        use_when=matched["use_when"],
        content=skill_content,
    )


_IN_GRAPH_GUARD = (
    "> **You are already executing INSIDE the DAG as this node's agent.** The "
    "skill below may describe a Phase 0 / dispatch-mode step that routes the "
    "work through a DAG front-door workflow (e.g. `multica` -> the review/"
    "security DAG). **Do NOT run that routing and do NOT dispatch or start "
    "another workflow run** — that would recurse this same graph. Skip any "
    "dispatch/Phase-0b step and perform the skill's actual procedure (Phase 1 "
    "onward) directly, producing the declared artifact/outputs here."
)

_PHASE_ZERO_HEADING_RE = re.compile(r"^#{1,6}\s+Phase\s+0(?:\b|[^\n]*)", re.MULTILINE)
_PHASE_ONE_HEADING_RE = re.compile(r"^#{1,6}\s+Phase\s+1(?:\b|[^\n]*)", re.MULTILINE)


def _without_dispatch_phases(skill_content: str) -> str:
    """Remove a skill's Phase 0 dispatch section for in-graph execution.

    A prose warning followed by the original unconditional routing procedure
    leaves two competing instructions in the assembled prompt.  For an agent
    already running as a DAG node, omit the dispatch section structurally and
    retain the direct Phase 1 procedure. Skills without a Phase 0 remain
    unchanged. A Phase 0 without a later Phase 1 is ambiguous and fails closed
    rather than injecting a potentially recursive procedure.
    """

    phase_zero = _PHASE_ZERO_HEADING_RE.search(skill_content)
    if phase_zero is None:
        return skill_content

    phase_one = _PHASE_ONE_HEADING_RE.search(skill_content, phase_zero.end())
    if phase_one is None:
        raise SkillBindingError(
            "cannot build in-graph skill injection: Phase 0 is present but "
            "no subsequent Phase 1 direct-execution procedure exists"
        )

    omission = (
        "<!-- In-graph injection omitted the skill's Phase 0 routing section. -->\n\n"
    )
    return skill_content[: phase_zero.start()] + omission + skill_content[phase_one.start() :]


def build_skill_injection(resolved: ResolvedSkill, *, in_graph: bool = False) -> str:
    """Render a resolved skill into the prompt-injectable text a real caller
    prepends to an agent's step_file/brief — the "load + invoke" half of the
    match-resolve-load-invoke seam.

    ``resolve_skill_binding`` alone only proves a binding is well-formed and
    readable; without this, nothing ever surfaces the skill's actual
    procedure to the spawned agent, so the binding stays inert. The emitted
    marker line (``[info] skill-invoked: path=...``) is the deterministic,
    machine-checkable signal that invocation happened — callers should also
    set the node's ``skill_invoked`` output to ``resolved.skill_path``
    themselves rather than relying on the spawned agent to self-report it.

    ``in_graph`` prepends an "already inside the DAG" guard. A skill whose
    Phase 0 dispatches the work through a DAG front-door (review/security)
    would, if injected verbatim into an in-graph agent, let that agent start
    the SAME graph again. The guard tells the agent to skip dispatch/Phase-0b
    and run the procedure directly. Set it on any binding attached to a node
    that already IS the graph execution of that skill.
    """
    marker = f"[info] skill-invoked: path={resolved.skill_path}"
    guard = f"{_IN_GRAPH_GUARD}\n\n" if in_graph else ""
    skill_content = _without_dispatch_phases(resolved.content) if in_graph else resolved.content
    return (
        f"## Injected Skill — {resolved.skill_path}\n\n"
        f"{guard}"
        f"{marker}\n\n"
        "The following skill content is the governing procedure for this "
        "step. Follow its Process phases; persona prose supplies identity, "
        "rubric, and output-format only — it is not a substitute procedure.\n\n"
        f"{skill_content}"
    )
