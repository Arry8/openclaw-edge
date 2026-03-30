<!-- Authored by: cc (Claude Code) | 2026-03-30 -->

# openclaw-edge

**The integration build of [openclaw](https://github.com/openclaw/openclaw) — every open upstream PR merged onto the latest release.**

Modeled after [linux-next](https://www.kernel.org/doc/man-pages/linux-next.html): instead of waiting months for the upstream team to triage ~6,600 open pull requests, `openclaw-edge` merges everything that applies cleanly onto the latest release tag and ships a build.

> No one else is doing this for openclaw. This repo is first.

---

## What it produces

The `mega/latest` branch starts from the most recent upstream release tag and has every clean-merging open PR applied on top. Updated nightly via GitHub Actions.

- **Phase 1**: all ~6,600 open PRs (`state=open`)
- **Phase 2**: all ~16,900 closed-but-not-merged PRs (`state=closed`, `merged_at=null`)
- Conflicts are skipped automatically; first writer wins on hot files
- Build-validated (`pnpm build`) before commits land on `mega/latest`
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
    ├── clean  →  commit (--no-verify)  →  continue
    └── conflict  →  abort  →  log  →  continue
        │
        ▼
  pnpm build  (every N merges + final)
        │
        ▼
  push mega/latest  →  create GH release mega/YYYY-MM-DD-HHMM
```

Typical outcome: **65–75% of open PRs** merge cleanly. The rest conflict and are skipped — logged in history and retried naturally when the next upstream release absorbs them.

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

### Typical catchup run

```sh
bun scripts/mega-merge.ts --resume --cache-prs --limit 50 --create-release
```

### All options

| Flag | Default | Description |
|---|---|---|
| `--upstream <remote>` | `upstream` | Git remote for openclaw/openclaw |
| `--state <open\|closed\|all>` | `open` | Which PRs to process |
| `--limit <n>` | unlimited | Stop after N attempts |
| `--dry-run` | off | Fetch and sort, no git changes |
| `--resume` | off | Skip PRs already in history |
| `--cache-prs` | off | Cache PR list to disk; skip API fetch on restarts |
| `--cache-ttl <n>` | `60` | Cache TTL in minutes |
| `--create-release` | off | Tag HEAD and create a GH pre-release after the run |
| `--release-interval <n>` | 0 (disabled) | Also create a release every N successful merges |
| `--no-continuous-build` | off | Disable background worktree build (on by default) |
| `--build-interval <n>` | 0 (disabled) | Run `pnpm build` every N clean merges |
| `--skip-build` | off | Skip all build validation |
| `--test` | off | Run `pnpm test` after the final build |
| `--report <path>` | `docs/mega-merge-report.json` | Report file path |
| `--fetch-batch <n>` | 50 | PR refs per git fetch batch |
| `--fetch-delay-ms <n>` | 200 | Delay between fetch batches |
| `--no-commit` | off | Stage but don't commit successful merges |
| `--aggressive-filter` | off | For closed PRs: skip stale/duplicate-labelled |

---

## Build validation

| When | What |
|---|---|
| Continuous (background worktree) | `pnpm build` — on by default, disable with `--no-continuous-build` |
| Every N merges (opt-in) | `pnpm build` via `--build-interval N` |
| End of run | `pnpm build` (always, unless `--skip-build`) |
| After final build passes | `pnpm test` (opt-in via `--test`) |

If a build fails, the script writes a partial report with `buildFailedAtPr` set and exits. Add that PR number to `SKIP_LIST` in `scripts/mega-merge.ts` and rerun with `--resume`.

---

## Skipping a PR permanently

```typescript
// scripts/mega-merge.ts
const SKIP_LIST = new Set<number>([
  29181, // broken shim imports
  36307, // missing `detail:` key
  48125, // mixed || and ??
  51371, // transitively includes PR #56737 (navigation-guard.ts TS error)
  56660, // duplicate observedSuspiciousSignatures
]);
```

---

## Nightly automation

GitHub Actions runs every Tuesday at 02:00 UTC. On success, merged commits are pushed to `mega/latest` and a pre-release tagged `mega/YYYY-MM-DD-HHMM` is created with the merge report and changelog attached.

See [`.github/workflows/mega-merge.yml`](.github/workflows/mega-merge.yml).

---

## Relationship to openclaw

- **openclaw/openclaw** — upstream source of truth
- **Arry8/openclaw-edge** — this repo; integration build only, no original development

`openclaw-edge` is not affiliated with the openclaw project or team.

---

## Prior art

- [linux-next](https://www.kernel.org/doc/man-pages/linux-next.html) — integration tree for the Linux kernel
