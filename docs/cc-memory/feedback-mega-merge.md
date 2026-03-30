---
name: mega-merge workflow feedback
description: Hard-won lessons building the mega-merge loop — what to avoid, what works
type: feedback
---

Do not run `pnpm check` (or trigger the pre-commit hook) on per-PR commits — use `git commit --no-verify`.

**Why:** Each hook invocation spawns tsgo + tsgolint which consume 10–75% CPU and 2–10% RAM each. Multiple interrupted runs leave orphaned processes that pile up. The hook adds no value here since we're merging upstream PRs, not authoring code.

**How to apply:** Always use `--no-verify` on the per-PR commit in the merge loop. Final build quality gate is `pnpm build` at end of run.

---

Always abort in-progress merges and reset the working tree before rerunning.

**Why:** Killed runs leave `MERGE_HEAD` and partial file changes. The script checks for a clean tree and exits if dirty. Running `git merge --abort && git checkout -- .` is the standard recovery.

**How to apply:** Before every `bun scripts/mega-merge.ts` invocation, check `git status` and abort/reset if needed.

---

The `--continuous-build` flag is on by default. Use `--no-continuous-build` for test/small runs.

**Why:** Background worktree build is wasted work for <50 PR test runs. Default-on was chosen to match user expectation that builds run continuously during large catchup runs.

**How to apply:** Always pass `--no-continuous-build` for test runs or when iterating quickly.

---

Write history after every single merge, not just at end of run.

**Why:** Runs are frequently killed/interrupted. Without per-merge history writes, `--resume` has nothing to skip and re-processes already-merged PRs, causing duplicate commits or conflicts.

**How to apply:** `appendToHistory()` is called immediately after each merge/conflict result. Do not batch or defer this write.
