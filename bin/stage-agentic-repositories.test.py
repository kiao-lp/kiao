import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("stage-agentic-repositories.py")
PROJECTION = pathlib.Path(".agents/skills/review/SKILL.md")


def git(path, *args):
    return subprocess.check_output(
        ["git", "-C", str(path), "-c", "user.name=Test", "-c", "user.email=test@localhost", *args],
        text=True,
    ).strip()


def run(*args):
    return subprocess.check_output([sys.executable, str(SCRIPT), *args], text=True)


class RepositoryDeliveryTest(unittest.TestCase):
    def test_reconcile_current_and_legacy_checkouts(self):
        with tempfile.TemporaryDirectory() as work:
            root = pathlib.Path(work)
            source = root / "source"
            repo = source / "agentic-resources/agent-example"
            repo.mkdir(parents=True)
            git(repo, "init", "-q", "-b", "main")
            (repo / "agent.json").write_text('{"id":"stable-id"}\n')
            (repo / "apm.yml").write_text("version: 1.0.0\n")
            (repo / ".gitignore").write_text(f"/{PROJECTION}\n")
            old = b"previous generated copy\n"
            digest = hashlib.sha256(old).hexdigest()
            (repo / "apm.lock.yaml").write_text(
                f"dependencies:\n- deployed_file_hashes:\n    {PROJECTION}: sha256:{digest}\n"
            )
            git(repo, "add", "--all")
            git(repo, "commit", "-qm", "initial publication")
            git(repo, "tag", "v1.0.0")

            (repo / "apm.yml").write_text("version: 1.0.1\n")
            (repo / "apm.lock.yaml").write_text("dependencies: []\n")
            git(repo, "commit", "-qam", "remove dependency")
            ancestor = git(repo, "rev-parse", "HEAD")
            (repo / "apm.yml").write_text("version: 1.0.2\n")
            git(repo, "commit", "-qam", "new publication")
            expected = git(repo, "rev-parse", "HEAD")
            git(repo, "tag", "v1.0.2")
            (source / "agentic-resources.json").write_text(json.dumps({"resources": [{
                "name": repo.name, "kind": "agent", "commit": expected, "remote": str(repo),
            }]}))
            seed = root / "seed"
            run("stage", "--fresh", "--agents", seed, source)
            for directory in ("clean", "draft", "new"):
                destination = root / directory
                target = destination / repo.name
                if directory != "new":
                    destination.mkdir()
                    git(destination, "clone", "-q", str(repo))
                    git(target, "reset", "--hard", ancestor)
                    git(target, "tag", "-d", "v1.0.2")
                    projection = target / PROJECTION
                    projection.parent.mkdir(parents=True)
                    projection.write_bytes(old)
                    if directory == "draft":
                        (target / "apm.yml").write_text("version: 1.0.0\n# my draft\n")
                        git(target, "add", "apm.yml")
                        (target / "apm.yml").write_text("version: 1.0.0\n# my current draft\n")
                        index = (target / ".git/index").read_bytes()
                    output = run("seed", "--agents", "--dry-run", seed, destination)
                    self.assertIn("1 old APM files", output)
                    self.assertEqual(projection.read_bytes(), old)
                    self.assertEqual(git(target, "rev-parse", "HEAD"), ancestor)
                run("seed", "--agents", seed, destination)
                second = run("seed", "--agents", seed, destination)
                wanted = ancestor if directory == "draft" else expected
                self.assertEqual(git(target, "rev-parse", "HEAD"), wanted)
                self.assertIn("0 old APM files", second)
                self.assertFalse((target / PROJECTION).exists())
                archived = list((target / ".git").glob(f"kiao-old-apm-*/{PROJECTION}"))
                if directory == "new":
                    self.assertEqual(archived, [])
                else:
                    self.assertEqual(len(archived), 1)
                    self.assertEqual(archived[0].read_bytes(), old)
                if directory == "draft":
                    self.assertIn("kept draft", second)
                    self.assertEqual((target / ".git/index").read_bytes(), index)
                    self.assertIn("# my current draft", (target / "apm.yml").read_text())
                else:
                    self.assertEqual(git(target, "rev-parse", "v1.0.2"), expected)


if __name__ == "__main__":
    unittest.main()
