#!/usr/bin/env python3
"""
workspace_watchdog.py - Detect workspace file changes after compaction (two-phase).

Usage:
    python3 workspace_watchdog.py verify
    python3 workspace_watchdog.py snapshot <description>
    python3 workspace_watchdog.py status
"""

import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

WORKSPACE_DIR = Path.home() / ".openclaw/workspace/memory"
SNAPSHOT_FILE = Path(__file__).parent.parent / "workspace_snapshot.json"


def file_hash(path: Path) -> str:
    """Compute MD5 hash of a file."""
    try:
        h = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return ""


def scan_workspace() -> dict[str, str]:
    """Scan all .md and .json files in workspace, returning path→hash map."""
    result: dict[str, str] = {}
    for pattern in ("**/*.md", "**/*.json"):
        for p in WORKSPACE_DIR.glob(pattern):
            if p.is_file():
                rel = str(p.relative_to(WORKSPACE_DIR))
                result[rel] = file_hash(p)
    return result


def load_snapshot() -> dict:
    if SNAPSHOT_FILE.exists():
        with open(SNAPSHOT_FILE) as f:
            return json.load(f)
    return {}


def save_snapshot(description: str, files: dict[str, str]) -> None:
    SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "description": description,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "files": files,
    }
    with open(SNAPSHOT_FILE, "w") as f:
        json.dump(data, f, indent=2)


def cmd_verify() -> None:
    snap = load_snapshot()
    if not snap:
        print("No snapshot found. Run 'snapshot' first.")
        return

    old_files: dict[str, str] = snap.get("files", {})
    current = scan_workspace()

    changed: list[str] = []
    deleted: list[str] = []
    new: list[str] = []

    for path, old_hash in old_files.items():
        if path not in current:
            deleted.append(path)
        elif current[path] != old_hash:
            changed.append(path)

    for path in current:
        if path not in old_files:
            new.append(path)

    snap_ts = snap.get("timestamp", "unknown")
    print(f"Snapshot: {snap.get('description', '')} @ {snap_ts}")
    print(f"changed={len(changed)} deleted={len(deleted)} new={len(new)}")

    for p in sorted(changed):
        print(f"  CHANGED  {p}")
    for p in sorted(deleted):
        print(f"  DELETED  {p}")
    for p in sorted(new):
        print(f"  NEW      {p}")

    if not changed and not deleted:
        print("No breaking changes detected.")
    else:
        print("WARNING: Breaking changes detected. Review before proceeding.")


def cmd_snapshot(description: str) -> None:
    files = scan_workspace()
    save_snapshot(description, files)
    print(f"Snapshot '{description}' saved ({len(files)} files).")


def cmd_status() -> None:
    snap = load_snapshot()
    if not snap:
        print("No snapshot on disk.")
        return
    print(f"snapshot_description: {snap.get('description', '')}")
    print(f"snapshot_timestamp: {snap.get('timestamp', '')}")
    print(f"snapshot_file_count: {len(snap.get('files', {}))}")
    current_count = len(scan_workspace())
    print(f"current_file_count: {current_count}")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    cmd = args[0]
    if cmd == "verify":
        cmd_verify()
    elif cmd == "snapshot":
        if len(args) < 2:
            print("Usage: workspace_watchdog.py snapshot <description>")
            sys.exit(1)
        cmd_snapshot(args[1])
    elif cmd == "status":
        cmd_status()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
