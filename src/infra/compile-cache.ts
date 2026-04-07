import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "./openclaw-root.js";

export const OPENCLAW_COMPILE_CACHE_DIR_ENV = "OPENCLAW_COMPILE_CACHE_DIR";

type EnableCompileCacheFn = (
  options?: string | { directory?: string; portable?: boolean },
) => unknown;

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeCompileCachePathSegment(value: string | undefined, fallback: string): string {
  const sanitized = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}

function hashCompileCacheInstallRoot(root: string): string {
  return createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);
}

function resolveCompileCacheBaseDir(env: NodeJS.ProcessEnv, tmpdir: () => string): string {
  const configured = trimToUndefined(env.NODE_COMPILE_CACHE);
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(tmpdir(), "node-compile-cache", "openclaw");
}

export function resolveOpenClawCompileCacheDirectory(params: {
  version: string | undefined;
  env?: NodeJS.ProcessEnv;
  packageRoot?: string | null;
  moduleUrl?: string;
  argv1?: string;
  cwd?: string;
  tmpdir?: () => string;
}): string {
  const env = params.env ?? process.env;
  const packageRoot =
    params.packageRoot ??
    resolveOpenClawPackageRootSync({
      moduleUrl: params.moduleUrl,
      argv1: params.argv1,
      cwd: params.cwd,
    });
  const installKey = packageRoot ? hashCompileCacheInstallRoot(packageRoot) : "unknown-root";
  const versionKey = sanitizeCompileCachePathSegment(params.version, "unknown-version");
  return path.join(
    resolveCompileCacheBaseDir(env, params.tmpdir ?? os.tmpdir),
    installKey,
    versionKey,
  );
}

export function prepareOpenClawCompileCacheDirectory(params: {
  version: string | undefined;
  env?: NodeJS.ProcessEnv;
  packageRoot?: string | null;
  moduleUrl?: string;
  argv1?: string;
  cwd?: string;
  tmpdir?: () => string;
}): string {
  const env = params.env ?? process.env;
  const prepared = trimToUndefined(env[OPENCLAW_COMPILE_CACHE_DIR_ENV]);
  if (prepared) {
    return prepared;
  }
  const directory = resolveOpenClawCompileCacheDirectory(params);
  env[OPENCLAW_COMPILE_CACHE_DIR_ENV] = directory;
  return directory;
}

export function enableOpenClawCompileCache(params: {
  enableCompileCache: EnableCompileCacheFn;
  version: string | undefined;
  env?: NodeJS.ProcessEnv;
  packageRoot?: string | null;
  moduleUrl?: string;
  argv1?: string;
  cwd?: string;
  tmpdir?: () => string;
}): string {
  const directory = prepareOpenClawCompileCacheDirectory(params);
  params.enableCompileCache({ directory });
  return directory;
}
