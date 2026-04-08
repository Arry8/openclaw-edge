import { describe, expect, it, vi } from "vitest";
import { captureSubagentCompletionReplyUsing } from "./subagent-announce-capture.js";

describe("captureSubagentCompletionReply", () => {
  it("returns immediate assistant output from history without polling", async () => {
    const readSubagentOutput = vi
      .fn<(sessionKey: string) => Promise<string | undefined>>()
      .mockResolvedValue("Immediate assistant completion");

    const result = await captureSubagentCompletionReplyUsing({
      sessionKey: "agent:main:subagent:child",
      maxWaitMs: 50,
      retryIntervalMs: 8,
      readSubagentOutput,
    });

    expect(result).toBe("Immediate assistant completion");
    expect(readSubagentOutput).toHaveBeenCalledTimes(1);
  });

  it("polls briefly and returns late tool output once available", async () => {
    vi.useFakeTimers();
    const readSubagentOutput = vi
      .fn<(sessionKey: string) => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("Late tool result completion");

    const pending = captureSubagentCompletionReplyUsing({
      sessionKey: "agent:main:subagent:child",
      maxWaitMs: 50,
      retryIntervalMs: 8,
      readSubagentOutput,
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toBe("Late tool result completion");
    expect(readSubagentOutput).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("returns undefined when no completion output arrives before retry window closes", async () => {
    vi.useFakeTimers();
    const readSubagentOutput = vi
      .fn<(sessionKey: string) => Promise<string | undefined>>()
      .mockResolvedValue(undefined);

    const pending = captureSubagentCompletionReplyUsing({
      sessionKey: "agent:main:subagent:child",
      maxWaitMs: 50,
      retryIntervalMs: 8,
      readSubagentOutput,
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toBeUndefined();
    expect(readSubagentOutput).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("returns partial assistant progress when the latest assistant turn is tool-only", async () => {
    const readSubagentOutput = vi
      .fn<(sessionKey: string) => Promise<string | undefined>>()
      .mockResolvedValue("Mapped the modules.");

    const result = await captureSubagentCompletionReplyUsing({
      sessionKey: "agent:main:subagent:child",
      maxWaitMs: 50,
      retryIntervalMs: 8,
      readSubagentOutput,
    });

    expect(result).toBe("Mapped the modules.");
  });

  it("includes exec tool result output alongside final assistant summary", async () => {
    chatHistoryMock.mockResolvedValueOnce({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "exec",
              arguments: { command: "wc -c file.json" },
            },
          ],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "123 file.json" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "The file has 123 bytes." }],
        },
      ],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:child");

    expect(result).toContain("123 file.json");
    expect(result).toContain("The file has 123 bytes.");
  });

  it("resets tool results after intermediate assistant summary", async () => {
    chatHistoryMock.mockResolvedValueOnce({
      messages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "exec", arguments: {} }],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "first command output" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "First round done." }],
        },
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-2", name: "exec", arguments: {} }],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "second command output" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "All done." }],
        },
      ],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:child");

    // First round output was absorbed by "First round done." and should not reappear
    expect(result).not.toContain("first command output");
    expect(result).toContain("second command output");
    expect(result).toContain("All done.");
  });

  it("includes multiple tool results from the same final round", async () => {
    chatHistoryMock.mockResolvedValueOnce({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-1", name: "exec", arguments: {} },
            { type: "toolCall", id: "call-2", name: "exec", arguments: {} },
          ],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "output A" }],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "output B" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Final summary." }],
        },
      ],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:child");

    expect(result).toContain("output A");
    expect(result).toContain("output B");
    expect(result).toContain("Final summary.");
  });

  it("extracts tool result from nested content object", async () => {
    chatHistoryMock.mockResolvedValueOnce({
      messages: [
        {
          role: "toolResult",
          content: {
            content: [{ type: "text", text: "nested tool output" }],
            details: { status: "completed" },
          },
        },
      ],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:child");

    expect(result).toBe("nested tool output");
  });
});
