import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAutoEnableResult } from "../../config/plugin-auto-enable.js";

const loadPluginManifestRegistry = vi.hoisted(() => vi.fn());
const listChannelPluginCatalogEntries = vi.hoisted(() => vi.fn((_args?: unknown): unknown[] => []));
const listChatChannels = vi.hoisted(() => vi.fn((): Array<Record<string, string>> => []));
const applyPluginAutoEnable = vi.hoisted(() =>
  vi.fn<(args: { config: unknown; env?: NodeJS.ProcessEnv }) => PluginAutoEnableResult>(
    ({ config }) => ({
      config: config as never,
      changes: [] as string[],
      autoEnabledReasons: {},
    }),
  ),
);

vi.mock("../../plugins/manifest-registry.js", () => ({
  loadPluginManifestRegistry: (...args: unknown[]) => loadPluginManifestRegistry(...args),
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: (args: unknown) =>
    applyPluginAutoEnable(args as { config: unknown; env?: NodeJS.ProcessEnv }),
}));

vi.mock("../../channels/plugins/catalog.js", () => ({
  listChannelPluginCatalogEntries: (args?: unknown) => listChannelPluginCatalogEntries(args),
}));

vi.mock("../../channels/registry.js", () => ({
  listChatChannels: () => listChatChannels(),
}));

import { listManifestInstalledChannelIds, resolveChannelSetupEntries } from "./discovery.js";

describe("listManifestInstalledChannelIds", () => {
  beforeEach(() => {
    loadPluginManifestRegistry.mockReset().mockReturnValue({
      plugins: [],
      diagnostics: [],
    });
    listChannelPluginCatalogEntries.mockReset().mockReturnValue([]);
    listChatChannels.mockReset().mockReturnValue([]);
    applyPluginAutoEnable.mockReset().mockImplementation(({ config }) => ({
      config: config as never,
      changes: [] as string[],
      autoEnabledReasons: {},
    }));
  });

  it("uses the auto-enabled config snapshot for manifest discovery", () => {
    const autoEnabledConfig = {
      channels: { slack: { enabled: true } },
      plugins: { allow: ["slack"] },
      autoEnabled: true,
    } as never;
    applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: ["slack"] as string[],
      autoEnabledReasons: {
        slack: ["slack configured"],
      },
    });
    loadPluginManifestRegistry.mockReturnValue({
      plugins: [{ id: "slack", channels: ["slack"] }],
      diagnostics: [],
    });

    const installedIds = listManifestInstalledChannelIds({
      cfg: {} as never,
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" } as NodeJS.ProcessEnv,
    });

    expect(applyPluginAutoEnable).toHaveBeenCalledWith({
      config: {},
      env: { OPENCLAW_HOME: "/tmp/home" },
    });
    expect(loadPluginManifestRegistry).toHaveBeenCalledWith({
      config: autoEnabledConfig,
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" },
    });
    expect(installedIds).toEqual(new Set(["slack"]));
  });

  it("filters channels hidden from setup out of interactive entries", () => {
    listChatChannels.mockReturnValue([
      {
        id: "telegram",
        label: "Telegram",
        selectionLabel: "Telegram",
        docsPath: "/channels/telegram",
        blurb: "bot token",
      },
    ]);

    const resolved = resolveChannelSetupEntries({
      cfg: {} as never,
      installedPlugins: [
        {
          id: "qa-channel",
          meta: {
            id: "qa-channel",
            label: "QA Channel",
            selectionLabel: "QA Channel",
            docsPath: "/channels/qa-channel",
            blurb: "synthetic",
            exposure: { setup: false },
          },
        } as never,
      ],
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" } as NodeJS.ProcessEnv,
    });

    expect(resolved.entries.map((entry) => entry.id)).toEqual(["telegram"]);
  });

  it("keeps trusted workspace entries in installed discovery results", () => {
    loadPluginManifestRegistry.mockReturnValue({
      plugins: [{ id: "matrix-plugin", channels: ["matrix"] }],
      diagnostics: [],
    });
    listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "matrix",
        pluginId: "matrix-plugin",
        origin: "workspace",
        meta: {
          id: "matrix",
          label: "Matrix",
          selectionLabel: "Matrix",
          docsPath: "/channels/matrix",
          blurb: "homeserver",
        },
      },
    ]);

    const resolved = resolveChannelSetupEntries({
      cfg: {
        plugins: {
          enabled: true,
          allow: ["matrix-plugin"],
        },
      } as never,
      installedPlugins: [],
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" } as NodeJS.ProcessEnv,
    });

    expect(resolved.installedCatalogEntries.map((entry) => entry.id)).toEqual(["matrix"]);
    expect(resolved.installableCatalogEntries).toEqual([]);
  });

  it("filters untrusted workspace entries out of installed discovery results", () => {
    loadPluginManifestRegistry.mockReturnValue({
      plugins: [{ id: "matrix-plugin", channels: ["matrix"] }],
      diagnostics: [],
    });
    listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "matrix",
        pluginId: "matrix-plugin",
        origin: "workspace",
        meta: {
          id: "matrix",
          label: "Matrix",
          selectionLabel: "Matrix",
          docsPath: "/channels/matrix",
          blurb: "homeserver",
        },
      },
    ]);

    const resolved = resolveChannelSetupEntries({
      cfg: {} as never,
      installedPlugins: [],
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" } as NodeJS.ProcessEnv,
    });

    expect(resolved.installedCatalogEntries).toEqual([]);
  });

  it("never offers workspace entries as installable setup options", () => {
    listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "matrix",
        pluginId: "matrix-plugin",
        origin: "workspace",
        meta: {
          id: "matrix",
          label: "Matrix",
          selectionLabel: "Matrix",
          docsPath: "/channels/matrix",
          blurb: "homeserver",
        },
      },
      {
        id: "telegram",
        pluginId: "@openclaw/telegram-plugin",
        origin: "bundled",
        meta: {
          id: "telegram",
          label: "Telegram",
          selectionLabel: "Telegram",
          docsPath: "/channels/telegram",
          blurb: "bot token",
        },
      },
    ]);

    const resolved = resolveChannelSetupEntries({
      cfg: {
        plugins: {
          enabled: true,
          allow: ["matrix-plugin"],
        },
      } as never,
      installedPlugins: [],
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" } as NodeJS.ProcessEnv,
    });

    expect(resolved.installableCatalogEntries.map((entry) => entry.id)).toEqual(["telegram"]);
    expect(listChannelPluginCatalogEntries).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
    });
  });
});
