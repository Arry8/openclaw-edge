import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import {
  createLearningLoopLlmCaller,
  isLearningLoopInternalSessionId,
  resolveLearningLoopAgentId,
  resolveLearningLoopSkillsBaseDir,
} from "./runtime-llm.js";

type TestApi = {
  api: OpenClawPluginApi;
  mocks: {
    runEmbeddedPiAgent: ReturnType<typeof vi.fn>;
    resolveAgentWorkspaceDir: ReturnType<typeof vi.fn>;
    resolveAgentDir: ReturnType<typeof vi.fn>;
    resolveThinkingDefault: ReturnType<typeof vi.fn>;
    resolveAgentTimeoutMs: ReturnType<typeof vi.fn>;
  };
};

function makeApi(overrides?: Partial<OpenClawPluginApi>): TestApi {
  const runEmbeddedPiAgent = vi.fn(async () => ({
    payloads: [{ text: '[{"stored":true}]' }],
    meta: { durationMs: 5 },
  }));
  const resolveAgentWorkspaceDir = vi.fn(() => "/tmp/openclaw-learning-loop-workspace");
  const resolveAgentDir = vi.fn(() => "/tmp/openclaw-learning-loop-agent");
  const resolveThinkingDefault = vi.fn(() => "low");
  const resolveAgentTimeoutMs = vi.fn(() => 15_000);

  const api = {
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

  return {
    api,
    mocks: {
      runEmbeddedPiAgent,
      resolveAgentWorkspaceDir,
      resolveAgentDir,
      resolveThinkingDefault,
      resolveAgentTimeoutMs,
    },
  };
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
    const { api, mocks } = makeApi({
      config: {
        agents: {
          list: [{ id: "ops", default: true }],
        },
      },
    });

    const skillsDir = resolveLearningLoopSkillsBaseDir(api);

    expect(skillsDir).toBe("/tmp/openclaw-learning-loop-workspace/skills");
    expect(mocks.resolveAgentWorkspaceDir).toHaveBeenCalledWith(api.config, "ops");
  });

  it("supports active-agent workspace overrides for scoped learning services", () => {
    const { api, mocks } = makeApi();

    const skillsDir = resolveLearningLoopSkillsBaseDir(api, {
      agentId: "ops",
      workspaceDir: "/tmp/openclaw-ops-workspace",
    });

    expect(skillsDir).toBe("/tmp/openclaw-ops-workspace/skills");
    expect(mocks.resolveAgentWorkspaceDir).not.toHaveBeenCalled();
  });

  it("runs embedded llm calls with the default agent model and json-only contract", async () => {
    const { api, mocks } = makeApi({
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
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledWith(
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
    const { api, mocks } = makeApi();
    const callLlm = createLearningLoopLlmCaller(api);

    await callLlm("system prompt", "user prompt");

    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        provider: "anthropic",
        model: "claude-opus-4-6",
      }),
    );
  });

  it("runs embedded llm calls with scoped agent runtime overrides", async () => {
    const { api, mocks } = makeApi({
      config: {
        agents: {
          list: [
            {
              id: "main",
              default: true,
              model: { primary: "anthropic/claude-opus-4-6" },
            },
            {
              id: "ops",
              model: { primary: "openai/gpt-5.4" },
            },
          ],
        },
      },
    });
    const callLlm = createLearningLoopLlmCaller(api, {
      agentId: "ops",
      workspaceDir: "/tmp/openclaw-ops-workspace",
      agentDir: "/tmp/openclaw-ops-agent",
    });

    await callLlm("system prompt", "user prompt");

    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "ops",
        workspaceDir: "/tmp/openclaw-ops-workspace",
        agentDir: "/tmp/openclaw-ops-agent",
        provider: "openai",
        model: "gpt-5.4",
      }),
    );
  });

  it("uses unique internal session ids even when calls share the same timestamp", async () => {
    const { api, mocks } = makeApi();
    const callLlm = createLearningLoopLlmCaller(api);
    vi.spyOn(Date, "now").mockReturnValue(1_717_171_717_171);

    await Promise.all([
      callLlm("system prompt", "user prompt one"),
      callLlm("system prompt", "user prompt two"),
    ]);

    const sessionIds = mocks.runEmbeddedPiAgent.mock.calls.map(
      (call) => (call[0] as { sessionId: string }).sessionId,
    );

    expect(sessionIds).toHaveLength(2);
    expect(new Set(sessionIds).size).toBe(2);
    expect(sessionIds[0]).toMatch(/^__openclaw_learning_loop_internal__-1717171717171-/);
    expect(sessionIds[1]).toMatch(/^__openclaw_learning_loop_internal__-1717171717171-/);
  });
});
