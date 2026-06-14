"""Supersede-emit regression tests (s4-superseded-callers-wire).

kg_emit_cli --mode supersede and kg_emit.emit_superseded existed but the three
documented callsites never produced a `superseded` triple in practice
(post-merge audit: SELECT COUNT(*) FROM triples WHERE predicate='superseded'
returned 0). These tests run each callsite's documented invocation form
end-to-end against a fixture kg.sqlite and pin:

1. /plan step 13 story-overwrite — `python3 -m hive.lib.kg_emit_cli --mode
   supersede --predicate story-spec --object <new>` (the exact flag form in
   skills/plan/SKILL.md) inserts the provenance edge AND sets valid_until on
   the prior story-spec triple.
2. meta-team-cycle step-03 grouped-proposal replacement — same CLI with the
   `--new-object` alias and predicate `proposal`.
3. session-end memory replacement — runSessionEnd({supersededMemories}) in
   hive/lib/session-end.js reaches kgSupersede and lands the edge.
4. The provenance edge is inserted even when no prior triple exists (the
   common production case — specs were never KG-recorded before supersession),
   so the audit count is > 0 after any supersession.
5. The documented snippets themselves stay present in the markdown callsites.

Run from the repo root with:

    python3 -m pytest tests/test_supersede_emits.py
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from hive.lib.kg_bootstrap import bootstrap_kg

REPO_ROOT = Path(__file__).resolve().parents[1]
PLAN_SKILL = REPO_ROOT / "skills" / "plan" / "SKILL.md"
PROPOSAL_STEP = (
    REPO_ROOT / "hive" / "workflows" / "steps" / "meta-team-cycle" / "step-03-proposal.md"
)
SESSION_END_SKILL = REPO_ROOT / "skills" / "hive" / "skills" / "session-end" / "SKILL.md"
STEP_08 = REPO_ROOT / "hive" / "workflows" / "steps" / "daily-ceremony" / "step-08-session-end.md"
SESSION_END_JS = REPO_ROOT / "hive" / "lib" / "session-end.js"


def _make_db(tmp_path: Path, extra_predicates: tuple[str, ...] = ()) -> Path:
    db_path = tmp_path / "kg.sqlite"
    bootstrap_kg(db_path)
    if extra_predicates:
        with sqlite3.connect(str(db_path)) as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO predicates VALUES (?)",
                [(p,) for p in extra_predicates],
            )
            conn.commit()
    return db_path


def _seed_triple(db_path: Path, subject: str, predicate: str, obj: str) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(
            "INSERT INTO triples (subject, predicate, object, valid_from, source_epic, source_agent)"
            " VALUES (?, ?, ?, '2026-01-01T00:00:00Z', 'seed-epic', 'seed-agent')",
            (subject, predicate, obj),
        )
        conn.commit()


def _query(db_path: Path, sql: str, params: tuple = ()) -> list[tuple]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(sql, params).fetchall()


def _run_cli(db_path: Path, *args: str) -> dict:
    env = dict(os.environ, HIVE_KG_SQLITE_PATH=str(db_path))
    proc = subprocess.run(
        [sys.executable, "-m", "hive.lib.kg_emit_cli", *args, "--json"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _superseded_count(db_path: Path) -> int:
    rows = _query(db_path, "SELECT COUNT(*) FROM triples WHERE predicate='superseded'")
    return rows[0][0]


# ---------------------------------------------------------------------------
# Callsite 1: /plan step 13 story-overwrite (skills/plan/SKILL.md)
# ---------------------------------------------------------------------------


def test_plan_story_overwrite_supersede_sets_prior_and_inserts_edge(tmp_path):
    db = _make_db(tmp_path, extra_predicates=("story-spec",))
    _seed_triple(db, "s7-demo-story", "story-spec", "aaa111bbb222")

    result = _run_cli(
        db,
        "--mode", "supersede",
        "--subject", "s7-demo-story",
        "--predicate", "story-spec",
        "--prior-object", "aaa111bbb222",
        "--object", "ccc333ddd444",
        "--source-epic", "demo-epic",
        "--source-agent", "plan",
    )

    assert result["emitted"] is True
    assert result["metadata"]["prior_valid_until_updated"] is True

    edges = _query(
        db,
        "SELECT object, valid_until FROM triples WHERE subject=? AND predicate='superseded'",
        ("s7-demo-story",),
    )
    assert edges == [("aaa111bbb222->ccc333ddd444", None)]

    prior = _query(
        db,
        "SELECT valid_until FROM triples WHERE subject=? AND predicate='story-spec' AND object=?",
        ("s7-demo-story", "aaa111bbb222"),
    )
    assert len(prior) == 1
    assert prior[0][0] is not None


def test_plan_supersede_without_prior_triple_still_inserts_edge(tmp_path):
    # Production reality at first supersession: the original story-spec was
    # never KG-recorded. The edge must still land so the audit count is > 0.
    db = _make_db(tmp_path)

    result = _run_cli(
        db,
        "--mode", "supersede",
        "--subject", "s7-demo-story",
        "--predicate", "story-spec",
        "--prior-object", "aaa111bbb222",
        "--object", "ccc333ddd444",
        "--source-epic", "demo-epic",
        "--source-agent", "plan",
    )

    assert result["emitted"] is True
    assert result["metadata"]["prior_valid_until_updated"] is False
    assert _superseded_count(db) == 1


# ---------------------------------------------------------------------------
# Callsite 2: meta-team-cycle step-03 grouped-proposal replacement
# ---------------------------------------------------------------------------


def test_proposal_replacement_supersede_via_new_object_alias(tmp_path):
    db = _make_db(tmp_path, extra_predicates=("proposal",))
    _seed_triple(db, "meta-epic-1", "proposal", "proposal-2")

    # step-03-proposal.md documents the --new-object alias, not --object.
    result = _run_cli(
        db,
        "--mode", "supersede",
        "--subject", "meta-epic-1",
        "--predicate", "proposal",
        "--prior-object", "proposal-2",
        "--new-object", "proposal-5",
        "--source-epic", "meta-epic-1",
        "--source-agent", "meta-optimize",
    )

    assert result["emitted"] is True
    assert result["metadata"]["prior_valid_until_updated"] is True

    edges = _query(
        db,
        "SELECT object FROM triples WHERE subject=? AND predicate='superseded'",
        ("meta-epic-1",),
    )
    assert edges == [("proposal-2->proposal-5",)]

    prior = _query(
        db,
        "SELECT valid_until FROM triples WHERE subject=? AND predicate='proposal' AND object=?",
        ("meta-epic-1", "proposal-2"),
    )
    assert len(prior) == 1
    assert prior[0][0] is not None
    assert _superseded_count(db) == 1


# ---------------------------------------------------------------------------
# Callsite 3: session-end memory replacement (hive/lib/session-end.js)
# ---------------------------------------------------------------------------


def _node_with_sqlite_available() -> bool:
    if shutil.which("node") is None:
        return False
    probe = subprocess.run(
        ["node", "-e", "require('better-sqlite3')"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        check=False,
    )
    return probe.returncode == 0


needs_node_sqlite = pytest.mark.skipif(
    not _node_with_sqlite_available(),
    reason="node or better-sqlite3 unavailable — run npm install at the repo root",
)

_RUN_SESSION_END_JS = """
const { runSessionEnd } = require(process.argv[1]);
runSessionEnd({
  agentName: 'developer',
  epicId: 'epic-x',
  promotedSlugs: [],
  triples: [],
  supersededMemories: [JSON.parse(process.argv[2])],
  skipCompile: true,
}).then((r) => {
  console.log(JSON.stringify({ kgError: r.kgError ? r.kgError.message : null }));
}).catch((err) => {
  console.error(err && err.message);
  process.exit(1);
});
"""


def _run_session_end(db_path: Path, replacement: dict) -> dict:
    env = dict(os.environ, HIVE_KG_SQLITE_PATH=str(db_path))
    proc = subprocess.run(
        [
            "node",
            "-e",
            _RUN_SESSION_END_JS,
            str(SESSION_END_JS),
            json.dumps(replacement),
        ],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


@needs_node_sqlite
def test_session_end_memory_replacement_supersede(tmp_path):
    db = _make_db(tmp_path, extra_predicates=("memory",))
    _seed_triple(db, "developer", "memory", "old-slug")

    out = _run_session_end(db, {
        "subject": "developer",
        "predicate": "memory",
        "prior_object": "old-slug",
        "new_object": "new-slug",
        "source_agent": "developer",
    })

    assert out["kgError"] is None

    edges = _query(
        db,
        "SELECT object, source_epic, source_agent FROM triples"
        " WHERE subject='developer' AND predicate='superseded'",
    )
    assert edges == [("old-slug->new-slug", "epic-x", "developer")]

    prior = _query(
        db,
        "SELECT valid_until FROM triples WHERE subject='developer'"
        " AND predicate='memory' AND object='old-slug'",
    )
    assert len(prior) == 1
    assert prior[0][0] is not None


@needs_node_sqlite
def test_session_end_supersede_without_prior_memory_still_inserts_edge(tmp_path):
    # Pins the kgSupersede fix: edge insertion must not be gated on the prior
    # triple existing (JS previously skipped the insert when updated == 0,
    # diverging from kg_emit.py and keeping the audit count at 0).
    db = _make_db(tmp_path)

    out = _run_session_end(db, {
        "subject": "developer",
        "predicate": "memory",
        "prior_object": "old-slug",
        "new_object": "new-slug",
        "source_agent": "developer",
    })

    assert out["kgError"] is None
    assert _superseded_count(db) == 1


# ---------------------------------------------------------------------------
# Doc pinning — the documented snippets must stay wired in the callsites
# ---------------------------------------------------------------------------


def test_plan_skill_documents_story_spec_supersede():
    text = PLAN_SKILL.read_text(encoding="utf-8")
    assert "--mode supersede" in text
    assert '--predicate "story-spec"' in text
    assert "kg_emit_cli" in text


def test_proposal_step_documents_proposal_supersede():
    text = PROPOSAL_STEP.read_text(encoding="utf-8")
    assert "--mode supersede" in text
    assert '--predicate "proposal"' in text
    assert "--new-object" in text


def test_session_end_docs_wire_superseded_memories():
    skill = SESSION_END_SKILL.read_text(encoding="utf-8")
    assert "supersededMemories" in skill
    step08 = STEP_08.read_text(encoding="utf-8")
    assert "supersededMemories" in step08
