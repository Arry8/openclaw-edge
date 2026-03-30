---
name: openclaw-edge mega-merge current state
description: Full runbook for the mega-merge project — what it does, current state, how to operate it, and how to handle build failures
type: project
---

## What this repo is

`Arry8/openclaw-edge` — integration build of `openclaw/openclaw`. Modeled after linux-next: instead of waiting for the upstream team to triage ~6,600 open PRs, this repo merges everything that applies cleanly onto the latest release tag and ships a build.

- Integration branch: `mega/latest`
- Nightly automation: `.github/workflows/mega-merge.yml` (Tuesdays 02:00 UTC)
- Upstream: `https://github.com/openclaw/openclaw.git` (remote name: `upstream`)
- This repo: `https://github.com/Arry8/openclaw-edge`

---

## Current state (as of 2026-03-30)

- 12 PRs in history: 2 merged cleanly (#57603, #57624 — seeded), rest are conflicts from Tier 1 SSRF/security PRs that overlap with already-merged code
- The first ~10 Tier 1 PRs in the queue all conflict — this is normal, keep increasing `--limit` to get past them
- GH release `mega/2026-03-30-1135` was created successfully (end-to-end test passed)
- Build takes ~8 minutes (`pnpm build`)
- PR cache: 6576 open PRs at `docs/mega-merge-pr-cache.json`

---

## Script: `scripts/mega-merge.ts`

Core merge loop. PRs sorted by priority tier: 1=security/crash, 2=fix, 3=feat, 4=other.

Key flags:
- `--resume` — skip PRs already in `docs/mega-merge-history.json`
- `--cache-prs` — use cached PR list (avoids 45s API fetch on restarts)
- `--cache-ttl <n>` — cache TTL in minutes (default 60)
- `--limit <n>` — attempt exactly N PRs; pass and fail both count
- `--create-release` — tag HEAD and create a GH pre-release after the run
- `--release-interval <n>` — also create a release every N successful merges
- `--no-continuous-build` — disable background worktree build (on by default)
- `--skip-build` — skip final `pnpm build`
- Per-PR commits use `git commit --no-verify` internally to skip the pre-commit hook

---

## Standard commands

### Test run (10 PRs, no continuous build)
```sh
bun scripts/mega-merge.ts --resume --cache-prs --limit 10 --create-release --no-continuous-build
```

### Larger catchup run (500 PRs, continuous build, release every 500)
```sh
bun scripts/mega-merge.ts --resume --cache-prs --limit 500 --create-release --release-interval 500
```

### Full unlimited run
```sh
bun scripts/mega-merge.ts --resume --cache-prs --create-release --release-interval 500
```

---

## Before every run — clean tree check

Killed runs leave partial state. Always run this first:

```sh
git status --short
ls .git/MERGE_HEAD 2>/dev/null && git merge --abort
git checkout -- .
git status --short  # should only show ?? untracked files
```

---

## How to handle a build failure

When `pnpm build` fails, the offending code came from a recently merged PR.

### Step 1 — identify the bad PR

Look at the build error output — it will name a file. Find which PR introduced it:

```sh
git log --oneline -- <path/to/failing/file>
```

The merge commit will look like `merge(pr#NNNNN): ...`. That NNNNN is the bad PR.
Also check `docs/mega-merge-history.json` for recent merges.

### Step 2 — stop the script and clean up

```sh
pkill -f "mega-merge.ts"
ls .git/MERGE_HEAD 2>/dev/null && git merge --abort
git checkout -- .
```

### Step 3 — add the PR to SKIP_LIST

Open `scripts/mega-merge.ts`, find `SKIP_LIST` near the top, and add the bad PR:

```typescript
const SKIP_LIST = new Set<number>([
  29181, // broken shim imports
  36307, // missing `detail:` key
  48125, // mixed || and ??
  51371, // transitively includes PR #56737 (navigation-guard.ts TS error)
  56660, // duplicate observedSuspiciousSignatures
  // ADD NEW ENTRY HERE:
  57999, // breaks X — pnpm build error in path/to/file.ts
]);
```

### Step 4 — remove the bad PR's commit from mega/latest

```sh
git log --oneline | grep "pr#NNNNN"
git revert <commit-sha> --no-edit --no-verify
```

Or if it was the very last commit:
```sh
git reset --hard HEAD~1
```

### Step 5 — commit the SKIP_LIST update and resume

```sh
git add scripts/mega-merge.ts
git commit --no-verify -m "fix(mega-merge): add PR #NNNNN to SKIP_LIST — <reason>"
bun scripts/mega-merge.ts --resume --cache-prs --limit 50 --create-release --no-continuous-build
```

`--resume` skips all previously processed PRs and the newly skip-listed one, continuing from where the run left off.

---

## SKIP_LIST (current as of 2026-03-30)

```typescript
const SKIP_LIST = new Set<number>([
  29181, // broken shim imports
  36307, // missing `detail:` key
  48125, // mixed || and ??
  51371, // transitively includes PR #56737 (navigation-guard.ts TS error)
  56660, // duplicate observedSuspiciousSignatures
]);
```

---

## Orphaned tsgo processes

The pre-commit hook runs `pnpm tsgo` on every `git commit`. Interrupted runs leave tsgo processes burning 10–75% CPU and 2–10% RAM each. The script kills them at startup and end automatically. To kill manually:

```sh
pgrep -a -f "tsgo|tsgolint"
ps -p <pids> -o pid,pgid,%cpu,command
kill -- -<PGID>   # kill the whole process group by PGID
```

---

## Key files

| File | Purpose |
|---|---|
| `docs/mega-merge-history.json` | One entry per PR attempted; written after every merge/conflict. Source of truth for `--resume`. |
| `docs/mega-merge-pr-cache.json` | Cached list of open PRs. Avoids 45s API fetch. Gitignored. |
| `docs/mega-merge-report.json` | Last run summary. |
| `docs/mega-merge-changelog.md` | Append-only human-readable batch log. |
| `docs/cc-memory/` | CC memory files — copy to `~/.claude/projects/.../memory/` on new machine. |

---

## Important constraints

- `mega/latest` never merges back to `main`
- The script is deterministic and LLM-free — broken PRs go to SKIP_LIST, never manually patched
- Per-PR commits use `--no-verify` to skip tsgo/lint; `pnpm build` is the real quality gate
- The GH Action does not use `--continuous-build` (background processes are killed when the CI step exits)
- Never run `git stash` — other agents may be working in the same repo
