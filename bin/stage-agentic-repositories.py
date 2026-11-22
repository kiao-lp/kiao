#!/usr/bin/env python3
"""Restore, stage, migrate and seed agent and dependency repositories."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile


def git(path, *args):
    subprocess.run(["git", "-C", str(path), *args], check=True, stdout=subprocess.DEVNULL)


def restore(source, agents=False):
    catalogue = json.loads((source / "agentic-resources.json").read_text())
    repositories = source / "agentic-resources"
    repositories.mkdir(parents=True, exist_ok=True)
    for resource in catalogue["resources"]:
        if (resource["kind"] == "agent") != agents:
            continue
        path = repositories / resource["name"]
        if not path.exists():
            remote = resource.get("remote")
            if not remote:
                raise RuntimeError(f"{path}: restore its Git bundle or add a remote to agentic-resources.json")
            subprocess.run(["git", "clone", "--", remote, str(path)], check=True)
        commit = resource["commit"]
        git(path, "cat-file", "-e", commit + "^{commit}")
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()
        dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=path, text=True).strip()
        if actual != commit or dirty:
            raise RuntimeError(f"{path}: catalogue requires clean commit {commit}")


def stage(destination, sources, available_only=False, agents=False):
    repositories = {}
    for source in sources:
        catalogue = json.loads((source / "agentic-resources.json").read_text())
        for resource in catalogue["resources"]:
            if (resource["kind"] == "agent") != agents:
                continue
            name = resource["name"]
            original = source / "agentic-resources" / name
            if available_only and not original.exists():
                continue
            if name in repositories:
                raise ValueError(f"Duplicate resource {name}: {repositories[name][0]} and {original}")
            repositories[name] = (original, resource)

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".stage-", dir=destination.parent) as work:
        staged = pathlib.Path(work) / destination.name
        staged.mkdir()
        for name, (original, resource) in repositories.items():
            target = staged / name
            subprocess.run(["git", "clone", "--quiet", "--no-hardlinks", "--no-checkout", "--",
                            str(original), str(target)], check=True)
            git(target, "checkout", "--quiet", "-B", "main", resource["commit"])
            git(target, "remote", "remove", "origin")
            remote = resource.get("remote")
            if remote:
                git(target, "remote", "add", "origin", remote)
        staged.rename(destination)
    kind = "agent" if agents else "agentic dependency"
    print(f"Staged {len(repositories)} {kind} repositories.")


def seed(source, destination, agents=False):
    destination.mkdir(parents=True, exist_ok=True)
    for resource in sorted(source.iterdir()):
        if not resource.is_dir() or not (resource / ".git").exists() or (resource / "agent.json").exists() != agents:
            continue
        target = destination / resource.name
        if os.path.lexists(target):
            if agents and not target.is_symlink() and (target / ".git").is_dir():
                fast_forward_agent(resource, target)
            continue
        with tempfile.TemporaryDirectory(prefix=".clone-", dir=destination) as work:
            staged = pathlib.Path(work) / resource.name
            shutil.copytree(resource, staged, symlinks=True)
            try:
                staged.rename(target)
            except OSError:
                if not os.path.lexists(target):
                    raise


def fast_forward_agent(staged, installed):
    def read(project, *args):
        return subprocess.check_output(["git", "-C", str(project), *args], text=True).strip()

    current = read(installed, "rev-parse", "HEAD")
    wanted = read(staged, "rev-parse", "HEAD")
    if current == wanted:
        return
    staged_id = json.loads((staged / "agent.json").read_text())["id"]
    installed_metadata = installed / "agent.json"
    if not installed_metadata.is_file() or json.loads(installed_metadata.read_text()).get("id") != staged_id:
        return
    if read(installed, "rev-parse", "--abbrev-ref", "HEAD") != "main" or read(installed, "status", "--porcelain"):
        print(f"Kept the working tree of {installed.name}. The assembled publication is {wanted}.")
        return
    ancestor = subprocess.run(
        ["git", "-C", str(staged), "merge-base", "--is-ancestor", current, wanted],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if ancestor.returncode:
        return
    git(installed, "fetch", "--tags", "--", str(staged), "refs/heads/main")
    git(installed, "merge", "--ff-only", "FETCH_HEAD")
    print(f"Updated {installed.name} to {wanted}.")


def migrate(source, destination):
    if source is None or not source.exists():
        return
    source = source.resolve()
    target = destination.resolve()
    if source == target:
        return
    if target.is_relative_to(source):
        raise ValueError(f"Cannot migrate {source} into itself at {destination}")

    def ignored(directory, names):
        if directory == str(source):
            return [name for name in names if name == ".cache" or name.startswith(".clone-")]
        return []

    names = {entry.name for entry in source.iterdir()}
    if not names.difference(ignored(str(source), names)):
        return

    marker = ".kiao-migrated-from"
    origin = str(source) + "\n"
    previous = destination / marker
    if previous.is_file() and previous.read_text() == origin:
        return
    if destination.is_symlink() or (
        destination.exists() and (not destination.is_dir() or any(destination.iterdir()))
    ):
        raise FileExistsError(f"Cannot migrate {source}: {destination} already contains files")

    # Stage on the destination filesystem so publishing the copy is atomic even across mounts.
    with tempfile.TemporaryDirectory(prefix=".migration-", dir=destination.parent) as work:
        staged = pathlib.Path(work) / destination.name
        shutil.copytree(source, staged, symlinks=True, ignore=ignored)
        (staged / marker).write_text(origin)
        staged.rename(destination)
    print(f"Migrated {source} to {destination}", flush=True)


def update_dependency_paths(project, destinations):
    from ruamel.yaml import YAML, YAMLError

    manifest = project / "apm.yml"
    if manifest.is_symlink() or not manifest.is_file():
        return
    yaml = YAML()
    yaml.preserve_quotes = True
    try:
        document = yaml.load(manifest)
    except (ValueError, YAMLError):
        return
    if not isinstance(document, dict) or not isinstance(document.get("dependencies"), dict):
        return
    dependencies = document["dependencies"].get("apm")
    if not isinstance(dependencies, list):
        return

    changed = False
    for index, dependency in enumerate(dependencies):
        if isinstance(dependency, dict) and dependency.get("git") is None:
            relative = dependency.get("path")
        elif isinstance(dependency, str) and dependency.startswith(("./", "../")):
            relative = dependency
        else:
            continue
        if not isinstance(relative, str) or pathlib.Path(relative).is_absolute():
            continue
        source = pathlib.Path(os.path.abspath(project / relative))
        if source == project or source not in destinations:
            continue
        if destinations[source] == source and destinations[project] == project:
            continue
        relocated = os.path.relpath(destinations[source], destinations[project])
        if relative == relocated:
            continue
        if isinstance(dependency, dict):
            dependency["path"] = relocated
        else:
            dependencies[index] = relocated
        changed = True
    if changed:
        with tempfile.TemporaryDirectory(dir=project) as work:
            updated = pathlib.Path(work) / manifest.name
            yaml.dump(document, updated)
            shutil.copymode(manifest, updated)
            updated.replace(manifest)


def flatten_dependencies(root, group_names):
    destination = root / "dependencies"
    groups = []
    moves = {}
    targets = set()
    for name in group_names:
        group = destination / name
        if group.parent != destination or group == destination or name == "..":
            raise ValueError(f"Invalid dependency group: {name}")
        if group.is_symlink():
            raise ValueError(f"{group} must be a directory")
        if not group.is_dir() or (group / ".git").exists():
            continue
        groups.append(group)
        for entry in sorted(group.iterdir()):
            if entry.name == "catalogue.json":
                continue
            target = destination / entry.name
            if target in targets or os.path.lexists(target):
                raise FileExistsError(f"Cannot move {entry}: {target} has a conflicting entry")
            moves[entry] = target
            targets.add(target)

    if moves:
        destinations = {
            repo: repo for parent in (root / "agents", destination) for repo in parent.glob("*")
            if not repo.is_symlink() and (repo / ".git").exists()
        }
        destinations.update({
            repo: target for repo, target in moves.items() if not repo.is_symlink() and (repo / ".git").exists()
        })
        for project in destinations:
            update_dependency_paths(project, destinations)
        for entry, target in moves.items():
            entry.rename(target)

    for group in groups:
        (group / "catalogue.json").unlink(missing_ok=True)
        group.rmdir()


def prepare(root, legacy_agents, legacy_dependencies, legacy_dependency_groups):
    if root.is_symlink():
        raise ValueError(f"{root} must be a directory")
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve()
    gitignore = root / ".gitignore"
    if gitignore.is_symlink():
        raise ValueError(f"{gitignore} must be a regular file")
    rules = gitignore.read_bytes() if gitignore.exists() else b""
    if rules.splitlines()[-1:] != [b"*"]:
        with gitignore.open("ab") as stream:
            if rules and not rules.endswith(b"\n"):
                stream.write(b"\n")
            stream.write(b"*\n")
    scope = root / ".kiao-files"
    if not scope.exists():
        scope.write_text("[migration]\n/\n[refactor]\n/\n")

    migrate(legacy_agents, root / "agents")
    migrate(legacy_dependencies, root / "dependencies")
    flatten_dependencies(root, legacy_dependency_groups)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    modes = parser.add_subparsers(dest="mode", required=True)
    restoration = modes.add_parser("restore")
    restoration.add_argument("--agents", action="store_true")
    restoration.add_argument("source", type=pathlib.Path)
    staging = modes.add_parser("stage")
    staging.add_argument("--available", action="store_true", help="stage only repositories present locally")
    staging.add_argument("--agents", action="store_true")
    staging.add_argument("destination", type=pathlib.Path)
    staging.add_argument("sources", type=pathlib.Path, nargs="+")
    seeding = modes.add_parser("seed")
    seeding.add_argument("--agents", action="store_true")
    seeding.add_argument("source", type=pathlib.Path)
    seeding.add_argument("destination", type=pathlib.Path)
    preparation = modes.add_parser("prepare")
    preparation.add_argument("root", type=pathlib.Path)
    preparation.add_argument("--legacy-agents", type=pathlib.Path)
    preparation.add_argument("--legacy-dependencies", type=pathlib.Path)
    preparation.add_argument("--legacy-dependency-group", action="append", default=[])
    args = parser.parse_args()
    if args.mode == "restore":
        try:
            restore(args.source.resolve(), args.agents)
        except (RuntimeError, subprocess.CalledProcessError) as exc:
            parser.exit(1, f"{exc}\n")
    elif args.mode == "prepare":
        prepare(args.root, args.legacy_agents, args.legacy_dependencies, args.legacy_dependency_group)
    elif args.mode == "stage":
        stage(args.destination.resolve(), [source.resolve() for source in args.sources], args.available, args.agents)
    else:
        seed(args.source.resolve(), args.destination.resolve(), args.agents)
