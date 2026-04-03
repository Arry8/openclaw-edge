import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import {
  createLearningLoopLlmCaller,
  isLearningLoopInternalSessionId,
  resolveLearningLoopAgentId,
  resolveLearningLoopSkillsBaseDir,
} from "./runtime-llm.js";

function makeApi(overrides?: Partial<OpenClawPluginApi>): OpenClawPluginApi {
  const runEmbeddedPiAgent = vi.fn(async () => ({
    payloads: [{ text: '[{"stored":true}]' }],
    meta: { durationMs: 5 },
  }));
  const resolveAgentWorkspaceDir = vi.fn(() => "/tmp/openclaw-learning-loop-workspace");
  const resolveAgentDir = vi.fn(() => "/tmp/openclaw-learning-loop-agent");
  const resolveThinkingDefault = vi.fn(() => "low");
  const resolveAgentTimeoutMs = vi.fn(() => 15_000);

  return {
    config: {},
    runtime: {
      agent: {
        defaults: {
          provider: "anthropic",
          model: "claude-opus-4-6",
        },
        resolveAgentWorkspaceDir,
        resolveAgentDir,
        resolveThinkingDefault,
        resolveAgentTimeoutMs,
        runEmbeddedPiAgent,
      },
    },
    ...overrides,
  } as unknown as OpenClawPluginApi;
}

describe("runtime-llm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the default configured agent id when present", () => {
    expect(
      resolveLearningLoopAgentId({
        agents: {
          list: [{ id: "main" }, { id: "ops", default: true }],
        },
      } as OpenClawPluginApi["config"]),
    ).toBe("ops");
  });

  it("falls back to main when no agent config exists", () => {
    expect(resolveLearningLoopAgentId(undefined)).toBe("main");
  });

  it("marks internal learning-loop session ids", () => {
    expect(isLearningLoopInternalSessionId("__openclaw_learning_loop_internal__-123")).toBe(true);
    expect(isLearningLoopInternalSessionId("learning-loop-123")).toBe(false);
    expect(isLearningLoopInternalSessionId("user-session-123")).toBe(false);
    expect(isLearningLoopInternalSessionId(undefined)).toBe(false);
  });

  it("stores evolutions under the default agent workspace skills tree", () => {
    const api = makeApi({
      config: {
        agents: {
          list: [{ id: "ops", default: true }],
        },
      },
    });

    const skillsDir = resolveLearningLoopSkillsBaseDir(api);

    expect(skillsDir).toBe("/tmp/openclaw-learning-loop-workspace/skills");
    expect(api.runtime.agent.resolveAgentWorkspaceDir).toHaveBeenCalledWith(api.config, "ops");
  });

  it("runs embedded llm calls with the default agent model and json-only contract", async () => {
    const api = makeApi({
      config: {
        agents: {
          defaults: {
            model: "anthropic/claude-sonnet-4-6",
          },
          list: [
            {
              id: "ops",
              default: true,
              model: { primary: "openai/gpt-5.4" },
            },
          ],
        },
      },
    });

    const callLlm = createLearningLoopLlmCaller(api);
    const result = await callLlm("system prompt", "user prompt");

    expect(result).toBe('[{"stored":true}]');
    expect(api.runtime.agent.runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(api.runtime.agent.runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "ops",
        sessionId: expect.stringMatching(/^__openclaw_learning_loop_internal__-/),
        workspaceDir: "/tmp/openclaw-learning-loop-workspace",
        agentDir: "/tmp/openclaw-learning-loop-agent",
        provider: "openai",
        model: "gpt-5.4",
        thinkLevel: "low",
        verboseLevel: "off",
        disableTools: true,
        bootstrapContextMode: "lightweight",
        cleanupBundleMcpOnRunEnd: true,
        extraSystemPrompt: expect.stringContaining("Return only the requested JSON."),
        prompt: "user prompt",
      }),
    );
  });

  it("falls back to runtime defaults when no model is configured", async () => {
    const api = makeApi();
    const callLlm = createLearningLoopLlmCaller(api);

    await callLlm("system prompt", "user prompt");

    expect(api.runtime.agent.runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        provider: "anthropic",
        model: "claude-opus-4-6",
      }),
    );
  });
});
