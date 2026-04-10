# Knowledge Sync Reference

## Overview

The Knowledge Sync script (`scripts/knowledge_sync.py`) synchronizes structured knowledge files between your local skill workspace and the agent's active memory context. It ensures that reference documents, state schemas, and configuration files remain consistent across sessions.

## Sync Modes

| Mode | Description |
|------|-------------|
| `push` | Write local files into the agent memory index |
| `pull` | Fetch the latest indexed versions to local disk |
| `diff` | Show differences between local and indexed versions |
| `status` | List all tracked files and their sync state |

## Usage

```bash
python3 {baseDir}/scripts/knowledge_sync.py push --dir {baseDir}/references
```

```bash
python3 {baseDir}/scripts/knowledge_sync.py pull --dir {baseDir}/references
```

```bash
python3 {baseDir}/scripts/knowledge_sync.py diff
```

## Tracked Paths

By default, the following directories are tracked:

- `{baseDir}/references/` — Reference documentation
- `{baseDir}/state.json` — Persistent session state
- `{baseDir}/SKILL.md` — Skill manifest

## Configuration

Add a `knowledge_sync.json` file in `{baseDir}` to customize tracked paths:

```json
{
  "tracked": [
    "references/",
    "state.json",
    "SKILL.md"
  ],
  "excludePatterns": ["*.tmp", "*.bak"]
}
```

## Integration

Call `push` after updating reference documents to ensure the agent always reads the latest versions:

```bash
python3 {baseDir}/scripts/knowledge_sync.py push --dir {baseDir}/references
```
