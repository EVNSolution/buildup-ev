import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "validate-env.py"
SPEC = importlib.util.spec_from_file_location("validate_env", MODULE_PATH)
assert SPEC and SPEC.loader
validate_env = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_env)


VALID = {
    "DATABASE_URL": "postgresql://buildup:secret@db.example/buildup_ev",
    "JWT_SECRET": "a" * 32,
    "MODUSIGN_DRY_RUN": "true",
    "MAIL_SMTP_USER": "mailer@example.com",
    "MAIL_SMTP_PASS": "secret",
    "WARP_API_BASE_URL": "https://warp.example",
    "WARP_API_KEY": "b" * 32,
}


class ValidateEnvTest(unittest.TestCase):
    def test_valid_production_contract(self):
        self.assertEqual(validate_env.validate(VALID), [])

    def test_missing_or_weak_core_values_are_rejected(self):
        values = {**VALID, "DATABASE_URL": "sqlite:dev.db", "JWT_SECRET": "short"}
        errors = validate_env.validate(values)
        self.assertTrue(any("DATABASE_URL" in error for error in errors))
        self.assertTrue(any("JWT_SECRET" in error for error in errors))

    def test_partial_feature_pair_is_rejected(self):
        values = {**VALID, "MAIL_SMTP_PASS": ""}
        self.assertTrue(any("MAIL_SMTP_USER" in error for error in validate_env.validate(values)))

    def test_runtime_and_bootstrap_keys_are_rejected(self):
        values = {**VALID, "PORT": "3001", "BOOTSTRAP_ADMIN_PW": "do-not-keep"}
        errors = validate_env.validate(values)
        self.assertTrue(any("PORT" in error for error in errors))
        self.assertTrue(any("BOOTSTRAP_ADMIN_PW" in error for error in errors))

    def test_parser_rejects_duplicates_without_echoing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("JWT_SECRET=first-secret\nJWT_SECRET=second-secret\n", encoding="utf-8")
            values, errors = validate_env.parse_env(path)
        self.assertEqual(values["JWT_SECRET"], "first-secret")
        self.assertEqual(errors, ["line 2: duplicate key JWT_SECRET"])
        self.assertNotIn("second-secret", " ".join(errors))

    def test_cli_failure_never_prints_secret_values(self):
        secret = "sensitive-value-that-must-not-appear"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                f"DATABASE_URL=sqlite:dev.db\nJWT_SECRET={secret}\nMODUSIGN_DRY_RUN=true\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [str(MODULE_PATH), str(path)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(secret, result.stdout)
        self.assertNotIn(secret, result.stderr)


if __name__ == "__main__":
    unittest.main()
