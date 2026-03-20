import { describe, expect, it } from "vitest";
import { registerSingleProviderPlugin } from "../../test/helpers/plugins/plugin-registration.js";
import amazonBedrockPlugin from "./index.js";

describe("amazon-bedrock provider plugin", () => {
  it("marks Claude 4.6 Bedrock models as adaptive by default", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);

    expect(
      provider.resolveDefaultThinkingLevel?.({
        provider: "amazon-bedrock",
        modelId: "us.anthropic.claude-opus-4-6-v1",
      } as never),
    ).toBe("adaptive");
    expect(
      provider.resolveDefaultThinkingLevel?.({
        provider: "amazon-bedrock",
        modelId: "amazon.nova-micro-v1:0",
      } as never),
    ).toBeUndefined();
  });

  it("enables prompt caching for Application Inference Profile ARNs with Claude model name", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const arn =
      "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-claude-profile";
    const result = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: arn,
      config: {
        models: {
          providers: {
            "amazon-bedrock": {
              models: [{ id: arn, name: "Claude Sonnet 4.6 via Inference Profile" }],
            },
          },
        },
      },
      streamFn: baseFn,
    } as never);

    // Should return the original streamFn (no no-cache wrapper)
    expect(result).toBe(baseFn);
  });

  it("enables prompt caching for inference profile when config uses provider alias", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const arn =
      "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-claude-profile";
    const result = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: arn,
      config: {
        models: {
          providers: {
            // "bedrock" is a known alias that normalizeProviderId maps to "amazon-bedrock"
            bedrock: {
              models: [{ id: arn, name: "Claude Sonnet 4.6 via Inference Profile" }],
            },
          },
        },
      },
      streamFn: baseFn,
    } as never);

    // Should return the original streamFn even when config key is "bedrock" alias
    expect(result).toBe(baseFn);
  });

  it("disables prompt caching for Application Inference Profile ARNs with non-Claude model name", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const arn =
      "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/llama-profile";
    const wrapped = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: arn,
      config: {
        models: {
          providers: {
            "amazon-bedrock": {
              models: [{ id: arn, name: "Llama 2 via Inference Profile" }],
            },
          },
        },
      },
      streamFn: baseFn,
    } as never);

    expect(
      wrapped?.(
        { api: "openai-completions", provider: "amazon-bedrock", id: arn } as never,
        { messages: [] } as never,
        {},
      ),
    ).toMatchObject({ cacheRetention: "none" });
  });

  it("disables prompt caching for Application Inference Profile ARNs with no config entry", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const arn =
      "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/unknown-profile";
    const wrapped = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: arn,
      streamFn: baseFn,
    } as never);

    expect(
      wrapped?.(
        { api: "openai-completions", provider: "amazon-bedrock", id: arn } as never,
        { messages: [] } as never,
        {},
      ),
    ).toMatchObject({ cacheRetention: "none" });
  });

  it("disables prompt caching for non-Anthropic Bedrock models", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const wrapped = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: "amazon.nova-micro-v1:0",
      streamFn: (_model: unknown, _context: unknown, options: Record<string, unknown>) => options,
    } as never);

    expect(
      wrapped?.(
        {
          api: "openai-completions",
          provider: "amazon-bedrock",
          id: "amazon.nova-micro-v1:0",
        } as never,
        { messages: [] } as never,
        {},
      ),
    ).toMatchObject({
      cacheRetention: "none",
    });
  });

  it("injects region from bedrockDiscovery config into stream options", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const wrapped = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: "eu.anthropic.claude-sonnet-4-6",
      config: {
        models: {
          bedrockDiscovery: { region: "eu-west-1" },
        },
      },
      streamFn: baseFn,
    } as never);

    const result = wrapped?.(
      {
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        id: "eu.anthropic.claude-sonnet-4-6",
      } as never,
      { messages: [] } as never,
      {},
    );
    expect(result).toMatchObject({ region: "eu-west-1" });
  });

  it("injects region extracted from provider baseUrl into stream options", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const wrapped = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: "eu.anthropic.claude-sonnet-4-6",
      config: {
        models: {
          providers: {
            "amazon-bedrock": {
              baseUrl: "https://bedrock-runtime.eu-central-1.amazonaws.com",
              models: [],
            },
          },
        },
      },
      streamFn: baseFn,
    } as never);

    const result = wrapped?.(
      {
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        id: "eu.anthropic.claude-sonnet-4-6",
      } as never,
      { messages: [] } as never,
      {},
    );
    expect(result).toMatchObject({ region: "eu-central-1" });
  });

  it("does not inject region when neither bedrockDiscovery nor baseUrl is configured", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);
    const baseFn = (_model: never, _context: never, options: Record<string, unknown>) => options;
    const result = provider.wrapStreamFn?.({
      provider: "amazon-bedrock",
      modelId: "anthropic.claude-sonnet-4-6",
      streamFn: baseFn,
    } as never);

    // Without region config, Claude model returns the base streamFn directly
    expect(result).toBe(baseFn);
  });
});
