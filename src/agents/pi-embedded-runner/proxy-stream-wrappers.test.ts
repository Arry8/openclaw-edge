import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context, Model } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { createOpenRouterSystemCacheWrapper, createOpenRouterWrapper } from "./proxy-stream-wrappers.js";

describe("proxy stream wrappers", () => {
  it("adds OpenRouter attribution headers to stream options", () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push({
        headers: options?.headers,
      });
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterWrapper(baseStreamFn);
    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "openrouter/auto",
    } as Model<"openai-completions">;
    const context: Context = { messages: [] };

    void wrapped(model, context, { headers: { "X-Custom": "1" } });

    expect(calls).toEqual([
      {
        headers: {
          "HTTP-Referer": "https://openclaw.ai",
          "X-OpenRouter-Title": "OpenClaw",
          "X-OpenRouter-Categories": "cli-agent",
          "X-Custom": "1",
        },
      },
    ]);
  });

  it("adds cache_control to system message for OpenRouter Anthropic models", () => {
    let capturedPayload: unknown;
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      // Simulate the transport calling onPayload with the outgoing payload
      options?.onPayload?.({
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      });
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "anthropic/claude-sonnet-4",
    } as Model<"openai-completions">;

    wrapped(model, { messages: [] }, {
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    });

    const systemMsg = (capturedPayload as { messages: Array<{ role: string; content: unknown }> })
      .messages[0];
    expect(systemMsg.content).toEqual([
      {
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("adds cache_control to system message for OpenRouter DeepSeek models", () => {
    let capturedPayload: unknown;
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      options?.onPayload?.({
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      });
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "deepseek/deepseek-v3.2",
    } as Model<"openai-completions">;

    wrapped(model, { messages: [] }, {
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    });

    const systemMsg = (capturedPayload as { messages: Array<{ role: string; content: unknown }> })
      .messages[0];
    expect(systemMsg.content).toEqual([
      {
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("passes through without modification for non-cacheable OpenRouter models", () => {
    let capturedPayload: unknown;
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      options?.onPayload?.({
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      });
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "openai/gpt-4",
    } as Model<"openai-completions">;

    wrapped(model, { messages: [] }, {
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    });

    // Non-cacheable models should pass through unmodified — content stays as string
    const systemMsg = (capturedPayload as { messages: Array<{ role: string; content: unknown }> })
      .messages[0];
    expect(systemMsg.content).toBe("You are a helpful assistant.");
  });

  it("passes through without modification for non-OpenRouter providers", () => {
    let capturedPayload: unknown;
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      options?.onPayload?.({
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      });
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    const model = {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude-sonnet-4-20250514",
    } as Model<"anthropic-messages">;

    wrapped(model, { messages: [] }, {
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    });

    // Non-OpenRouter providers should pass through unmodified
    const systemMsg = (capturedPayload as { messages: Array<{ role: string; content: unknown }> })
      .messages[0];
    expect(systemMsg.content).toBe("You are a helpful assistant.");
  });
});
