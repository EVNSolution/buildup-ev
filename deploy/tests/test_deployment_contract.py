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
        # 배포는 **모든 검증 잡**을 기다린다. 취약점 검사를 따로 떼어 나란히 돌리더라도
        # 관문에서 빠지면 안 된다 — 빨라지자고 검사를 건너뛰는 것이 제일 나쁜 결과다.
        needs = re.search(r"^    needs: (.+)$", WORKFLOW, re.M)
        self.assertIsNotNone(needs)
        self.assertIn("validate", needs.group(1))
        self.assertIn("audit", needs.group(1))

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


class DeploySpeedContractTest(unittest.TestCase):
    """
    배포를 빠르게 만든 장치들 — **빠르기가 정확성을 갉아먹지 않는지** 지킨다.

    실측 18분 47초 중 코드 검증은 11초였고, 나머지 대부분이 의존성 설치(4분 29초)와
    운영 서버 배포 대기(4분 40초)였다. 둘 다 「같은 것을 다시 만드는」 시간이다.
    """

    def test_dependency_cache_is_keyed_on_the_lockfile(self):
        # 잠금파일 말고 다른 것으로 키를 잡으면, 의존성이 바뀌었는데 옛 트리를 되살릴 수 있다.
        # `npm ci` 는 정의상 잠금파일만 보고 트리를 만들므로 키도 그것이어야 한다.
        self.assertIn("hashFiles('package-lock.json')", WORKFLOW)
        self.assertIn("steps.deps.outputs.cache-hit != 'true'", WORKFLOW)

    def test_server_skips_reinstall_only_with_a_stamp_that_cannot_survive_a_wipe(self):
        """
        운영 서버는 잠금파일이 그대로면 `npm ci` 를 건너뛴다.

        건너뛰어도 되는 이유는 도장을 **node_modules 안에** 두기 때문이다 —
        `npm ci` 는 그 디렉터리를 통째로 지우므로, 도장이 설치 없이 살아남을 수 없다.
        도장을 밖으로 옮기면 「설치는 안 됐는데 도장은 있는」 상태가 만들어진다.
        """
        self.assertIn("npm_install_stamp='node_modules/.buildup-ev-lockfile-sha256'", REMOTE)
        # npm 이 설치를 끝냈다는 자기 표식도 함께 본다
        self.assertIn("[ -f node_modules/.package-lock.json ]", REMOTE)
        # 도장은 설치에 **성공한 뒤에만** 찍는다
        install = REMOTE[REMOTE.index("else\n  npm ci"):]
        self.assertLess(install.index("npm ci"), install.index("$npm_install_stamp"))

    def test_server_still_installs_when_the_lockfile_changes(self):
        # 해시를 비교하지 않고 「node_modules 가 있으면 건너뛴다」로 두면
        # 의존성이 바뀐 배포에서 옛 트리로 돌아간다.
        self.assertIn('= "$LOCKFILE_SHA256" ]', REMOTE)
        self.assertIn("LOCKFILE_SHA256=", REMOTE)

    def test_deploy_reports_whether_dependencies_were_reused(self):
        # 로그에 안 남으면 「왜 이번엔 빨랐지」를 나중에 되짚을 수 없다
        self.assertIn("deps=cached", REMOTE)
        self.assertIn("deps=installed", REMOTE)
