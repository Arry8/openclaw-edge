import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardPrompter } from "../wizard/prompts.js";

const resolveAgentWorkspaceDir = vi.hoisted(() =>
  vi.fn((_cfg?: unknown, _agentId?: unknown) => "/tmp/openclaw-workspace"),
);
const resolveDefaultAgentId = vi.hoisted(() => vi.fn((_cfg?: unknown) => "default"));
const listChannelPluginCatalogEntries = vi.hoisted(() => vi.fn((_args?: unknown): unknown[] => []));
const getChannelSetupPlugin = vi.hoisted(() => vi.fn((_channel?: unknown) => undefined));
const listChannelSetupPlugins = vi.hoisted(() => vi.fn((): unknown[] => []));
const collectChannelStatus = vi.hoisted(() =>
  vi.fn(async (_args?: unknown) => ({
    installedPlugins: [],
    catalogEntries: [],
    installedCatalogEntries: [],
    statusByChannel: new Map(),
    statusLines: [],
  })),
);

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: (cfg?: unknown, agentId?: unknown) =>
    resolveAgentWorkspaceDir(cfg, agentId),
  resolveDefaultAgentId: (cfg?: unknown) => resolveDefaultAgentId(cfg),
}));

vi.mock("../channels/plugins/catalog.js", () => ({
  listChannelPluginCatalogEntries: (args?: unknown) => listChannelPluginCatalogEntries(args),
}));

vi.mock("../channels/plugins/setup-registry.js", () => ({
  getChannelSetupPlugin: (channel?: unknown) => getChannelSetupPlugin(channel),
  listChannelSetupPlugins: () => listChannelSetupPlugins(),
}));

vi.mock("../channels/registry.js", () => ({
  listChatChannels: () => [],
}));

vi.mock("../commands/channel-setup/registry.js", () => ({
  resolveChannelSetupWizardAdapterForPlugin: vi.fn(),
}));

vi.mock("../commands/channel-setup/plugin-install.js", () => ({
  ensureChannelSetupPluginInstalled: vi.fn(),
  loadChannelSetupPluginRegistrySnapshotForChannel: vi.fn(() => ({
    channels: [],
    channelSetups: [],
  })),
}));

vi.mock("../config/channel-configured.js", () => ({
  isChannelConfigured: vi.fn(() => false),
}));

vi.mock("./channel-setup.status.js", () => ({
  collectChannelStatus: (args?: unknown) => collectChannelStatus(args),
  noteChannelPrimer: vi.fn(),
  resolveChannelSelectionNoteLines: vi.fn(() => []),
  resolveChannelSetupSelectionContributions: vi.fn(() => []),
  resolveQuickstartDefault: vi.fn(() => undefined),
  noteChannelStatus: vi.fn(),
}));

import { setupChannels } from "./channel-setup.js";

describe("setupChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listChannelPluginCatalogEntries.mockReturnValue([]);
    collectChannelStatus.mockResolvedValue({
      installedPlugins: [],
      catalogEntries: [],
      installedCatalogEntries: [],
      statusByChannel: new Map(),
      statusLines: [],
    });
  });

  it("excludes workspace catalog entries while preloading scoped setup plugins", async () => {
    const prompter = {
      confirm: vi.fn(async () => false),
      note: vi.fn(async () => {}),
    } as unknown as WizardPrompter;

    await setupChannels({} as never, {} as never, prompter, {});

    expect(listChannelPluginCatalogEntries).toHaveBeenCalledWith({
      workspaceDir: "/tmp/openclaw-workspace",
      excludeWorkspace: true,
    });
  });
});
