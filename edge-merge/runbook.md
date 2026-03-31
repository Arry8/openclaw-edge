# edge-merge runbook

Operational reference for `edge-merge/scripts/edge-merge.ts` — the script that merges upstream openclaw PRs onto `mega/latest`.

---

## Prerequisites

- Node 22+, [Bun](https://bun.sh), [pnpm](https://pnpm.io)
- [gh CLI](https://cli.github.com) authenticated
- `upstream` remote pointing at `openclaw/openclaw`

```sh
git clone https://github.com/Arry8/openclaw-edge
cd openclaw-edge
git checkout mega/latest
git remote add upstream https://github.com/openclaw/openclaw.git
pnpm install --no-frozen-lockfile --ignore-scripts
```

---

## PR priority tiers

PRs are sorted and applied in this order. When two PRs touch the same file, first writer wins.

| Tier | Criteria | Examples |
|---|---|---|
| 0 | Post-tag merged (officially accepted upstream) | Any PR merged into openclaw/openclaw after the base tag |
| 1 | Security / crash keywords in title | `xss`, `crash`, `oom`, `cve-`, `dos`, `data-loss` |
| 2 | Title starts with `fix` | `fix: ...`, `fix(scope): ...` |
| 3 | Title starts with `feat` | `feat: ...`, `feat(scope): ...` |
| 4 | Everything else | docs, chore, refactor, etc. |

PRs with the same HEAD SHA are deduplicated (only one is processed).

---

## All flags

### Input / targeting

| Flag | Default | Description |
|---|---|---|
| `--upstream <remote>` | `upstream` | Git remote name for `openclaw/openclaw`. Change if you named the remote differently. |
| `--state <open\|closed\|all>` | `all` | Which PRs to fetch from the API. Default `all` processes open PRs + post-tag merged (tier 0) only — closed-unmerged are silently skipped unless `--state closed` is passed. `closed` = explicit Phase 2 run (16K closed-unmerged PRs). Post-tag merged PRs are always applied first as tier 0 regardless of `--state`. |
| `--limit <n>` | unlimited | Stop after attempting exactly N PRs. Both successes and failures count toward the limit. |

### Run control

| Flag | Default | Description |
|---|---|---|
| `--dry-run` | off | Fetch and sort PRs, print what would be done — no git changes at all. |
| `--resume` | off | Skip PRs already recorded in `edge-merge/docs/history.json`. Use this on all restarts to avoid reprocessing. PRs with a `conflict` or `fetch-failed` history result are automatically retried if the author has pushed a new commit (head SHA changed). `merged` entries are never retried. |
| `--no-commit` | off | Stage successful merges but do not commit them. Useful for manual inspection of what a PR actually changes. |

### Fetch tuning

| Flag | Default | Description |
|---|---|---|
| `--cache-prs` | off | Cache the PR list to `edge-merge/docs/pr-cache.json` after fetching. On subsequent runs within `--cache-ttl`, reuse it instead of hitting the API. Saves ~30s per restart. |
| `--cache-ttl <n>` | `60` | How long the PR cache is valid, in minutes. Ignored without `--cache-prs`. |
| `--fetch-batch <n>` | `50` | Number of PR refs to fetch in a single `git fetch` call. Reduce if GitHub rate-limits you. |
| `--fetch-delay-ms <n>` | `200` | Milliseconds to wait between fetch batches. Increase if seeing transient fetch failures. |

### Build validation

| Flag | Default | Description |
|---|---|---|
| `--build-interval <n>` | `0` | Run `pnpm build` (bundler + tsc) every N clean merges during the loop. `0` = only at end. Recommended: `10`. When a build fails mid-loop, the last merged PR is the likely culprit — the script stops and prints the PR number. |
| `--skip-build` | off | Skip all build validation — both interval and final. Use only for testing the merge loop itself, never before `--create-release`. |
| `--test` | off | Run `pnpm test` after the final build passes. Adds significant time. Failures print a bisect hint but do not necessarily mean the PR is bad (pre-existing failures on base are common). |
| `--continuous-build` | off | **Deprecated / broken.** Runs `pnpm build` in a background git worktree after each merge. Has a known race condition with `--create-release` that causes the release to be silently skipped. Use `--build-interval 10` instead. |
| `--auto-skip-on-build-failure` | off | On build failure (interval or final): parse error output, trace each failing file to its `merge(pr#N)` commit via `git log`, revert that commit, record the PR number in `edge-merge/docs/autoskip.json`, and retry (up to 3 times). Sends an ntfy.sh notification and stops if it cannot auto-fix. Auto-skipped PRs are loaded from `autoskip.json` at startup on all future runs. |

### Output / releases

| Flag | Default | Description |
|---|---|---|
| `--report <path>` | `edge-merge/docs/report.json` | Where to write the JSON run summary. Written at end of run; a partial report is written immediately on build failure so `--resume` can continue from the right place. |
| `--changelog <path>` | `edge-merge/docs/changelog.md` | Markdown file to prepend a human-readable batch summary to after each successful build. Newest entries are at the top. |
| `--create-release` | off | After a successful build, create a GitHub pre-release on `Arry8/openclaw-edge` tagged `mega/YYYY-MM-DD-HHmm`. Release notes come from the latest changelog section. Requires `gh` CLI. |
| `--release-interval <n>` | `0` | Also create a snapshot release every N successful merges during the loop. `0` = end only. Useful for very long runs where you want intermediate releases. |
| `--no-promote-main` | off | By default, after a clean build the script fast-forwards `main` to match `mega/latest`. Pass this flag to skip that promotion. |

---

## Common use cases

### 1. Dry run — inspect without touching git

```sh
bun edge-merge/scripts/edge-merge.ts --dry-run --limit 20
```

Prints which PRs would be attempted and their tiers. No git changes.

---

### 2. Canonical catchup run

The standard command for working through the PR backlog.

```sh
bun edge-merge/scripts/edge-merge.ts \
  --cache-prs --cache-ttl 120 \
  --build-interval 10 \
  --auto-skip-on-build-failure \
  --create-release \
  --resume
```

- `--build-interval 10` — builds every 10 merges (~14 min overhead per 1000 PRs vs. 114 min at interval=1)
- `--auto-skip-on-build-failure` — bad PRs are reverted automatically; run continues unattended
- `--cache-prs` — API fetch is skipped on restarts within 2 hours
- `--resume` — always include on restarts to skip already-processed PRs; automatically retries previously-conflicted PRs if the author pushed a new commit

---

### 3. Quick test run — try a small batch

```sh
bun edge-merge/scripts/edge-merge.ts \
  --limit 25 \
  --build-interval 0 \
  --skip-build \
  --cache-prs
```

Merges 25 PRs with no build validation. Use to verify the script is working or to inspect what PRs are being picked up.

---

### 4. Resume after interruption

Always check the tree is clean first:

```sh
git status --short
# If MERGE_HEAD exists:
git merge --abort
# If tracked files are dirty:
git checkout -- .
```

Then resume:

```sh
bun edge-merge/scripts/edge-merge.ts \
  --cache-prs --cache-ttl 120 \
  --build-interval 10 \
  --auto-skip-on-build-failure \
  --create-release \
  --resume
```

The script also auto-commits dirty data files (`history.json`, `changelog.md`, etc.) at startup if they are the only uncommitted changes — common after a killed run.

---

### 5. Manual build failure recovery

When a build fails and `--auto-skip-on-build-failure` is not set (or the auto-skip exhausted its retries):

**Step 1 — identify the bad PR**

The script prints: `Last merged PR is the likely culprit. Add #NNNNN to autoskip.json and rerun with --resume.`

Confirm with:
```sh
git log --oneline -- <path/to/failing/file>
# Look for:  merge(pr#NNNNN): ...
```

**Step 2 — add to autoskip.json and revert**

Append a manual entry to `edge-merge/docs/autoskip.json`:
```json
{ "number": NNNNN, "reason": "<why it breaks the build>", "source": "manual" }
```

Then revert the merge commit (use `-m 1` for merge commits):
```sh
git revert -m 1 --no-edit <commit-sha>
```

**Step 3 — commit and resume**

```sh
git add edge-merge/docs/autoskip.json
git commit --no-verify -m "fix(edge-merge): add PR #NNNNN to autoskip.json — <reason>"

bun edge-merge/scripts/edge-merge.ts \
  --cache-prs --cache-ttl 120 \
  --build-interval 10 \
  --auto-skip-on-build-failure \
  --create-release \
  --resume
```

---

### 6. Inspect a single PR before merging

```sh
bun edge-merge/scripts/edge-merge.ts --no-commit --limit 1
# Review the staged changes
git diff --cached
# Accept or discard
git commit --no-verify -m "merge(pr#NNNNN): ..."
# or
git reset --hard HEAD
```

---

### 7. Phase 2 — closed-but-not-merged PRs

```sh
bun edge-merge/scripts/edge-merge.ts \
  --state closed \
  --aggressive-filter \
  --cache-prs --cache-ttl 120 \
  --build-interval 10 \
  --auto-skip-on-build-failure \
  --create-release \
  --resume
```

`--aggressive-filter` additionally skips PRs labelled `stale`, `wip`, or `duplicate` — reduces noise from intentionally-abandoned closed PRs.

---

### 8. Promote main manually

If you need to promote `main` without running the full merge loop:

```sh
git checkout main
git reset --hard origin/mega/latest
git push origin main --force
```

Or from `mega/latest` directly:

```sh
git push origin mega/latest:main --force
```

---

## Key files

| File | Purpose |
|---|---|
| `edge-merge/scripts/edge-merge.ts` | The merge script. Contains `SKIP_LIST` and all logic. |
| `edge-merge/docs/history.json` | One entry per PR attempted. Source of truth for `--resume`. Written after every single merge — not batched — so kills/crashes lose at most one entry. |
| `edge-merge/docs/autoskip.json` | All skipped PRs (`source: "manual"` or `"auto"`). Loaded into `SKIP_SET` at startup. |
| `edge-merge/docs/pr-cache.json` | Cached PR list from GitHub API. Gitignored. Populated by `--cache-prs`. |
| `edge-merge/docs/report.json` | Last run summary (JSON). Gitignored. Written at end of run; partial write on build failure. |
| `edge-merge/docs/changelog.md` | Append-only human-readable batch log. Newest entries at top. |

---

## Permanent skip list

`edge-merge/docs/autoskip.json` is the single source of truth for all skipped PRs. Entries have a `source` field: `"manual"` for hand-added entries, `"auto"` for entries written by `--auto-skip-on-build-failure`. Both are loaded into `SKIP_SET` at startup.

To add a PR manually (when not using `--auto-skip-on-build-failure`):

1. Append to `edge-merge/docs/autoskip.json`:
   ```json
   { "number": NNNNN, "reason": "<why it breaks the build>", "source": "manual" }
   ```
2. Revert its merge commit: `git revert -m 1 <sha>`
3. Commit: `git commit --no-verify -m "fix(edge-merge): add PR #NNNNN to autoskip.json — <reason>"`
4. Resume: rerun with `--resume`

---

## GitHub Actions

The daily run is defined in [`.github/workflows/edge-merge.yml`](../.github/workflows/edge-merge.yml). It runs at 08:00 UTC with a 60-minute timeout. Manual trigger available via `workflow_dispatch` with optional `limit` and `skip_build` inputs.

After a successful run, `mega/latest` is force-pushed, `main` is fast-forwarded to match, and a pre-release is created.

> **Note:** The GH Action does not use `--continuous-build` — background processes are killed when the CI step exits.

---

## Orphaned tsgo processes

The pre-commit hook runs `pnpm tsgo` on commits. Interrupted runs leave orphaned processes. The script kills them automatically at startup.

To kill manually:

```sh
pgrep -a -f "tsgo|tsgolint"
kill -- -<PGID>   # kill the whole process group
```
