import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const DEFAULT_AGENT_ID = "main";
export const LEARNING_LOOP_INTERNAL_SESSION_PREFIX = "__openclaw_learning_loop_internal__-";
type ConfiguredAgentEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];
const JSON_ONLY_OUTPUT_CONTRACT = [
  "You are running an internal learning-loop review task.",
  "Return only the requested JSON.",
  "Do not wrap the JSON in markdown fences.",
  "Do not add commentary before or after the JSON.",
].join(" ");

function readPrimaryModel(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed || undefined;
  }
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const primary = (raw as { primary?: unknown }).primary;
  if (typeof primary !== "string") {
    return undefined;
  }
  const trimmed = primary.trim();
  return trimmed || undefined;
}

function resolveConfiguredDefaultAgentEntry(
  cfg?: OpenClawConfig,
): ConfiguredAgentEntry | undefined {
  const agents = cfg?.agents?.list;
  if (!Array.isArray(agents) || agents.length === 0) {
    return undefined;
  }

  return agents.find((entry) => entry.default === true) ?? agents[0];
}

function resolveProviderModel(params: {
  cfg?: OpenClawConfig;
  agentId: string;
  runtime: OpenClawPluginApi["runtime"];
}): { provider: string; model: string } {
  const defaultAgentEntry = resolveConfiguredDefaultAgentEntry(params.cfg);
  const configuredAgentModel =
    defaultAgentEntry &&
    typeof defaultAgentEntry.id === "string" &&
    defaultAgentEntry.id.trim().toLowerCase() === params.agentId
      ? readPrimaryModel(defaultAgentEntry.model)
      : undefined;
  const configuredDefaultModel = readPrimaryModel(params.cfg?.agents?.defaults?.model);
  const modelRef = configuredAgentModel ?? configuredDefaultModel;

  if (!modelRef) {
    return {
      provider: params.runtime.agent.defaults.provider,
      model: params.runtime.agent.defaults.model,
    };
  }

  const slashIndex = modelRef.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: params.runtime.agent.defaults.provider,
      model: modelRef,
    };
  }

  return {
    provider: modelRef.slice(0, slashIndex) || params.runtime.agent.defaults.provider,
    model: modelRef.slice(slashIndex + 1) || params.runtime.agent.defaults.model,
  };
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  const text = (payloads ?? [])
    .filter((payload) => !payload.isError && typeof payload.text === "string")
    .map((payload) => payload.text ?? "")
    .join("\n")
    .trim();
  if (text) {
    return text;
  }

  const errorText = (payloads ?? []).find(
    (payload) => payload.isError && typeof payload.text === "string" && payload.text.trim(),
  )?.text;
  if (errorText) {
    throw new Error(errorText);
  }

  throw new Error("learning-loop internal LLM call returned empty output");
}

export function resolveLearningLoopAgentId(cfg?: OpenClawConfig): string {
  const defaultEntry = resolveConfiguredDefaultAgentEntry(cfg);
  if (!defaultEntry || typeof defaultEntry.id !== "string") {
    return DEFAULT_AGENT_ID;
  }
  const trimmed = defaultEntry.id.trim().toLowerCase();
  return trimmed || DEFAULT_AGENT_ID;
}

export function resolveLearningLoopSkillsBaseDir(api: OpenClawPluginApi): string {
  const cfg = api.config ?? ({} as OpenClawConfig);
  const agentId = resolveLearningLoopAgentId(cfg);
  const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId);
  return path.join(workspaceDir, "skills");
}

export function isLearningLoopInternalSessionId(sessionId?: string): boolean {
  return (
    typeof sessionId === "string" && sessionId.startsWith(LEARNING_LOOP_INTERNAL_SESSION_PREFIX)
  );
}

export function createLearningLoopLlmCaller(
  api: OpenClawPluginApi,
): (systemPrompt: string, userPrompt: string) => Promise<string> {
  return async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const cfg = api.config ?? ({} as OpenClawConfig);
    const agentId = resolveLearningLoopAgentId(cfg);
    const { provider, model } = resolveProviderModel({
      cfg,
      agentId,
      runtime: api.runtime,
    });
    const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId);
    const agentDir = api.runtime.agent.resolveAgentDir(cfg, agentId);
    const thinkLevel = api.runtime.agent.resolveThinkingDefault({
      cfg,
      provider,
      model,
    });
    const timeoutMs = api.runtime.agent.resolveAgentTimeoutMs({ cfg });
    const sessionId = `${LEARNING_LOOP_INTERNAL_SESSION_PREFIX}${Date.now()}`;

    let tempDir: string | null = null;
    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-learning-loop-"));
      const sessionFile = path.join(tempDir, "session.json");

      const result = await api.runtime.agent.runEmbeddedPiAgent({
        sessionId,
        runId: `${sessionId}-run`,
        agentId,
        sessionFile,
        workspaceDir,
        agentDir,
        config: cfg,
        prompt: userPrompt,
        provider,
        model,
        thinkLevel,
        verboseLevel: "off",
        timeoutMs,
        disableTools: true,
        bootstrapContextMode: "lightweight",
        cleanupBundleMcpOnRunEnd: true,
        extraSystemPrompt: `${systemPrompt}\n\n${JSON_ONLY_OUTPUT_CONTRACT}`,
      });

      return collectText(result.payloads);
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore tmp cleanup failures for best-effort background tasks.
        }
      }
    }
  };
}
