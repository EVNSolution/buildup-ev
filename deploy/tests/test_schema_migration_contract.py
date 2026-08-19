import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
APPLY = (ROOT / "deploy/apply-schema-migrations.sh").read_text(encoding="utf-8")
BACKUP = (ROOT / "deploy/backup-database.sh").read_text(encoding="utf-8")
BASELINE_TOOL = (ROOT / "deploy/baseline-existing-database.sh").read_text(encoding="utf-8")
MIGRATIONS = ROOT / "backend/prisma/migrations"


class SchemaMigrationContractTest(unittest.TestCase):
    def test_prisma_history_has_baseline_and_forward_migration(self):
        names = sorted(path.parent.name for path in MIGRATIONS.glob("*/migration.sql"))
        self.assertEqual(
            names,
            ["20260819000000_baseline", "20260819001000_add_customer_warp_index"],
        )
        self.assertTrue((MIGRATIONS / "migration_lock.toml").is_file())

    def test_deploy_backs_up_then_runs_only_reviewed_migrations(self):
        pending = APPLY.index('if [ "$pending" -gt 0 ]')
        backup = APPLY.index("deploy/backup-database.sh", pending)
        migrate = APPLY.index("run_prisma migrate deploy")
        exact_diff = APPLY.index("run_prisma migrate diff")
        self.assertLess(backup, migrate)
        self.assertLess(migrate, exact_diff)
        self.assertNotIn("prisma db push", APPLY)
        self.assertNotIn("accept-data-loss", APPLY)

    def test_backup_is_verified_and_retained(self):
        self.assertIn("pg_dump", BACKUP)
        self.assertIn("pg_restore -l", BACKUP)
        self.assertIn("BACKUP_KEEP", BACKUP)

    def test_existing_database_baseline_is_fail_closed(self):
        self.assertIn("baseline-expected-drift.sql", BASELINE_TOOL)
        self.assertIn("run_prisma migrate resolve", BASELINE_TOOL)
        self.assertIn("deploy/backup-database.sh", BASELINE_TOOL)
        self.assertNotIn("prisma db push", BASELINE_TOOL)


if __name__ == "__main__":
    unittest.main()
