import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadChannelOutboundAdapter: vi.fn(),
  loadConfig: vi.fn(() => ({ test: true })),
  sendText: vi.fn(async () => ({ messageId: "m1" })),
}));

vi.mock("../../channels/plugins/outbound/load.js", () => ({
  loadChannelOutboundAdapter: mocks.loadChannelOutboundAdapter,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

import { createChannelOutboundRuntimeSend } from "./channel-outbound-send.js";

describe("createChannelOutboundRuntimeSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadChannelOutboundAdapter.mockResolvedValue({
      sendText: mocks.sendText,
    });
  });

  it("forwards threadTs alias to threadId", async () => {
    const runtimeSend = createChannelOutboundRuntimeSend({
      channelId: "slack",
      unavailableMessage: "missing",
    });

    await runtimeSend.sendMessage("C123", "hello", {
      threadTs: "1712345678.123456",
    });

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "C123",
        text: "hello",
        threadId: "1712345678.123456",
      }),
    );
  });

  it("forwards replyToId alias to replyToId", async () => {
    const runtimeSend = createChannelOutboundRuntimeSend({
      channelId: "slack",
      unavailableMessage: "missing",
    });

    await runtimeSend.sendMessage("C123", "hello", {
      replyToId: "1712000000.000001",
    });

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "C123",
        text: "hello",
        replyToId: "1712000000.000001",
      }),
    );
  });

  it("prefers canonical fields over aliases", async () => {
    const runtimeSend = createChannelOutboundRuntimeSend({
      channelId: "slack",
      unavailableMessage: "missing",
    });

    await runtimeSend.sendMessage("C123", "hello", {
      messageThreadId: "200.000",
      threadTs: "100.000",
      replyToMessageId: "400.000",
      replyToId: "300.000",
    });

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "200.000",
        replyToId: "400.000",
      }),
    );
  });
});
