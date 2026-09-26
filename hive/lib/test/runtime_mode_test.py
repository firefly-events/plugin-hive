from __future__ import annotations

import unittest

from hive.lib.runtime_mode import detect_interactive_mode


class RuntimeModeTests(unittest.TestCase):
    def test_hive_headless_1_forces_headless(self) -> None:
        self.assertEqual(
            detect_interactive_mode({"HIVE_HEADLESS": "1"}),
            {"mode": "headless", "source": "env"},
        )

    def test_hive_headless_0_forces_interactive(self) -> None:
        self.assertEqual(
            detect_interactive_mode({"HIVE_HEADLESS": "0"}),
            {"mode": "interactive", "source": "env"},
        )

    def test_ci_true_with_no_override_resolves_headless(self) -> None:
        self.assertEqual(
            detect_interactive_mode({"CI": "true"}),
            {"mode": "headless", "source": "ci"},
        )

    def test_no_signals_resolves_interactive_default(self) -> None:
        self.assertEqual(
            detect_interactive_mode({}),
            {"mode": "interactive", "source": "default"},
        )

    def test_hive_headless_1_wins_over_ci_true(self) -> None:
        self.assertEqual(
            detect_interactive_mode({"HIVE_HEADLESS": "1", "CI": "true"}),
            {"mode": "headless", "source": "env"},
        )

    def test_hive_headless_0_wins_over_ci_true(self) -> None:
        self.assertEqual(
            detect_interactive_mode({"HIVE_HEADLESS": "0", "CI": "true"}),
            {"mode": "interactive", "source": "env"},
        )

    def test_unrecognized_ci_value_does_not_trigger_headless(self) -> None:
        self.assertEqual(
            detect_interactive_mode({"CI": "1"}),
            {"mode": "interactive", "source": "default"},
        )


if __name__ == "__main__":
    unittest.main()
