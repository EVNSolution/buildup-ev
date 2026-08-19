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
            "deploy-evidence.jsonl",
            "write_manifest",
            "public_ready_matches",
            "slot-record-reconciled",
            "restore_caddy",
            "switch-rolled-back",
        ):
            self.assertIn(token, REMOTE)
        self.assertIn('test "$(git rev-parse HEAD)" = "$SOURCE_REVISION"', REMOTE)
        self.assertIn('caddy validate --config "$caddy_candidate" --adapter caddyfile', REMOTE)
        self.assertNotIn("npm cache clean", REMOTE)


if __name__ == "__main__":
    unittest.main()
