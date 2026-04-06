#!/usr/bin/env bun
// Authored by: cc (Claude Code) | 2026-03-29
//
// edge-merge.ts — Fetch every open PR on openclaw/openclaw and merge what
// applies cleanly onto the current branch. Inspired by Linux linux-next.
//
// Usage:
//   bun scripts/edge-merge.ts [options]
//
// Options:
//   --upstream <remote>   Git remote name for openclaw/openclaw (default: upstream)
//   --state <s>           PR state to process: open|closed|all (default: open)
//                         "closed" targets closed-but-not-merged PRs (Phase 2)
//   --limit <n>           Stop after attempting N PRs (default: unlimited)
//   --dry-run             Fetch and sort but do not touch the git tree
//   --resume              Skip PRs already in a previous report (--report must exist)
//   --report <path>       Path to write/read the JSON report
//                         (default: edge-merge/docs/report.json)
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
//                         (default: edge-merge/docs/changelog.md)
//   --release-interval <n> Create a GitHub release every N successful merges
//                         (default: 0 = only at the end when --create-release is set).
//   --cache-prs           Cache the PR list to edge-merge/docs/pr-cache.json and reuse
//                         it on subsequent runs within --cache-ttl minutes. Useful for
//                         local catchup loops where the API is hit on every restart.
//   --cache-ttl <n>       Cache TTL in minutes (default: 60). Ignored without --cache-prs.
//   --continuous-build    Run pnpm build continuously in a background git worktree
//                         throughout the merge loop (non-blocking). Stops the loop if
//                         any background build fails. When set, --build-interval is
//                         ignored; a final build still runs at the end.
//   --auto-skip-on-build-failure
//                         When a build fails (interval or final), parse the error
//                         output to identify the failing file(s), trace each file
//                         to its merge(pr#N) commit via git log, revert that commit,
//                         record the PR in edge-merge/docs/autoskip.json, and retry
//                         the build (up to 3 times). If the build passes, the run
//                         continues. If it cannot be auto-fixed (pre-existing base
//                         issue, revert conflict, or retries exhausted), a ntfy.sh
//                         notification is sent to Arry8 and the script stops.
//                         Auto-skipped PRs are loaded at startup on future runs.
//   --create-release      After a successful build, create a GitHub release on the
//                         edge repo (Arry8/openclaw-edge) tagged mega/YYYY-MM-DD-HHmm
//                         with the merged PR list as release notes. Requires gh CLI.
//   --auto-skip-on-build-failure
//                         When a build fails (interval or final), automatically parse
//                         the build output for failing file paths, trace each file to
//                         the most recent merge commit, revert those commits, and retry
//                         the build (up to 3 times). Reverted PR numbers are appended
//                         to edge-merge/docs/autoskip.json and loaded automatically on
//                         future runs. When not set, existing behavior is preserved
//                         (stop + print manual instructions).
//
// Requires:
//   - gh CLI authenticated (for GitHub API pagination)
//   - git remote named <upstream> pointing at openclaw/openclaw
//   - Current branch is the integration target (e.g. mega/v2026.3.28)

import {
  spawnSync,
  execFileSync,
  spawn as spawnAsync,
  type ChildProcess,
} from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  appendFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
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

type ReportEntry = PrRecord & { tier: 0 | 1 | 2 | 3 | 4; result: MergeResult };

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

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// PRs to skip — loaded at startup from edge-merge/docs/autoskip.json.
// Includes both manually added entries (source: "manual") and auto-reverted
// entries written by --auto-skip-on-build-failure (source: "auto").
// To permanently skip a PR, append to autoskip.json with source: "manual".
const SKIP_SET = new Set<number>();

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
const PR_STATE = flag("--state", "all") as "open" | "closed" | "all";
const LIMIT = parseInt(flag("--limit", "0"), 10) || Infinity;
const DRY_RUN = boolFlag("--dry-run");
const RESUME = boolFlag("--resume");
const REPORT_PATH = resolve(REPO_DIR, flag("--report", "edge-merge/docs/report.json"));
const HISTORY_PATH = resolve(REPO_DIR, "edge-merge/docs/history.json");
const AUTOSKIP_PATH = resolve(REPO_DIR, "edge-merge/docs/autoskip.json");
const FETCH_BATCH = parseInt(flag("--fetch-batch", "50"), 10);
const FETCH_DELAY_MS = parseInt(flag("--fetch-delay-ms", "200"), 10);
const NO_COMMIT = boolFlag("--no-commit");
const PROMOTE_MAIN = !process.argv.includes("--no-promote-main"); // fast-forward main to mega/latest after clean build
const BUILD_INTERVAL = parseInt(flag("--build-interval", "0"), 10); // 0 = disabled
const SKIP_BUILD = boolFlag("--skip-build");
const RUN_TEST = boolFlag("--test");
const AGGRESSIVE_FILTER = boolFlag("--aggressive-filter");
const CHANGELOG_PATH = resolve(REPO_DIR, flag("--changelog", "edge-merge/docs/changelog.md"));
const CREATE_RELEASE = boolFlag("--create-release");
const RELEASE_INTERVAL = parseInt(flag("--release-interval", "0"), 10); // 0 = disabled
const CONTINUOUS_BUILD = boolFlag("--continuous-build");
const AUTO_SKIP_ON_BUILD_FAILURE = boolFlag("--auto-skip-on-build-failure");
const CACHE_PRS = boolFlag("--cache-prs");
const CACHE_TTL_MS = parseInt(flag("--cache-ttl", "60"), 10) * 60_000;
const PR_CACHE_PATH = resolve(REPO_DIR, "edge-merge/docs/pr-cache.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`[edge-merge] ${msg}\n`);
}

function warn(msg: string) {
  process.stderr.write(`[edge-merge] WARN: ${msg}\n`);
}

// Run a command, return { ok, stdout, stderr }.
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string; timeoutMs?: number } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_DIR,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeoutMs,
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

// Kill orphaned tsgo/tsgolint processes left by interrupted builds.
function killOrphanedTsgo(): void {
  const result = run("pgrep", ["-f", "tsgo|tsgolint"]);
  if (!result.ok || !result.stdout) return;
  const self = process.pid;
  const toKill = result.stdout
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p && parseInt(p, 10) !== self);
  if (toKill.length > 0) {
    warn(`Found ${toKill.length} orphaned tsgo/tsgolint process(es) — killing: ${toKill.join(", ")}`);
    run("kill", toKill);
  }
}

// ── Continuous build manager ─────────────────────────────────────────────────

// Manages a background pnpm build running in a git worktree that is kept at the
// latest merged HEAD. The merge loop calls tick() after each successful merge;
// it starts a new build whenever the previous one finishes and HEAD has advanced.
// failed is set to true if any background build exits non-zero — the merge loop
// checks this before each iteration and stops early.
class ContinuousBuildManager {
  readonly worktreePath: string;
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents
  private proc: ChildProcess | null = null;
  private buildingSha: string | null = null;
  private lastBuiltSha: string | null = null;
  failed = false;
  failedAtSha: string | null = null;
  private logPath: string;

  constructor(worktreePath: string) {
    this.worktreePath = worktreePath;
    this.logPath = `${worktreePath}.build.log`;
  }

  setup(headSha: string): void {
    run("git", ["worktree", "add", "--detach", this.worktreePath, headSha]);
    // Symlink node_modules from the main repo to avoid a full reinstall.
    symlinkSync(resolve(REPO_DIR, "node_modules"), resolve(this.worktreePath, "node_modules"));
    log(`Continuous build: worktree at ${this.worktreePath}`);
  }

  // Call after each successful merge with the new HEAD sha.
  tick(currentSha: string): void {
    if (this.failed) {
      return;
    }
    if (this.proc !== null) {
      return;
    } // build already in flight
    if (currentSha === this.lastBuiltSha) {
      return;
    } // nothing new
    this.startBuild(currentSha);
  }

  private startBuild(sha: string): void {
    // Move the worktree to this commit before building.
    run("git", ["-C", this.worktreePath, "reset", "--hard", sha]);
    this.buildingSha = sha;

    const logFd = require("node:fs").openSync(this.logPath, "a") as number; // eslint-disable-line @typescript-eslint/no-require-imports
    const proc = spawnAsync("pnpm", ["build"], {
      cwd: this.worktreePath,
      stdio: ["ignore", logFd, logFd],
      detached: true, // own process group so cleanup kills tsgo grandchildren too
    });
    proc.unref(); // don't keep the event loop alive
    this.proc = proc;

    proc.on("exit", (code) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").closeSync(logFd);
      this.lastBuiltSha = this.buildingSha;
      this.proc = null;
      if (code !== 0 && !this.failed) {
        this.failed = true;
        this.failedAtSha = this.buildingSha;
        process.stderr.write(
          `\n[edge-merge] Background build FAILED at ${this.failedAtSha?.slice(0, 12)}.\n` +
            `  Build log: ${this.logPath}\n`,
        );
      }
    });
  }

  // Wait for the currently in-flight build (if any) to finish.
  waitForCurrent(): Promise<void> {
    if (!this.proc) {
      return Promise.resolve();
    }
    return new Promise((res) => {
      this.proc!.on("exit", () => res());
    });
  }

  cleanup(): void {
    if (this.proc) {
      // Kill the whole process group (negative PID) so tsgo grandchildren are
      // also terminated rather than orphaned when the merge loop exits.
      try {
        process.kill(-this.proc.pid!, "SIGTERM");
      } catch {
        this.proc.kill("SIGTERM"); // fallback if pgid already gone
      }
      this.proc = null;
    }
    run("git", ["worktree", "remove", "--force", this.worktreePath]);
    try {
      rmSync(this.logPath, { force: true });
    } catch {
      /* ignore */
    }
  }
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
    1: "Security / Crash",
    2: "Fixes",
    3: "Features",
    4: "Other",
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
        `- [#${e.number}](https://github.com/openclaw/openclaw/pull/${e.number}) ${e.title}${e.author ? ` — Thanks @${e.author}` : ""}`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);

  // Prepend so newest entries appear at the top of the file.
  const entry = lines.join("\n");
  const existing = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, "utf8") : "";
  writeFileSync(CHANGELOG_PATH, entry + existing);
  log(`  Changelog updated                 : ${CHANGELOG_PATH}`);
}

// ── GitHub release creator ────────────────────────────────────────────────────

function createGhRelease(params: {
  tag: string;
  runDate: string;
  baseCommit: string;
  mergedEntries: ReportEntry[];
  changelogPath?: string;
}): void {
  const { tag, runDate, baseCommit, mergedEntries, changelogPath } = params;

  // Use the last changelog section if available, otherwise build notes inline
  let notes: string;
  if (changelogPath) {
    try {
      const full = readFileSync(changelogPath, "utf8");
      // Changelog is prepended — newest entry is at the top.
      // Grab the first section only (everything before the second "## " header).
      const secondSection = full.indexOf("\n## ");
      notes = secondSection >= 0 ? full.slice(0, secondSection).trim() : full.trim();
    } catch {
      notes = "";
    }
  }
  if (!notes) {
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
      if (group.length === 0) continue;
      lines.push(`### ${tierLabels[tier]}`);
      lines.push(``);
      for (const e of group) {
        lines.push(
          `- [#${e.number}](https://github.com/openclaw/openclaw/pull/${e.number}) ${e.title}`,
        );
      }
      lines.push(``);
    }
    notes = lines.join("\n");
  }

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
    "--latest",
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

// ── PR list cache ─────────────────────────────────────────────────────────────

// Load cached PR list if it exists and is within TTL, otherwise fetch and save.
async function fetchAllOpenPrsCached(): Promise<PrRecord[]> {
  if (CACHE_PRS && existsSync(PR_CACHE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(PR_CACHE_PATH, "utf8")) as {
        fetchedAt: number;
        prs: PrRecord[];
      };
      const ageMs = Date.now() - cached.fetchedAt;
      if (ageMs < CACHE_TTL_MS) {
        const ageMins = Math.round(ageMs / 60_000);
        log(
          `Using cached PR list (${cached.prs.length} PRs, ${ageMins}m old). Pass --no-cache-prs to force refresh.`,
        );
        return cached.prs;
      }
      log(
        `PR cache expired (${Math.round(ageMs / 60_000)}m old, TTL ${Math.round(CACHE_TTL_MS / 60_000)}m) — refetching.`,
      );
    } catch {
      warn("Could not parse PR cache; refetching.");
    }
  }

  const prs = await fetchAllOpenPrs();

  if (CACHE_PRS) {
    try {
      writeFileSync(PR_CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), prs }, null, 2));
      log(`PR list cached to ${PR_CACHE_PATH}`);
    } catch {
      warn("Could not write PR cache.");
    }
  }

  return prs;
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
  if (SKIP_SET.has(pr.number)) {
    return { skip: true, reason: "in skip list" };
  }

  // Skip merged PRs only if their commits are already in our tree (pre-tag merge).
  // Post-tag merges (mergedAt set but headSha not yet reachable from HEAD) must be
  // included — they are officially accepted upstream work that belongs in this build.
  if (pr.mergedAt !== null && isAlreadyApplied(pr.headSha)) {
    return { skip: true, reason: "merged upstream" };
  }

  // Skip closed-unmerged PRs unless the user explicitly requested them via --state closed.
  // The default --state all fetches everything but defers the 16K closed-unmerged backlog
  // to an explicit opt-in run. Post-tag merged PRs (mergedAt !== null) are handled above.
  if (pr.closedAt !== null && pr.mergedAt === null && PR_STATE !== "closed") {
    return { skip: true, reason: "closed (unmerged)" };
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

function sortPrs(prs: PrRecord[]): Array<PrRecord & { tier: 0 | 1 | 2 | 3 | 4 }> {
  return prs
    .map((pr) => ({
      ...pr,
      // Tier 0 = post-tag merged (officially accepted upstream); applied before open PRs.
      // Tiers 1–4 = open PRs sorted by security/fix/feat/other.
      tier: (pr.mergedAt !== null ? 0 : assignTier(pr.title)) as 0 | 1 | 2 | 3 | 4,
    }))
    .toSorted((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Within tier 0: oldest mergedAt first (apply in upstream merge order)
      // Within tiers 1–4: oldest createdAt first
      const aTime = a.mergedAt ? new Date(a.mergedAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.mergedAt ? new Date(b.mergedAt).getTime() : new Date(b.createdAt).getTime();
      return aTime - bTime;
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

type HistoryEntry = { number: number; headSha: string; result: { status: string } };

// Returns a map of prNumber → { headSha, status } for all previously processed PRs.
// Used by --resume to skip already-processed PRs, with SHA-change detection for retries.
function loadPreviouslyProcessed(): Map<number, { headSha: string; status: string }> {
  if (!RESUME) {
    return new Map();
  }
  // Load from cumulative history (all runs) so --resume always skips everything
  // processed across all prior batches, not just the last one.
  const path = existsSync(HISTORY_PATH) ? HISTORY_PATH : REPORT_PATH;
  if (!existsSync(path)) {
    return new Map();
  }
  try {
    const prev = JSON.parse(readFileSync(path, "utf8")) as { entries: HistoryEntry[] };
    const processed = new Map(
      prev.entries.map((e) => [e.number, { headSha: e.headSha ?? "", status: e.result?.status ?? "" }]),
    );
    log(`Resume: ${processed.size} PRs in history.`);
    return processed;
  } catch {
    warn("Could not parse history for resume; starting fresh.");
    return new Map();
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

  // Strip upstream .github/workflows/ changes — GitHub rejects pushes that
  // modify workflow files unless the token has `workflow` scope, which causes
  // the interval push (and final push) to fail with "refusing to allow a
  // GitHub App to create or update workflow". Restore our own workflow files.
  const stagedWorkflowsResult = run("git", ["diff", "--cached", "--name-only", "--", ".github/workflows/"]);
  const workflowFiles = stagedWorkflowsResult.stdout.split("\n").filter((f) => f.trim());
  if (workflowFiles.length > 0) {
    for (const f of workflowFiles) {
      const inHead = run("git", ["ls-files", "--error-unmatch", f]);
      if (inHead.ok) {
        run("git", ["checkout", "HEAD", "--", f]); // restore our version
      } else {
        run("git", ["rm", "--cached", "--force", f]); // unstage new upstream workflow
      }
    }
    // Re-check if anything remains after stripping workflow changes
    const afterStrip = run("git", ["diff", "--cached", "--quiet"]);
    if (afterStrip.ok) {
      abortMerge();
      return { status: "already-applied" };
    }
  }

  const commitMsg = `merge(pr#${pr.number}): ${pr.title}`;
  const commitResult = run("git", ["commit", "--no-verify", "--no-edit", "-m", commitMsg]);

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

  const FETCH_TIMEOUT_MS = 30_000; // 30s — kills stalled connections
  const r = run("git", ["fetch", "--no-tags", UPSTREAM, ...refspecs], { timeoutMs: FETCH_TIMEOUT_MS });

  if (r.ok) {
    for (const n of numbers) {
      results.set(n, true);
    }
    return results;
  }

  // Batch failed — try each individually to identify bad refs
  for (const n of numbers) {
    const single = run("git", ["fetch", "--no-tags", UPSTREAM, `refs/pull/${n}/head:tmp/pr-${n}`], { timeoutMs: FETCH_TIMEOUT_MS });
    results.set(n, single.ok);
  }
  return results;
}

// ── History helpers ───────────────────────────────────────────────────────────

// Append a single entry to the cumulative history file immediately.
// Called after every successful merge so restarts resume from the exact last PR.
function appendToHistory(entry: ReportEntry): void {
  let history: { entries: ReportEntry[] } = { entries: [] };
  if (existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
    } catch {
      warn("Could not parse history file; will overwrite.");
    }
  }
  // Skip if already recorded (e.g. duplicate call on retry).
  if (history.entries.some((e) => e.number === entry.number)) {
    return;
  }
  history.entries.push(entry);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// ── Auto-skip on build failure ────────────────────────────────────────────────

type AutoSkipEntry = {
  number: number;
  reason: string;
  source: "manual" | "auto";
  revertedAt?: string;
};

// Load previously auto-skipped PR numbers from disk (returns empty array if missing/invalid).
function loadAutoSkips(): AutoSkipEntry[] {
  if (!existsSync(AUTOSKIP_PATH)) return [];
  try {
    return JSON.parse(readFileSync(AUTOSKIP_PATH, "utf8")) as AutoSkipEntry[];
  } catch {
    warn("Could not parse autoskip file; treating as empty.");
    return [];
  }
}

// Append a new entry to the autoskip JSON file.
function appendAutoSkip(entry: AutoSkipEntry): void {
  const existing = loadAutoSkips();
  existing.push(entry);
  writeFileSync(AUTOSKIP_PATH, JSON.stringify(existing, null, 2));
}

// Extract file paths from combined tsc / tsdown / rolldown build output.
// tsc:      path/to/file.ts(line,col): error TSxxx
// rolldown: [PARSE_ERROR] ... [path/to/file.ts:line:col]
function extractFailingFiles(buildOutput: string): string[] {
  const seen = new Set<string>();
  // Strip ANSI escape codes before matching — rolldown wraps paths in colored box-drawing
  // characters and ANSI codes can appear between '[' and the file path.
  // eslint-disable-next-line no-control-regex
  const clean = buildOutput.replace(/\x1b\[[0-9;]*m/g, "");
  // tsc style: word chars, dots, slashes, hyphens followed by .ts or .js then ( digit
  const tscRe = /([\w./@-]+(?:\/[\w./@-]+)*\.[tj]sx?)\(\d/g;
  // rolldown style: [ src/file.ts:line:col ] (╭─[ ... ] box format has a space after [)
  const rolldownRe = /\[\s*([\w./@-]+(?:\/[\w./@-]+)*\.[tj]sx?):\d/g;
  for (const re of [tscRe, rolldownRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      seen.add(m[1]);
    }
  }
  return [...seen];
}

// Given a file path, find the most recent merge commit that touched it.
// Returns { prNumber, sha } or null if not a tracked merge commit.
function findCulpritPr(filePath: string): { prNumber: number; sha: string } | null {
  const result = run("git", ["log", "--oneline", "--first-parent", "-1", "--", filePath]);
  if (!result.ok || !result.stdout) return null;
  // Expected format: "<sha> merge(pr#NNNNN): ..."
  const m = result.stdout.match(/^([0-9a-f]+)\s+merge\(pr#(\d+)\)/i);
  if (!m) return null;
  return { sha: m[1], prNumber: parseInt(m[2], 10) };
}

// Run a build, capturing combined stdout+stderr.
function runBuildCapture(): { ok: boolean; output: string } {
  const result = run("pnpm", ["build"]);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return { ok: result.ok, output };
}

/**
 * On build failure, parse failing files → find culprit PR commits → revert them →
 * retry the build up to `maxRetries` times.
 *
 * Returns true if the build eventually passes, false if we gave up or couldn't
 * identify a culprit.
 */
// ── ntfy.sh notification ─────────────────────────────────────────────────────

async function notifyNtfy(title: string, message: string): Promise<void> {
  try {
    await fetch("https://ntfy.sh/Arry8", {
      method: "POST",
      headers: { "Title": title, "Priority": "high", "Tags": "warning,edge-merge" },
      body: message,
    });
  } catch {
    // Non-fatal — notification failure never blocks the script
  }
}

async function autoSkipAndRetry(
  buildOutput: string,
  maxRetries = 3,
): Promise<boolean> {
  log("Auto-skip: analyzing build failure...");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const files = extractFailingFiles(buildOutput);
    if (files.length === 0) {
      const msg = `Auto-skip: could not extract any failing file paths from build output. Add the offending PR to ${AUTOSKIP_PATH} with source:"manual" and rerun with --resume.`;
      process.stderr.write(`[edge-merge] ${msg}\n`);
      await notifyNtfy("edge-merge: manual intervention required", msg);
      return false;
    }
    log(`Auto-skip: failing files detected: ${files.join(", ")}`);

    // Find all culprit PRs (deduplicated by PR number)
    const culprits = new Map<number, { sha: string; files: string[] }>();
    const unattributed: string[] = [];

    for (const f of files) {
      const hit = findCulpritPr(f);
      if (!hit) {
        unattributed.push(f);
        continue;
      }
      const existing = culprits.get(hit.prNumber);
      if (existing) {
        existing.files.push(f);
      } else {
        culprits.set(hit.prNumber, { sha: hit.sha, files: [f] });
      }
    }

    if (culprits.size === 0) {
      const msg = `Auto-skip: no merge(pr#N) commits found for failing files: ${unattributed.join(", ")} — pre-existing base issue, cannot auto-fix.`;
      process.stderr.write(`[edge-merge] ${msg}\n`);
      await notifyNtfy("edge-merge: manual intervention required", msg);
      return false;
    }

    if (unattributed.length > 0) {
      warn(`Auto-skip: ${unattributed.length} file(s) not attributable to a merge commit (ignored): ${unattributed.join(", ")}`);
    }

    // Revert each culprit commit
    for (const [prNumber, { sha, files: culpritFiles }] of culprits) {
      log(`Auto-skip: reverting PR #${prNumber} (${sha}) — failing in: ${culpritFiles.join(", ")}`);
      const revertResult = run("git", ["revert", "-m", "1", "--no-edit", sha]);
      if (!revertResult.ok) {
        const msg = `Auto-skip: git revert of ${sha} (PR #${prNumber}) failed: ${revertResult.stderr.slice(0, 200)}. Resolve manually and rerun with --resume.`;
        process.stderr.write(`[edge-merge] ${msg}\n`);
        await notifyNtfy("edge-merge: manual intervention required", msg);
        return false;
      }
      const reason = `${culpritFiles[0]} (auto-skip attempt ${attempt})`;
      appendAutoSkip({ number: prNumber, reason, source: "auto", revertedAt: new Date().toISOString() });
      log(`Auto-skip: PR #${prNumber} reverted and recorded in ${AUTOSKIP_PATH}`);
    }

    // Retry the build
    log(`Auto-skip: retrying build (attempt ${attempt}/${maxRetries})...`);
    const retry = runBuildCapture();
    if (retry.ok) {
      log(`Auto-skip: build passed after reverting ${culprits.size} PR(s).`);
      return true;
    }
    // Build still failing — loop with the new output
    buildOutput = retry.output;
    log(`Auto-skip: build still failing after attempt ${attempt}.`);
  }

  const msg = `Auto-skip exhausted ${maxRetries} retries — build still failing. Check ${AUTOSKIP_PATH} for what was reverted, then resolve manually.`;
  process.stderr.write(`[edge-merge] ${msg}\n`);
  await notifyNtfy("edge-merge: manual intervention required", msg);
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();

  killOrphanedTsgo();

  // Verify we're in a git repo and the upstream remote exists
  const remoteCheck = run("git", ["remote", "get-url", UPSTREAM]);
  if (!remoteCheck.ok) {
    process.stderr.write(
      `[edge-merge] ERROR: remote '${UPSTREAM}' not found.\n` +
        `  Add it with: git remote add ${UPSTREAM} https://github.com/openclaw/openclaw.git\n`,
    );
    process.exit(1);
  }

  // Auto-commit edge-merge data files if they're the only dirty files — these
  // are always safe to commit and are commonly left dirty by interrupted runs.
  const AUTO_COMMIT_PATHS = [
    resolve(REPO_DIR, "edge-merge/docs/history.json"),
    resolve(REPO_DIR, "edge-merge/docs/changelog.md"),
    resolve(REPO_DIR, "edge-merge/docs/pr-cache.json"),
    resolve(REPO_DIR, "edge-merge/docs/report.json"),
    resolve(REPO_DIR, "edge-merge/docs/autoskip.json"),
  ];
  {
    const dirty = run("git", ["status", "--porcelain"]);
    const dirtyTracked = dirty.stdout
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("??"));
    // Porcelain v1: "XY PATH" where XY = 2 status chars, then a space.
    // run() trims stdout, which strips the leading ' ' on the first line when
    // X = ' ' (unindexed change). Detect and restore before slicing.
    const dirtyFiles = dirtyTracked.map((l) => {
      const line = l.length >= 3 && l[2] === " " ? l : " " + l;
      return resolve(REPO_DIR, line.slice(3).trim());
    });
    const allAutoCommittable = dirtyFiles.every((f) => AUTO_COMMIT_PATHS.includes(f));
    if (dirtyTracked.length > 0 && allAutoCommittable) {
      run("git", ["add", ...AUTO_COMMIT_PATHS]);
      const result = run("git", ["commit", "--no-verify", "-m", "chore(edge-merge): update history and changelog"]);
      if (result.ok) {
        log("Auto-committed history/changelog leftover from previous run.");
      } else {
        warn(`Auto-commit failed: ${result.stderr || result.stdout}`);
      }
    } else if (dirtyTracked.length > 0) {
      warn(`Dirty files not auto-committable: ${dirtyFiles.join(", ")}`);
    }
  }

  // Verify working tree is clean (no uncommitted tracked changes; ignore untracked)
  const statusCheck = run("git", ["status", "--porcelain"]);
  const trackedChanges = statusCheck.stdout
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("??"))
    .join("\n");
  if (trackedChanges) {
    process.stderr.write(
      `[edge-merge] ERROR: working tree has uncommitted changes.\n` +
        `  Commit or stash before running edge-merge.\n`,
    );
    process.exit(1);
  }

  const baseCommit = run("git", ["rev-parse", "HEAD"]).stdout;
  const baseBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;

  // Set up continuous background build worktree if requested.
  const cb =
    CONTINUOUS_BUILD && !DRY_RUN
      ? new ContinuousBuildManager(`/tmp/mega-build-${Date.now()}`)
      : null;
  if (cb) {
    cb.setup(baseCommit);
  }

  // Register cleanup so the worktree is always removed on exit.
  const cleanupCb = () => {
    try {
      cb?.cleanup();
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanupCb);
  process.on("SIGINT", () => {
    cleanupCb();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupCb();
    process.exit(143);
  });

  log(`Base commit: ${baseCommit.slice(0, 12)}`);
  log(`Base branch: ${baseBranch}`);
  log(`Upstream remote: ${UPSTREAM} (${remoteCheck.stdout})`);
  if (DRY_RUN) {
    log("DRY RUN — git tree will not be modified.");
  }

  // Fetch all open PRs (from cache if --cache-prs and within TTL)
  const rawPrs = await fetchAllOpenPrsCached();

  // Sort + deduplicate
  const sorted = deduplicateBySha(sortPrs(rawPrs));

  // Load already-processed set for resume
  const previouslyProcessed = loadPreviouslyProcessed();

  // Populate SKIP_SET from edge-merge/docs/autoskip.json (includes both
  // manual entries and auto-reverted entries from --auto-skip-on-build-failure).
  {
    const skips = loadAutoSkips();
    for (const e of skips) {
      SKIP_SET.add(e.number);
    }
    const manual = skips.filter((e) => e.source === "manual").length;
    const auto = skips.filter((e) => e.source === "auto").length;
    if (skips.length > 0) {
      log(`Skip list: loaded ${skips.length} entries from ${AUTOSKIP_PATH} (${manual} manual, ${auto} auto)`);
    }
  }

  // Decide which to attempt
  let shaRetryCount = 0;
  const candidates = sorted.filter((pr) => {
    const prev = previouslyProcessed.get(pr.number);
    if (prev) {
      // merged → never retry; the commit is already in the tree
      if (prev.status === "merged") return false;
      // conflict or fetch-failed → retry if the author pushed a new SHA
      if (prev.status === "conflict" || prev.status === "fetch-failed") {
        if (prev.headSha && prev.headSha === pr.headSha) return false;
        shaRetryCount++;
        return true;
      }
      // anything else (skipped, already-applied) → skip
      return false;
    }
    const s = shouldSkip(pr);
    return !s.skip;
  });
  if (shaRetryCount > 0) {
    log(`Resume: ${shaRetryCount} previously-conflicted PR(s) eligible for retry (author pushed new SHA).`);
  }

  const limit = Math.min(candidates.length, isFinite(LIMIT) ? LIMIT : candidates.length);
  log(
    `PRs to attempt: ${limit} (of ${sorted.length} total, ` +
      `${sorted.length - candidates.length} pre-filtered)`,
  );

  // Print tier breakdown
  const tierCounts = [0, 1, 2, 3, 4].map(
    (t) => candidates.filter((p) => p.tier === t).slice(0, limit).length,
  );
  log(
    `  Tier 0 (post-tag merged): ${tierCounts[0]}  ` +
      `Tier 1 (security/crash): ${tierCounts[1]}  ` +
      `Tier 2 (fix): ${tierCounts[2]}  ` +
      `Tier 3 (feat): ${tierCounts[3]}  ` +
      `Tier 4 (other): ${tierCounts[4]}`,
  );

  const toProcess = candidates.slice(0, limit);

  // ── Batch-fetch all refs before starting merges ───────────────────────────
  // Fetching in bulk is much faster than one-at-a-time.
  // Skip PRs whose tmp/pr-N ref already exists locally — avoids unnecessary
  // network round-trips on restarts (git gc retains refs/objects).
  const existingRefs = new Set(
    run("git", ["show-ref"]).stdout
      .split("\n")
      .map((l) => l.split(" ")[1])
      .filter((r) => r?.startsWith("refs/heads/tmp/pr-"))
      .map((r) => parseInt(r.replace("refs/heads/tmp/pr-", ""), 10)),
  );
  const toFetch = toProcess.filter((p) => !existingRefs.has(p.number));
  const alreadyLocal = toProcess.length - toFetch.length;
  if (alreadyLocal > 0) log(`Skipping ${alreadyLocal} refs already local; fetching ${toFetch.length}.`);
  const fetchSuccess = new Map<number, boolean>();
  for (const p of toProcess) { if (existingRefs.has(p.number)) fetchSuccess.set(p.number, true); }

  log(`\nFetching ${toFetch.length} PR refs in batches of ${FETCH_BATCH}...`);

  for (let i = 0; i < toFetch.length; i += FETCH_BATCH) {
    const batch = toFetch.slice(i, i + FETCH_BATCH);
    const batchNums = batch.map((p) => p.number);
    const results = fetchBatch(batchNums);
    for (const [n, ok] of results) {
      fetchSuccess.set(n, ok);
    }

    const fetchedCount = [...fetchSuccess.values()].filter(Boolean).length;
    process.stdout.write(
      `\r  fetched ${fetchedCount}/${Math.min(i + FETCH_BATCH, toFetch.length)}...`,
    );

    if (i + FETCH_BATCH < toFetch.length) {
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

      // Kick off (or continue) the background build after each successful merge.
      if (result.status === "merged" && cb) {
        const currentSha = run("git", ["rev-parse", "HEAD"]).stdout;
        cb.tick(currentSha);
      }
    }

    // Clean up temp branch
    deleteBranch(tmpBranch);

    // Check if the background build reported a failure; stop early if so.
    if (cb?.failed) {
      process.stdout.write("\n");
      process.stderr.write(
        `[edge-merge] Stopping merge loop: background build failed at ${cb.failedAtSha?.slice(0, 12)}.\n` +
          `  Add the offending PR to ${AUTOSKIP_PATH} with source:"manual" and rerun with --resume.\n`,
      );
      break;
    }

    entries.push({ ...pr, result });

    // Write to history immediately so restarts resume from this point.
    if (
      !DRY_RUN &&
      (result.status === "merged" ||
        result.status === "conflict" ||
        result.status === "fetch-failed")
    ) {
      appendToHistory({ ...pr, result });
    }

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

    // Interval build (skipped when --continuous-build is active — that already covers this).
    if (
      !SKIP_BUILD &&
      !DRY_RUN &&
      !CONTINUOUS_BUILD &&
      BUILD_INTERVAL > 0 &&
      result.status === "merged" &&
      mergedCount % BUILD_INTERVAL === 0
    ) {
      process.stdout.write("\n");
      log(`Interval build at merge #${mergedCount} (PR #${pr.number})...`);
      const intervalBuild = runBuildCapture();
      if (!intervalBuild.ok) {
        if (AUTO_SKIP_ON_BUILD_FAILURE) {
          const fixed = await autoSkipAndRetry(intervalBuild.output);
          if (!fixed) {
            // Write partial report before exiting
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
          // Build fixed — continue merge loop
        } else {
          const intervalFailMsg = `Interval build FAILED after PR #${pr.number} (merge #${mergedCount}). Add #${pr.number} to ${AUTOSKIP_PATH} with source:"manual" and rerun with --resume.`;
          await notifyNtfy("edge-merge: manual intervention required", intervalFailMsg);
          process.stderr.write(
            `[edge-merge] Interval build FAILED after PR #${pr.number} (merge #${mergedCount}).\n` +
              `  Last merged PR is the likely culprit. Add #${pr.number} to ${AUTOSKIP_PATH} with source:"manual" and rerun with --resume.\n` +
              `  Re-run with --auto-skip-on-build-failure to attempt automatic recovery.\n`,
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
      }
      log(`Interval build passed.`);
      if (!DRY_RUN) {
        const pushResult = run("git", ["push", "origin", `${baseBranch}`, "--force"]);
        if (pushResult.ok) log(`  Pushed ${baseBranch} to origin.`);
        else warn(`Interval push failed: ${pushResult.stderr}`);
        const intervalHeadCommit = run("git", ["rev-parse", "HEAD"]).stdout;
        const intervalMergedEntries = entries.filter((e) => e.result.status === "merged");
        appendChangelog({
          runDate: new Date().toISOString().slice(0, 16).replace("T", " "),
          baseCommit,
          headCommit: intervalHeadCommit,
          baseBranch,
          mergedEntries: intervalMergedEntries,
          durationMs: Date.now() - startMs,
          buildPassed: true,
        });
        log(`  Changelog appended (${intervalMergedEntries.length} merged so far).`);
      }
    }

    // Interval release: snapshot progress as a GitHub pre-release every N merges.
    if (
      CREATE_RELEASE &&
      !DRY_RUN &&
      RELEASE_INTERVAL > 0 &&
      result.status === "merged" &&
      mergedCount % RELEASE_INTERVAL === 0
    ) {
      process.stdout.write("\n");
      const snapSha = run("git", ["rev-parse", "HEAD"]).stdout;
      const snapDate = new Date().toISOString().slice(0, 16).replace("T", " ");
      const snapEntries = entries.filter((e) => e.result.status === "merged");
      const tagTs = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
      createGhRelease({
        tag: `mega/${tagTs}`,
        runDate: snapDate,
        baseCommit: snapSha,
        mergedEntries: snapEntries,
        changelogPath: CHANGELOG_PATH,
      });
    }
  }
  process.stdout.write("\n");

  // Wait for any in-flight background build before proceeding to the final build.
  if (cb) {
    if (!cb.failed) {
      log("Waiting for background build to finish...");
      await cb.waitForCurrent();
    }
    if (cb.failed) {
      process.stderr.write(
        `[edge-merge] Background build failed at ${cb.failedAtSha?.slice(0, 12)}; final build may also fail.\n`,
      );
    }
  }

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

  if (!DRY_RUN) writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // ── Flush remaining entries to history ────────────────────────────────────
  // merged/conflict/fetch-failed are already written mid-loop; this catches
  // skipped and already-applied entries for a complete end-of-run record.
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
    if (!DRY_RUN && newEntries.length > 0) {
      history.entries.push(...newEntries);
      writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
    }
    log(`  History total entries             : ${history.entries.length}`);
    log(`  History path                      : ${HISTORY_PATH}`);
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
    if (AUTO_SKIP_ON_BUILD_FAILURE) {
      // Capture output so autoSkipAndRetry can parse it.
      const finalBuild = runBuildCapture();
      if (finalBuild.ok) {
        log("Build passed.");
        buildPassed = true;
      } else {
        const fixed = await autoSkipAndRetry(finalBuild.output);
        if (fixed) {
          log("Build passed after auto-skip.");
          buildPassed = true;
        } else {
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
      }
    } else {
      try {
        execFileSync("pnpm", ["build"], { cwd: REPO_DIR, stdio: "inherit" });
        log("Build passed.");
        buildPassed = true;
      } catch {
        const finalFailMsg = `Final build FAILED on branch ${baseBranch}. Use --auto-skip-on-build-failure or add offending PR to ${AUTOSKIP_PATH} with source:"manual" and rerun with --resume.`;
        await notifyNtfy("edge-merge: manual intervention required", finalFailMsg);
        process.stderr.write(
          `[edge-merge] Final build FAILED.\n` +
            `  Use 'git bisect' against the merge order in ${REPORT_PATH} to find the offending PR,\n` +
            `  add it to ${AUTOSKIP_PATH} with source:"manual", then rerun with --resume.\n` +
            `  Re-run with --auto-skip-on-build-failure to attempt automatic recovery.\n`,
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
    }

    if (RUN_TEST) {
      log(`\nRunning pnpm test...`);
      try {
        execFileSync("pnpm", ["test"], { cwd: REPO_DIR, stdio: "inherit" });
        log("Tests passed.");
      } catch {
        process.stderr.write(
          `[edge-merge] pnpm test FAILED.\n` +
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
    createGhRelease({ tag, runDate, baseCommit, mergedEntries, changelogPath: CHANGELOG_PATH });
  }

  // ── Promote to main ───────────────────────────────────────────────────────
  // Force-push mega/latest to main after a clean build. Force is required
  // because the GH Action may have pushed independently to main.
  // Skip if build was skipped, nothing merged, or --no-promote-main passed.
  if (PROMOTE_MAIN && !DRY_RUN && mergedCount > 0 && buildPassed) {
    log("\nPromoting mega/latest → main...");
    const ff = run("git", ["push", "origin", `${baseBranch}:main`, "--force"]);
    if (ff.ok) {
      log("main promoted successfully.");
    } else {
      warn(`Failed to promote main: ${ff.stderr}. Push mega/latest manually when ready.`);
    }
  }

  // Clean up any tsgo/tsgolint processes spawned during the build steps.
  killOrphanedTsgo();
}

main().catch((err) => {
  process.stderr.write(`[edge-merge] Fatal: ${err}\n`);
  process.exit(1);
});
