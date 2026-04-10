import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";

export function resolveOpenClawAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_AGENT_DIR?.trim() || env.PI_CODING_AGENT_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env);
  }
  // Allow early override via env var (before config is parsed).
  const agentId = env.OPENCLAW_DEFAULT_AGENT_ID?.trim()
    ? normalizeAgentId(env.OPENCLAW_DEFAULT_AGENT_ID)
    : DEFAULT_AGENT_ID;
  const defaultAgentDir = path.join(resolveStateDir(env), "agents", agentId, "agent");
  return resolveUserPath(defaultAgentDir, env);
}

export function ensureOpenClawAgentEnv(): string {
  const dir = resolveOpenClawAgentDir();
  if (!process.env.OPENCLAW_AGENT_DIR) {
    process.env.OPENCLAW_AGENT_DIR = dir;
  }
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = dir;
  }
  return dir;
}
