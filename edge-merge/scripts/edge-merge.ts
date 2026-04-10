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
//   --cache-prs           Enable delta-fetch mode. On first run: full fetch of all open PRs,
//                         saved to edge-merge/docs/pr-cache.json. On subsequent runs: only
//                         fetches PRs updated since the last run (~50/day vs ~6500). Also
//                         fetches recently-closed PRs: merged ones become Tier 0, abandoned
//                         ones are removed from the cache. Strongly recommended for GHA.
//   --cache-ttl <n>       Unused in delta mode (kept for backwards compat). Default: 60.
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
//   --reset-base <tag>    Start fresh from an upstream release tag. Hard-resets
//                         mega/latest to <tag>, clears history/autoskip/pr-cache,
//                         preserves edge-merge/ directory, then runs the full
//                         merge loop. Incompatible with --resume.
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
  unlinkSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
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
const PR_STATE = flag("--state", "open") as "open" | "closed" | "all";
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
const RESET_BASE = flag("--reset-base", "");

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
      ".[] | {number, title, isDraft, createdAt: .created_at, closedAt: .closed_at, mergedAt: .merged_at, headSha: .head.sha, author: .user.login, labels: [.labels[].name]}",
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

// ── PR list cache + delta-fetch ───────────────────────────────────────────────

type PrCache = { fetchedAt: string; prs: PrRecord[] };

function loadPrCache(): PrCache | null {
  if (!existsSync(PR_CACHE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(PR_CACHE_PATH, "utf8")) as {
      fetchedAt: number | string;
      prs: PrRecord[];
    };
    // Normalise legacy numeric timestamp to ISO string
    const fetchedAt =
      typeof raw.fetchedAt === "number"
        ? new Date(raw.fetchedAt).toISOString()
        : raw.fetchedAt;
    return { fetchedAt, prs: raw.prs };
  } catch {
    return null;
  }
}

function savePrCache(prs: PrRecord[]): void {
  try {
    writeFileSync(PR_CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), prs }));
    log(`PR list cached to ${PR_CACHE_PATH} (${prs.length} PRs)`);
  } catch {
    warn("Could not write PR cache.");
  }
}

// Fetch only PRs updated since `since` (ISO string).
// Returns open-PR updates, newly-merged PRs (Tier 0), and abandoned PR numbers.
async function deltaFetch(
  since: string,
): Promise<{ updated: PrRecord[]; merged: PrRecord[]; abandoned: number[] }> {
  const sinceMs = new Date(since).getTime();
  const updated: PrRecord[] = [];
  const merged: PrRecord[] = [];
  const abandoned: number[] = [];
  const jqFull =
    ".[] | {number, title, isDraft, createdAt: .created_at, updatedAt: .updated_at, closedAt: .closed_at, mergedAt: .merged_at, headSha: .head.sha, author: .user.login, labels: [.labels[].name]}";

  // Recently-updated open PRs
  for (let page = 1; ; page++) {
    const result = run("gh", [
      "api",
      `repos/openclaw/openclaw/pulls?state=open&sort=updated&direction=desc&per_page=100&page=${page}`,
      "--jq",
      jqFull,
    ]);
    if (!result.ok || !result.stdout) break;
    const lines = result.stdout.split("\n").filter((l) => l.trim());
    if (lines.length === 0) break;
    let hitOld = false;
    for (const line of lines) {
      try {
        const pr = JSON.parse(line) as PrRecord & { updatedAt: string };
        if (new Date(pr.updatedAt ?? pr.createdAt).getTime() < sinceMs) {
          hitOld = true;
          break;
        }
        updated.push(pr);
      } catch { /* skip malformed */ }
    }
    if (hitOld || lines.length < 100) break;
    await sleep(50);
  }

  // Recently-closed PRs — split into merged (Tier 0) vs abandoned (drop from cache)
  for (let page = 1; ; page++) {
    const result = run("gh", [
      "api",
      `repos/openclaw/openclaw/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
      "--jq",
      jqFull,
    ]);
    if (!result.ok || !result.stdout) break;
    const lines = result.stdout.split("\n").filter((l) => l.trim());
    if (lines.length === 0) break;
    let hitOld = false;
    for (const line of lines) {
      try {
        const pr = JSON.parse(line) as PrRecord & { updatedAt: string };
        if (new Date(pr.updatedAt ?? pr.createdAt).getTime() < sinceMs) {
          hitOld = true;
          break;
        }
        if (pr.mergedAt) {
          merged.push(pr); // merged into upstream → Tier 0 candidate
        } else {
          abandoned.push(pr.number); // closed without merge → remove from cache
        }
      } catch { /* skip malformed */ }
    }
    if (hitOld || lines.length < 100) break;
    await sleep(50);
  }

  log(
    `Delta fetch: ${updated.length} updated open, ${merged.length} newly-merged (T0), ${abandoned.length} abandoned since ${since}`,
  );
  return { updated, merged, abandoned };
}

function mergeDelta(
  cached: PrRecord[],
  updated: PrRecord[],
  mergedPrs: PrRecord[],
  abandoned: number[],
): PrRecord[] {
  const byNumber = new Map(cached.map((p) => [p.number, p]));
  for (const n of abandoned) byNumber.delete(n);
  for (const pr of updated) byNumber.set(pr.number, pr);
  // Newly-merged PRs stay in the list with mergedAt set so Tier 0 logic picks them up
  for (const pr of mergedPrs) byNumber.set(pr.number, pr);
  return [...byNumber.values()];
}

// Main entry point for PR list retrieval.
// With --cache-prs: delta-fetch after first full fetch.
// Without --cache-prs: always full fetch (existing behaviour).
async function fetchAllOpenPrsCached(): Promise<PrRecord[]> {
  if (CACHE_PRS) {
    const cache = loadPrCache();
    if (cache) {
      log(`PR cache found (${cache.prs.length} PRs, fetched ${cache.fetchedAt}). Running delta fetch...`);
      const delta = await deltaFetch(cache.fetchedAt);
      const result = mergeDelta(cache.prs, delta.updated, delta.merged, delta.abandoned);
      savePrCache(result);
      return result;
    }
    log("No PR cache found — performing full fetch.");
  }

  const prs = await fetchAllOpenPrs();
  if (CACHE_PRS) savePrCache(prs);
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

  const FETCH_BATCH_TIMEOUT_MS = 30_000;   // 30s for the whole batch
  const FETCH_SINGLE_TIMEOUT_MS = 5_000;   // 5s per ref — avoids hanging on deleted/GC'd refs
  const r = run("git", ["fetch", "--no-tags", UPSTREAM, ...refspecs], { timeoutMs: FETCH_BATCH_TIMEOUT_MS });

  if (r.ok) {
    for (const n of numbers) {
      results.set(n, true);
    }
    return results;
  }

  // Batch failed — try each individually to identify bad refs
  for (const n of numbers) {
    const single = run("git", ["fetch", "--no-tags", UPSTREAM, `refs/pull/${n}/head:tmp/pr-${n}`], { timeoutMs: FETCH_SINGLE_TIMEOUT_MS });
    results.set(n, single.ok);
  }
  return results;
}

// ── History helpers ───────────────────────────────────────────────────────────

// Write a file with retry on transient Windows file-lock errors (EUNKNOWN, EBUSY).
function writeFileWithRetry(path: string, data: string, retries = 3): void {
  for (let i = 0; i < retries; i++) {
    try {
      writeFileSync(path, data);
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i < retries - 1 && (code === "EUNKNOWN" || code === "EBUSY")) {
        Bun.sleepSync(100);
        continue;
      }
      throw e;
    }
  }
}

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
  writeFileWithRetry(HISTORY_PATH, JSON.stringify(history, null, 2));
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
  writeFileWithRetry(AUTOSKIP_PATH, JSON.stringify(existing, null, 2));
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

// Fetch merge(pr#N) commits on the first-parent chain.
// If `since` SHA provided, fetches all commits since that point (entire run).
// Otherwise fetches the last N commits.
function getRecentMergeCommits(n: number, since?: string): Array<{ sha: string; prNumber: number }> {
  const rangeArg = since ? `${since}..HEAD` : `-${n * 4}`;
  const args = since
    ? ["log", "--oneline", "--first-parent", rangeArg]
    : ["log", "--oneline", "--first-parent", rangeArg];
  const result = run("git", args);
  if (!result.ok || !result.stdout) return [];
  const commits: Array<{ sha: string; prNumber: number }> = [];
  for (const line of result.stdout.split("\n")) {
    const m = line.match(/^([0-9a-f]+)\s+merge\(pr#(\d+)\)/i);
    if (m) commits.push({ sha: m[1], prNumber: parseInt(m[2], 10) });
    if (!since && commits.length >= n) break;
  }
  return commits;
}

// Binary search merge commits to find the one causing the build failure.
// First tries the last `batchSize` commits (fast). If that fails, widens to all commits
// since runBaseCommit (the start of this run) for transitive errors introduced long ago.
// Temporarily reverts subsets, rebuilds, then undoes reverts to narrow to single culprit.
// Returns the culprit { sha, prNumber } or null if not found.
async function binarySearchCulprit(
  batchSize: number,
): Promise<{ sha: string; prNumber: number } | null> {
  // Try narrow window first (fast path)
  let commits = getRecentMergeCommits(batchSize);
  if (commits.length > 0) {
    const result = await runBinarySearch(commits);
    if (result) return result;
  }
  // Widen to full run history if narrow search failed
  if (runBaseCommit) {
    const allCommits = getRecentMergeCommits(0, runBaseCommit);
    if (allCommits.length > commits.length) {
      log(`Auto-skip: narrow search failed — widening to all ${allCommits.length} commits since run start...`);
      return runBinarySearch(allCommits);
    }
  }
  return null;
}

async function runBinarySearch(
  commits: Array<{ sha: string; prNumber: number }>,
): Promise<{ sha: string; prNumber: number } | null> {
  if (commits.length === 0) return null;
  log(`Auto-skip: binary search over ${commits.length} merge commits for transitive culprit...`);

  let lo = 0;
  let hi = commits.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const toRevert = commits.slice(lo, mid + 1);

    // Save HEAD so we can reset back cleanly after testing
    const savedHead = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    let revertFailed = false;
    for (const c of toRevert) {
      const r = run("git", ["revert", "-m", "1", "--no-edit", c.sha]);
      if (!r.ok) { revertFailed = true; break; }
    }

    if (revertFailed) {
      run("git", ["reset", "--hard", savedHead]);
      lo = mid + 1;
      continue;
    }

    const build = runBuildCapture();
    // Always reset back — never leave revert commits in history during search
    run("git", ["reset", "--hard", savedHead]);

    if (build.ok) {
      hi = mid; // reverting lo..mid fixed it — culprit is in this range
    } else {
      lo = mid + 1; // still broken — culprit is in mid+1..hi
    }
  }

  const candidate = commits[lo];
  if (!candidate) return null;

  // Verify: revert candidate alone and confirm build passes
  const savedHead = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const verify = run("git", ["revert", "-m", "1", "--no-edit", candidate.sha]);
  if (!verify.ok) {
    run("git", ["reset", "--hard", savedHead]);
    return null;
  }
  const check = runBuildCapture();
  if (check.ok) {
    log(`Auto-skip: binary search found culprit PR #${candidate.prNumber} (${candidate.sha})`);
    // Leave this revert in place — caller will record it in autoskip and continue
    return candidate;
  }
  // Didn't fix it alone — reset back and give up
  run("git", ["reset", "--hard", savedHead]);
  return null;
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

let unattributableBuildFailures = 0;
const MAX_UNATTRIBUTABLE_FAILURES = 3;
// Set at start of main() — used by binarySearchCulprit to scope search to current run
let runBaseCommit = "";

// Returns { ok, revertedPrs } — ok=true means build fixed, revertedPrs lists PRs that were reverted.
async function autoSkipAndRetry(
  buildOutput: string,
  maxRetries = 3,
): Promise<{ ok: boolean; revertedPrs: number[] }> {
  const revertedPrs: number[] = [];
  log("Auto-skip: analyzing build failure...");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const files = extractFailingFiles(buildOutput);
    if (files.length === 0) {
      unattributableBuildFailures++;
      if (unattributableBuildFailures >= MAX_UNATTRIBUTABLE_FAILURES) {
        const msg = `Auto-skip: unattributable build failure (${unattributableBuildFailures}x) — circuit breaker tripped, stopping.`;
        warn(msg);
        await notifyNtfy("edge-merge: circuit breaker tripped", msg);
        return { ok: false, revertedPrs };
      }
      const msg = `Auto-skip: could not extract failing file paths (${unattributableBuildFailures}/${MAX_UNATTRIBUTABLE_FAILURES}) — continuing.`;
      warn(msg);
      await notifyNtfy("edge-merge: unattributable build failure (continuing)", msg);
      return { ok: true, revertedPrs };
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
      // Direct file search found nothing — fall back to binary search (handles transitive TS errors)
      log(`Auto-skip: no direct file culprit for: ${unattributed.join(", ")} — falling back to binary search...`);
      const bsResult = await binarySearchCulprit(BUILD_INTERVAL * 2);
      if (bsResult) {
        const reason = `${unattributed[0]} (binary-search, attempt ${attempt})`;
        appendAutoSkip({ number: bsResult.prNumber, reason, source: "auto", revertedAt: new Date().toISOString() });
        revertedPrs.push(bsResult.prNumber);
        log(`Auto-skip: binary search reverted PR #${bsResult.prNumber} — retrying build.`);
        const retry = runBuildCapture();
        if (retry.ok) {
          log(`Auto-skip: build passed after binary-search revert of PR #${bsResult.prNumber}.`);
          return { ok: true, revertedPrs };
        }
        buildOutput = retry.output;
        continue;
      }
      unattributableBuildFailures++;
      const msg = `Auto-skip: binary search also failed to find culprit (${unattributableBuildFailures}/${MAX_UNATTRIBUTABLE_FAILURES}): ${unattributed.join(", ")} — stopping run.`;
      warn(msg);
      await notifyNtfy("edge-merge: unattributable build failure (stopping)", msg);
      return { ok: false, revertedPrs };
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
        return { ok: false, revertedPrs };
      }
      revertedPrs.push(prNumber);
      const reason = `${culpritFiles[0]} (auto-skip attempt ${attempt})`;
      appendAutoSkip({ number: prNumber, reason, source: "auto", revertedAt: new Date().toISOString() });
      log(`Auto-skip: PR #${prNumber} reverted and recorded in ${AUTOSKIP_PATH}`);
    }

    // Retry the build
    log(`Auto-skip: retrying build (attempt ${attempt}/${maxRetries})...`);
    const retry = runBuildCapture();
    if (retry.ok) {
      log(`Auto-skip: build passed after reverting ${culprits.size} PR(s).`);
      return { ok: true, revertedPrs };
    }
    // Build still failing — loop with the new output
    buildOutput = retry.output;
    log(`Auto-skip: build still failing after attempt ${attempt}.`);
  }

  const msg = `Auto-skip exhausted ${maxRetries} retries — build still failing. Stopping run. Check ${AUTOSKIP_PATH} for reverted PRs and rerun with --resume.`;
  warn(msg);
  await notifyNtfy("edge-merge: retries exhausted (stopping)", msg);
  return { ok: false, revertedPrs };
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

  // ── Reset base (fresh start from a new upstream tag) ──────────────────────
  if (RESET_BASE) {
    if (RESUME) {
      process.stderr.write("[edge-merge] ERROR: --reset-base and --resume are incompatible.\n");
      process.exit(1);
    }
    log(`Resetting base to upstream tag: ${RESET_BASE}`);

    // Fetch the tag from upstream
    const fetchTag = run("git", ["fetch", UPSTREAM, `refs/tags/${RESET_BASE}:refs/tags/${RESET_BASE}`]);
    if (!fetchTag.ok) {
      process.stderr.write(`[edge-merge] ERROR: could not fetch tag '${RESET_BASE}' from ${UPSTREAM}.\n  ${fetchTag.stderr}\n`);
      process.exit(1);
    }

    // Capture current HEAD and branch before reset
    const preResetSha = run("git", ["rev-parse", "HEAD"]).stdout;
    const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
    if (currentBranch === "HEAD") {
      process.stderr.write("[edge-merge] ERROR: --reset-base requires a branch checkout (not detached HEAD).\n");
      process.exit(1);
    }
    const edgeMergeDir = resolve(REPO_DIR, "edge-merge");
    const hasEdgeMerge = existsSync(edgeMergeDir);

    // Hard reset to the tag (stays on the current branch)
    const reset = run("git", ["reset", "--hard", RESET_BASE]);
    if (!reset.ok) {
      process.stderr.write(`[edge-merge] ERROR: git reset --hard ${RESET_BASE} failed.\n  ${reset.stderr}\n`);
      process.exit(1);
    }
    log(`Reset to ${RESET_BASE}: ${run("git", ["rev-parse", "--short", "HEAD"]).stdout}`);

    // Restore edge-merge directory (it lives in our fork, not upstream)
    if (hasEdgeMerge) {
      run("git", ["checkout", preResetSha, "--", "edge-merge/"]);
      log("Restored edge-merge/ directory from previous HEAD.");
    }

    // Clear history, autoskip, and pr-cache for a fresh start
    for (const p of [HISTORY_PATH, AUTOSKIP_PATH, PR_CACHE_PATH]) {
      if (existsSync(p)) {
        unlinkSync(p);
        log(`  Cleared ${basename(p)}`);
      }
    }

    // Commit the reset state
    run("git", ["add", "-A"]);
    run("git", ["commit", "--no-verify", "-m", `chore(edge-merge): reset base to ${RESET_BASE}`]);
    log(`Base reset complete. Proceeding with merge loop.\n`);
  }

  // Auto-commit any tracked dirty files left over from an interrupted run.
  // This covers both edge-merge data files and staged PR merge changes that
  // were never committed (e.g. a PR that deleted or modified dist/ files).
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
    if (dirtyTracked.length > 0) {
      // Stage all tracked changes (including deletions) and commit.
      run("git", ["add", "-u"]);
      // Also stage any auto-commit paths that may be unstaged.
      run("git", ["add", ...AUTO_COMMIT_PATHS.filter((p) => existsSync(p))]);
      const result = run("git", ["commit", "--no-verify", "-m", "chore(edge-merge): commit leftover changes from interrupted run"]);
      if (result.ok) {
        log("Auto-committed history/changelog leftover from previous run.");
      } else {
        warn(`Auto-commit failed: ${result.stderr || result.stdout}`);
      }
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
  runBaseCommit = baseCommit; // used by binarySearchCulprit for wide search
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
      // conflict, fetch-failed, or already-applied → retry if the author pushed a new SHA
      if (prev.status === "conflict" || prev.status === "fetch-failed" || prev.status === "already-applied") {
        if (prev.headSha && prev.headSha === pr.headSha) return false;
        shaRetryCount++;
        return true;
      }
      // anything else (skipped) → skip
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
  // Build a map of locally-existing refs: prNumber → local SHA
  const existingRefs = new Map<number, string>();
  for (const line of run("git", ["show-ref"]).stdout.split("\n")) {
    const [sha, ref] = line.split(" ");
    if (ref?.startsWith("refs/heads/tmp/pr-")) {
      existingRefs.set(parseInt(ref.replace("refs/heads/tmp/pr-", ""), 10), sha);
    }
  }
  // Only reuse a local ref if its SHA matches the current headSha from the PR list.
  // If the author force-pushed, the local ref is stale and must be re-fetched.
  const toFetch = toProcess.filter((p) => {
    const localSha = existingRefs.get(p.number);
    return !localSha || localSha !== p.headSha;
  });
  const alreadyLocal = toProcess.length - toFetch.length;
  if (alreadyLocal > 0) log(`Skipping ${alreadyLocal} refs already local (SHA match); fetching ${toFetch.length}.`);
  const fetchSuccess = new Map<number, boolean>();
  for (const p of toProcess) {
    const localSha = existingRefs.get(p.number);
    if (localSha && localSha === p.headSha) fetchSuccess.set(p.number, true);
  }

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
  let lastChangelogIndex = 0;

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
        result.status === "fetch-failed" ||
        result.status === "already-applied")
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
          const { ok: fixed, revertedPrs: intervalReverted } = await autoSkipAndRetry(intervalBuild.output);
          // Mark reverted PRs in entries and adjust counts
          for (const rn of intervalReverted) {
            const entry = entries.find((e) => e.number === rn && e.result.status === "merged");
            if (entry) { entry.result = { status: "reverted" as any, conflictFiles: [] }; mergedCount--; }
          }
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
        const intervalMergedEntries = entries.filter((e) => e.result.status === "merged").slice(lastChangelogIndex);
        lastChangelogIndex += intervalMergedEntries.length;
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

    // Commit history.json so the next run (e.g. GHA) gets an up-to-date
    // resume list even after a clean exit.
    if (!DRY_RUN) {
      run("git", ["add", HISTORY_PATH]);
      if (existsSync(AUTOSKIP_PATH)) run("git", ["add", AUTOSKIP_PATH]);
      if (existsSync(CHANGELOG_PATH)) run("git", ["add", CHANGELOG_PATH]);
      if (existsSync(REPORT_PATH)) run("git", ["add", REPORT_PATH]);
      const dirty = run("git", ["diff", "--cached", "--quiet"]);
      if (!dirty.ok) {
        run("git", ["commit", "--no-verify", "-m", "chore(edge-merge): update history, autoskip, and report"]);
        log("  History/autoskip/report committed to git.");
      }
    }
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

  let mergedEntries = entries.filter((e) => e.result.status === "merged");
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
        const { ok: fixed, revertedPrs: finalReverted } = await autoSkipAndRetry(finalBuild.output);
        // Mark reverted PRs and adjust counts
        for (const rn of finalReverted) {
          const entry = entries.find((e) => e.number === rn && e.result.status === "merged");
          if (entry) { entry.result = { status: "reverted" as any, conflictFiles: [] }; mergedCount--; }
        }
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

  // Recompute after build may have reverted PRs
  mergedEntries = entries.filter((e) => e.result.status === "merged");

  // ── Changelog ─────────────────────────────────────────────────────────────
  // Only append entries not already written by interval changelogs.
  if (!DRY_RUN && mergedCount > 0) {
    const finalMergedEntries = mergedEntries.slice(lastChangelogIndex);
    if (finalMergedEntries.length > 0) {
      appendChangelog({
        runDate,
        baseCommit,
        headCommit,
        baseBranch,
        mergedEntries: finalMergedEntries,
        durationMs,
        buildPassed,
      });
    }
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
