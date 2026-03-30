<!-- Authored by: cc (Claude Code) | 2026-03-30 -->

# openclaw-edge

**The integration build of [openclaw](https://github.com/openclaw/openclaw) — every open upstream PR merged onto a release tag.**

Modeled after [linux-next](https://www.kernel.org/doc/man-pages/linux-next.html): instead of waiting months for the upstream team to triage ~6,600 open pull requests, `openclaw-edge` merges everything that applies cleanly onto a fixed upstream release tag and ships a build.

> No one else is doing this for openclaw. This repo is first.

---

## What it produces

The `mega/latest` branch starts from a fixed upstream release tag and has every clean-merging open PR applied on top. It is not rebased as new upstream releases ship — the goal is to exhaust the full PR queue against a stable base. Updated daily via GitHub Actions.

- **Phase 1**: all ~6,600 open PRs (`state=open`)
- **Phase 2**: all ~16,900 closed-but-not-merged PRs (`state=closed`, `merged_at=null`)
- Conflicts are skipped automatically; first writer wins on hot files
- Build and type-check validated (`pnpm build` includes `tsc`) before releasing
- Full merge history in `docs/mega-merge-history.json`
- Changelog in `docs/mega-merge-changelog.md`
- Release assets attached to each GH release

---

## How it works

```
upstream release tag (e.g. v2026.3.28)
        │
        ▼
  fetch all open PR refs  ──►  sort by priority tier
  (refs/pull/N/head)             1. security / crash
                                 2. fix
                                 3. feat
                                 4. other
        │
        ▼
  for each PR:
    git merge --no-commit --no-ff
    ├── clean    →  commit (--no-verify)  →  continue
    └── conflict →  abort  →  log         →  continue
        │
        ▼
  every 10 merges: pnpm build (bundler + tsc)
    ├── passes  →  continue
    └── fails   →  auto-skip: find culprit PR via git log --first-parent
                              revert merge commit
                              record in autoskip.json
                              retry build (up to 3×)
                   ├── fixed  →  continue
                   └── stuck  →  ntfy.sh alert → stop
        │
        ▼
  final pnpm build + pnpm test (optional)
        │
        ▼
  push mega/latest  →  fast-forward main
        │
        ▼
  create GH release  mega/YYYY-MM-DD-HHMM
```

Typical outcome: **65–75% of open PRs** merge cleanly. The rest conflict and are skipped — logged in history and retried naturally when the next upstream release absorbs them.

---

## Build + release policy

**Both must pass before a release is created:**

1. **Bundler** (`tsdown`/rolldown) — catches parse errors, missing imports, broken syntax
2. **Type check** (`tsc`) — catches logic errors disguised as type errors (e.g. `.catch()` on `void|Promise<void>`, `override` on a non-existent base method)

**PR disposition is binary and deterministic — no patching:**
- PR merges cleanly AND both checks pass → stays in
- Either check fails → PR is auto-reverted, added to skip list, run continues

---

## Running locally

### Prerequisites

- Node 22+, [Bun](https://bun.sh), [pnpm](https://pnpm.io)
- [gh CLI](https://cli.github.com) authenticated
- `upstream` remote pointing at `openclaw/openclaw`

```sh
git clone https://github.com/Arry8/openclaw-edge
cd openclaw-edge
git checkout mega/latest
git remote add upstream https://github.com/openclaw/openclaw.git
```

### Dry run (no git changes)

```sh
bun scripts/mega-merge.ts --dry-run --limit 10
```

### Canonical catchup run

```sh
bun scripts/mega-merge.ts \
  --cache-prs --cache-ttl 120 \
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
| `--auto-skip-on-build-failure` | off | On build failure: parse error output, find culprit PR via `git log --first-parent`, revert it, retry build. Records auto-skips in `docs/mega-merge-autoskip.json`. Sends ntfy.sh alert if it cannot auto-fix. |
| `--skip-build` | off | Skip all build validation |
| `--test` | off | Run `pnpm test` after the final build |
| `--create-release` | off | Tag HEAD and create a GH pre-release after the run |
| `--release-interval <n>` | `0` | Also create a release every N successful merges |
| `--no-promote-main` | off | Skip fast-forwarding `main` to `mega/latest` after clean build |
| `--report <path>` | `docs/mega-merge-report.json` | Report file path |
| `--changelog <path>` | `docs/mega-merge-changelog.md` | Changelog file path |
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
4. Records the PR number in `docs/mega-merge-autoskip.json`
5. Retries the build (up to 3 times)
6. If the build passes → continues the run transparently
7. If it cannot fix (pre-existing base issue, revert conflict, retries exhausted) → sends a high-priority [ntfy.sh](https://ntfy.sh) notification to `Arry8` and stops

Auto-skipped PRs are loaded at startup on all future runs alongside the hardcoded `SKIP_LIST`.

---

## Permanent skip list

PRs that are known to break the build are in `SKIP_LIST` in `scripts/mega-merge.ts`:

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
| `docs/mega-merge-history.json` | One entry per PR attempted. Source of truth for `--resume`. Written after every merge. |
| `docs/mega-merge-autoskip.json` | PRs auto-reverted by `--auto-skip-on-build-failure`. Loaded at startup. |
| `docs/mega-merge-pr-cache.json` | Cached PR list from GitHub API. Gitignored. |
| `docs/mega-merge-report.json` | Last run summary. |
| `docs/mega-merge-changelog.md` | Append-only human-readable batch log. |

---

## Automation

GitHub Actions runs daily at 08:00 UTC. Each run processes as many PRs as possible within the 60-minute job timeout (~250 PRs/run). On success, `mega/latest` and `main` are updated and a pre-release tagged `mega/YYYY-MM-DD-HHMM` is created. `main` is force-pushed so it always reflects `mega/latest`.

See [`.github/workflows/mega-merge.yml`](.github/workflows/mega-merge.yml).

---

## Relationship to openclaw

- **openclaw/openclaw** — upstream source of truth
- **Arry8/openclaw-edge** — this repo; integration build only, no original development

`openclaw-edge` is not affiliated with the openclaw project or team.

---

## Prior art

- [linux-next](https://www.kernel.org/doc/man-pages/linux-next.html) — integration tree for the Linux kernel
