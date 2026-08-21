import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
WORKFLOW = (ROOT / ".github/workflows/deploy-ssm.yml").read_text(encoding="utf-8")
REMOTE = (ROOT / "deploy/remote-deploy.sh").read_text(encoding="utf-8")


class DeploymentContractTest(unittest.TestCase):
    def test_pull_requests_validate_without_deploying(self):
        self.assertIn("pull_request:", WORKFLOW)
        self.assertIn("if: github.event_name != 'pull_request'", WORKFLOW)
        self.assertIn("needs: validate", WORKFLOW)

    def test_actions_are_pinned_and_exact_revision_is_forwarded(self):
        action_refs = re.findall(r"uses:\s+[^\s]+@([^\s]+)", WORKFLOW)
        self.assertGreaterEqual(len(action_refs), 3)
        self.assertTrue(all(re.fullmatch(r"[0-9a-f]{40}", ref) for ref in action_refs))
        self.assertIn("SOURCE_REVISION: ${{ github.sha }}", WORKFLOW)
        self.assertIn("ACTOR: ${{ github.actor }}", WORKFLOW)
        self.assertIn('test "$SOURCE_REVISION" = "$(git rev-parse HEAD)"', WORKFLOW)
        self.assertNotIn("DEPLOY_REF", WORKFLOW)
        self.assertRegex(WORKFLOW, r"image: postgres@sha256:[0-9a-f]{64}")

    def test_operational_env_never_passes_through_github(self):
        self.assertNotIn("secrets.APP_ENV", WORKFLOW)
        self.assertNotIn("put-parameter", WORKFLOW)
        self.assertEqual(WORKFLOW.count("aws ssm send-command"), 1)
        self.assertIn("deploy/validate-env.py", WORKFLOW)

    def test_release_evidence_and_rollback_are_part_of_remote_deploy(self):
        for token in (
            "SOURCE_REVISION must be a full Git SHA",
            "SSM_VERSION",
            "LOCKFILE_SHA256",
            "SCHEMA_MIGRATION_SHA256",
            "schemaMigrationCount",
            "deploy-evidence.jsonl",
            "write_manifest",
            "public_ready_matches",
            "slot-record-reconciled",
            "restore_caddy",
            "switch-rolled-back",
            "schema-migration-blocked",
            "schema-migration-verified",
            "privacyPreflightCount",
        ):
            self.assertIn(token, REMOTE)
        self.assertIn('test "$(git rev-parse HEAD)" = "$SOURCE_REVISION"', REMOTE)
        self.assertIn('caddy validate --config "$caddy_candidate" --adapter caddyfile', REMOTE)
        self.assertNotIn("npm cache clean", REMOTE)

    def test_index_html_must_revalidate(self):
        """
        index.html 에 Cache-Control 이 없으면 브라우저가 **추정 캐시**를 쓴다
        (RFC 9111 — 보통 Last-Modified 로부터 흐른 시간의 10%).
        그래서 배포를 해도 홈 화면에 추가한 앱이 몇 시간씩 옛 문서를 물고 있었다.

        index.html 은 새 번들 이름을 가리키는 **유일한 문서**다 —
        이것만 매번 재검증하면 나머지는 저절로 최신이 된다.
        """
        self.assertIn('header Cache-Control "no-cache"', REMOTE)

    def test_hashed_assets_cached_long(self):
        """해시가 붙은 자산은 이름이 곧 내용이라 길게 캐시해도 안전하다."""
        self.assertIn("handle /assets/* {", REMOTE)
        self.assertIn('header Cache-Control "public, max-age=31536000, immutable"', REMOTE)

    def test_asset_rule_comes_before_catch_all(self):
        """
        Caddy 의 handle 은 **먼저 쓴 것이 이긴다.** 잡동사니 handle 이 위에 있으면
        해시 자산까지 no-cache 가 되어 매 요청이 서버로 간다.
        """
        assets = REMOTE.index("handle /assets/* {")
        catch_all = REMOTE.index('header Cache-Control "no-cache"')
        self.assertLess(assets, catch_all)

    def test_schema_migrations_finish_before_candidate_start(self):
        migrate = REMOTE.index("deploy/apply-schema-migrations.sh")
        drift = REMOTE.index("npm run --workspace=backend db:drift")
        candidate = REMOTE.index("pm2 start")
        self.assertLess(migrate, drift)
        self.assertLess(drift, candidate)
        self.assertNotIn("prisma db push", REMOTE)
        self.assertIn("Prisma migration 검증", WORKFLOW)
        self.assertIn("privacy_preflight_count", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
