---
name: openclaw-backup-remote
description: Automate verified OpenClaw backups and upload archives to remote storage with rclone (Google Drive, S3, OneDrive, Dropbox, WebDAV, NAS remotes). Use when users ask to schedule daily/weekly backups, push backups off-machine, apply retention policies, or validate migration readiness.
---

# OpenClaw Backup + Remote Storage

Create reliable backup automation with `openclaw backup create` and `rclone`.

## Prerequisites

Check these first:

```bash
openclaw --version
rclone version
rclone listremotes
```

If anything is missing, stop and return exact setup commands.

## Create verified backups

Use verified archives by default:

```bash
openclaw backup create --verify --output <backup-dir>
```

Optional modes only when requested:

- `--only-config`
- `--no-include-workspace`

## Upload to remote storage

Prefer `copy` for safety (non-destructive):

```bash
rclone copy "<backup-dir>" "<remote>:<path>" --include "*openclaw-backup*.tar.gz"
```

Examples:

```bash
rclone copy "C:\Backups\OpenClaw" "gdrive:OpenClawBackups" --include "*openclaw-backup*.tar.gz"
rclone copy "/var/backups/openclaw" "s3:org-backups/openclaw" --include "*openclaw-backup*.tar.gz"
rclone copy "/srv/openclaw-backups" "onedrive:OpenClawBackups" --include "*openclaw-backup*.tar.gz"
```

Use `sync` only when the user explicitly wants destination pruning behavior.

## Retention

Apply retention when requested (default target: keep last 30):

- Local retention: delete oldest local archives beyond N.
- Remote retention: delete oldest remote archives beyond N.

Sort by modified time and remove oldest first.

## Scheduling

For recurring jobs, create cron schedules with explicit timezone and concise status output.

Suggested default schedule:

- Daily at 02:00 local time

After creating the schedule, run one manual test and confirm:

1. archive exists locally
2. archive exists remotely
3. next run time is set

## Failure handling

On any failure, report all of the following:

- failing step
- exact command and error
- minimal fix
- whether local backup succeeded even if upload failed

Never treat an upload or verify failure as success.
