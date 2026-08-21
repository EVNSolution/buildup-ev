import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
APPLY = (ROOT / "deploy/apply-schema-migrations.sh").read_text(encoding="utf-8")
REMOTE = (ROOT / "deploy/remote-deploy.sh").read_text(encoding="utf-8")
BACKUP = (ROOT / "deploy/backup-database.sh").read_text(encoding="utf-8")
BASELINE_TOOL = (ROOT / "deploy/baseline-existing-database.sh").read_text(encoding="utf-8")
MIGRATIONS = ROOT / "backend/prisma/migrations"


class SchemaMigrationContractTest(unittest.TestCase):
    def test_prisma_history_has_baseline_and_forward_migration(self):
        """migration 이력의 **모양**을 못박는다 — 목록 자체를 박아 두지 않는다.

        예전에는 디렉터리 목록을 통째로 하드코딩했다. 그래서 **정당한 migration 을
        더할 때마다 배포가 막혔고**, 통과시키려면 목록을 고쳐 적는 수밖에 없었다 —
        그 순간 이 테스트는 아무것도 지키지 않는 받아쓰기가 된다.

        정말 지켜야 하는 것은 이것들이다:
          · baseline 이 **하나만** 있고 **가장 앞**이다 (migrate resolve 가 그걸 전제한다)
          · 이름이 `<14자리 시각>_<이름>` 이라 **정렬 순서 = 시간 순서**다 (forward-only)
          · 같은 시각이 둘 있으면 적용 순서가 흔들린다
          · baseline 뒤에 실제 forward migration 이 하나 이상 있다
        """
        names = sorted(path.parent.name for path in MIGRATIONS.glob("*/migration.sql"))
        self.assertTrue(names, "migration 이 하나도 없다")

        pattern = re.compile(r"^\d{14}_[a-z0-9_]+$")
        for name in names:
            self.assertRegex(name, pattern, f"migration 이름 형식이 어긋난다: {name}")

        stamps = [name[:14] for name in names]
        self.assertEqual(len(set(stamps)), len(stamps), f"같은 시각의 migration 이 있다: {names}")

        baselines = [name for name in names if name.endswith("_baseline")]
        self.assertEqual(len(baselines), 1, f"baseline 은 하나여야 한다: {baselines}")
        self.assertEqual(names[0], baselines[0], f"baseline 이 가장 앞이어야 한다: {names}")

        self.assertGreater(len(names), 1, "baseline 뒤의 forward migration 이 없다")
        self.assertTrue((MIGRATIONS / "migration_lock.toml").is_file())

    def test_deploy_backs_up_then_runs_only_reviewed_migrations(self):
        preflight = APPLY.index('raw_count="$(psql_privacy_query')
        pending = APPLY.index('if [ "$pending" -gt 0 ]')
        backup = APPLY.index("deploy/backup-database.sh", pending)
        migrate = APPLY.index("run_prisma migrate deploy")
        exact_diff = APPLY.index("run_prisma migrate diff")
        self.assertLess(preflight, backup)
        self.assertLess(backup, migrate)
        self.assertLess(migrate, exact_diff)
        self.assertNotIn("prisma db push", APPLY)
        self.assertNotIn("accept-data-loss", APPLY)

    def test_privacy_preflight_is_read_only_fail_closed_and_evidenced(self):
        for token in (
            "default_transaction_read_only=on",
            "BEGIN TRANSACTION READ ONLY",
            "privacy-preflight.audit",
            "privacy-preflight.sql",
            "privacy_preflight_count",
            "Privacy preflight blocked",
            'contract "$marker" "$query" "$migration"',
        ):
            self.assertIn(token, APPLY)
        self.assertIn("privacyPreflightValidation=passed", REMOTE)
        self.assertIn("privacy-preflight.audit", REMOTE)
        self.assertIn("privacy-preflight.sql", REMOTE)

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
