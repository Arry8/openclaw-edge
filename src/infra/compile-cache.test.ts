import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_COMPILE_CACHE_DIR_ENV,
  enableOpenClawCompileCache,
  prepareOpenClawCompileCacheDirectory,
  resolveOpenClawCompileCacheDirectory,
} from "./compile-cache.js";

describe("compile cache directory resolution", () => {
  it("uses a version-scoped default cache directory", () => {
    const directory = resolveOpenClawCompileCacheDirectory({
      version: "2026.4.5",
      env: {},
      packageRoot: "/opt/openclaw",
      tmpdir: () => "/tmp/openclaw-tests",
    });

    expect(path.basename(directory)).toBe("2026.4.5");
    expect(path.basename(path.dirname(directory))).toHaveLength(12);
    expect(path.dirname(path.dirname(directory))).toBe(
      path.join("/tmp/openclaw-tests", "node-compile-cache", "openclaw"),
    );
  });

  it("treats NODE_COMPILE_CACHE as the base directory instead of the final leaf", () => {
    const directory = resolveOpenClawCompileCacheDirectory({
      version: "2026.4.5",
      env: { NODE_COMPILE_CACHE: "/var/tmp/openclaw-cache" },
      packageRoot: "/opt/openclaw",
      tmpdir: () => "/tmp/ignored",
    });

    expect(path.basename(directory)).toBe("2026.4.5");
    expect(path.basename(path.dirname(directory))).toHaveLength(12);
    expect(path.dirname(path.dirname(directory))).toBe("/var/tmp/openclaw-cache");
  });

  it("reuses the prepared cache directory across repeated bootstrap calls", () => {
    const env: NodeJS.ProcessEnv = {};
    const initial = prepareOpenClawCompileCacheDirectory({
      version: "2026.4.5",
      env,
      packageRoot: "/opt/openclaw",
      tmpdir: () => "/tmp/openclaw-tests",
    });

    env.NODE_COMPILE_CACHE = "/var/tmp/changed-base";

    const repeated = prepareOpenClawCompileCacheDirectory({
      version: "2026.4.6",
      env,
      packageRoot: "/opt/other-openclaw",
      tmpdir: () => "/tmp/ignored",
    });

    expect(repeated).toBe(initial);
    expect(env[OPENCLAW_COMPILE_CACHE_DIR_ENV]).toBe(initial);
  });

  it("passes the prepared directory into enableCompileCache", () => {
    const enableCompileCache = vi.fn();
    const env: NodeJS.ProcessEnv = {
      NODE_COMPILE_CACHE: "/var/tmp/openclaw-cache",
    };

    const directory = enableOpenClawCompileCache({
      enableCompileCache,
      version: "2026.4.5",
      env,
      packageRoot: "/opt/openclaw",
      tmpdir: () => "/tmp/ignored",
    });

    expect(enableCompileCache).toHaveBeenCalledWith({ directory });
    expect(env.NODE_COMPILE_CACHE).toBe("/var/tmp/openclaw-cache");
    expect(env[OPENCLAW_COMPILE_CACHE_DIR_ENV]).toBe(directory);
  });
});
