#!/usr/bin/env python3
"""
jsonl_recovery.py - Recover delta messages from .jsonl after checkpoint timestamp.

Usage:
    python3 jsonl_recovery.py recover
    python3 jsonl_recovery.py find-sessions
    python3 jsonl_recovery.py status
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

CHECKPOINT_FILE = Path.home() / ".openclaw/workspace/memory/session-checkpoint.md"
# OpenClaw stores session transcripts under ~/.openclaw/agents/<agent>/sessions
AGENTS_DIR = Path.home() / ".openclaw/agents"
# Fallback: also scan memory directory for any .jsonl files
MEMORY_DIR = Path.home() / ".openclaw/workspace/memory"
MAX_DELTA_BYTES = 2048
MAX_MESSAGES = 5


def find_jsonl_files() -> List[Path]:
    """Find all .jsonl session files from agent session store and memory directory."""
    found: List[Path] = []
    # Primary: agent session directories
    if AGENTS_DIR.exists():
        found.extend(AGENTS_DIR.glob("*/sessions/*.jsonl"))
    # Fallback: memory directory
    if MEMORY_DIR.exists():
        found.extend(MEMORY_DIR.glob("**/*.jsonl"))
    # Deduplicate and sort by mtime descending
    seen = set()
    unique: List[Path] = []
    for p in found:
        resolved = p.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(p)
    return sorted(unique, key=lambda p: p.stat().st_mtime, reverse=True)


def _normalize_ts(ts_str: str) -> str:
    """Normalize ISO timestamp: replace trailing Z with +00:00 for fromisoformat."""
    ts_str = ts_str.strip()
    if ts_str.endswith("Z"):
        ts_str = ts_str[:-1] + "+00:00"
    return ts_str


def get_checkpoint_timestamp() -> Optional[datetime]:
    """Extract _last_updated timestamp from checkpoint file."""
    if not CHECKPOINT_FILE.exists():
        return None
    with open(CHECKPOINT_FILE) as f:
        for line in f:
            if "_last_updated:" in line:
                ts_str = line.split("_last_updated:")[-1].strip().rstrip("_").strip()
                try:
                    return datetime.fromisoformat(_normalize_ts(ts_str))
                except ValueError:
                    return None
    return None


def _get_message_timestamp(msg: dict) -> Optional[datetime]:
    """Extract timestamp from a message record if available."""
    # Try envelope format timestamp fields
    for key in ("timestamp", "created_at", "ts"):
        val = msg.get(key)
        if not val:
            # check inside envelope
            inner = msg.get("message", {})
            if isinstance(inner, dict):
                val = inner.get(key)
        if val and isinstance(val, str):
            try:
                ts = datetime.fromisoformat(_normalize_ts(val))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                return ts
            except ValueError:
                pass
    return None


def _extract_content(msg: dict) -> Optional[str]:
    """Extract assistant content from a message dict.

    Handles both flat records {"role": ..., "content": ...} and
    OpenClaw envelope records {"type": "message", "message": {"role": ..., "content": ...}}.
    """
    # Envelope format
    if msg.get("type") == "message" and isinstance(msg.get("message"), dict):
        inner = msg["message"]
        if inner.get("role") == "assistant":
            return inner.get("content", "") or None
        return None
    # Flat format
    if msg.get("role") == "assistant":
        return msg.get("content", "") or None
    return None


def cmd_recover() -> None:
    ts = get_checkpoint_timestamp()
    if ts is None:
        print("ERROR: No _last_updated timestamp found in checkpoint.")
        sys.exit(1)
    jsonl_files = find_jsonl_files()
    if not jsonl_files:
        print("No .jsonl session files found.")
        return
    collected: List[str] = []
    total_bytes = 0
    # Normalize ts to UTC for comparison
    ts_utc = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts
    for jf in jsonl_files:
        file_mtime = datetime.fromtimestamp(jf.stat().st_mtime, tz=timezone.utc)
        if file_mtime <= ts_utc:
            continue
        with open(jf) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # Filter by per-message timestamp if available
                msg_ts = _get_message_timestamp(msg)
                if msg_ts is not None:
                    if msg_ts.tzinfo is None:
                        msg_ts = msg_ts.replace(tzinfo=timezone.utc)
                    if msg_ts <= ts_utc:
                        continue
                content = _extract_content(msg)
                if not content:
                    continue
                entry = f"**[{jf.stem}]** {content[:200]}"
                entry_bytes = len(entry.encode())
                if total_bytes + entry_bytes > MAX_DELTA_BYTES:
                    break
                collected.append(entry)
                total_bytes += entry_bytes
                if len(collected) >= MAX_MESSAGES:
                    break
        if len(collected) >= MAX_MESSAGES:
            break
    if not collected:
        print("No new delta messages found after checkpoint timestamp.")
        return
    delta_section = "\n\n### \U0001f4e1 Recovered Delta\n"
    delta_section += f"_delta_since_last: {ts.isoformat()} \u2192 now_\n"
    for entry in collected:
        delta_section += f"\n{entry}\n"
    with open(CHECKPOINT_FILE, "a") as f:
        f.write(delta_section)
    print(f"Recovered {len(collected)} message(s) ({total_bytes} bytes) appended to checkpoint.")


def cmd_find_sessions() -> None:
    files = find_jsonl_files()
    if not files:
        print("No .jsonl files found.")
        return
    for f in files:
        mtime = datetime.fromtimestamp(f.stat().st_mtime).isoformat()
        print(f"{mtime} {f}")


def cmd_status() -> None:
    ts = get_checkpoint_timestamp()
    files = find_jsonl_files()
    print(f"checkpoint_last_updated: {ts.isoformat() if ts else 'unknown'}")
    print(f"jsonl_files_found: {len(files)}")
    if files:
        newest = datetime.fromtimestamp(files[0].stat().st_mtime).isoformat()
        print(f"newest_jsonl: {newest} {files[0].name}")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    cmd = args[0]
    if cmd == "recover":
        cmd_recover()
    elif cmd == "find-sessions":
        cmd_find_sessions()
    elif cmd == "status":
        cmd_status()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
