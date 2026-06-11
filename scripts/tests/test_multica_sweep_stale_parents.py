"""Classification tests for scripts/multica-sweep-stale-parents.py.

Pure fixture-driven tests — no live Multica CLI calls. The apply tests stub
the CLI wrapper and assert on the recorded command sequence.
"""

import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "multica-sweep-stale-parents.py"
_spec = importlib.util.spec_from_file_location("multica_sweep", SCRIPT_PATH)
sweep_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sweep_mod)

NOW = datetime(2026, 6, 9, 12, 0, 0, tzinfo=timezone.utc)
MIN_AGE = timedelta(minutes=30)


def iso(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_parent(num, *, assignee_type="squad", updated_minutes_ago=120,
                status="in_progress"):
    return {
        "id": f"00000000-0000-0000-0000-0000000{num:05d}",
        "identifier": f"PLU-{num}",
        "number": num,
        "title": f"Parent {num}",
        "status": status,
        "assignee_type": assignee_type,
        "updated_at": iso(updated_minutes_ago),
    }


def make_child(parent, suffix, status):
    return {
        "id": f"11111111-0000-0000-0000-0000000{suffix:05d}",
        "identifier": f"PLU-{900 + suffix}",
        "status": status,
        "parent_issue_id": parent["id"],
    }


def classify(parent, children, comments=()):
    return sweep_mod.classify_parent(parent, list(children), list(comments), NOW, MIN_AGE)


# --- AC1: PLU-277/298/302/305/308 — children terminal, parent old → STALE ---

def test_terminal_children_old_parents_are_stale():
    terminal_mixes = [
        ["done", "done"],                      # PLU-277
        ["done", "cancelled"],                 # PLU-298
        ["in_review", "done", "done"],         # PLU-302
        ["in_review"],                         # PLU-305
        ["cancelled", "in_review", "done"],    # PLU-308
    ]
    for num, statuses in zip([277, 298, 302, 305, 308], terminal_mixes):
        parent = make_parent(num, updated_minutes_ago=120)
        children = [make_child(parent, i, s) for i, s in enumerate(statuses)]
        result = classify(parent, children)
        assert result["verdict"] == "STALE", f"PLU-{num}: {result['reason']}"


# --- AC2: PLU-312 — agent-assigned, live, no children → NOT stale ---

def test_agent_assigned_parent_without_children_is_not_stale():
    parent = make_parent(312, assignee_type="agent", updated_minutes_ago=240)
    result = classify(parent, children=[])
    assert result["verdict"] == "ACTIVE"
    assert "no child issues" in result["reason"]


def test_one_child_in_progress_is_not_stale():
    parent = make_parent(400, updated_minutes_ago=120)
    children = [
        make_child(parent, 1, "done"),
        make_child(parent, 2, "in_progress"),
    ]
    result = classify(parent, children)
    assert result["verdict"] == "ACTIVE"
    assert "non-terminal children" in result["reason"]


def test_fresh_parent_is_not_stale():
    parent = make_parent(401, updated_minutes_ago=5)
    children = [make_child(parent, 1, "done")]
    result = classify(parent, children)
    assert result["verdict"] == "ACTIVE"
    assert "quiet threshold" in result["reason"]


# --- AC3: BLOCKED comment → blocked section, --apply never touches ---

def test_blocked_comment_lands_in_blocked_section():
    parent = make_parent(402, updated_minutes_ago=120)
    children = [make_child(parent, 1, "done")]
    comments = [{"content": "BLOCKED: child PLU-903 stuck waiting on auth fix"}]
    result = classify(parent, children, comments)
    assert result["verdict"] == "BLOCKED"

    report = sweep_mod.render_report([result])
    assert "Blocked-by-intent" in report

    calls = []
    sweep_mod.run_multica = lambda args: calls.append(args) or ""
    for r in [result]:
        if r["verdict"] == "STALE":
            sweep_mod.apply_stale(r)
    assert calls == []


def test_blocked_word_in_prose_lowercase_does_not_block():
    parent = make_parent(403, updated_minutes_ago=120)
    children = [make_child(parent, 1, "done")]
    comments = [{"content": "this was blocked earlier but resolved"}]
    result = classify(parent, children, comments)
    assert result["verdict"] == "STALE"


# --- Sweep filtering: only in_progress squad/agent parents considered ---

def test_sweep_skips_member_assigned_and_non_in_progress():
    squad_parent = make_parent(500, updated_minutes_ago=120)
    member_parent = make_parent(501, updated_minutes_ago=120)
    member_parent["assignee_type"] = "member"
    done_parent = make_parent(502, updated_minutes_ago=120, status="done")
    children = {
        squad_parent["id"]: [make_child(squad_parent, 1, "done")],
        member_parent["id"]: [make_child(member_parent, 2, "done")],
    }
    results = sweep_mod.sweep(
        [squad_parent, member_parent, done_parent], children, {}, NOW, MIN_AGE
    )
    assert [r["key"] for r in results] == ["PLU-500"]
    assert results[0]["verdict"] == "STALE"


# --- Delegated-comment fallback for child discovery ---

def test_extract_delegated_child_ids_from_mentions():
    child_id = "22222222-3333-4444-5555-666666666666"
    comments = [
        {"content": f"Delegated: [PLU-901](mention://issue/{child_id})"},
        {"content": f"dup mention [PLU-901](mention://issue/{child_id})"},
    ]
    assert sweep_mod.extract_delegated_child_ids(comments) == [child_id]


def test_extract_ignores_mentions_outside_delegated_comments():
    child_id = "22222222-3333-4444-5555-666666666666"
    other_id = "77777777-8888-9999-aaaa-bbbbbbbbbbbb"
    comments = [
        {"content": f"Delegated: [PLU-901](mention://issue/{child_id})"},
        {"content": f"see also [PLU-902](mention://issue/{other_id})"},
    ]
    assert sweep_mod.extract_delegated_child_ids(comments) == [child_id]


# --- AC4/AC5: report mode mutates nothing; --apply flips with attribution ---

def run_main_with_stubbed_cli(argv, results):
    """Run main() with gather + CLI stubbed; returns (exit_code, cli_calls)."""
    calls = []
    sweep_mod.gather = lambda min_age: [dict(r) for r in results]
    sweep_mod.run_multica = lambda args: calls.append(list(args)) or ""
    code = sweep_mod.main(argv)
    return code, calls


def stale_result():
    return {
        "id": "00000000-0000-0000-0000-000000000277",
        "key": "PLU-277",
        "title": "Parent 277",
        "age_seconds": 7200,
        "child_summary": "2 done",
        "child_count": 2,
        "verdict": "STALE",
        "reason": "all children terminal, parent past quiet threshold",
    }


def test_report_mode_mutates_nothing(capsys):
    code, calls = run_main_with_stubbed_cli([], [stale_result()])
    assert code == 0
    assert calls == []
    assert "STALE" in capsys.readouterr().out


def test_apply_flips_stale_with_attribution_comment_first(capsys):
    code, calls = run_main_with_stubbed_cli(["--apply"], [stale_result()])
    assert code == 0
    assert len(calls) == 2
    comment_call, update_call = calls
    assert comment_call[:3] == ["issue", "comment", "add"]
    assert "sweep" in comment_call[comment_call.index("--content") + 1].lower()
    assert update_call == [
        "issue", "update", "00000000-0000-0000-0000-000000000277",
        "--status", "done",
    ]


def test_apply_skips_blocked_and_active(capsys):
    blocked = dict(stale_result(), key="PLU-402", verdict="BLOCKED",
                   id="00000000-0000-0000-0000-000000000402")
    active = dict(stale_result(), key="PLU-312", verdict="ACTIVE",
                  id="00000000-0000-0000-0000-000000000312")
    code, calls = run_main_with_stubbed_cli(["--apply"], [blocked, active])
    assert code == 0
    assert calls == []


def test_json_output_is_machine_readable(capsys):
    code, _ = run_main_with_stubbed_cli(["--json"], [stale_result()])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["results"][0]["verdict"] == "STALE"
    assert payload["applied"] == []


def test_negative_min_age_rejected(capsys):
    import pytest
    with pytest.raises(SystemExit) as excinfo:
        sweep_mod.main(["--min-age", "-5"])
    assert excinfo.value.code == 2
    assert "--min-age must be >= 0" in capsys.readouterr().err
