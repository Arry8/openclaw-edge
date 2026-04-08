import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import type { SsrFPolicy } from "../infra/net/ssrf.js";
import { ensurePortAvailable } from "../infra/ports.js";
import { rawDataToString } from "../infra/ws.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { CONFIG_DIR } from "../utils.js";
import {
  CHROME_BOOTSTRAP_EXIT_TIMEOUT_MS,
  CHROME_BOOTSTRAP_PREFS_TIMEOUT_MS,
  CHROME_LAUNCH_READY_POLL_MS,
  CHROME_LAUNCH_READY_WINDOW_MS,
  CHROME_REACHABILITY_TIMEOUT_MS,
  CHROME_STDERR_HINT_MAX_CHARS,
  CHROME_STOP_PROBE_TIMEOUT_MS,
  CHROME_STOP_TIMEOUT_MS,
  CHROME_WS_READY_TIMEOUT_MS,
} from "./cdp-timeouts.js";
import {
  appendCdpPath,
  assertCdpEndpointAllowed,
  fetchCdpChecked,
  isWebSocketUrl,
  openCdpWebSocket,
} from "./cdp.helpers.js";
import { normalizeCdpWsUrl } from "./cdp.js";
import {
  type BrowserExecutable,
  resolveBrowserExecutableForPlatform,
} from "./chrome.executables.js";
import {
  decorateOpenClawProfile,
  ensureProfileCleanExit,
  isProfileDecorated,
} from "./chrome.profile-decoration.js";
import type { ResolvedBrowserConfig, ResolvedBrowserProfile } from "./config.js";
import {
  DEFAULT_OPENCLAW_BROWSER_COLOR,
  DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME,
} from "./constants.js";

const log = createSubsystemLogger("browser").child("chrome");
const CHROME_SINGLETON_LOCK_PATHS = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
] as const;
const CHROME_SINGLETON_IN_USE_PATTERN = /profile appears to be in use by another chromium process/i;
const CHROME_MISSING_DISPLAY_PATTERN = /missing x server|\$DISPLAY/i;

export type { BrowserExecutable } from "./chrome.executables.js";
export {
  findChromeExecutableLinux,
  findChromeExecutableMac,
  findChromeExecutableWindows,
  resolveBrowserExecutableForPlatform,
} from "./chrome.executables.js";
export {
  decorateOpenClawProfile,
  ensureProfileCleanExit,
  isProfileDecorated,
} from "./chrome.profile-decoration.js";

function exists(filePath: string) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearChromeSingletonArtifacts(userDataDir: string) {
  for (const basename of CHROME_SINGLETON_LOCK_PATHS) {
    try {
      fs.rmSync(path.join(userDataDir, basename), { force: true });
    } catch {
      // ignore best-effort cleanup
    }
  }
}

export function clearStaleChromeSingletonLocks(
  userDataDir: string,
  hostname = os.hostname(),
): boolean {
  const lockPath = path.join(userDataDir, "SingletonLock");
  let target: string | null = null;
  try {
    target = fs.readlinkSync(lockPath);
  } catch {
    return false;
  }

  const match = /^(?<lockHost>.+)-(?<pid>\d+)$/.exec(target);
  if (!match?.groups) {
    return false;
  }

  const lockHost = normalizeOptionalString(match.groups.lockHost) ?? "";
  const pid = Number.parseInt(match.groups.pid ?? "", 10);
  if (lockHost === hostname && processExists(pid)) {
    return false;
  }

  clearChromeSingletonArtifacts(userDataDir);
  return true;
}

function chromeLaunchHints(params: {
  stderrOutput: string;
  resolved: ResolvedBrowserConfig;
  profileName: string;
}): string {
  const hints: string[] = [];
  if (process.platform === "linux" && !params.resolved.noSandbox) {
    hints.push("If running in a container or as root, try setting browser.noSandbox: true.");
  }
  if (CHROME_MISSING_DISPLAY_PATTERN.test(params.stderrOutput) && !params.resolved.headless) {
    hints.push(
      "No DISPLAY/X server was detected. Enable browser.headless: true, start Xvfb, or run the Gateway in a desktop session.",
    );
  }
  if (CHROME_SINGLETON_IN_USE_PATTERN.test(params.stderrOutput)) {
    hints.push(
      `The Chromium profile "${params.profileName}" is locked. Stop the existing browser or remove stale Singleton* lock files under ~/.openclaw/browser/${params.profileName}/user-data.`,
    );
  }
  return hints.length > 0 ? `\nHint: ${hints.join("\nHint: ")}` : "";
}

export type RunningChrome = {
  pid: number;
  exe: BrowserExecutable;
  userDataDir: string;
  cdpPort: number;
  startedAt: number;
  proc: ChildProcess;
};

function resolveBrowserExecutable(resolved: ResolvedBrowserConfig): BrowserExecutable | null {
  return resolveBrowserExecutableForPlatform(resolved, process.platform);
}

export function resolveOpenClawUserDataDir(profileName = DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME) {
  return path.join(CONFIG_DIR, "browser", profileName, "user-data");
}

function cdpUrlForPort(cdpPort: number) {
  return `http://127.0.0.1:${cdpPort}`;
}

export function buildOpenClawChromeLaunchArgs(params: {
  resolved: ResolvedBrowserConfig;
  profile: ResolvedBrowserProfile;
  userDataDir: string;
}): string[] {
  const { resolved, profile, userDataDir } = params;
  const args: string[] = [
    `--remote-debugging-port=${profile.cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--password-store=basic",
  ];

  if (resolved.headless) {
    args.push("--headless=new");
    args.push("--disable-gpu");
  }
  if (resolved.noSandbox) {
    args.push("--no-sandbox");
    args.push("--disable-setuid-sandbox");
  }
  if (process.platform === "linux") {
    args.push("--disable-dev-shm-usage");
  }
  if (resolved.extraArgs.length > 0) {
    args.push(...resolved.extraArgs);
  }

  return args;
}

async function canOpenWebSocket(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const ws = openCdpWebSocket(url, { handshakeTimeoutMs: timeoutMs });
    ws.once("open", () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(true);
    });
    ws.once("error", () => resolve(false));
  });
}

export async function isChromeReachable(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
  ssrfPolicy?: SsrFPolicy,
): Promise<boolean> {
  try {
    await assertCdpEndpointAllowed(cdpUrl, ssrfPolicy);
    if (isWebSocketUrl(cdpUrl)) {
      // Direct WebSocket endpoint — probe via WS handshake.
      return await canOpenWebSocket(cdpUrl, timeoutMs);
    }
    const version = await fetchChromeVersion(cdpUrl, timeoutMs, ssrfPolicy);
    return Boolean(version);
  } catch {
    return false;
  }
}

type ChromeVersion = {
  webSocketDebuggerUrl?: string;
  Browser?: string;
  "User-Agent"?: string;
};

async function fetchChromeVersion(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
  ssrfPolicy?: SsrFPolicy,
): Promise<ChromeVersion | null> {
  const ctrl = new AbortController();
  const t = setTimeout(ctrl.abort.bind(ctrl), timeoutMs);
  try {
    await assertCdpEndpointAllowed(cdpUrl, ssrfPolicy);
    const versionUrl = appendCdpPath(cdpUrl, "/json/version");
    const res = await fetchCdpChecked(versionUrl, timeoutMs, { signal: ctrl.signal });
    const data = (await res.json()) as ChromeVersion;
    if (!data || typeof data !== "object") {
      return null;
    }
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function getChromeWebSocketUrl(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
  ssrfPolicy?: SsrFPolicy,
): Promise<string | null> {
  await assertCdpEndpointAllowed(cdpUrl, ssrfPolicy);
  if (isWebSocketUrl(cdpUrl)) {
    // Direct WebSocket endpoint — the cdpUrl is already the WebSocket URL.
    return cdpUrl;
  }
  const version = await fetchChromeVersion(cdpUrl, timeoutMs, ssrfPolicy);
  const wsUrl = normalizeOptionalString(version?.webSocketDebuggerUrl) ?? "";
  if (!wsUrl) {
    return null;
  }
  const normalizedWsUrl = normalizeCdpWsUrl(wsUrl, cdpUrl);
  await assertCdpEndpointAllowed(normalizedWsUrl, ssrfPolicy);
  return normalizedWsUrl;
}

async function canRunCdpHealthCommand(
  wsUrl: string,
  timeoutMs = CHROME_WS_READY_TIMEOUT_MS,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const ws = openCdpWebSocket(wsUrl, {
      handshakeTimeoutMs: timeoutMs,
    });
    let settled = false;
    const onMessage = (raw: Parameters<typeof rawDataToString>[0]) => {
      if (settled) {
        return;
      }
      let parsed: { id?: unknown; result?: unknown } | null = null;
      try {
        parsed = JSON.parse(rawDataToString(raw)) as { id?: unknown; result?: unknown };
      } catch {
        return;
      }
      if (parsed?.id !== 1) {
        return;
      }
      finish(Boolean(parsed.result && typeof parsed.result === "object"));
    };

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      ws.off("message", onMessage);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(value);
    };
    const timer = setTimeout(
      () => {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        finish(false);
      },
      Math.max(50, timeoutMs + 25),
    );

    ws.once("open", () => {
      try {
        ws.send(
          JSON.stringify({
            id: 1,
            method: "Browser.getVersion",
          }),
        );
      } catch {
        finish(false);
      }
    });

    ws.on("message", onMessage);

    ws.once("error", () => {
      finish(false);
    });
    ws.once("close", () => {
      finish(false);
    });
  });
}

export async function isChromeCdpReady(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
  handshakeTimeoutMs = CHROME_WS_READY_TIMEOUT_MS,
  ssrfPolicy?: SsrFPolicy,
): Promise<boolean> {
  const wsUrl = await getChromeWebSocketUrl(cdpUrl, timeoutMs, ssrfPolicy).catch(() => null);
  if (!wsUrl) {
    return false;
  }
  return await canRunCdpHealthCommand(wsUrl, handshakeTimeoutMs);
}

export async function launchOpenClawChrome(
  resolved: ResolvedBrowserConfig,
  profile: ResolvedBrowserProfile,
): Promise<RunningChrome> {
  if (!profile.cdpIsLoopback) {
    throw new Error(`Profile "${profile.name}" is remote; cannot launch local Chrome.`);
  }
  await ensurePortAvailable(profile.cdpPort);

  const exe = resolveBrowserExecutable(resolved);
  if (!exe) {
    throw new Error(
      "No supported browser found (Chrome/Brave/Edge/Chromium on macOS, Linux, or Windows).",
    );
  }

  const userDataDir = resolveOpenClawUserDataDir(profile.name);
  fs.mkdirSync(userDataDir, { recursive: true });

  const needsDecorate = !isProfileDecorated(
    userDataDir,
    profile.name,
    (profile.color ?? DEFAULT_OPENCLAW_BROWSER_COLOR).toUpperCase(),
  );

  // First launch to create preference files if missing, then decorate and relaunch.
  const spawnOnce = () => {
    const args = buildOpenClawChromeLaunchArgs({
      resolved,
      profile,
      userDataDir,
    });
    // stdio tuple: discard stdout to prevent buffer saturation in constrained
    // environments (e.g. Docker), while keeping stderr piped for diagnostics.
    // Cast to ChildProcessWithoutNullStreams so callers can use .stderr safely;
    // the tuple overload resolution varies across @types/node versions.
    return spawn(exe.path, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        // Reduce accidental sharing with the user's env.
        HOME: os.homedir(),
      },
    }) as unknown as ChildProcessWithoutNullStreams;
  };

  const startedAt = Date.now();

  const localStatePath = path.join(userDataDir, "Local State");
  const preferencesPath = path.join(userDataDir, "Default", "Preferences");
  const needsBootstrap = !exists(localStatePath) || !exists(preferencesPath);

  // If the profile doesn't exist yet, bootstrap it once so Chrome creates defaults.
  // Then decorate (if needed) before the "real" run.
  if (needsBootstrap) {
    const bootstrap = spawnOnce();
    const deadline = Date.now() + CHROME_BOOTSTRAP_PREFS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exists(localStatePath) && exists(preferencesPath)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      bootstrap.kill("SIGTERM");
    } catch {
      // ignore
    }
    const exitDeadline = Date.now() + CHROME_BOOTSTRAP_EXIT_TIMEOUT_MS;
    while (Date.now() < exitDeadline) {
      if (bootstrap.exitCode != null) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (needsDecorate) {
    try {
      decorateOpenClawProfile(userDataDir, {
        name: profile.name,
        color: profile.color,
      });
      log.info(`🦞 openclaw browser profile decorated (${profile.color})`);
    } catch (err) {
      log.warn(`openclaw browser profile decoration failed: ${String(err)}`);
    }
  }

  try {
    ensureProfileCleanExit(userDataDir);
  } catch (err) {
    log.warn(`openclaw browser clean-exit prefs failed: ${String(err)}`);
  }

  const launchOnceAndWait = async (allowSingletonRecovery: boolean): Promise<RunningChrome> => {
    const proc = spawnOnce();

    // Collect stderr for diagnostics in case Chrome fails to start.
    // The listener is removed on success to avoid unbounded memory growth
    // from a long-lived Chrome process that emits periodic warnings.
    const stderrChunks: Buffer[] = [];
    const onStderr = (chunk: Buffer) => {
      stderrChunks.push(chunk);
    };
    proc.stderr?.on("data", onStderr);

    const finishFailure = (stderrOutput: string): never => {
      const stderrHint = stderrOutput
        ? `\nChrome stderr:\n${stderrOutput.slice(0, CHROME_STDERR_HINT_MAX_CHARS)}`
        : "";
      const launchHint = chromeLaunchHints({
        stderrOutput,
        resolved,
        profileName: profile.name,
      });
      throw new Error(
        `Failed to start Chrome CDP on port ${profile.cdpPort} for profile "${profile.name}".${launchHint}${stderrHint}`,
      );
    };

    try {
      const readyDeadline = Date.now() + CHROME_LAUNCH_READY_WINDOW_MS;
      while (Date.now() < readyDeadline) {
        if (await isChromeReachable(profile.cdpUrl)) {
          break;
        }
        await new Promise((r) => setTimeout(r, CHROME_LAUNCH_READY_POLL_MS));
      }

      if (!(await isChromeReachable(profile.cdpUrl))) {
        const stderrOutput =
          normalizeOptionalString(Buffer.concat(stderrChunks).toString("utf8")) ?? "";
        if (
          allowSingletonRecovery &&
          CHROME_SINGLETON_IN_USE_PATTERN.test(stderrOutput) &&
          clearStaleChromeSingletonLocks(userDataDir)
        ) {
          log.warn(
            `Removed stale Chromium Singleton* locks for profile "${profile.name}" and retrying launch.`,
          );
          try {
            proc.kill("SIGKILL");
          } catch {
            // ignore
          }
          return await launchOnceAndWait(false);
        }
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        finishFailure(stderrOutput);
      }

      const pid = proc.pid ?? -1;
      log.info(
        `🦞 openclaw browser started (${exe.kind}) profile "${profile.name}" on 127.0.0.1:${profile.cdpPort} (pid ${pid})`,
      );
      return {
        pid,
        exe,
        userDataDir,
        cdpPort: profile.cdpPort,
        startedAt,
        proc,
      };
    } finally {
      proc.stderr?.off("data", onStderr);
      stderrChunks.length = 0;
    }
  };

  return await launchOnceAndWait(true);
}

export async function stopOpenClawChrome(
  running: RunningChrome,
  timeoutMs = CHROME_STOP_TIMEOUT_MS,
) {
  const proc = running.proc;
  if (proc.killed) {
    return;
  }
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!proc.exitCode && proc.killed) {
      break;
    }
    if (!(await isChromeReachable(cdpUrlForPort(running.cdpPort), CHROME_STOP_PROBE_TIMEOUT_MS))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}
