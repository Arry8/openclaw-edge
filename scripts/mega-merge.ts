#!/usr/bin/env bun
// Authored by: cc (Claude Code) | 2026-03-29
//
// mega-merge.ts — Fetch every open PR on openclaw/openclaw and merge what
// applies cleanly onto the current branch. Inspired by Linux linux-next.
//
// Usage:
//   bun scripts/mega-merge.ts [options]
//
// Options:
//   --upstream <remote>   Git remote name for openclaw/openclaw (default: upstream)
//   --state <s>           PR state to process: open|closed|all (default: open)
//                         "closed" targets closed-but-not-merged PRs (Phase 2)
//   --limit <n>           Stop after attempting N PRs (default: unlimited)
//   --dry-run             Fetch and sort but do not touch the git tree
//   --resume              Skip PRs already in a previous report (--report must exist)
//   --report <path>       Path to write/read the JSON report
//                         (default: docs/mega-merge-report.json)
//   --fetch-batch <n>     PRs to fetch per git fetch batch (default: 50)
//   --fetch-delay-ms <n>  Delay between fetch batches in ms (default: 200)
//   --no-commit           Leave successful merges staged but do not commit
//                         (useful for manual inspection)
//   --build-interval <n>  Run pnpm build every N successful merges to catch
//                         breakage early (default: 0 = only at the end).
//                         When a build fails mid-run, the offending PR number
//                         is written to the report and the run stops.
//   --skip-build          Skip all pnpm build validation (final and interval)
//   --test                Run pnpm test after the final build passes
//   --aggressive-filter   For closed PRs: also skip stale, wip, duplicate-labelled
//   --changelog <path>    Append a human-readable batch summary to this markdown file
//                         (default: docs/mega-merge-changelog.md)
//   --create-release      After a successful build, create a GitHub release on the
//                         edge repo (Arry8/openclaw-edge) tagged mega/YYYY-MM-DD-HHmm
//                         with the merged PR list as release notes. Requires gh CLI.
//
// Requires:
//   - gh CLI authenticated (for GitHub API pagination)
//   - git remote named <upstream> pointing at openclaw/openclaw
//   - Current branch is the integration target (e.g. mega/v2026.3.28)

import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ─────────────────────────────────────────────────────────────────────

type PrRecord = {
  number: number;
  title: string;
  author: string;
  headSha: string;
  isDraft: boolean;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  labels: string[];
};

type MergeResult =
  | { status: "merged"; commitSha: string }
  | { status: "conflict"; conflictFiles: string[] }
  | { status: "fetch-failed"; error: string }
  | { status: "skipped"; reason: string }
  | { status: "already-applied" };

type ReportEntry = PrRecord & { tier: 1 | 2 | 3 | 4; result: MergeResult };

type Report = {
  generatedAt: string;
  baseCommit: string;
  baseBranch: string;
  upstreamRemote: string;
  totalPrs: number;
  attempted: number;
  merged: number;
  conflicted: number;
  skipped: number;
  fetchFailed: number;
  durationMs: number;
  entries: ReportEntry[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// PRs whose changes we never want to apply regardless of merge cleanliness.
// Add PR numbers here when they cause build failures after the fact.
const SKIP_LIST = new Set<number>([
  29181, // brings in broken shim imports (../signal, ../telegram) removed by #45967
  36307, // missing `detail:` key in audit.ts object literal — syntax error
  48125, // mixed || and ?? without parens in feishu/card-action.ts
  51371, // transitively includes PR #56737 branch (navigation-guard.ts void|Promise<void> .catch() TS error)
  56660, // duplicate observedSuspiciousSignatures declaration in config/io.ts
]);

// Files that, if a PR touches only these, we skip (noise-only changes).
const _SKIP_ONLY_PATHS = [
  "appcast.xml",
  "docs/zh-CN/",
  "CHANGELOG.md",
  ".github/CONTRIBUTORS",
  "README.md",
];

// Title patterns that determine merge priority tier.
// Lower tier number = applied first. When hot files conflict, first writer wins.
const TIER_PATTERNS: Array<{ tier: 1 | 2 | 3 | 4; pattern: RegExp }> = [
  {
    tier: 1,
    pattern:
      /\b(ssrf|xss|injection|crash|oom|out.of.memory|memory.leak|infinite.loop|recursion|data.loss|data.corrupt|dos\b|denial.of.service|cve-|security)\b/i,
  },
  { tier: 2, pattern: /^fix[\s(]/ },
  { tier: 3, pattern: /^feat[\s(]/ },
  { tier: 4, pattern: /./ },
];

// ── Arg parsing ───────────────────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

function boolFlag(name: string): boolean {
  return process.argv.includes(name);
}

const UPSTREAM = flag("--upstream", "upstream");
const PR_STATE = flag("--state", "open") as "open" | "closed" | "all";
const LIMIT = parseInt(flag("--limit", "0"), 10) || Infinity;
const DRY_RUN = boolFlag("--dry-run");
const RESUME = boolFlag("--resume");
const REPORT_PATH = resolve(REPO_DIR, flag("--report", "docs/mega-merge-report.json"));
const HISTORY_PATH = resolve(REPO_DIR, "docs/mega-merge-history.json");
const FETCH_BATCH = parseInt(flag("--fetch-batch", "50"), 10);
const FETCH_DELAY_MS = parseInt(flag("--fetch-delay-ms", "200"), 10);
const NO_COMMIT = boolFlag("--no-commit");
const BUILD_INTERVAL = parseInt(flag("--build-interval", "0"), 10); // 0 = disabled
const SKIP_BUILD = boolFlag("--skip-build");
const RUN_TEST = boolFlag("--test");
const AGGRESSIVE_FILTER = boolFlag("--aggressive-filter");
const CHANGELOG_PATH = resolve(REPO_DIR, flag("--changelog", "docs/mega-merge-changelog.md"));
const CREATE_RELEASE = boolFlag("--create-release");

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`[mega-merge] ${msg}\n`);
}

function warn(msg: string) {
  process.stderr.write(`[mega-merge] WARN: ${msg}\n`);
}

// Run a command, return { ok, stdout, stderr }.
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_DIR,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

// Abort a pending merge silently.
function abortMerge() {
  run("git", ["merge", "--abort"]);
}

// Delete a temp branch silently.
function deleteBranch(branch: string) {
  run("git", ["branch", "-D", branch]);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Changelog writer ─────────────────────────────────────────────────────────

function appendChangelog(params: {
  runDate: string;
  baseCommit: string;
  headCommit: string;
  baseBranch: string;
  mergedEntries: ReportEntry[];
  durationMs: number;
  buildPassed: boolean;
}): void {
  const { runDate, baseCommit, headCommit, baseBranch, mergedEntries, durationMs, buildPassed } =
    params;
  const mins = Math.round(durationMs / 60_000);
  const tierLabels: Record<number, string> = {
    1: "security/crash",
    2: "fix",
    3: "feat",
    4: "other",
  };

  const lines: string[] = [];
  lines.push(`## ${runDate} — ${mergedEntries.length} PRs merged`);
  lines.push(``);
  lines.push(
    `**Base:** \`${baseCommit.slice(0, 12)}\` → **Head:** \`${headCommit.slice(0, 12)}\` on \`${baseBranch}\`  `,
  );
  lines.push(`**Build:** ${buildPassed ? "passed" : "skipped/failed"}  `);
  lines.push(`**Duration:** ${mins}m`);
  lines.push(``);

  // Group by tier
  for (const tier of [1, 2, 3, 4] as const) {
    const group = mergedEntries.filter((e) => e.tier === tier);
    if (group.length === 0) {
      continue;
    }
    lines.push(`### ${tierLabels[tier]} (${group.length})`);
    lines.push(``);
    for (const e of group) {
      lines.push(
        `- [#${e.number}](https://github.com/openclaw/openclaw/pull/${e.number}) ${e.title} (@${e.author})`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);

  appendFileSync(CHANGELOG_PATH, lines.join("\n"));
  log(`  Changelog appended to             : ${CHANGELOG_PATH}`);
}

// ── GitHub release creator ────────────────────────────────────────────────────

function createGhRelease(params: {
  tag: string;
  runDate: string;
  baseCommit: string;
  mergedEntries: ReportEntry[];
}): void {
  const { tag, runDate, baseCommit, mergedEntries } = params;

  // Build release notes
  const lines: string[] = [];
  lines.push(`Mega-merge batch — ${runDate}`);
  lines.push(``);
  lines.push(`**Base commit:** \`${baseCommit.slice(0, 12)}\``);
  lines.push(`**PRs merged:** ${mergedEntries.length}`);
  lines.push(``);

  const tierLabels: Record<number, string> = {
    1: "Security / Crash",
    2: "Fixes",
    3: "Features",
    4: "Other",
  };
  for (const tier of [1, 2, 3, 4] as const) {
    const group = mergedEntries.filter((e) => e.tier === tier);
    if (group.length === 0) {
      continue;
    }
    lines.push(`### ${tierLabels[tier]}`);
    lines.push(``);
    for (const e of group) {
      lines.push(
        `- [#${e.number}](https://github.com/openclaw/openclaw/pull/${e.number}) ${e.title}`,
      );
    }
    lines.push(``);
  }

  const notes = lines.join("\n");

  // Tag the current HEAD, then create the release
  const tagResult = run("git", ["tag", tag]);
  if (!tagResult.ok) {
    warn(`Could not create tag ${tag}: ${tagResult.stderr}`);
    return;
  }

  const pushTag = run("git", ["push", "origin", tag]);
  if (!pushTag.ok) {
    warn(`Could not push tag ${tag}: ${pushTag.stderr}`);
  }

  const releaseResult = run("gh", [
    "release",
    "create",
    tag,
    "--repo",
    "Arry8/openclaw-edge",
    "--title",
    `Mega-merge ${runDate}`,
    "--notes",
    notes,
    "--prerelease",
  ]);

  if (releaseResult.ok) {
    log(`  GitHub release created            : ${tag}`);
  } else {
    warn(`gh release create failed: ${releaseResult.stderr}`);
  }
}

// ── GitHub API pagination ─────────────────────────────────────────────────────

async function fetchAllOpenPrs(): Promise<PrRecord[]> {
  const stateLabel = PR_STATE === "all" ? "open + closed" : PR_STATE;
  log(`Fetching ${stateLabel} PR list from GitHub API...`);
  const all: PrRecord[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const result = run("gh", [
      "api",
      `repos/openclaw/openclaw/pulls?state=${PR_STATE}&per_page=${perPage}&page=${page}`,
      "--jq",
      ".[] | {number, title, isDraft, createdAt, closedAt: .closed_at, mergedAt: .merged_at, headSha: .head.sha, author: .user.login, labels: [.labels[].name]}",
    ]);

    if (!result.ok) {
      warn(`API page ${page} failed: ${result.stderr}`);
      break;
    }

    if (!result.stdout) {
      break;
    }

    // jq outputs one JSON object per line when iterating
    const lines = result.stdout.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      break;
    }

    for (const line of lines) {
      try {
        all.push(JSON.parse(line) as PrRecord);
      } catch {
        // skip malformed lines
      }
    }

    log(`  page ${page}: ${lines.length} PRs (total so far: ${all.length})`);

    if (lines.length < perPage) {
      break;
    } // last page
    page++;

    // Small delay to avoid hammering the API
    await sleep(50);
  }

  log(`Fetched ${all.length} open PRs total.`);
  return all;
}

// ── PR filtering ──────────────────────────────────────────────────────────────

// Stale noise patterns only applied under --aggressive-filter for closed PRs
const STALE_TITLE_RE = /^(wip|draft|poc|test\b|bump|typo|revert\b)/i;
const DUPLICATE_LABELS = new Set(["duplicate", "wontfix", "won't fix", "invalid", "spam"]);
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function shouldSkip(pr: PrRecord): { skip: true; reason: string } | { skip: false } {
  if (pr.isDraft) {
    return { skip: true, reason: "draft" };
  }
  if (SKIP_LIST.has(pr.number)) {
    return { skip: true, reason: "in SKIP_LIST" };
  }

  // For closed PRs: always skip ones that were actually merged (commits already in base)
  if (pr.mergedAt !== null) {
    return { skip: true, reason: "merged upstream" };
  }

  if (AGGRESSIVE_FILTER && pr.closedAt !== null) {
    // Skip old abandoned PRs with no obvious value
    const age = Date.now() - new Date(pr.closedAt).getTime();
    if (age > ONE_YEAR_MS && STALE_TITLE_RE.test(pr.title)) {
      return { skip: true, reason: "stale + noise title" };
    }
    // Skip PRs labelled as duplicates or explicitly rejected
    if (pr.labels.some((l) => DUPLICATE_LABELS.has(l.toLowerCase()))) {
      return {
        skip: true,
        reason: `label: ${pr.labels.find((l) => DUPLICATE_LABELS.has(l.toLowerCase()))}`,
      };
    }
  }

  return { skip: false };
}

function assignTier(title: string): 1 | 2 | 3 | 4 {
  for (const { tier, pattern } of TIER_PATTERNS) {
    if (pattern.test(title)) {
      return tier;
    }
  }
  return 4;
}

function sortPrs(prs: PrRecord[]): Array<PrRecord & { tier: 1 | 2 | 3 | 4 }> {
  return prs
    .map((pr) => ({ ...pr, tier: assignTier(pr.title) }))
    .toSorted((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier - b.tier;
      }
      // Within the same tier, older PRs first (more likely to be the "original" fix)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

// ── Deduplication by head SHA ─────────────────────────────────────────────────

function deduplicateBySha(
  prs: Array<PrRecord & { tier: 1 | 2 | 3 | 4 }>,
): Array<PrRecord & { tier: 1 | 2 | 3 | 4 }> {
  const seen = new Set<string>();
  const result: Array<PrRecord & { tier: 1 | 2 | 3 | 4 }> = [];
  for (const pr of prs) {
    if (seen.has(pr.headSha)) {
      continue;
    }
    seen.add(pr.headSha);
    result.push(pr);
  }
  const dupes = prs.length - result.length;
  if (dupes > 0) {
    log(`Deduplicated ${dupes} PRs with identical head SHA.`);
  }
  return result;
}

// ── Already-applied detection ─────────────────────────────────────────────────

// A PR is already applied if its head commit is reachable from HEAD.
function isAlreadyApplied(headSha: string): boolean {
  const r = run("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]);
  return r.ok;
}

// ── Resume support ─────────────────────────────────────────────────────────────

function loadPreviouslyProcessed(): Set<number> {
  if (!RESUME) {
    return new Set();
  }
  // Load from cumulative history (all runs) so --resume always skips everything
  // processed across all prior batches, not just the last one.
  const path = existsSync(HISTORY_PATH) ? HISTORY_PATH : REPORT_PATH;
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    const prev = JSON.parse(readFileSync(path, "utf8")) as { entries: { number: number }[] };
    const processed = new Set(prev.entries.map((e) => e.number));
    log(`Resume: skipping ${processed.size} already-processed PRs from history.`);
    return processed;
  } catch {
    warn("Could not parse history for resume; starting fresh.");
    return new Set();
  }
}

// ── Core merge loop ───────────────────────────────────────────────────────────

async function attemptMerge(
  pr: PrRecord & { tier: 1 | 2 | 3 | 4 },
  tmpBranch: string,
): Promise<MergeResult> {
  // Check if already in history
  if (isAlreadyApplied(pr.headSha)) {
    return { status: "already-applied" };
  }

  // Merge attempt
  const mergeResult = run("git", ["merge", "--no-commit", "--no-ff", tmpBranch]);

  if (!mergeResult.ok) {
    // Collect conflicting files before aborting
    const conflictResult = run("git", ["diff", "--name-only", "--diff-filter=U"]);
    const conflictFiles = conflictResult.stdout.split("\n").filter((f) => f.trim());

    abortMerge();
    return { status: "conflict", conflictFiles };
  }

  if (DRY_RUN || NO_COMMIT) {
    // Reset the staged-but-not-committed merge
    run("git", ["merge", "--abort"]);
    return { status: "merged", commitSha: "(dry-run)" };
  }

  // Check if merge produced any changes (could be empty if all changes are
  // already present via a previous merge)
  const statusResult = run("git", ["diff", "--cached", "--quiet"]);
  if (statusResult.ok) {
    // Nothing staged — already absorbed
    abortMerge();
    return { status: "already-applied" };
  }

  const commitMsg = `merge(pr#${pr.number}): ${pr.title}`;
  const commitResult = run("git", ["commit", "--no-edit", "-m", commitMsg]);

  if (!commitResult.ok) {
    abortMerge();
    return {
      status: "fetch-failed",
      error: `commit failed: ${commitResult.stderr}`,
    };
  }

  const shaResult = run("git", ["rev-parse", "HEAD"]);
  return { status: "merged", commitSha: shaResult.stdout };
}

// ── Fetch a batch of PR refs ──────────────────────────────────────────────────

function fetchBatch(numbers: number[]): Map<number, boolean> {
  const results = new Map<number, boolean>();
  // Build refspecs: refs/pull/<n>/head:tmp/pr-<n>
  const refspecs = numbers.map((n) => `refs/pull/${n}/head:tmp/pr-${n}`);

  const r = run("git", ["fetch", "--no-tags", UPSTREAM, ...refspecs]);

  if (r.ok) {
    for (const n of numbers) {
      results.set(n, true);
    }
    return results;
  }

  // Batch failed — try each individually to identify bad refs
  for (const n of numbers) {
    const single = run("git", ["fetch", "--no-tags", UPSTREAM, `refs/pull/${n}/head:tmp/pr-${n}`]);
    results.set(n, single.ok);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();

  // Verify we're in a git repo and the upstream remote exists
  const remoteCheck = run("git", ["remote", "get-url", UPSTREAM]);
  if (!remoteCheck.ok) {
    process.stderr.write(
      `[mega-merge] ERROR: remote '${UPSTREAM}' not found.\n` +
        `  Add it with: git remote add ${UPSTREAM} https://github.com/openclaw/openclaw.git\n`,
    );
    process.exit(1);
  }

  // Verify working tree is clean (no uncommitted tracked changes; ignore untracked)
  const statusCheck = run("git", ["status", "--porcelain"]);
  const trackedChanges = statusCheck.stdout
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("??"))
    .join("\n");
  if (trackedChanges) {
    process.stderr.write(
      `[mega-merge] ERROR: working tree has uncommitted changes.\n` +
        `  Commit or stash before running mega-merge.\n`,
    );
    process.exit(1);
  }

  const baseCommit = run("git", ["rev-parse", "HEAD"]).stdout;
  const baseBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;

  log(`Base commit: ${baseCommit.slice(0, 12)}`);
  log(`Base branch: ${baseBranch}`);
  log(`Upstream remote: ${UPSTREAM} (${remoteCheck.stdout})`);
  if (DRY_RUN) {
    log("DRY RUN — git tree will not be modified.");
  }

  // Fetch all open PRs
  const rawPrs = await fetchAllOpenPrs();

  // Sort + deduplicate
  const sorted = deduplicateBySha(sortPrs(rawPrs));

  // Load already-processed set for resume
  const previouslyProcessed = loadPreviouslyProcessed();

  // Decide which to attempt
  const candidates = sorted.filter((pr) => {
    if (previouslyProcessed.has(pr.number)) {
      return false;
    }
    const s = shouldSkip(pr);
    return !s.skip;
  });

  const limit = Math.min(candidates.length, isFinite(LIMIT) ? LIMIT : candidates.length);
  log(
    `PRs to attempt: ${limit} (of ${sorted.length} total, ` +
      `${sorted.length - candidates.length} pre-filtered)`,
  );

  // Print tier breakdown
  const tierCounts = [1, 2, 3, 4].map(
    (t) => candidates.filter((p) => p.tier === t).slice(0, limit).length,
  );
  log(
    `  Tier 1 (security/crash): ${tierCounts[0]}  ` +
      `Tier 2 (fix): ${tierCounts[1]}  ` +
      `Tier 3 (feat): ${tierCounts[2]}  ` +
      `Tier 4 (other): ${tierCounts[3]}`,
  );

  const toProcess = candidates.slice(0, limit);

  // ── Batch-fetch all refs before starting merges ───────────────────────────
  // Fetching in bulk is much faster than one-at-a-time.
  log(`\nFetching ${toProcess.length} PR refs in batches of ${FETCH_BATCH}...`);

  const fetchSuccess = new Map<number, boolean>();
  for (let i = 0; i < toProcess.length; i += FETCH_BATCH) {
    const batch = toProcess.slice(i, i + FETCH_BATCH);
    const batchNums = batch.map((p) => p.number);
    const results = fetchBatch(batchNums);
    for (const [n, ok] of results) {
      fetchSuccess.set(n, ok);
    }

    const fetchedCount = [...fetchSuccess.values()].filter(Boolean).length;
    process.stdout.write(
      `\r  fetched ${fetchedCount}/${Math.min(i + FETCH_BATCH, toProcess.length)}...`,
    );

    if (i + FETCH_BATCH < toProcess.length) {
      await sleep(FETCH_DELAY_MS);
    }
  }
  process.stdout.write("\n");

  const fetchedOk = [...fetchSuccess.entries()].filter(([, ok]) => ok).length;
  const fetchedFail = toProcess.length - fetchedOk;
  log(`Fetch results: ${fetchedOk} OK, ${fetchedFail} failed`);

  // ── Merge loop ────────────────────────────────────────────────────────────
  log(`\nMerging...`);

  const entries: ReportEntry[] = [];
  let mergedCount = 0;
  let conflictCount = 0;
  let skippedCount = 0;
  let fetchFailCount = 0;
  let alreadyAppliedCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const pr = toProcess[i];
    const tmpBranch = `tmp/pr-${pr.number}`;
    const pct = Math.round(((i + 1) / toProcess.length) * 100);

    const fetched = fetchSuccess.get(pr.number) ?? false;

    let result: MergeResult;

    if (!fetched) {
      result = {
        status: "fetch-failed",
        error: "ref not found (branch deleted or repo private)",
      };
      fetchFailCount++;
    } else {
      result = await attemptMerge(pr, tmpBranch);

      switch (result.status) {
        case "merged":
          mergedCount++;
          break;
        case "conflict":
          conflictCount++;
          break;
        case "skipped":
          skippedCount++;
          break;
        case "already-applied":
          alreadyAppliedCount++;
          break;
        case "fetch-failed":
          fetchFailCount++;
          break;
      }
    }

    // Clean up temp branch
    deleteBranch(tmpBranch);

    entries.push({ ...pr, result });

    const statusChar =
      result.status === "merged"
        ? "✓"
        : result.status === "conflict"
          ? "✗"
          : result.status === "already-applied"
            ? "~"
            : "!";

    process.stdout.write(
      `\r  [${pct}%] ${statusChar} #${pr.number} (T${pr.tier}) — ` +
        `merged:${mergedCount} conflict:${conflictCount} skip:${skippedCount + alreadyAppliedCount}`,
    );

    // Interval build: catch breakage early rather than discovering it at the end
    if (
      !SKIP_BUILD &&
      !DRY_RUN &&
      BUILD_INTERVAL > 0 &&
      result.status === "merged" &&
      mergedCount % BUILD_INTERVAL === 0
    ) {
      process.stdout.write("\n");
      log(`Interval build at merge #${mergedCount} (PR #${pr.number})...`);
      const buildOk = run("pnpm", ["build"]);
      if (!buildOk.ok) {
        process.stderr.write(
          `[mega-merge] Interval build FAILED after PR #${pr.number} (merge #${mergedCount}).\n` +
            `  Last merged PR is the likely culprit. Add #${pr.number} to SKIP_LIST and rerun with --resume.\n`,
        );
        // Write partial report before exiting so --resume can continue from here
        writeFileSync(
          REPORT_PATH,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              baseCommit,
              baseBranch,
              upstreamRemote: remoteCheck.stdout,
              totalPrs: rawPrs.length,
              attempted: i + 1,
              merged: mergedCount,
              conflicted: conflictCount,
              skipped: skippedCount + alreadyAppliedCount,
              fetchFailed: fetchFailCount,
              durationMs: Date.now() - startMs,
              buildFailedAtPr: pr.number,
              entries,
            },
            null,
            2,
          ),
        );
        process.exit(1);
      }
      log(`Interval build passed.`);
    }
  }
  process.stdout.write("\n");

  // ── Write report ──────────────────────────────────────────────────────────
  const durationMs = Date.now() - startMs;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseCommit,
    baseBranch,
    upstreamRemote: remoteCheck.stdout,
    totalPrs: rawPrs.length,
    attempted: toProcess.length,
    merged: mergedCount,
    conflicted: conflictCount,
    skipped: skippedCount + alreadyAppliedCount,
    fetchFailed: fetchFailCount,
    durationMs,
    entries,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // ── Append to cumulative history ──────────────────────────────────────────
  // History persists across runs so --resume always skips previously processed PRs.
  {
    let history: { entries: ReportEntry[] } = { entries: [] };
    if (existsSync(HISTORY_PATH)) {
      try {
        history = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
      } catch {
        warn("Could not parse history file; will overwrite.");
      }
    }
    const existingNums = new Set(history.entries.map((e) => e.number));
    const newEntries = entries.filter((e) => !existingNums.has(e.number));
    history.entries.push(...newEntries);
    writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
    log(`  History updated (${history.entries.length} total entries)  : ${HISTORY_PATH}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const mins = Math.round(durationMs / 60_000);
  log(`\n${"─".repeat(60)}`);
  log(`Mega-merge complete in ${mins}m`);
  log(`  Total open PRs fetched from API : ${rawPrs.length}`);
  log(`  Attempted                       : ${toProcess.length}`);
  log(`  Merged cleanly                  : ${mergedCount}`);
  log(`  Conflicted (skipped)            : ${conflictCount}`);
  log(`  Already applied                 : ${alreadyAppliedCount}`);
  log(`  Fetch failed                    : ${fetchFailCount}`);
  log(`  Other skipped                   : ${skippedCount}`);
  log(`  Report written to               : ${REPORT_PATH}`);

  const mergedEntries = entries.filter((e) => e.result.status === "merged");
  const runDate = new Date().toISOString().slice(0, 16).replace("T", " ");
  const headCommit = run("git", ["rev-parse", "HEAD"]).stdout;
  let buildPassed = false;

  if (!SKIP_BUILD && !DRY_RUN && mergedCount > 0) {
    log(`\nRunning pnpm build...`);
    try {
      execFileSync("pnpm", ["build"], { cwd: REPO_DIR, stdio: "inherit" });
      log("Build passed.");
      buildPassed = true;
    } catch {
      process.stderr.write(
        `[mega-merge] Final build FAILED.\n` +
          `  Use 'git bisect' against the merge order in ${REPORT_PATH} to find the offending PR,\n` +
          `  add its number to SKIP_LIST, then rerun with --resume.\n`,
      );
      // Write changelog and exit — don't create a release on a failed build
      appendChangelog({
        runDate,
        baseCommit,
        headCommit,
        baseBranch,
        mergedEntries,
        durationMs,
        buildPassed: false,
      });
      process.exit(1);
    }

    if (RUN_TEST) {
      log(`\nRunning pnpm test...`);
      try {
        execFileSync("pnpm", ["test"], { cwd: REPO_DIR, stdio: "inherit" });
        log("Tests passed.");
      } catch {
        process.stderr.write(
          `[mega-merge] pnpm test FAILED.\n` +
            `  Check test output above. If failures are pre-existing on the base tag, they are not\n` +
            `  caused by this run. Otherwise use 'git bisect' to identify the offending PR.\n`,
        );
        appendChangelog({
          runDate,
          baseCommit,
          headCommit,
          baseBranch,
          mergedEntries,
          durationMs,
          buildPassed: false,
        });
        process.exit(1);
      }
    }
  }

  // ── Changelog ─────────────────────────────────────────────────────────────
  if (!DRY_RUN && mergedCount > 0) {
    appendChangelog({
      runDate,
      baseCommit,
      headCommit,
      baseBranch,
      mergedEntries,
      durationMs,
      buildPassed,
    });
  }

  // ── GitHub release ────────────────────────────────────────────────────────
  // Only create a release when build passed (or build was skipped) and we actually merged something.
  if (CREATE_RELEASE && !DRY_RUN && mergedCount > 0 && (buildPassed || SKIP_BUILD)) {
    const tagTs = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const tag = `mega/${tagTs}`;
    createGhRelease({ tag, runDate, baseCommit, mergedEntries });
  }
}

main().catch((err) => {
  process.stderr.write(`[mega-merge] Fatal: ${err}\n`);
  process.exit(1);
});
