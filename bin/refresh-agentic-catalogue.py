#!/usr/bin/env python3
"""Pin the clean resource working trees and their remotes in an assembly catalogue."""
import argparse
import json
import pathlib
import subprocess
import urllib.parse

parser = argparse.ArgumentParser()
parser.add_argument("root", type=pathlib.Path, nargs="?", default=pathlib.Path(__file__).resolve().parents[1])
args = parser.parse_args()
root = args.root.resolve()
path = root / "agentic-resources.json"
catalogue = json.loads(path.read_text())
for resource in catalogue["resources"]:
    repository = root / "agentic-resources" / resource["name"]
    def git(*arguments):
        return subprocess.run(["git", "-C", str(repository), *arguments], check=True, text=True, stdout=subprocess.PIPE).stdout.strip()
    if git("status", "--porcelain"):
        raise SystemExit(f"{repository}: commit or resolve the draft before updating its build pin")
    resource["commit"] = git("rev-parse", "HEAD")
    remotes = git("remote").splitlines()
    remote = git("remote", "get-url", "origin") if "origin" in remotes else None
    if remote and urllib.parse.urlsplit(remote).password:
        raise SystemExit(f"{repository}: remote URL contains a credential")
    resource["remote"] = remote
path.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n")
