import type { ChannelPluginCatalogEntry } from "../../channels/plugins/catalog.js";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizePluginsConfig, resolveEnableState } from "../../plugins/config-state.js";

export function isTrustedWorkspaceChannelCatalogEntry(
  entry: ChannelPluginCatalogEntry | undefined,
  cfg: OpenClawConfig,
): boolean {
  if (entry?.origin !== "workspace") {
    return true;
  }
  if (!entry.pluginId) {
    return false;
  }
  return resolveEnableState(entry.pluginId, "workspace", normalizePluginsConfig(cfg.plugins))
    .enabled;
}
