# edge-merge runbook

Operational reference for running `edge-merge/scripts/edge-merge.ts` — the script that drives the daily integration build.

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

## Common runs

### Dry run (no git changes)

```sh
bun edge-merge/scripts/edge-merge.ts --dry-run --limit 10
```

### Canonical catchup run

```sh
bun edge-merge/scripts/edge-merge.ts \
  --build-interval 10 \
  --auto-skip-on-build-failure \
  --create-release \
  --resume
```

---

## All options

| Flag | Default | Description |
|---|---|---|
| `--upstream <remote>` | `upstream` | Git remote for openclaw/openclaw |
| `--state <open\|closed\|all>` | `open` | Which PRs to process |
| `--limit <n>` | unlimited | Stop after N attempts |
| `--dry-run` | off | Fetch and sort, no git changes |
| `--resume` | off | Skip PRs already in history |
| `--cache-prs` | off | Cache PR list to disk; skip API fetch on restarts |
| `--cache-ttl <n>` | `60` | Cache TTL in minutes |
| `--build-interval <n>` | `0` | Run `pnpm build` every N clean merges (0 = end only). Runs bundler + tsc. |
| `--auto-skip-on-build-failure` | off | On build failure: find culprit PR via `git log --first-parent`, revert it, retry build. Records auto-skips in `edge-merge/docs/autoskip.json`. Sends ntfy.sh alert if it cannot auto-fix. |
| `--skip-build` | off | Skip all build validation |
| `--test` | off | Run `pnpm test` after the final build |
| `--create-release` | off | Tag HEAD and create a GH pre-release after the run |
| `--release-interval <n>` | `0` | Also create a release every N successful merges |
| `--no-promote-main` | off | Skip fast-forwarding `main` to `mega/latest` after clean build |
| `--report <path>` | `edge-merge/docs/report.json` | Report file path |
| `--changelog <path>` | `edge-merge/docs/changelog.md` | Changelog file path |
| `--fetch-batch <n>` | `50` | PR refs per git fetch batch |
| `--fetch-delay-ms <n>` | `200` | Delay between fetch batches |
| `--no-commit` | off | Stage but don't commit successful merges |
| `--aggressive-filter` | off | For closed PRs: skip stale/duplicate-labelled |

---

## Auto-skip on build failure

When `--auto-skip-on-build-failure` is set and a build fails, the script:

1. Parses the build output for failing file paths (handles both `tsc` and rolldown error formats)
2. For each failing file, runs `git log --first-parent -1 -- <file>` to find the `merge(pr#N)` commit that introduced it
3. Reverts that commit with `git revert -m 1`
4. Records the PR number in `edge-merge/docs/autoskip.json`
5. Retries the build (up to 3 times)
6. If the build passes → continues the run transparently
7. If it cannot fix → sends a high-priority [ntfy.sh](https://ntfy.sh) notification and stops

Auto-skipped PRs are loaded at startup on all future runs alongside the hardcoded `SKIP_LIST`.

---

## Permanent skip list

PRs that are known to break the build are in `SKIP_LIST` in `edge-merge/scripts/edge-merge.ts`:

```typescript
const SKIP_LIST = new Set<number>([
  29181, // broken shim imports (../signal, ../telegram) removed by #45967
  36307, // missing `detail:` key in audit.ts — syntax error
  48125, // mixed || and ?? without parens in feishu/card-action.ts
  51371, // transitively includes PR #56737 (navigation-guard.ts TS error)
  55875, // unterminated regex in skill-scanner.ts — parse error
  56660, // duplicate observedSuspiciousSignatures in config/io.ts
  56617, // gateway-plugin.ts: override handleReconnectionAttempt not in base
  56737, // navigation-guard.ts: .catch() on void|Promise<void> — TS error
  56840, // gateway-plugin.ts: same override pattern as #56617
  51722, // sandbox/browser.ts: duplicate object property — TS1117
  45782, // fs-safe.ts + pairing-store.ts TS errors in error handling
  47225, // stream-payload-utils.ts TS error in toolsOverride field
]);
```

To add a PR: edit `SKIP_LIST`, revert its merge commit with `git revert -m 1 <sha>`, commit, rerun with `--resume`.

---

## Key files

| File | Purpose |
|---|---|
| `edge-merge/docs/history.json` | One entry per PR attempted. Source of truth for `--resume`. Written after every merge. |
| `edge-merge/docs/autoskip.json` | PRs auto-reverted by `--auto-skip-on-build-failure`. Loaded at startup. |
| `edge-merge/docs/pr-cache.json` | Cached PR list from GitHub API. Gitignored. |
| `edge-merge/docs/report.json` | Last run summary. |
| `edge-merge/docs/changelog.md` | Append-only human-readable batch log. |

---

## GitHub Actions

The daily run is defined in [`.github/workflows/edge-merge.yml`](../.github/workflows/edge-merge.yml). It runs at 08:00 UTC with a 60-minute timeout. Manual trigger available via `workflow_dispatch` with optional `limit` and `skip_build` inputs.

After a successful run, `mega/latest` is force-pushed, `main` is fast-forwarded to match, and a release is created.

### Promoting main manually

If you need to promote `main` without running the full merge loop:

```sh
git checkout main
git reset --hard origin/mega/latest
git push origin main --force
```
