import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  readConfigFileSnapshot,
  replaceConfigFile,
  resetPluginsCliTestState,
  runPluginsCommand,
  runtimeLogs,
  writeConfigFile,
} from "./plugins-cli-test-helpers.js";

// Mock stale-plugin-config used via dynamic import inside plugins clean
const scanStalePluginConfig = vi.fn();
const maybeRepairStalePluginConfig = vi.fn();
const isStalePluginAutoRepairBlocked = vi.fn();

vi.mock("../commands/doctor/shared/stale-plugin-config.js", () => ({
  scanStalePluginConfig: (...args: unknown[]) => scanStalePluginConfig(...args),
  maybeRepairStalePluginConfig: (...args: unknown[]) => maybeRepairStalePluginConfig(...args),
  isStalePluginAutoRepairBlocked: (...args: unknown[]) => isStalePluginAutoRepairBlocked(...args),
}));

const STALE_CONFIG: OpenClawConfig = {
  plugins: {
    allow: ["discord", "weixin"],
    entries: {
      weixin: { enabled: true },
    },
  },
} as OpenClawConfig;

const STALE_HITS = [
  { pluginId: "weixin", pathLabel: "plugins.allow", surface: "allow" as const },
  { pluginId: "weixin", pathLabel: "plugins.entries.weixin", surface: "entries" as const },
];

const CLEAN_CONFIG: OpenClawConfig = {
  plugins: {
    allow: ["discord"],
    entries: {},
  },
} as OpenClawConfig;

describe("plugins cli clean", () => {
  beforeEach(() => {
    resetPluginsCliTestState();
    scanStalePluginConfig.mockReset();
    maybeRepairStalePluginConfig.mockReset();
    isStalePluginAutoRepairBlocked.mockReset();
    isStalePluginAutoRepairBlocked.mockReturnValue(false);
  });

  it("reports no stale references when config is clean", async () => {
    scanStalePluginConfig.mockReturnValue([]);

    await runPluginsCommand(["plugins", "clean"]);

    expect(replaceConfigFile).not.toHaveBeenCalled();
    expect(runtimeLogs.some((line) => line.includes("No stale plugin references found."))).toBe(
      true,
    );
  });

  it("shows stale references and removes them", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw-config.json5",
      config: STALE_CONFIG,
      hash: "abc123",
    });
    scanStalePluginConfig.mockReturnValue(STALE_HITS);
    maybeRepairStalePluginConfig.mockReturnValue({
      config: CLEAN_CONFIG,
      changes: [
        "- plugins.allow: removed 1 stale plugin id (weixin)",
        "- plugins.entries: removed 1 stale plugin entry (weixin)",
      ],
    });

    await runPluginsCommand(["plugins", "clean"]);

    expect(replaceConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({ nextConfig: CLEAN_CONFIG }),
    );
    expect(
      runtimeLogs.some((line) => line.includes("Found 2 stale plugin references:")),
    ).toBe(true);
    expect(runtimeLogs.some((line) => line.includes("Removed:"))).toBe(true);
  });

  it("shows stale references without writing in --dry-run mode", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw-config.json5",
      config: STALE_CONFIG,
      hash: "abc123",
    });
    scanStalePluginConfig.mockReturnValue(STALE_HITS);

    await runPluginsCommand(["plugins", "clean", "--dry-run"]);

    expect(replaceConfigFile).not.toHaveBeenCalled();
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(runtimeLogs.some((line) => line.includes("dry run"))).toBe(true);
  });

  it("blocks removal when plugin discovery has errors", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw-config.json5",
      config: STALE_CONFIG,
      hash: "abc123",
    });
    scanStalePluginConfig.mockReturnValue(STALE_HITS);
    isStalePluginAutoRepairBlocked.mockReturnValue(true);

    await runPluginsCommand(["plugins", "clean"]);

    expect(replaceConfigFile).not.toHaveBeenCalled();
    expect(
      runtimeLogs.some((line) => line.includes("plugin discovery currently has errors")),
    ).toBe(true);
  });
});
