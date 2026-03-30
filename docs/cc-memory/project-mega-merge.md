---
name: openclaw-edge mega-merge current state
description: Current state of the mega-merge project — branch, script, skip list, what's working
type: project
---

## What this repo is

`Arry8/openclaw-edge` — integration build of `openclaw/openclaw`. Modeled after linux-next: merges every open upstream PR onto the latest release tag. Branch: `mega/latest`. Nightly via `.github/workflows/mega-merge.yml` (Tuesdays 02:00 UTC).

## Script: `scripts/mega-merge.ts`

Core merge loop. Key flags:
- `--resume` — skip PRs already in `docs/mega-merge-history.json`
- `--cache-prs` — use cached PR list (`docs/mega-merge-pr-cache.json`, 60min TTL)
- `--limit <n>` — attempt exactly N PRs (pass/fail both count)
- `--create-release` — tag HEAD and create GH pre-release after run
- `--release-interval <n>` — also release every N successful merges
- `--no-continuous-build` — disable background worktree build (on by default)
- `--skip-build` — skip final `pnpm build`
- `--no-verify` is passed on every per-PR `git commit` to skip the pre-commit hook

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

## History / resume state

`docs/mega-merge-history.json` — written after every merge/conflict. 12 entries as of 2026-03-30 (2 merged, rest conflicts from Tier 1 SSRF/security PRs that conflict with already-merged code).

## Typical local test command

```
bun scripts/mega-merge.ts --resume --cache-prs --limit 10 --create-release --no-continuous-build
```

## Known issues / gotchas

- Git tree must be fully clean before running (no staged or unstaged tracked changes). Killed runs leave partial merge state — always check for `MERGE_HEAD` and run `git merge --abort && git checkout -- .` before restarting.
- tsgo orphans accumulate from interrupted `pnpm check` runs. Script now kills them at startup AND end via `killOrphanedTsgo()`.
- The first ~10 Tier 1 PRs all conflict (SSRF/security changes already merged). Normal — keep increasing limit to get past them.
- PR list has 6576 open PRs. Cache file at `docs/mega-merge-pr-cache.json` avoids 45s re-fetch on restarts.
- `mega/latest` is the integration branch. Never merges back to `main`.

**Why:** To avoid the 45s API re-fetch and pre-commit hook tsgo CPU burn on every commit.
