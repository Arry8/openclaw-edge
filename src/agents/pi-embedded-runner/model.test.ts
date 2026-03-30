import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverModels } from "../pi-model-discovery.js";
import { createProviderRuntimeTestMock } from "./model.provider-runtime.test-support.js";

vi.mock("../pi-model-discovery.js", () => ({
  discoverAuthStorage: vi.fn(() => ({ mocked: true })),
  discoverModels: vi.fn(() => ({ find: vi.fn(() => null) })),
}));

import type { OpenRouterModelCapabilities } from "./openrouter-model-capabilities.js";

const mockGetOpenRouterModelCapabilities = vi.fn<
  (modelId: string) => OpenRouterModelCapabilities | undefined
>(() => undefined);
const mockLoadOpenRouterModelCapabilities = vi.fn<(modelId: string) => Promise<void>>(
  async () => {},
);
vi.mock("./openrouter-model-capabilities.js", () => ({
  getOpenRouterModelCapabilities: (modelId: string) => mockGetOpenRouterModelCapabilities(modelId),
  loadOpenRouterModelCapabilities: (modelId: string) =>
    mockLoadOpenRouterModelCapabilities(modelId),
}));

const CALL_THROUGH = Symbol("call-through");
const mockRunProviderDynamicModel = vi.fn<(...args: unknown[]) => unknown>(() => CALL_THROUGH);

import type { OpenClawConfig } from "../../config/config.js";
import { buildForwardCompatTemplate } from "./model.forward-compat.test-support.js";
import { buildInlineProviderModels, resolveModel, resolveModelAsync } from "./model.js";
import {
  buildOpenAICodexForwardCompatExpectation,
  makeModel,
  mockDiscoveredModel,
  mockOpenAICodexTemplateModel,
  resetMockDiscoverModels,
} from "./model.test-harness.js";

beforeEach(() => {
  resetMockDiscoverModels(discoverModels);
  mockGetOpenRouterModelCapabilities.mockReset();
  mockGetOpenRouterModelCapabilities.mockReturnValue(undefined);
  mockLoadOpenRouterModelCapabilities.mockReset();
  mockLoadOpenRouterModelCapabilities.mockResolvedValue();
  mockRunProviderDynamicModel.mockReset();
  mockRunProviderDynamicModel.mockReturnValue(CALL_THROUGH);
});

function createRuntimeHooks() {
  const baseMock = createProviderRuntimeTestMock({
    handledDynamicProviders: [
      "openrouter",
      "github-copilot",
      "openai-codex",
      "openai",
      "anthropic",
      "zai",
    ],
    getOpenRouterModelCapabilities: (modelId: string) =>
      mockGetOpenRouterModelCapabilities(modelId),
    loadOpenRouterModelCapabilities: async (modelId: string) => {
      await mockLoadOpenRouterModelCapabilities(modelId);
    },
  });
  const originalRunProviderDynamicModel = baseMock.runProviderDynamicModel;
  return {
    ...baseMock,
    runProviderDynamicModel: (
      ...args: Parameters<typeof originalRunProviderDynamicModel>
    ): ReturnType<typeof originalRunProviderDynamicModel> => {
      const mockResult = mockRunProviderDynamicModel(...args);
      if (mockResult !== CALL_THROUGH) {
        return mockResult as ReturnType<typeof originalRunProviderDynamicModel>;
      }
      return originalRunProviderDynamicModel(...args);
    },
  };
}

function resolveModelForTest(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: OpenClawConfig,
) {
  const resolvedAgentDir = agentDir ?? "/tmp/agent";
  return resolveModel(provider, modelId, agentDir, cfg, {
    authStorage: { mocked: true } as never,
    modelRegistry: discoverModels({ mocked: true } as never, resolvedAgentDir),
    runtimeHooks: createRuntimeHooks(),
  });
}

function resolveModelAsyncForTest(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: OpenClawConfig,
  options?: { retryTransientProviderRuntimeMiss?: boolean },
) {
  const resolvedAgentDir = agentDir ?? "/tmp/agent";
  return resolveModelAsync(provider, modelId, agentDir, cfg, {
    authStorage: { mocked: true } as never,
    modelRegistry: discoverModels({ mocked: true } as never, resolvedAgentDir),
    ...options,
    runtimeHooks: createRuntimeHooks(),
  });
}

describe("buildInlineProviderModels", () => {
  it("attaches provider ids to inline models", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      " alpha ": { baseUrl: "http://alpha.local", models: [makeModel("alpha-model")] },
      beta: { baseUrl: "http://beta.local", models: [makeModel("beta-model")] },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toEqual([
      {
        ...makeModel("alpha-model"),
        provider: "alpha",
        baseUrl: "http://alpha.local",
        api: undefined,
      },
      {
        ...makeModel("beta-model"),
        provider: "beta",
        baseUrl: "http://beta.local",
        api: undefined,
      },
    ]);
  });

  it("inherits baseUrl from provider when model does not specify it", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      custom: {
        baseUrl: "http://localhost:8000",
        models: [makeModel("custom-model")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://localhost:8000");
  });

  it("inherits api from provider when model does not specify it", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      custom: {
        baseUrl: "http://localhost:8000",
        api: "anthropic-messages",
        models: [makeModel("custom-model")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].api).toBe("anthropic-messages");
  });

  it("model-level api takes precedence over provider-level api", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      custom: {
        baseUrl: "http://localhost:8000",
        api: "openai-responses",
        models: [{ ...makeModel("custom-model"), api: "anthropic-messages" as const }],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].api).toBe("anthropic-messages");
  });

  it("inherits both baseUrl and api from provider config", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      custom: {
        baseUrl: "http://localhost:10000",
        api: "anthropic-messages",
        models: [makeModel("claude-opus-4.5")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "custom",
      baseUrl: "http://localhost:10000",
      api: "anthropic-messages",
      name: "claude-opus-4.5",
    });
  });

  it("normalizes bare Google API hosts for custom Google Generative AI providers", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      "google-paid ": {
        baseUrl: "https://generativelanguage.googleapis.com",
        api: "google-generative-ai",
        models: [makeModel("gemini-2.5-pro")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "google-paid",
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    });
  });

  it("merges provider-level headers into inline models", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      proxy: {
        baseUrl: "https://proxy.example.com",
        api: "anthropic-messages",
        headers: { "User-Agent": "custom-agent/1.0" },
        models: [makeModel("claude-sonnet-4-6")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].headers).toEqual({ "User-Agent": "custom-agent/1.0" });
  });

  it("omits headers when neither provider nor model specifies them", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      plain: {
        baseUrl: "http://localhost:8000",
        models: [makeModel("some-model")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].headers).toBeUndefined();
  });

  it("drops SecretRef marker headers in inline provider models", () => {
    const providers: Parameters<typeof buildInlineProviderModels>[0] = {
      custom: {
        headers: {
          Authorization: "secretref-env:OPENAI_HEADER_TOKEN",
          "X-Managed": "secretref-managed",
          "X-Static": "tenant-a",
        },
        models: [makeModel("custom-model")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].headers).toEqual({
      "X-Static": "tenant-a",
    });
  });
});

describe("resolveModel", () => {
  it("defaults model input to text when discovery omits input", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "custom",
      modelId: "missing-input",
      templateModel: {
        id: "missing-input",
        name: "missing-input",
        api: "openai-completions",
        provider: "custom",
        baseUrl: "http://localhost:9999",
        reasoning: false,
        // NOTE: deliberately omit input to simulate buggy/custom catalogs.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    });

    const result = resolveModelForTest("custom", "missing-input", "/tmp/agent", {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9999",
            api: "openai-completions",
            // Intentionally keep this minimal — the discovered model provides the rest.
            models: [{ id: "missing-input", name: "missing-input" }],
          },
        },
      },
    } as unknown as OpenClawConfig);

    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.model?.input)).toBe(true);
    expect(result.model?.input).toEqual(["text"]);
  });

  it("includes provider baseUrl in fallback model", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9000",
            models: [],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("custom", "missing-model", "/tmp/agent", cfg);

    expect(result.model?.baseUrl).toBe("http://localhost:9000");
    expect(result.model?.provider).toBe("custom");
    expect(result.model?.id).toBe("missing-model");
  });

  it("normalizes Google fallback baseUrls for custom providers", () => {
    const cfg = {
      models: {
        providers: {
          "google-paid": {
            baseUrl: "https://generativelanguage.googleapis.com",
            api: "google-generative-ai",
            models: [],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("google-paid", "missing-model", "/tmp/agent", cfg);

    expect(result.model?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("normalizes configured Google override baseUrls when provider api is omitted", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "google",
      modelId: "gemini-2.5-pro",
      templateModel: {
        ...makeModel("gemini-2.5-pro"),
        provider: "google",
        api: "google-generative-ai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
    });

    const cfg = {
      models: {
        providers: {
          google: {
            baseUrl: "https://generativelanguage.googleapis.com",
            models: [{ id: "gemini-2.5-pro", name: "gemini-2.5-pro" }],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("google", "gemini-2.5-pro", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model?.api).toBe("google-generative-ai");
    expect(result.model?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("normalizes custom api.openai.com providers to responses transport", () => {
    const cfg = {
      models: {
        providers: {
          "custom-openai": {
            baseUrl: "https://api.openai.com/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("gpt-5.4"),
                provider: "custom-openai",
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("custom-openai", "gpt-5.4", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "custom-openai",
      id: "gpt-5.4",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("normalizes custom api.x.ai providers to responses transport", () => {
    const cfg = {
      models: {
        providers: {
          "custom-xai": {
            baseUrl: "https://api.x.ai/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("grok-4.1-fast"),
                provider: "custom-xai",
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("custom-xai", "grok-4.1-fast", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "custom-xai",
      id: "grok-4.1-fast",
      api: "openai-responses",
      baseUrl: "https://api.x.ai/v1",
    });
  });

  it("includes provider headers in provider fallback model", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9000",
            headers: { "X-Custom-Auth": "token-123" },
            models: [makeModel("listed-model")],
          },
        },
      },
    } as unknown as OpenClawConfig;

    // Requesting a non-listed model forces the providerCfg fallback branch.
    const result = resolveModelForTest("custom", "missing-model", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect((result.model as unknown as { headers?: Record<string, string> }).headers).toEqual({
      "X-Custom-Auth": "token-123",
    });
  });

  it("drops SecretRef marker provider headers in fallback models", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9000",
            headers: {
              Authorization: "secretref-env:OPENAI_HEADER_TOKEN",
              "X-Managed": "secretref-managed",
              "X-Custom-Auth": "token-123",
            },
            models: [makeModel("listed-model")],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("custom", "missing-model", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect((result.model as unknown as { headers?: Record<string, string> }).headers).toEqual({
      "X-Custom-Auth": "token-123",
    });
  });

  it("drops marker headers from discovered models.json entries", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "custom",
      modelId: "listed-model",
      templateModel: {
        ...makeModel("listed-model"),
        provider: "custom",
        headers: {
          Authorization: "secretref-env:OPENAI_HEADER_TOKEN",
          "X-Managed": "secretref-managed",
          "X-Static": "tenant-a",
        },
      },
    });

    const result = resolveModelForTest("custom", "listed-model", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect((result.model as unknown as { headers?: Record<string, string> }).headers).toEqual({
      "X-Static": "tenant-a",
    });
  });

  it("prefers matching configured model metadata for fallback token limits", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9000",
            models: [
              {
                ...makeModel("model-a"),
                contextWindow: 4096,
                maxTokens: 1024,
              },
              {
                ...makeModel("model-b"),
                contextWindow: 262144,
                maxTokens: 32768,
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("custom", "model-b", "/tmp/agent", cfg);

    expect(result.model?.contextWindow).toBe(262144);
    expect(result.model?.maxTokens).toBe(32768);
  });

  it("propagates reasoning from matching configured fallback model", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9000",
            models: [
              {
                ...makeModel("model-a"),
                reasoning: false,
              },
              {
                ...makeModel("model-b"),
                reasoning: true,
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("custom", "model-b", "/tmp/agent", cfg);

    expect(result.model?.reasoning).toBe(true);
  });

  it("matches prefixed OpenRouter native ids in configured fallback models", () => {
    const cfg = {
      models: {
        providers: {
          openrouter: {
            baseUrl: "https://openrouter.ai/api/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("openrouter/healer-alpha"),
                reasoning: true,
                input: ["text", "image"],
                contextWindow: 262144,
                maxTokens: 65536,
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const models = buildInlineProviderModels(cfg.models?.providers ?? {});
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "openrouter",
          id: "openrouter/healer-alpha",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 262144,
          maxTokens: 65536,
        }),
      ]),
    );
    expect(models.find((model) => model.id === "openrouter/healer-alpha")).toMatchObject({
      provider: "openrouter",
      id: "openrouter/healer-alpha",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 262144,
      maxTokens: 65536,
    });
  });

  it("uses OpenRouter API capabilities for unknown models when cache is populated", () => {
    mockGetOpenRouterModelCapabilities.mockReturnValue({
      name: "Healer Alpha",
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 65536,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });

    const result = resolveModelForTest("openrouter", "openrouter/healer-alpha", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "openrouter/healer-alpha",
      name: "Healer Alpha",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 262144,
      maxTokens: 65536,
    });
  });

  it("falls back to heuristic vision detection when OpenRouter API cache is empty", () => {
    mockGetOpenRouterModelCapabilities.mockReturnValue(undefined);

    // Vision model detected by heuristic
    const visionResult = resolveModelForTest("openrouter", "openai/gpt-4o", "/tmp/agent");
    expect(visionResult.error).toBeUndefined();
    expect(visionResult.model).toMatchObject({
      provider: "openrouter",
      id: "openai/gpt-4o",
      input: ["text", "image"],
    });

    // Non-vision model defaults to text-only
    const textResult = resolveModelForTest("openrouter", "deepseek/deepseek-chat", "/tmp/agent");
    expect(textResult.error).toBeUndefined();
    expect(textResult.model).toMatchObject({
      provider: "openrouter",
      id: "deepseek/deepseek-chat",
      input: ["text"],
    });
  });

  it("preloads OpenRouter capabilities before first async resolve of an unknown model", async () => {
    mockLoadOpenRouterModelCapabilities.mockImplementation(async (modelId) => {
      if (modelId === "google/gemini-3.1-flash-image-preview") {
        mockGetOpenRouterModelCapabilities.mockReturnValue({
          name: "Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)",
          input: ["text", "image"],
          reasoning: true,
          contextWindow: 65536,
          maxTokens: 65536,
          cost: { input: 0.5, output: 3, cacheRead: 0, cacheWrite: 0 },
        });
      }
    });

    const result = await resolveModelAsyncForTest(
      "openrouter",
      "google/gemini-3.1-flash-image-preview",
      "/tmp/agent",
    );

    expect(mockLoadOpenRouterModelCapabilities).toHaveBeenCalledWith(
      "google/gemini-3.1-flash-image-preview",
    );
    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "google/gemini-3.1-flash-image-preview",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 65536,
      maxTokens: 65536,
    });
  });

  it("skips OpenRouter preload for models already present in the registry", async () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openrouter",
      modelId: "openrouter/healer-alpha",
      templateModel: {
        id: "openrouter/healer-alpha",
        name: "Healer Alpha",
        api: "openai-completions",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 65536,
      },
    });

    const result = await resolveModelAsyncForTest(
      "openrouter",
      "openrouter/healer-alpha",
      "/tmp/agent",
    );

    expect(mockLoadOpenRouterModelCapabilities).not.toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "openrouter/healer-alpha",
      input: ["text", "image"],
    });
  });

  it("resolves OpenRouter vision models with image input based on configured model", () => {
    const cfg = {
      models: {
        providers: {
          openrouter: {
            baseUrl: "https://openrouter.ai/api/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("anthropic/claude-opus-4-6"),
                input: ["text", "image"],
              },
            ],
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelForTest(
      "openrouter",
      "anthropic/claude-opus-4-6",
      "/tmp/agent",
      cfg,
    );

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "anthropic/claude-opus-4-6",
      input: ["text", "image"],
    });
  });

  it("resolves OpenRouter vision models by model ID pattern heuristic", () => {
    // Without explicit config, vision models are detected by ID pattern
    mockGetOpenRouterModelCapabilities.mockReturnValue(undefined);
    const visionModelIds = [
      "openai/gpt-4o",
      "openai/gpt-4-turbo",
      "anthropic/claude-3-opus",
      "anthropic/claude-sonnet-4-5",
      "google/gemini-1.5-pro",
      "google/gemini-flash-2.0",
      "qwen/qwen2-vl-72b",
      "mistralai/pixtral-large",
      "meta-llama/llama-3.2-90b-vision",
    ];

    for (const modelId of visionModelIds) {
      const result = resolveModelForTest("openrouter", modelId, "/tmp/agent");

      expect(result.error).toBeUndefined();
      expect(result.model?.input).toContain("image");
      expect(result.model?.input).toContain("text");
    }
  });

  it("resolves OpenRouter text-only models without image input", () => {
    // Models without vision patterns default to text-only
    mockGetOpenRouterModelCapabilities.mockReturnValue(undefined);
    const textOnlyModelIds = [
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.1-70b-instruct",
      "mistralai/mistral-large",
    ];

    for (const modelId of textOnlyModelIds) {
      const result = resolveModelForTest("openrouter", modelId, "/tmp/agent");

      expect(result.error).toBeUndefined();
      expect(result.model?.input).toEqual(["text"]);
    }
  });

  it("uses explicitly configured imageModel.primary with OpenRouter (#44648)", () => {
    // Regression test: when imageModel.primary is configured to an OpenRouter vision model,
    // the model should resolve with image input capability
    const cfg = {
      agents: {
        defaults: {
          imageModel: { primary: "openrouter/openai/gpt-4o" },
        },
      },
      models: {
        providers: {
          openrouter: {
            baseUrl: "https://openrouter.ai/api/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("openai/gpt-4o"),
                input: ["text", "image"],
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("openrouter", "openai/gpt-4o", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "openai/gpt-4o",
      input: ["text", "image"],
    });
  });

  it("applies vision heuristic to plugin-resolved OpenRouter models", () => {
    // When the plugin resolves an OpenRouter model with text-only input,
    // the vision heuristic should augment it with image support for known vision models.
    mockRunProviderDynamicModel.mockReturnValue({
      id: "anthropic/claude-sonnet-4-5",
      name: "Anthropic: Claude Sonnet 4.5",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 8192,
    });

    const result = resolveModel("openrouter", "anthropic/claude-sonnet-4-5", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "anthropic/claude-sonnet-4-5",
      input: ["text", "image"],
    });
  });

  it("does not apply vision heuristic to plugin-resolved non-vision OpenRouter models", () => {
    mockRunProviderDynamicModel.mockReturnValue({
      id: "deepseek/deepseek-chat",
      name: "DeepSeek: Chat",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0 },
      contextWindow: 64000,
      maxTokens: 8192,
    });

    const result = resolveModel("openrouter", "deepseek/deepseek-chat", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "deepseek/deepseek-chat",
      input: ["text"],
    });
  });

  it("honors explicit config input over vision heuristic for plugin-resolved OpenRouter models", () => {
    // When explicit config specifies text-only for a model that would match the vision heuristic,
    // the config should take precedence.
    mockRunProviderDynamicModel.mockReturnValue({
      id: "anthropic/claude-3-haiku",
      name: "Anthropic: Claude 3 Haiku",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.25, output: 1.25, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    });

    const cfg = {
      models: {
        providers: {
          openrouter: {
            models: [
              {
                ...makeModel("anthropic/claude-3-haiku"),
                input: ["text"],
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModel("openrouter", "anthropic/claude-3-haiku", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "anthropic/claude-3-haiku",
      input: ["text"],
    });
  });

  it("uses explicit config input with image for plugin-resolved OpenRouter models", () => {
    // When explicit config specifies image input, it should be honored
    // even if the plugin returned text-only.
    mockRunProviderDynamicModel.mockReturnValue({
      id: "custom/my-vision-model",
      name: "Custom Vision Model",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    });

    const cfg = {
      models: {
        providers: {
          openrouter: {
            models: [
              {
                ...makeModel("custom/my-vision-model"),
                input: ["text", "image"],
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModel("openrouter", "custom/my-vision-model", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "custom/my-vision-model",
      input: ["text", "image"],
    });
  });

  it("preserves plugin-resolved image input for OpenRouter models", () => {
    // If the plugin already returns image input, don't overwrite it.
    mockRunProviderDynamicModel.mockReturnValue({
      id: "openai/gpt-4o",
      name: "OpenAI: GPT-4o",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    });

    const result = resolveModel("openrouter", "openai/gpt-4o", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openrouter",
      id: "openai/gpt-4o",
      input: ["text", "image"],
    });
  });

  it("does not apply vision heuristic to plugin-resolved non-OpenRouter models", () => {
    // Vision heuristic is OpenRouter-specific; other providers should not be affected.
    mockRunProviderDynamicModel.mockReturnValue({
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 8192,
    });

    const result = resolveModel("anthropic", "claude-sonnet-4-5", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "anthropic",
      id: "claude-sonnet-4-5",
      input: ["text"],
    });
  });

  it("prefers configured provider api metadata over discovered registry model", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "onehub",
      modelId: "glm-5",
      templateModel: {
        id: "glm-5",
        name: "GLM-5 (cached)",
        provider: "onehub",
        api: "anthropic-messages",
        baseUrl: "https://old-provider.example.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 2048,
      },
    });

    const cfg = {
      models: {
        providers: {
          onehub: {
            baseUrl: "http://new-provider.example.com/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("glm-5"),
                api: "openai-completions",
                reasoning: true,
                contextWindow: 198000,
                maxTokens: 16000,
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("onehub", "glm-5", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "onehub",
      id: "glm-5",
      api: "openai-completions",
      baseUrl: "http://new-provider.example.com/v1",
      reasoning: true,
      contextWindow: 198000,
      maxTokens: 16000,
    });
  });

  it("prefers exact provider config over normalized alias match when both keys exist", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "bedrock",
      modelId: "bedrock-alias-exact-test",
      templateModel: {
        id: "bedrock-alias-exact-test",
        name: "Bedrock alias test",
        provider: "bedrock",
        api: "openai-completions",
        baseUrl: "https://default-provider.example.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 2048,
      },
    });

    const cfg = {
      models: {
        providers: {
          "amazon-bedrock": {
            baseUrl: "https://canonical-bedrock.example.com/v1",
            api: "openai-completions",
            headers: { "X-Provider": "canonical" },
            models: [{ ...makeModel("bedrock-alias-exact-test"), reasoning: false }],
          },
          bedrock: {
            baseUrl: "https://alias-bedrock.example.com/v1",
            api: "anthropic-messages",
            headers: { "X-Provider": "alias" },
            models: [
              {
                ...makeModel("bedrock-alias-exact-test"),
                api: "anthropic-messages",
                reasoning: true,
                contextWindow: 262144,
                maxTokens: 32768,
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("bedrock", "bedrock-alias-exact-test", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "bedrock",
      id: "bedrock-alias-exact-test",
      api: "anthropic-messages",
      baseUrl: "https://alias-bedrock.example.com",
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 32768,
      headers: { "X-Provider": "alias" },
    });
  });

  it("builds an openai-codex fallback for gpt-5.4", () => {
    mockOpenAICodexTemplateModel(discoverModels);

    const result = resolveModelForTest("openai-codex", "gpt-5.4", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject(buildOpenAICodexForwardCompatExpectation("gpt-5.4"));
  });

  it("builds an openai-codex fallback for gpt-5.4", () => {
    mockOpenAICodexTemplateModel(discoverModels);

    const result = resolveModelForTest("openai-codex", "gpt-5.4", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject(buildOpenAICodexForwardCompatExpectation("gpt-5.4"));
  });

  it("builds an openai-codex fallback for gpt-5.3-codex-spark", () => {
    mockOpenAICodexTemplateModel(discoverModels);

    const result = resolveModelForTest("openai-codex", "gpt-5.3-codex-spark", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject(
      buildOpenAICodexForwardCompatExpectation("gpt-5.3-codex-spark"),
    );
  });

  it("keeps openai-codex gpt-5.3-codex-spark when discovery provides it", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai-codex",
      modelId: "gpt-5.3-codex-spark",
      templateModel: {
        ...buildOpenAICodexForwardCompatExpectation("gpt-5.3-codex-spark"),
        name: "GPT-5.3 Codex Spark",
        input: ["text"],
      },
    });

    const result = resolveModelForTest("openai-codex", "gpt-5.3-codex-spark", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openai-codex",
      id: "gpt-5.3-codex-spark",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
    });
  });

  it("rejects stale direct openai gpt-5.3-codex-spark discovery rows", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai",
      modelId: "gpt-5.3-codex-spark",
      templateModel: buildForwardCompatTemplate({
        id: "gpt-5.3-codex-spark",
        name: "GPT-5.3 Codex Spark",
        provider: "openai",
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      }),
    });

    const result = resolveModelForTest("openai", "gpt-5.3-codex-spark", "/tmp/agent");

    expect(result.model).toBeUndefined();
    expect(result.error).toBe(
      "Unknown model: openai/gpt-5.3-codex-spark. gpt-5.3-codex-spark is only supported via openai-codex OAuth. Use openai-codex/gpt-5.3-codex-spark.",
    );
  });

  it("applies provider overrides to openai gpt-5.4 forward-compat models", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai",
      modelId: "gpt-5.2",
      templateModel: buildForwardCompatTemplate({
        id: "gpt-5.2",
        name: "GPT-5.2",
        provider: "openai",
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      }),
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://proxy.example.com/v1",
            headers: { "X-Proxy-Auth": "token-123" },
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("openai", "gpt-5.4", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openai",
      id: "gpt-5.4",
      api: "openai-responses",
      baseUrl: "https://proxy.example.com/v1",
    });
    expect((result.model as unknown as { headers?: Record<string, string> }).headers).toMatchObject(
      {
        "X-Proxy-Auth": "token-123",
      },
    );
  });

  it("applies configured overrides to github-copilot dynamic models", () => {
    const cfg = {
      models: {
        providers: {
          "github-copilot": {
            baseUrl: "https://proxy.example.com/v1",
            api: "openai-completions",
            headers: { "X-Proxy-Auth": "token-123" },
            models: [
              {
                ...makeModel("gpt-5.4-mini"),
                reasoning: true,
                input: ["text"],
                contextWindow: 256000,
                maxTokens: 32000,
              },
            ],
          },
        },
      },
    } as unknown as OpenClawConfig;

    const result = resolveModelForTest("github-copilot", "gpt-5.4-mini", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "github-copilot",
      id: "gpt-5.4-mini",
      api: "openai-completions",
      baseUrl: "https://proxy.example.com/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 32000,
    });
    expect((result.model as unknown as { headers?: Record<string, string> }).headers).toMatchObject(
      {
        "X-Proxy-Auth": "token-123",
      },
    );
  });

  it("builds an openai fallback for gpt-5.4 mini from the gpt-5-mini template", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai",
      modelId: "gpt-5-mini",
      templateModel: buildForwardCompatTemplate({
        id: "gpt-5-mini",
        name: "GPT-5 mini",
        provider: "openai",
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400_000,
        maxTokens: 128_000,
      }),
    });

    const result = resolveModelForTest("openai", "gpt-5.4-mini", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openai",
      id: "gpt-5.4-mini",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400_000,
      maxTokens: 128_000,
    });
  });

  it("builds an openai fallback for gpt-5.4 nano from the gpt-5-nano template", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai",
      modelId: "gpt-5-nano",
      templateModel: buildForwardCompatTemplate({
        id: "gpt-5-nano",
        name: "GPT-5 nano",
        provider: "openai",
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400_000,
        maxTokens: 128_000,
      }),
    });

    const result = resolveModelForTest("openai", "gpt-5.4-nano", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openai",
      id: "gpt-5.4-nano",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400_000,
      maxTokens: 128_000,
    });
  });

  it("normalizes stale native openai gpt-5.4 completions transport to responses", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai",
      modelId: "gpt-5.4",
      templateModel: buildForwardCompatTemplate({
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "openai",
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
      }),
    });

    const result = resolveModelForTest("openai", "gpt-5.4", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openai",
      id: "gpt-5.4",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("keeps proxied openai completions transport untouched", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "openai",
      modelId: "gpt-5.4",
      templateModel: buildForwardCompatTemplate({
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "openai",
        api: "openai-completions",
        baseUrl: "https://proxy.example.com/v1",
      }),
    });

    const result = resolveModelForTest("openai", "gpt-5.4", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "openai",
      id: "gpt-5.4",
      api: "openai-completions",
      baseUrl: "https://proxy.example.com/v1",
    });
  });

  it("normalizes stale native xai completions transport to responses", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "xai",
      modelId: "grok-4.20-beta-latest-reasoning",
      templateModel: buildForwardCompatTemplate({
        id: "grok-4.20-beta-latest-reasoning",
        name: "Grok 4.20 Beta Latest (Reasoning)",
        provider: "xai",
        api: "openai-completions",
        baseUrl: "https://api.x.ai/v1",
      }),
    });

    const result = resolveModelForTest("xai", "grok-4.20-beta-latest-reasoning", "/tmp/agent");

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "xai",
      id: "grok-4.20-beta-latest-reasoning",
      api: "openai-responses",
      baseUrl: "https://api.x.ai/v1",
    });
  });

  it("normalizes stale native xai completions transport after plugin model normalization", () => {
    mockDiscoveredModel(discoverModels, {
      provider: "xai",
      modelId: "grok-4.20-beta-latest-reasoning",
      templateModel: buildForwardCompatTemplate({
        id: "grok-4.20-beta-latest-reasoning",
        name: "Grok 4.20 Beta Latest (Reasoning)",
        provider: "xai",
        api: "openai-completions",
        baseUrl: "https://api.x.ai/v1",
      }),
    });

    const result = resolveModel("xai", "grok-4.20-beta-latest-reasoning", "/tmp/agent", undefined, {
      authStorage: { mocked: true } as never,
      modelRegistry: discoverModels({ mocked: true } as never, "/tmp/agent"),
      runtimeHooks: {
        applyProviderResolvedModelCompatWithPlugins: () => undefined,
        buildProviderUnknownModelHintWithPlugin: () => undefined,
        prepareProviderDynamicModel: async () => {},
        runProviderDynamicModel: () => undefined,
        applyProviderResolvedTransportWithPlugin: ({ provider, context }) =>
          provider === "xai" &&
          context.model.api === "openai-completions" &&
          context.model.baseUrl === "https://api.x.ai/v1"
            ? {
                ...context.model,
                api: "openai-responses",
              }
            : undefined,
        normalizeProviderResolvedModelWithPlugin: ({ provider, context }) =>
          provider === "xai" ? (context.model as never) : undefined,
        normalizeProviderTransportWithPlugin: () => undefined,
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "xai",
      id: "grok-4.20-beta-latest-reasoning",
      api: "openai-responses",
      baseUrl: "https://api.x.ai/v1",
    });
  });
});
