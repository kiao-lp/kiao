#!/usr/bin/env python3
"""Restore, stage, migrate and seed agent and dependency repositories."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile


def git_result(path, *args):
    return subprocess.run(["git", "-C", str(path), *args], capture_output=True,
                          env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"})


def read_git(path, *args):
    result = git_result(path, *args)
    if result.returncode:
        detail = result.stderr.decode(errors="replace").strip().splitlines()
        raise RuntimeError(f"{path}: git {args[0]}: {detail[-1] if detail else 'failed'}")
    return result.stdout


def revision(path, ref="HEAD"):
    return read_git(path, "rev-parse", "--verify", ref).decode().strip()


def catalogue_resources(source, agents, names=()):
    catalogue = json.loads((source / "agentic-resources.json").read_text())
    return [resource for resource in catalogue["resources"]
            if (resource["kind"] == "agent") == agents and (not names or resource["name"] in names)]


def clone_pinned(source, resource, target, *, fresh=False):
    name, commit = resource["name"], resource["commit"]
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", name) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError(f"Invalid name or commit for catalogue resource {name}")
    original = source / "agentic-resources" / name
    remote = resource.get("remote")
    bundle = source / "agentic-bundles" / (name + ".bundle")
    if not fresh and (original / ".git").exists() and has_commit(original, commit):
        origin = str(original)
    elif remote:
        origin = remote
    elif bundle.is_file():
        origin = str(bundle)
    else:
        raise RuntimeError(f"{name}: catalogue commit {commit} needs {bundle}")

    target.mkdir()
    read_git(target, "clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", origin, ".")
    if not has_commit(target, commit):
        read_git(target, "fetch", "--no-tags", "origin", commit)
    read_git(target, "checkout", "--quiet", "-B", "main", commit)
    if origin != remote:
        read_git(target, "remote", "remove", "origin")
        if remote:
            read_git(target, "remote", "add", "origin", remote)
    if remote and git_result(target, "show-ref", "--verify", "refs/remotes/origin/main").returncode:
        # The checkout is pinned, so this is the last documented state of the remote branch.
        read_git(target, "update-ref", "refs/remotes/origin/main", commit)
    if remote:
        read_git(target, "branch", "--set-upstream-to=origin/main", "main")


def has_commit(path, commit):
    return git_result(path, "cat-file", "-e", commit + "^{commit}").returncode == 0


def restore(source, agents=False, names=()):
    repositories = source / "agentic-resources"
    repositories.mkdir(parents=True, exist_ok=True)
    for resource in catalogue_resources(source, agents, names):
        path = repositories / resource["name"]
        commit = resource["commit"]
        if not (path / ".git").exists() and os.path.lexists(path):
            raise RuntimeError(f"{path}: catalogue commit {commit} requires a Git checkout")
        if (path / ".git").exists() and revision(path) == commit:
            if status(path):
                raise RuntimeError(f"{path}: catalogue commit {commit} requires a clean checkout")
            continue
        with tempfile.TemporaryDirectory(prefix=".restore-", dir=repositories) as work:
            staged = pathlib.Path(work) / path.name
            clone_pinned(source, resource, staged, fresh=True)
            if not path.exists():
                staged.rename(path)
            elif reconcile(staged, path, agents, dry_run=False) != commit or status(path):
                raise RuntimeError(f"{path}: catalogue commit {commit} requires a clean checkout")


def stage(destination, sources, agents=False, names=(), fresh=False):
    repositories = {}
    for source in sources:
        for resource in catalogue_resources(source, agents, names):
            name = resource["name"]
            if name in repositories:
                raise ValueError(f"Duplicate resource {name}: {repositories[name][0]} and {source}")
            repositories[name] = (source, resource)
    if set(names) - repositories.keys():
        raise ValueError(f"Missing catalogue resources: {', '.join(sorted(set(names) - repositories.keys()))}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".stage-", dir=destination.parent) as work:
        staged = pathlib.Path(work) / destination.name
        staged.mkdir()
        for name, (source, resource) in repositories.items():
            clone_pinned(source, resource, staged / name, fresh=fresh)
        if {"mcp-kiao", "mcp-hybridflow"}.issubset(repositories):
            build = json.loads((staged / "mcp-hybridflow" / "kiao.build.json").read_text())
            lock = (staged / "mcp-kiao" / "package-lock.json").read_bytes()
            if (build.get("commit") != repositories["mcp-kiao"][1]["commit"] or
                    build.get("lockDigest") != hashlib.sha256(lock).hexdigest()):
                raise ValueError("mcp-hybridflow was built from a different mcp-kiao catalogue commit or npm lock")
        (staged / "catalogue.json").write_text(json.dumps({
            "resources": [resource for _, resource in repositories.values()]
        }, indent=2) + "\n")
        staged.rename(destination)
    kind = "agent" if agents else "agentic dependency"
    print(f"Staged {len(repositories)} {kind} repositories.")


def seed(source, destination, agents=False, dry_run=False, existing_only=False):
    if not dry_run:
        destination.mkdir(parents=True, exist_ok=True)
    index = source / "catalogue.json"
    pins = {r["name"]: r["commit"] for r in json.loads(index.read_text())["resources"]} if index.is_file() else {}
    for resource in sorted(source.iterdir()):
        if not resource.is_dir() or not (resource / ".git").exists() or (resource / "agent.json").exists() != agents:
            continue
        target = destination / resource.name
        wanted = revision(resource)
        if pins and pins.get(resource.name) != wanted:
            raise ValueError(f"{resource}: seed catalogue requires {pins.get(resource.name)}, found {wanted}")
        if os.path.lexists(target):
            try:
                reconcile(resource, target, agents, dry_run)
            except (OSError, RuntimeError, ValueError) as exc:
                print(f"{target.name}: expected {wanted}; kept checkout ({exc})", flush=True)
            continue
        if existing_only:
            continue
        print(f"{target.name}: expected {wanted}; {'would add' if dry_run else 'adding'} checkout", flush=True)
        if dry_run:
            continue
        with tempfile.TemporaryDirectory(prefix=".clone-", dir=destination) as work:
            staged = pathlib.Path(work) / resource.name
            shutil.copytree(resource, staged, symlinks=True)
            try:
                staged.rename(target)
            except OSError:
                if not os.path.lexists(target):
                    raise


def status(project):
    output = read_git(project, "--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all",
                      "--no-renames", "-z")
    return [(entry[:2], os.fsdecode(entry[3:])) for entry in output.split(b"\0") if entry]


def projection_hashes(data):
    from ruamel.yaml import YAML, YAMLError

    try:
        lock = YAML(typ="safe").load(data)
    except YAMLError:
        return {}
    if not isinstance(lock, dict):
        return {}
    hashes = {}
    for dep in lock.get("dependencies") or ():
        if isinstance(dep, dict) and isinstance(dep.get("deployed_file_hashes"), dict):
            hashes.update(dep["deployed_file_hashes"])
    return hashes


def lock_hashes(project, commit):
    lock = git_result(project, "show", commit + ":apm.lock.yaml")
    return projection_hashes(lock.stdout) if lock.returncode == 0 else {}


def projection_file(project, name):
    path = project / name
    if not path.is_file() or path.resolve() != path:
        return None
    with path.open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def old_projections(installed, staged, current, wanted):
    paths = read_git(installed, "ls-files", "--others", "-z", "--", ".agents/skills", ".claude/skills")
    if not paths:
        return {}
    candidates = {name: projection_file(installed, name)
                  for name in (os.fsdecode(entry) for entry in paths.split(b"\0") if entry)}
    expected = lock_hashes(staged, wanted)
    candidates = {name: digest for name, digest in candidates.items() if digest and digest != expected.get(name)}
    if not candidates:
        return {}
    stale = {}
    history = read_git(installed, "log", "--format=%H", current, "--all", "--", "apm.lock.yaml")
    for commit in history.decode().splitlines():
        hashes = lock_hashes(installed, commit)
        for name in list(candidates.keys() & hashes.keys()):
            if candidates[name] == hashes[name]:
                stale[name] = candidates.pop(name)
        if not candidates:
            break
    return stale


def is_ancestor(project, older, newer):
    return git_result(project, "merge-base", "--is-ancestor", older, newer).returncode == 0


def reconcile(staged, installed, agents, dry_run):
    wanted = revision(staged)
    if installed.is_symlink() or not (installed / ".git").is_dir():
        print(f"{installed.name}: expected {wanted}; kept path (not a managed Git checkout)")
        return None
    current = revision(installed)
    if agents:
        identities = [json.loads(read_git(path, "show", ref + ":agent.json")).get("id")
                      for path, ref in ((staged, wanted), (installed, current))]
        if not identities[0] or identities[0] != identities[1]:
            print(f"{installed.name}: current {current}; expected {wanted}; kept checkout (different agent identity)")
            return current

    branch = git_result(installed, "symbolic-ref", "--quiet", "HEAD").stdout.strip()
    can_advance = branch == b"refs/heads/main" and current != wanted and is_ancestor(staged, current, wanted)
    changes = status(installed)
    stale = old_projections(installed, installed, current, current)
    draft = [(code, name) for code, name in changes if code != b"??" or name not in stale]
    if can_advance and not draft:
        stale = old_projections(installed, staged, current, wanted)
    prefix = f"{installed.name}: current {current}; expected {wanted}"
    if draft:
        reason = f"kept draft ({len(draft)} Git changes, first path {draft[0][1]!r})"
    elif current == wanted:
        reason = "at catalogue commit"
    elif can_advance:
        reason = "would fast-forward" if dry_run else "fast-forwarding"
    elif branch != b"refs/heads/main":
        reason = f"kept checkout (branch {branch.decode() or 'detached HEAD'})"
    elif is_ancestor(installed, wanted, current):
        reason = "kept newer local history"
    else:
        reason = "kept divergent Git history"
    print(f"{prefix}; {reason}; {len(stale)} old APM files", flush=True)
    if dry_run:
        return current
    if stale:
        archive = pathlib.Path(tempfile.mkdtemp(prefix="kiao-old-apm-", dir=installed / ".git"))
        for name, digest in sorted(stale.items()):
            if projection_file(installed, name) != digest:
                raise RuntimeError(f"{name} changed since inventory")
            backup = archive / name
            backup.parent.mkdir(parents=True, exist_ok=True)
            (installed / name).rename(backup)
        print(f"{installed.name}: archived {len(stale)} old APM files in {archive}", flush=True)
    if can_advance and not draft:
        if status(installed):
            print(f"{prefix}; kept checkout (Git changes after inventory)", flush=True)
            return current
        read_git(installed, "fetch", "--no-tags", "--", str(staged), "refs/heads/main")
        read_git(installed, "merge", "--ff-only", "--no-overwrite-ignore", wanted)
        current = revision(installed)
    if current == wanted:
        fetch_release_tags(staged, installed, wanted)
    return current


def fetch_release_tags(staged, installed, wanted):
    def tags(path, *args):
        output = read_git(path, "for-each-ref", "--format=%(refname) %(objectname)", *args, "refs/tags")
        return dict(line.split() for line in output.decode().splitlines())

    current = tags(installed)
    missing = []
    for ref, oid in tags(staged, "--merged=" + wanted).items():
        if ref not in current:
            missing.append(f"{ref}:{ref}")
        elif current[ref] != oid:
            print(f"{installed.name}: expected {wanted}; kept different local tag {ref}")
    if missing:
        read_git(installed, "fetch", "--no-tags", "--", str(staged), *missing)


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
    restoration.add_argument("--name", action="append", default=[])
    restoration.add_argument("source", type=pathlib.Path)
    staging = modes.add_parser("stage")
    staging.add_argument("--agents", action="store_true")
    staging.add_argument("--fresh", action="store_true", help="fetch from declared Git remotes and bundles")
    staging.add_argument("--name", action="append", default=[])
    staging.add_argument("destination", type=pathlib.Path)
    staging.add_argument("sources", type=pathlib.Path, nargs="+")
    seeding = modes.add_parser("seed")
    seeding.add_argument("--agents", action="store_true")
    seeding.add_argument("--dry-run", action="store_true")
    seeding.add_argument("--existing-only", action="store_true")
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
            restore(args.source.resolve(), args.agents, args.name)
        except (RuntimeError, subprocess.CalledProcessError) as exc:
            parser.exit(1, f"{exc}\n")
    elif args.mode == "prepare":
        prepare(args.root, args.legacy_agents, args.legacy_dependencies, args.legacy_dependency_group)
    elif args.mode == "stage":
        stage(args.destination.resolve(), [source.resolve() for source in args.sources], args.agents, args.name, args.fresh)
    else:
        seed(args.source.resolve(), args.destination.resolve(), args.agents, args.dry_run, args.existing_only)
