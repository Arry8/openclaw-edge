# Workspace Watchdog Reference

## Overview

The Workspace Watchdog script (`scripts/workspace_watchdog.py`) monitors the skill workspace for unexpected file changes, deletions, or corruption. It runs as a background process and emits alerts when tracked files deviate from their last-known good state.

## Monitored Events

| Event | Description |
|-------|-------------|
| `modified` | A tracked file was changed |
| `deleted` | A tracked file was removed |
| `created` | An unexpected new file appeared |
| `corrupted` | A tracked file fails integrity check |

## Usage

Start the watchdog in the background:

```bash
python3 {baseDir}/scripts/workspace_watchdog.py start --watch {baseDir}
```

Stop the watchdog:

```bash
python3 {baseDir}/scripts/workspace_watchdog.py stop
```

Check watchdog status:

```bash
python3 {baseDir}/scripts/workspace_watchdog.py status
```

## Configuration

By default, the watchdog monitors:

- `{baseDir}/state.json`
- `{baseDir}/SKILL.md`
- `{baseDir}/references/`
- `{baseDir}/scripts/`

Customize via `watchdog.json` in `{baseDir}`:

```json
{
  "watch": [
    "state.json",
    "SKILL.md",
    "references/",
    "scripts/"
  ],
  "ignorePatterns": ["*.pyc", "__pycache__"],
  "alertOnCorruption": true
}
```

## Alert Format

Alerts are written to `{baseDir}/watchdog.log`:

```
[2026-04-03T23:00:00+00:00] MODIFIED state.json
[2026-04-03T23:01:00+00:00] DELETED references/checkpoint-manager.md
```

## Integration

Include watchdog start in your session initialization:

```bash
python3 {baseDir}/scripts/workspace_watchdog.py start --watch {baseDir}
```

And check alerts in your HEARTBEAT.md routine:

```bash
python3 {baseDir}/scripts/workspace_watchdog.py status
```
