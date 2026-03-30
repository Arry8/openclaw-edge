import { describe, expect, it } from "vitest";
import { registerSingleProviderPlugin } from "../../test/helpers/plugins/plugin-registration.js";
import amazonBedrockPlugin from "./index.js";

// Minimal shapes for the deeply generic pi-ai/plugin types used in tests.
// Tests return the options object (not a real stream) to assert injected fields.
type TestStreamModel = { api: string; provider: string; id: string };
type TestStreamContext = { messages: unknown[] };
type TestStreamOptions = Record<string, unknown>;
type TestStreamFn = (model: TestStreamModel, context: TestStreamContext, options: TestStreamOptions) => TestStreamOptions;
type TestConfig = {
  models?: {
    bedrockDiscovery?: { region?: string };
    providers?: Record<string, { baseUrl?: string; models?: Array<{ id: string; name: string }> }>;
  };
};

const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
const passThroughFn: TestStreamFn = (_model, _context, options) => options;

function wrapStream(modelId: string, config?: TestConfig) {
  return provider.wrapStreamFn?.({
    provider: "amazon-bedrock",
    modelId,
    config,
    streamFn: passThroughFn,
  } as never) as TestStreamFn | null | undefined;
}

function invokeWrapped(wrapped: TestStreamFn | null | undefined, modelId: string, api = "bedrock-converse-stream") {
  return wrapped?.({ api, provider: "amazon-bedrock", id: modelId }, { messages: [] }, {});
}

describe("amazon-bedrock provider plugin", () => {
  it("marks Claude 4.6 Bedrock models as adaptive by default", () => {
    expect(
      provider.resolveDefaultThinkingLevel?.({
        provider: "amazon-bedrock",
        modelId: "us.anthropic.claude-opus-4-6-v1",
      }),
    ).toBe("adaptive");
    expect(
      provider.resolveDefaultThinkingLevel?.({
        provider: "amazon-bedrock",
        modelId: "amazon.nova-micro-v1:0",
      }),
    ).toBeUndefined();
  });

  describe("prompt caching", () => {
    it("enables prompt caching for inference profile ARNs with 'claude' in profile ID", () => {
      const arn =
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-claude-profile";
      const result = wrapStream(arn, {
        models: {
          providers: {
            "amazon-bedrock": {
              models: [{ id: arn, name: "Claude Sonnet 4.6 via Inference Profile" }],
            },
          },
        },
      });
      expect(result).toBe(passThroughFn);
    });

    it("enables prompt caching for inference profile when config uses provider alias", () => {
      const arn =
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-claude-profile";
      const result = wrapStream(arn, {
        models: {
          providers: {
            bedrock: {
              models: [{ id: arn, name: "Claude Sonnet 4.6 via Inference Profile" }],
            },
          },
        },
      });
      expect(result).toBe(passThroughFn);
    });

    it("disables prompt caching for inference profile ARNs without 'claude' in profile ID", () => {
      const arn =
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/llama-profile";
      const wrapped = wrapStream(arn, {
        models: {
          providers: {
            "amazon-bedrock": {
              models: [{ id: arn, name: "Llama 2 via Inference Profile" }],
            },
          },
        },
      });
      expect(invokeWrapped(wrapped, arn, "openai-completions")).toMatchObject({
        cacheRetention: "none",
      });
    });

    it("disables prompt caching for inference profile ARNs with no config entry", () => {
      const arn =
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/unknown-profile";
      const wrapped = wrapStream(arn);
      expect(invokeWrapped(wrapped, arn, "openai-completions")).toMatchObject({
        cacheRetention: "none",
      });
    });

    it("disables prompt caching for non-Anthropic Bedrock models", () => {
      const modelId = "amazon.nova-micro-v1:0";
      const wrapped = wrapStream(modelId);
      expect(invokeWrapped(wrapped, modelId, "openai-completions")).toMatchObject({
        cacheRetention: "none",
      });
    });
  });

  describe("region injection", () => {
    it("injects region from bedrockDiscovery config", () => {
      const modelId = "eu.anthropic.claude-sonnet-4-6";
      const wrapped = wrapStream(modelId, {
        models: { bedrockDiscovery: { region: "eu-west-1" } },
      });
      expect(invokeWrapped(wrapped, modelId)).toMatchObject({ region: "eu-west-1" });
    });

    it("injects region extracted from provider baseUrl", () => {
      const modelId = "eu.anthropic.claude-sonnet-4-6";
      const wrapped = wrapStream(modelId, {
        models: {
          providers: {
            "amazon-bedrock": {
              baseUrl: "https://bedrock-runtime.eu-central-1.amazonaws.com",
              models: [],
            },
          },
        },
      });
      expect(invokeWrapped(wrapped, modelId)).toMatchObject({ region: "eu-central-1" });
    });

    it("prefers provider baseUrl region over bedrockDiscovery region", () => {
      const modelId = "eu.anthropic.claude-sonnet-4-6";
      const wrapped = wrapStream(modelId, {
        models: {
          bedrockDiscovery: { region: "us-east-1" },
          providers: {
            "amazon-bedrock": {
              baseUrl: "https://bedrock-runtime.eu-west-1.amazonaws.com",
              models: [],
            },
          },
        },
      });
      expect(invokeWrapped(wrapped, modelId)).toMatchObject({ region: "eu-west-1" });
    });

    it("does not inject region when neither bedrockDiscovery nor baseUrl is configured", () => {
      const result = wrapStream("anthropic.claude-sonnet-4-6");
      expect(result).toBe(passThroughFn);
    });
  });
});
