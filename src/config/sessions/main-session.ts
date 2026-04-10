import {
  normalizeAgentId,
  normalizeMainKey,
  resolveAgentIdFromSessionKey,
} from "../../routing/session-key.js";
import type { SessionScope } from "./types.js";

/**
 * Hardcoded fallback when no config key, env var, or agents list provides
 * a default agent ID. Kept for backward compatibility.
 */
const FALLBACK_DEFAULT_AGENT_ID = "main";

function buildMainSessionKey(agentId: string, mainKey?: string): string {
  return `agent:${normalizeAgentId(agentId)}:${normalizeMainKey(mainKey)}`;
}

/**
 * Resolve the effective fallback agent ID from config, matching the same
 * priority chain used by `resolveDefaultAgentId()` in agent-scope.ts:
 *
 * 1. `agents.list[].default: true`
 * 2. `agents.list[0]`
 * 3. `agents.defaultAgentId` config key
 * 4. `OPENCLAW_DEFAULT_AGENT_ID` env var
 * 5. Hardcoded `"main"`
 */
function resolveMainFallbackAgentId(cfg?: {
  agents?: { defaultAgentId?: string; list?: Array<{ id?: string; default?: boolean }> };
}): string {
  const agents = cfg?.agents?.list ?? [];
  const fromList = agents.find((agent) => agent?.default)?.id ?? agents[0]?.id;
  if (fromList?.trim()) {
    return fromList.trim();
  }

  const configOverride = cfg?.agents?.defaultAgentId?.trim();
  if (configOverride) {
    return configOverride;
  }

  const envOverride = process.env.OPENCLAW_DEFAULT_AGENT_ID?.trim();
  if (envOverride) {
    return envOverride;
  }

  return FALLBACK_DEFAULT_AGENT_ID;
}

export function resolveMainSessionKey(cfg?: {
  session?: { scope?: SessionScope; mainKey?: string };
  agents?: { defaultAgentId?: string; list?: Array<{ id?: string; default?: boolean }> };
}): string {
  if (cfg?.session?.scope === "global") {
    return "global";
  }
  const defaultAgentId = resolveMainFallbackAgentId(cfg);
  return buildMainSessionKey(defaultAgentId, cfg?.session?.mainKey);
}

export { resolveAgentIdFromSessionKey };

export function resolveAgentMainSessionKey(params: {
  cfg?: { session?: { mainKey?: string } };
  agentId: string;
}): string {
  return buildMainSessionKey(params.agentId, params.cfg?.session?.mainKey);
}

export function resolveExplicitAgentSessionKey(params: {
  cfg?: { session?: { scope?: SessionScope; mainKey?: string } };
  agentId?: string | null;
}): string | undefined {
  const agentId = params.agentId?.trim();
  if (!agentId) {
    return undefined;
  }
  return resolveAgentMainSessionKey({ cfg: params.cfg, agentId });
}

export function canonicalizeMainSessionAlias(params: {
  cfg?: { session?: { scope?: SessionScope; mainKey?: string } };
  agentId: string;
  sessionKey: string;
}): string {
  const raw = params.sessionKey.trim();
  if (!raw) {
    return raw;
  }

  const agentId = normalizeAgentId(params.agentId);
  const mainKey = normalizeMainKey(params.cfg?.session?.mainKey);
  const agentMainSessionKey = buildMainSessionKey(agentId, mainKey);
  const agentMainAliasKey = buildMainSessionKey(agentId, "main");

  // Also recognize legacy keys built with the hardcoded DEFAULT_AGENT_ID ("main")
  // when the configured agent differs. resolveSessionKey() historically used
  // DEFAULT_AGENT_ID="main" for all write paths, producing "agent:main:<mainKey>"
  // even when the configured agent is e.g. "ops". See #29683.
  const legacyMainKey = buildMainSessionKey(FALLBACK_DEFAULT_AGENT_ID, mainKey);
  const legacyMainAliasKey = buildMainSessionKey(FALLBACK_DEFAULT_AGENT_ID, "main");

  const isMainAlias =
    raw === "main" ||
    raw === mainKey ||
    raw === agentMainSessionKey ||
    raw === agentMainAliasKey ||
    raw === legacyMainKey ||
    raw === legacyMainAliasKey;

  if (params.cfg?.session?.scope === "global" && isMainAlias) {
    return "global";
  }
  if (isMainAlias) {
    return agentMainSessionKey;
  }
  return raw;
}
