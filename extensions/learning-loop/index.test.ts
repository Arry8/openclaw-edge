import { describe, expect, it, beforeEach, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";

const pluginMocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  const graphiti = {
    search: vi.fn(async () => ({ facts: [], nodes: [] })),
    formatForPrompt: vi.fn(() => ""),
    addEpisode: vi.fn(async () => {
      callOrder.push("addEpisode");
      return "ok";
    }),
    addObservation: vi.fn(async () => "ok"),
    deleteFact: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {
      callOrder.push("closeConnection");
    }),
    dispose: vi.fn(async () => {}),
  };
  const evolutionService = {
    runAutoEvolution: vi.fn(async () => {
      callOrder.push("runAutoEvolution");
      return [];
    }),
    evolveSkill: vi.fn(async () => null),
    solidifySkill: vi.fn(() => 0),
    getPendingEntries: vi.fn(() => []),
    listEvolvedSkills: vi.fn(() => []),
    getDescriptionExperiences: vi.fn(() => ""),
    clearSignals: vi.fn(),
  };
  const nudgeManager = {
    checkNudge: vi.fn(() => {
      callOrder.push("checkNudge");
      return null;
    }),
    resetAll: vi.fn(),
    resetCounter: vi.fn(),
  };

  return {
    callOrder,
    graphiti,
    evolutionService,
    nudgeManager,
    GraphitiClient: vi.fn(function GraphitiClient() {
      return graphiti;
    }),
    EvolutionService: vi.fn(function EvolutionService() {
      return evolutionService;
    }),
    NudgeManager: vi.fn(function NudgeManager() {
      return nudgeManager;
    }),
    createLearningLoopLlmCaller: vi.fn(() => vi.fn(async () => "[]")),
    resolveLearningLoopSkillsBaseDir: vi.fn(() => "/tmp/openclaw-learning-loop-workspace/skills"),
    isLearningLoopInternalSessionId: vi.fn(() => false),
  };
});

vi.mock("./src/graphiti-client.js", () => ({
  GraphitiClient: pluginMocks.GraphitiClient,
}));

vi.mock("./src/evolution-service.js", () => ({
  EvolutionService: pluginMocks.EvolutionService,
}));

vi.mock("./src/nudge-manager.js", () => ({
  NudgeManager: pluginMocks.NudgeManager,
}));

vi.mock("./src/runtime-llm.js", () => ({
  createLearningLoopLlmCaller: pluginMocks.createLearningLoopLlmCaller,
  resolveLearningLoopSkillsBaseDir: pluginMocks.resolveLearningLoopSkillsBaseDir,
  isLearningLoopInternalSessionId: pluginMocks.isLearningLoopInternalSessionId,
}));

import learningLoopPlugin from "./index.js";

function createApi() {
  const on = vi.fn();
  const registerCli = vi.fn();
  const registerTool = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const api = createTestPluginApi({
    id: "learning-loop",
    name: "Learning Loop",
    source: "test",
    config: {},
    pluginConfig: {
      graphiti: {
        mcpServerUrl: "http://localhost:8000/mcp",
        groupId: "openclaw_test",
      },
      evolution: {
        enabled: true,
        approvalPolicy: "always_allow",
        maxEntriesPerRound: 2,
      },
      nudge: {
        enabled: true,
        memoryInterval: 5,
        skillInterval: 5,
      },
      memory: {
        autoRecall: true,
        autoCapture: true,
      },
    },
    runtime: {} as never,
    logger,
    on,
    registerCli,
    registerTool,
  });
  return { api, on, logger, registerCli, registerTool };
}

describe("learning-loop plugin", () => {
  beforeEach(() => {
    pluginMocks.callOrder.length = 0;
    pluginMocks.GraphitiClient.mockClear();
    pluginMocks.EvolutionService.mockClear();
    pluginMocks.NudgeManager.mockClear();
    pluginMocks.createLearningLoopLlmCaller.mockClear();
    pluginMocks.resolveLearningLoopSkillsBaseDir.mockClear();
    pluginMocks.isLearningLoopInternalSessionId.mockClear();
    Object.values(pluginMocks.graphiti).forEach((fn) => {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as { mockClear: () => void }).mockClear();
      }
    });
    Object.values(pluginMocks.evolutionService).forEach((fn) => {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as { mockClear: () => void }).mockClear();
      }
    });
    Object.values(pluginMocks.nudgeManager).forEach((fn) => {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as { mockClear: () => void }).mockClear();
      }
    });
    pluginMocks.isLearningLoopInternalSessionId.mockReturnValue(false);
  });

  it("registers a single agent_end handler to avoid internal hook races", () => {
    const { api, on } = createApi();

    learningLoopPlugin.register(api);

    const agentEndHooks = on.mock.calls.filter(([name]) => name === "agent_end");
    expect(agentEndHooks).toHaveLength(1);
  });

  it("runs post-turn learning work before closing the Graphiti connection", async () => {
    const { api, on } = createApi();

    learningLoopPlugin.register(api);

    const agentEndHandler = on.mock.calls.find(([name]) => name === "agent_end")?.[1];
    if (typeof agentEndHandler !== "function") {
      throw new Error("expected learning-loop plugin to register agent_end");
    }

    await agentEndHandler(
      {
        success: true,
        messages: [
          {
            role: "user",
            content: "Please remember that we use rg instead of grep here.",
          },
        ],
      },
      { sessionId: "session-1" },
    );

    expect(pluginMocks.callOrder).toEqual([
      "addEpisode",
      "runAutoEvolution",
      "checkNudge",
      "closeConnection",
    ]);
  });
});
