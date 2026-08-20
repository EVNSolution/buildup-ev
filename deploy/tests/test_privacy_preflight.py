import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
VALIDATOR = ROOT / "deploy/privacy-preflight.py"


class PrivacyPreflightTest(unittest.TestCase):
    def run_validator(self, *arguments, input_text=None):
        return subprocess.run(
            ["python3", str(VALIDATOR), *map(str, arguments)],
            input=input_text,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_contract_requires_one_safe_id_and_a_query(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "privacy-preflight.audit"
            query = root / "privacy-preflight.sql"
            migration = root / "migration.sql"
            marker.write_text("legacy-contact-removed\n", encoding="utf-8")
            query.write_text("SELECT COUNT(*) FROM customer WHERE false;\n", encoding="utf-8")
            migration.write_text(
                "-- privacy-abort-guard: legacy-contact-removed\nSELECT 1;\n", encoding="utf-8"
            )

            result = self.run_validator("contract", marker, query, migration)

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "legacy-contact-removed")

    def test_contract_rejects_missing_or_malformed_declarations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "privacy-preflight.audit"
            query = root / "privacy-preflight.sql"
            migration = root / "migration.sql"
            marker.write_text("bad id\nsecond-line\n", encoding="utf-8")
            migration.write_text("SELECT 1;\n", encoding="utf-8")

            result = self.run_validator("contract", marker, query, migration)

            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("second-line", result.stderr)

    def test_contract_requires_a_matching_transaction_abort_guard_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "privacy-preflight.audit"
            query = root / "privacy-preflight.sql"
            migration = root / "migration.sql"
            marker.write_text("legacy-contact-removed\n", encoding="utf-8")
            query.write_text("SELECT 0;\n", encoding="utf-8")
            migration.write_text("SELECT 1;\n", encoding="utf-8")

            result = self.run_validator("contract", marker, query, migration)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("transaction-level abort guard", result.stderr)

            migration.write_text(
                "-- privacy-abort-guard: legacy-contact-removed-extra\nSELECT 1;\n",
                encoding="utf-8",
            )
            suffix_result = self.run_validator("contract", marker, query, migration)
            self.assertNotEqual(suffix_result.returncode, 0)

    def test_count_accepts_only_one_non_negative_integer_without_echoing_input(self):
        accepted = self.run_validator("count", "legacy-contact-removed", input_text="0\n")
        rejected = self.run_validator(
            "count", "legacy-contact-removed", input_text="private-fixture\n1\n"
        )

        self.assertEqual(accepted.returncode, 0)
        self.assertEqual(accepted.stdout.strip(), "0")
        self.assertNotEqual(rejected.returncode, 0)
        self.assertNotIn("private-fixture", rejected.stderr)


if __name__ == "__main__":
    unittest.main()
