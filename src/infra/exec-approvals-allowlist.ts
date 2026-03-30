import path from "node:path";
import { isDispatchWrapperExecutable } from "./dispatch-wrapper-resolution.js";
import {
  analyzeShellCommand,
  isWindowsPlatform,
  matchAllowlist,
  resolveExecutionTargetCandidatePath,
  resolveExecutionTargetResolution,
  resolveCommandResolutionFromArgv,
  resolvePolicyTargetCandidatePath,
  resolvePolicyTargetResolution,
  splitCommandChain,
  type ExecCommandAnalysis,
  type ExecCommandSegment,
  type ExecutableResolution,
} from "./exec-approvals-analysis.js";
import type { ExecAllowlistEntry } from "./exec-approvals.js";
import {
  DEFAULT_SAFE_BINS,
  SAFE_BIN_PROFILES,
  type SafeBinProfile,
  validateSafeBinArgv,
} from "./exec-safe-bin-policy.js";
import { isTrustedSafeBinPath } from "./exec-safe-bin-trust.js";
import {
  extractShellWrapperInlineCommand,
  isShellWrapperExecutable,
  normalizeExecutableToken,
  POWERSHELL_WRAPPERS,
} from "./exec-wrapper-resolution.js";
import { resolveExecWrapperTrustPlan } from "./exec-wrapper-trust-plan.js";
import { expandHomePrefix } from "./home-dir.js";
import { POSIX_INLINE_COMMAND_FLAGS, resolveInlineCommandMatch } from "./shell-inline-command.js";

function hasShellLineContinuation(command: string): boolean {
  return /\\(?:\r\n|\n|\r)/.test(command);
}

export function normalizeSafeBins(entries?: readonly string[]): Set<string> {
  if (!Array.isArray(entries)) {
    return new Set();
  }
  const normalized = entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(normalized);
}

export function resolveSafeBins(entries?: readonly string[] | null): Set<string> {
  if (entries === undefined) {
    return normalizeSafeBins(DEFAULT_SAFE_BINS);
  }
  return normalizeSafeBins(entries ?? []);
}

export function isSafeBinUsage(params: {
  argv: string[];
  resolution: ExecutableResolution | null;
  safeBins: Set<string>;
  platform?: string | null;
  trustedSafeBinDirs?: ReadonlySet<string>;
  safeBinProfiles?: Readonly<Record<string, SafeBinProfile>>;
  isTrustedSafeBinPathFn?: typeof isTrustedSafeBinPath;
}): boolean {
  // Windows host exec uses PowerShell, which has different parsing/expansion rules.
  // Keep safeBins conservative there (require explicit allowlist entries).
  if (isWindowsPlatform(params.platform ?? process.platform)) {
    return false;
  }
  if (params.safeBins.size === 0) {
    return false;
  }
  const resolution = params.resolution;
  const execName = resolution?.executableName?.toLowerCase();
  if (!execName) {
    return false;
  }
  const matchesSafeBin = params.safeBins.has(execName);
  if (!matchesSafeBin) {
    return false;
  }
  if (!resolution?.resolvedPath) {
    return false;
  }
  const isTrustedPath = params.isTrustedSafeBinPathFn ?? isTrustedSafeBinPath;
  if (
    !isTrustedPath({
      resolvedPath: resolution.resolvedPath,
      trustedDirs: params.trustedSafeBinDirs,
    })
  ) {
    return false;
  }
  const argv = params.argv.slice(1);
  const safeBinProfiles = params.safeBinProfiles ?? SAFE_BIN_PROFILES;
  const profile = safeBinProfiles[execName];
  if (!profile) {
    return false;
  }
  return validateSafeBinArgv(argv, profile, { binName: execName });
}

function isPathScopedExecutableToken(token: string): boolean {
  return token.includes("/") || token.includes("\\");
}

export type ExecAllowlistEvaluation = {
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
  segmentSatisfiedBy: ExecSegmentSatisfiedBy[];
};

export type ExecSegmentSatisfiedBy = "allowlist" | "safeBins" | "skills" | null;
export type SkillBinTrustEntry = {
  name: string;
  resolvedPath: string;
};
type ExecAllowlistContext = {
  allowlist: ExecAllowlistEntry[];
  safeBins: Set<string>;
  safeBinProfiles?: Readonly<Record<string, SafeBinProfile>>;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  trustedSafeBinDirs?: ReadonlySet<string>;
  skillBins?: readonly SkillBinTrustEntry[];
  autoAllowSkills?: boolean;
};

function pickExecAllowlistContext(params: ExecAllowlistContext): ExecAllowlistContext {
  return {
    allowlist: params.allowlist,
    safeBins: params.safeBins,
    safeBinProfiles: params.safeBinProfiles,
    cwd: params.cwd,
    env: params.env,
    platform: params.platform,
    trustedSafeBinDirs: params.trustedSafeBinDirs,
    skillBins: params.skillBins,
    autoAllowSkills: params.autoAllowSkills,
  };
}

function normalizeSkillBinName(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeSkillBinResolvedPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = path.resolve(trimmed);
  if (process.platform === "win32") {
    return resolved.replace(/\\/g, "/").toLowerCase();
  }
  return resolved;
}

function buildSkillBinTrustIndex(
  entries: readonly SkillBinTrustEntry[] | undefined,
): Map<string, Set<string>> {
  const trustByName = new Map<string, Set<string>>();
  if (!entries || entries.length === 0) {
    return trustByName;
  }
  for (const entry of entries) {
    const name = normalizeSkillBinName(entry.name);
    const resolvedPath = normalizeSkillBinResolvedPath(entry.resolvedPath);
    if (!name || !resolvedPath) {
      continue;
    }
    const paths = trustByName.get(name) ?? new Set<string>();
    paths.add(resolvedPath);
    trustByName.set(name, paths);
  }
  return trustByName;
}

function isSkillAutoAllowedSegment(params: {
  segment: ExecCommandSegment;
  allowSkills: boolean;
  skillBinTrust: ReadonlyMap<string, ReadonlySet<string>>;
}): boolean {
  if (!params.allowSkills) {
    return false;
  }
  const resolution = params.segment.resolution;
  const execution = resolveExecutionTargetResolution(resolution);
  if (!execution?.resolvedPath) {
    return false;
  }
  const rawExecutable = execution.rawExecutable?.trim() ?? "";
  if (!rawExecutable || isPathScopedExecutableToken(rawExecutable)) {
    return false;
  }
  const executableName = normalizeSkillBinName(execution.executableName);
  const resolvedPath = normalizeSkillBinResolvedPath(execution.resolvedPath);
  if (!executableName || !resolvedPath) {
    return false;
  }
  return Boolean(params.skillBinTrust.get(executableName)?.has(resolvedPath));
}

function evaluateSegments(
  segments: ExecCommandSegment[],
  params: ExecAllowlistContext,
): {
  satisfied: boolean;
  matches: ExecAllowlistEntry[];
  segmentSatisfiedBy: ExecSegmentSatisfiedBy[];
} {
  const matches: ExecAllowlistEntry[] = [];
  const skillBinTrust = buildSkillBinTrustIndex(params.skillBins);
  const allowSkills = params.autoAllowSkills === true && skillBinTrust.size > 0;
  const segmentSatisfiedBy: ExecSegmentSatisfiedBy[] = [];

  const satisfied = segments.every((segment) => {
    if (segment.resolution?.policyBlocked === true) {
      segmentSatisfiedBy.push(null);
      return false;
    }
    const effectiveArgv =
      segment.resolution?.effectiveArgv && segment.resolution.effectiveArgv.length > 0
        ? segment.resolution.effectiveArgv
        : segment.argv;
    const allowlistSegment =
      effectiveArgv === segment.argv ? segment : { ...segment, argv: effectiveArgv };
    const executableResolution = resolvePolicyTargetResolution(segment.resolution);
    const candidatePath = resolvePolicyTargetCandidatePath(segment.resolution, params.cwd);
    const candidateResolution =
      candidatePath && executableResolution
        ? { ...executableResolution, resolvedPath: candidatePath }
        : executableResolution;
    const executableMatch = matchAllowlist(
      params.allowlist,
      candidateResolution,
      effectiveArgv,
      params.platform,
    );
    const inlineCommand = extractShellWrapperInlineCommand(allowlistSegment.argv);
    const shellPositionalArgvCandidatePath = resolveShellWrapperPositionalArgvCandidatePath({
      segment: allowlistSegment,
      cwd: params.cwd,
      env: params.env,
    });
    const shellPositionalArgvMatch = shellPositionalArgvCandidatePath
      ? matchAllowlist(
          params.allowlist,
          {
            rawExecutable: shellPositionalArgvCandidatePath,
            resolvedPath: shellPositionalArgvCandidatePath,
            executableName: path.basename(shellPositionalArgvCandidatePath),
          },
          undefined,
          params.platform,
        )
      : null;
    const shellScriptCandidatePath =
      inlineCommand === null
        ? resolveShellWrapperScriptCandidatePath({
            segment: allowlistSegment,
            cwd: params.cwd,
          })
        : undefined;
    // For script-wrapper cases the saved argPattern encodes only the arguments
    // after the script path token (see buildScriptArgPatternFromArgv).  Build a
    // synthetic argv whose [0] is the script and whose [1..] are the script args
    // so that matchArgPattern compares against the right portion of argv.
    const shellScriptArgv = shellScriptCandidatePath
      ? (() => {
          const scriptBase = path.basename(shellScriptCandidatePath).toLowerCase();
          const cwdBase = params.cwd && params.cwd.trim() ? params.cwd.trim() : process.cwd();
          const resolveArgPath = (a: string): string =>
            path.isAbsolute(a) ? a : path.resolve(cwdBase, a);
          // Prefer exact path match (normalizing relative tokens) to avoid
          // shadowing by earlier args with the same basename.
          let idx = effectiveArgv.findIndex((a) => resolveArgPath(a) === shellScriptCandidatePath);
          if (idx === -1) {
            idx = effectiveArgv.findIndex((a) => path.basename(a).toLowerCase() === scriptBase);
          }
          const scriptArgs = idx !== -1 ? effectiveArgv.slice(idx + 1) : [];
          return [shellScriptCandidatePath, ...scriptArgs];
        })()
      : null;
    const shellScriptMatch =
      shellScriptCandidatePath && shellScriptArgv
        ? matchAllowlist(
            params.allowlist,
            {
              rawExecutable: shellScriptCandidatePath,
              resolvedPath: shellScriptCandidatePath,
              executableName: path.basename(shellScriptCandidatePath),
            },
            shellScriptArgv,
            params.platform,
          )
        : null;
    const match = executableMatch ?? shellPositionalArgvMatch ?? shellScriptMatch;
    if (match) {
      matches.push(match);
    }
    const safe = isSafeBinUsage({
      argv: effectiveArgv,
      resolution: resolveExecutionTargetResolution(segment.resolution),
      safeBins: params.safeBins,
      safeBinProfiles: params.safeBinProfiles,
      platform: params.platform,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
    });
    const skillAllow = isSkillAutoAllowedSegment({
      segment,
      allowSkills,
      skillBinTrust,
    });
    const by: ExecSegmentSatisfiedBy = match
      ? "allowlist"
      : safe
        ? "safeBins"
        : skillAllow
          ? "skills"
          : null;
    segmentSatisfiedBy.push(by);
    return Boolean(by);
  });

  return { satisfied, matches, segmentSatisfiedBy };
}

function resolveAnalysisSegmentGroups(analysis: ExecCommandAnalysis): ExecCommandSegment[][] {
  if (analysis.chains) {
    return analysis.chains;
  }
  return [analysis.segments];
}

export function evaluateExecAllowlist(
  params: {
    analysis: ExecCommandAnalysis;
  } & ExecAllowlistContext,
): ExecAllowlistEvaluation {
  const allowlistMatches: ExecAllowlistEntry[] = [];
  const segmentSatisfiedBy: ExecSegmentSatisfiedBy[] = [];
  if (!params.analysis.ok || params.analysis.segments.length === 0) {
    return { allowlistSatisfied: false, allowlistMatches, segmentSatisfiedBy };
  }

  const allowlistContext = pickExecAllowlistContext(params);
  const hasChains = Boolean(params.analysis.chains);
  for (const group of resolveAnalysisSegmentGroups(params.analysis)) {
    const result = evaluateSegments(group, allowlistContext);
    if (!result.satisfied) {
      if (!hasChains) {
        return {
          allowlistSatisfied: false,
          allowlistMatches: result.matches,
          segmentSatisfiedBy: result.segmentSatisfiedBy,
        };
      }
      return { allowlistSatisfied: false, allowlistMatches: [], segmentSatisfiedBy: [] };
    }
    allowlistMatches.push(...result.matches);
    segmentSatisfiedBy.push(...result.segmentSatisfiedBy);
  }
  return { allowlistSatisfied: true, allowlistMatches, segmentSatisfiedBy };
}

export type ExecAllowlistAnalysis = {
  analysisOk: boolean;
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
  segments: ExecCommandSegment[];
  segmentSatisfiedBy: ExecSegmentSatisfiedBy[];
};

function hasSegmentExecutableMatch(
  segment: ExecCommandSegment,
  predicate: (token: string) => boolean,
): boolean {
  const execution = resolveExecutionTargetResolution(segment.resolution);
  const candidates = [execution?.executableName, execution?.rawExecutable, segment.argv[0]];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    if (predicate(trimmed)) {
      return true;
    }
  }
  return false;
}

function isShellWrapperSegment(segment: ExecCommandSegment): boolean {
  return hasSegmentExecutableMatch(segment, isShellWrapperExecutable);
}

const SHELL_WRAPPER_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "--command",
  "-o",
  "-O",
  "+O",
  "--rcfile",
  "--init-file",
  "--startup-file",
]);

// PowerShell flags (other than -File and -Command, which are handled explicitly above)
// that consume one positional value.  PowerShell supports prefix abbreviations, so we
// list the full names and common short forms.  Case-insensitive match.
const POWERSHELL_OPTIONS_WITH_VALUE_RE =
  /^-(?:executionpolicy|ep|windowstyle|w|workingdirectory|wd|inputformat|outputformat|settingsfile|configurationfile|version|v|psconsolefile|pscf|encodedcommand|en|enc|encodedarguments|ea)$/i;

function resolveShellWrapperScriptCandidatePath(params: {
  segment: ExecCommandSegment;
  cwd?: string;
}): string | undefined {
  if (!isShellWrapperSegment(params.segment)) {
    return undefined;
  }

  const argv = params.segment.argv;
  if (!Array.isArray(argv) || argv.length < 2) {
    return undefined;
  }

  const wrapperName = normalizeExecutableToken(argv[0] ?? "");
  const isPowerShell = POWERSHELL_WRAPPERS.has(wrapperName);

  let idx = 1;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (token === "--") {
      idx += 1;
      break;
    }
    if (token === "-c" || token === "--command") {
      return undefined;
    }
    // Combined short-flag checks (e.g. -lc, -ic) only apply to POSIX shells.
    // PowerShell uses full-word flags and never combines them; applying the
    // regex to PowerShell flags like -ExecutionPolicy or -SettingsFile would
    // incorrectly match because those words contain the letter 'c' or 's'.
    if (!isPowerShell && /^-[^-]*c[^-]*$/i.test(token)) {
      return undefined;
    }
    if (token === "-s" || (!isPowerShell && /^-[^-]*s[^-]*$/i.test(token))) {
      return undefined;
    }
    if (SHELL_WRAPPER_OPTIONS_WITH_VALUE.has(token)) {
      idx += 2;
      continue;
    }
    // PowerShell value-taking flags (e.g. -ExecutionPolicy Bypass) must skip both
    // the flag and its argument so the script token is identified correctly.
    if (isPowerShell && POWERSHELL_OPTIONS_WITH_VALUE_RE.test(token)) {
      idx += 2;
      continue;
    }
    if (token.startsWith("-") || token.startsWith("+")) {
      idx += 1;
      continue;
    }
    break;
  }

  const scriptToken = argv[idx]?.trim();
  if (!scriptToken) {
    return undefined;
  }
  if (path.isAbsolute(scriptToken)) {
    return scriptToken;
  }

  const expanded = scriptToken.startsWith("~") ? expandHomePrefix(scriptToken) : scriptToken;
  const base = params.cwd && params.cwd.trim().length > 0 ? params.cwd : process.cwd();
  return path.resolve(base, expanded);
}

function resolveShellWrapperPositionalArgvCandidatePath(params: {
  segment: ExecCommandSegment;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  if (!isShellWrapperSegment(params.segment)) {
    return undefined;
  }

  const argv = params.segment.argv;
  if (!Array.isArray(argv) || argv.length < 4) {
    return undefined;
  }

  const wrapper = normalizeExecutableToken(argv[0] ?? "");
  if (!["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"].includes(wrapper)) {
    return undefined;
  }

  const inlineMatch = resolveInlineCommandMatch(argv, POSIX_INLINE_COMMAND_FLAGS, {
    allowCombinedC: true,
  });
  if (inlineMatch.valueTokenIndex === null || !inlineMatch.command) {
    return undefined;
  }
  if (!isDirectShellPositionalCarrierInvocation(inlineMatch.command)) {
    return undefined;
  }

  const carriedExecutable = argv
    .slice(inlineMatch.valueTokenIndex + 1)
    .map((token) => token.trim())
    .find((token) => token.length > 0);
  if (!carriedExecutable) {
    return undefined;
  }

  // Reject wrapper targets carried through `$0 "$@"` because their trailing argv can
  // widen execution semantics beyond the original approved command.
  const carriedName = normalizeExecutableToken(carriedExecutable);
  if (isDispatchWrapperExecutable(carriedName) || isShellWrapperExecutable(carriedName)) {
    return undefined;
  }

  const resolution = resolveCommandResolutionFromArgv([carriedExecutable], params.cwd, params.env);
  return resolveExecutionTargetCandidatePath(resolution, params.cwd);
}

function isDirectShellPositionalCarrierInvocation(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Keep carrier matching strict: only allow direct `$0` execution with positional arguments.
  // This prevents payloads like `echo blocked; $0 "$1"` from satisfying allowlist checks.
  const shellWhitespace = String.raw`[^\S\r\n]+`;
  const positionalZero = String.raw`(?:\$(?:0|\{0\})|"\$(?:0|\{0\})")`;
  const positionalArg = String.raw`(?:\$(?:[@*]|[1-9]|\{[@*1-9]\})|"\$(?:[@*]|[1-9]|\{[@*1-9]\})")`;
  return new RegExp(
    `^(?:exec${shellWhitespace}(?:--${shellWhitespace})?)?${positionalZero}(?:${shellWhitespace}${positionalArg})*$`,
    "u",
  ).test(trimmed);
}

export type AllowAlwaysPattern = {
  pattern: string;
  argPattern?: string;
};

function escapeRegExpLiteral(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build an argPattern for a shell-wrapper script invocation.
 * Only the arguments *after* the script token are encoded so that the pattern
 * is independent of wrapper spelling (e.g. `pwsh -File script.ps1 foo` and
 * `C:\full\script.ps1 foo` both produce the same argPattern `^foo$`).
 */
function buildScriptArgPatternFromArgv(
  argv: string[],
  scriptPath: string,
  cwd?: string,
): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const scriptBase = path.basename(scriptPath).toLowerCase();
  const base = cwd && cwd.trim() ? cwd.trim() : process.cwd();
  // Prefer exact path match so that an earlier arg sharing the same basename
  // (e.g. -SettingsFile C:\tmp\deploy.ps1 before -File C:\scripts\deploy.ps1)
  // does not shadow the actual script token.  Normalize relative argv tokens to
  // absolute paths (using cwd) before comparing so that -File .\scripts\deploy.ps1
  // is correctly identified when scriptPath is already absolute.
  const resolveArgPath = (arg: string): string =>
    path.isAbsolute(arg) ? arg : path.resolve(base, arg);
  let scriptIdx = argv.findIndex((arg) => resolveArgPath(arg) === scriptPath);
  if (scriptIdx === -1) {
    scriptIdx = argv.findIndex((arg) => path.basename(arg).toLowerCase() === scriptBase);
  }
  const scriptArgs = scriptIdx !== -1 ? argv.slice(scriptIdx + 1) : [];
  // Always append a trailing \x00 sentinel so that matchArgPattern can detect
  // auto-generated patterns by .includes("\x00") even when there is only one arg
  // (or zero). Without the sentinel, a single-arg pattern like ^hello world$ would
  // be misidentified as a legacy space-joined pattern and allow a split-arg bypass.
  const normalized = scriptArgs.map((a) => a.replace(/\//g, "\\"));
  // Mirror the zero-args double-sentinel from buildArgPatternFromArgv so that
  // a script invocation with no trailing args (scriptArgs = []) is distinct from
  // one that passes a single explicit empty-string arg (scriptArgs = [""]).
  if (normalized.length === 0) {
    return "^\x00\x00$";
  }
  return `^${normalized.map(escapeRegExpLiteral).join("\x00")}\x00$`;
}

function buildArgPatternFromArgv(argv: string[]): string | undefined {
  // argPattern is currently Windows-only.  On other platforms, allow-always
  // creates path-only entries (the pre-existing behaviour).
  if (process.platform !== "win32") {
    return undefined;
  }
  const args = argv.slice(1);
  // Use \x00 as the argument separator so that argv boundaries are preserved.
  // Space-joined strings cannot distinguish `["a b"]` from `["a", "b"]`;
  // the null byte cannot appear in shell arguments and makes boundaries unambiguous.
  // A trailing \x00 sentinel is always appended so that matchArgPattern can detect
  // auto-generated patterns by .includes("\x00") regardless of argument count —
  // including the zero-arg and single-arg cases where the body contains no separator.
  //
  // Zero args use a double sentinel "^\x00\x00$" to distinguish [] from [""].
  // Both would otherwise join to "" and produce the identical "^\x00$", allowing
  // a zero-arg allow-always entry to incorrectly match a command that passes an
  // explicit empty-string argument.  matchArgPattern mirrors this: zero-arg argv
  // emits "\x00\x00" while one-empty-arg argv emits "\x00".
  const normalized = args.map((a) => a.replace(/\//g, "\\"));
  if (normalized.length === 0) {
    return "^\x00\x00$";
  }
  const joined = normalized.join("\x00");
  return `^${escapeRegExpLiteral(joined)}\x00$`;
}

function addAllowAlwaysPattern(
  out: AllowAlwaysPattern[],
  pattern: string,
  argPattern?: string,
): void {
  const exists = out.some(
    (p) => p.pattern === pattern && (p.argPattern ?? undefined) === (argPattern ?? undefined),
  );
  if (!exists) {
    out.push({ pattern, argPattern });
  }
}

function collectAllowAlwaysPatterns(params: {
  segment: ExecCommandSegment;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  depth: number;
  out: AllowAlwaysPattern[];
}) {
  if (params.depth >= 3) {
    return;
  }

  const trustPlan = resolveExecWrapperTrustPlan(params.segment.argv);
  if (trustPlan.policyBlocked) {
    return;
  }
  const segment =
    trustPlan.argv === params.segment.argv
      ? params.segment
      : {
          raw: trustPlan.argv.join(" "),
          argv: trustPlan.argv,
          resolution: resolveCommandResolutionFromArgv(trustPlan.argv, params.cwd, params.env),
        };

  const candidatePath = resolveExecutionTargetCandidatePath(segment.resolution, params.cwd);
  if (!candidatePath) {
    return;
  }
  if (!trustPlan.shellWrapperExecutable) {
    // Use the unwrapped argv (segment.argv) so that dispatch-wrapper tokens
    // (e.g. "env FOO=1") are not baked into the argPattern.
    const argPattern = buildArgPatternFromArgv(segment.argv);
    addAllowAlwaysPattern(params.out, candidatePath, argPattern);
    return;
  }
  const positionalArgvPath = resolveShellWrapperPositionalArgvCandidatePath({
    segment,
    cwd: params.cwd,
    env: params.env,
  });
  if (positionalArgvPath) {
    addAllowAlwaysPattern(params.out, positionalArgvPath);
    return;
  }
  // For PowerShell -File invocations, POWERSHELL_INLINE_COMMAND_FLAGS includes "-file"
  // so extractShellWrapperInlineCommand returns the script path as the "inline command".
  // Treating it as an inline shell command loses the script's trailing arguments.
  // Detect this case and fall through to resolveShellWrapperScriptCandidatePath instead,
  // which correctly slices out the script args for argPattern building.
  const isPowerShellFileInvocation =
    POWERSHELL_WRAPPERS.has(normalizeExecutableToken(segment.argv[0] ?? "")) &&
    segment.argv.some((t) => {
      const lower = t.trim().toLowerCase();
      return lower === "-file" || lower === "-f";
    }) &&
    !segment.argv.some((t) => {
      const lower = t.trim().toLowerCase();
      return lower === "-command" || lower === "-c" || lower === "--command";
    });
  const inlineCommand = isPowerShellFileInvocation
    ? null
    : (trustPlan.shellInlineCommand ?? extractShellWrapperInlineCommand(segment.argv));
  if (!inlineCommand) {
    const scriptPath = resolveShellWrapperScriptCandidatePath({
      segment,
      cwd: params.cwd,
    });
    if (scriptPath) {
      // Use script-specific helper so the argPattern encodes only the arguments
      // passed to the script itself, not the wrapper tokens (e.g. -File, pwsh).
      const argPattern = buildScriptArgPatternFromArgv(params.segment.argv, scriptPath, params.cwd);
      addAllowAlwaysPattern(params.out, scriptPath, argPattern);
    }
    return;
  }
  const nested = analyzeShellCommand({
    command: inlineCommand,
    cwd: params.cwd,
    env: params.env,
    platform: params.platform,
  });
  if (!nested.ok) {
    return;
  }
  for (const nestedSegment of nested.segments) {
    collectAllowAlwaysPatterns({
      segment: nestedSegment,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: params.depth + 1,
      out: params.out,
    });
  }
}

/**
 * Derive persisted allowlist patterns for an "allow always" decision.
 * When a command is wrapped in a shell (for example `zsh -lc "<cmd>"`),
 * persist the inner executable(s) rather than the shell binary.
 */
export function resolveAllowAlwaysPatterns(params: {
  segments: ExecCommandSegment[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
}): AllowAlwaysPattern[] {
  const patterns: AllowAlwaysPattern[] = [];
  for (const segment of params.segments) {
    collectAllowAlwaysPatterns({
      segment,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: 0,
      out: patterns,
    });
  }
  return patterns;
}

/**
 * Evaluates allowlist for shell commands (including &&, ||, ;) and returns analysis metadata.
 */
export function evaluateShellAllowlist(
  params: {
    command: string;
    env?: NodeJS.ProcessEnv;
  } & ExecAllowlistContext,
): ExecAllowlistAnalysis {
  const allowlistContext = pickExecAllowlistContext(params);
  const analysisFailure = (): ExecAllowlistAnalysis => ({
    analysisOk: false,
    allowlistSatisfied: false,
    allowlistMatches: [],
    segments: [],
    segmentSatisfiedBy: [],
  });

  // Keep allowlist analysis conservative: line-continuation semantics are shell-dependent
  // and can rewrite token boundaries at runtime.
  if (hasShellLineContinuation(params.command)) {
    return analysisFailure();
  }

  const chainParts = isWindowsPlatform(params.platform) ? null : splitCommandChain(params.command);
  if (!chainParts) {
    const analysis = analyzeShellCommand({
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
      return analysisFailure();
    }
    const evaluation = evaluateExecAllowlist({ analysis, ...allowlistContext });
    return {
      analysisOk: true,
      allowlistSatisfied: evaluation.allowlistSatisfied,
      allowlistMatches: evaluation.allowlistMatches,
      segments: analysis.segments,
      segmentSatisfiedBy: evaluation.segmentSatisfiedBy,
    };
  }

  const allowlistMatches: ExecAllowlistEntry[] = [];
  const segments: ExecCommandSegment[] = [];
  const segmentSatisfiedBy: ExecSegmentSatisfiedBy[] = [];

  for (const part of chainParts) {
    const analysis = analyzeShellCommand({
      command: part,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
      return analysisFailure();
    }

    segments.push(...analysis.segments);
    const evaluation = evaluateExecAllowlist({ analysis, ...allowlistContext });
    allowlistMatches.push(...evaluation.allowlistMatches);
    segmentSatisfiedBy.push(...evaluation.segmentSatisfiedBy);
    if (!evaluation.allowlistSatisfied) {
      return {
        analysisOk: true,
        allowlistSatisfied: false,
        allowlistMatches,
        segments,
        segmentSatisfiedBy,
      };
    }
  }

  return {
    analysisOk: true,
    allowlistSatisfied: true,
    allowlistMatches,
    segments,
    segmentSatisfiedBy,
  };
}
