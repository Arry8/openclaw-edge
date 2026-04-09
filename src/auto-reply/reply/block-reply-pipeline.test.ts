import { describe, expect, it } from "vitest";
import {
  createBlockReplyContentKey,
  createBlockReplyPayloadKey,
  createBlockReplyPipeline,
} from "./block-reply-pipeline.js";

describe("createBlockReplyPayloadKey", () => {
  it("produces different keys for payloads differing only by replyToId", () => {
    const a = createBlockReplyPayloadKey({ text: "hello world", replyToId: "post-1" });
    const b = createBlockReplyPayloadKey({ text: "hello world", replyToId: "post-2" });
    const c = createBlockReplyPayloadKey({ text: "hello world" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("produces different keys for payloads with different text", () => {
    const a = createBlockReplyPayloadKey({ text: "hello" });
    const b = createBlockReplyPayloadKey({ text: "world" });
    expect(a).not.toBe(b);
  });

  it("produces different keys for payloads with different media", () => {
    const a = createBlockReplyPayloadKey({ text: "hello", mediaUrl: "file:///a.png" });
    const b = createBlockReplyPayloadKey({ text: "hello", mediaUrl: "file:///b.png" });
    expect(a).not.toBe(b);
  });

  it("trims whitespace from text for key comparison", () => {
    const a = createBlockReplyPayloadKey({ text: "  hello  " });
    const b = createBlockReplyPayloadKey({ text: "hello" });
    expect(a).toBe(b);
  });
});

describe("createBlockReplyContentKey", () => {
  it("produces the same key for payloads differing only by replyToId", () => {
    const a = createBlockReplyContentKey({ text: "hello world", replyToId: "post-1" });
    const b = createBlockReplyContentKey({ text: "hello world", replyToId: "post-2" });
    const c = createBlockReplyContentKey({ text: "hello world" });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});

describe("createBlockReplyPipeline dedup with threading", () => {
  it("keeps separate deliveries for same text with different replyToId", async () => {
    const sent: Array<{ text?: string; replyToId?: string }> = [];
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async (payload) => {
        sent.push({ text: payload.text, replyToId: payload.replyToId });
      },
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "response text", replyToId: "thread-root-1" });
    pipeline.enqueue({ text: "response text", replyToId: undefined });
    await pipeline.flush();

    expect(sent).toEqual([
      { text: "response text", replyToId: "thread-root-1" },
      { text: "response text", replyToId: undefined },
    ]);
  });

  it("hasSentPayload matches regardless of replyToId", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "response text", replyToId: "thread-root-1" });
    await pipeline.flush();

    // Final payload with no replyToId should be recognized as already sent
    expect(pipeline.hasSentPayload({ text: "response text" })).toBe(true);
    expect(pipeline.hasSentPayload({ text: "response text", replyToId: "other-id" })).toBe(true);
  });
});

describe("createBlockReplyPipeline content coverage dedup", () => {
  it("detects when streamed chunks cover final assembled payload", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    // Simulate block streaming sending two paragraph chunks
    pipeline.enqueue({ text: "First paragraph." });
    pipeline.enqueue({ text: "Second paragraph." });
    await pipeline.flush();

    // Final assembled payload combines both paragraphs
    expect(pipeline.hasSentPayload({ text: "First paragraph.\n\nSecond paragraph." })).toBe(true);
  });

  it("detects when streamed chunks cover final payload with different whitespace", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "Hello world." });
    pipeline.enqueue({ text: "How are you?" });
    await pipeline.flush();

    // Final payload with newlines between chunks
    expect(pipeline.hasSentPayload({ text: "Hello world.\nHow are you?" })).toBe(true);
  });

  it("returns false when final payload has new content not streamed", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "First paragraph." });
    await pipeline.flush();

    // Final payload has extra content that was never streamed
    expect(pipeline.hasSentPayload({ text: "First paragraph. Extra content not streamed." })).toBe(
      false,
    );
  });

  it("does not suppress media payloads via content coverage", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "Description" });
    await pipeline.flush();

    // Even though text matches, media payload should not be suppressed
    expect(pipeline.hasSentPayload({ text: "Description", mediaUrl: "file:///photo.jpg" })).toBe(
      false,
    );
  });

  it("detects single chunk covering single final payload", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "Short reply" });
    await pipeline.flush();

    // Exact content key match should work
    expect(pipeline.hasSentPayload({ text: "Short reply" })).toBe(true);
  });

  it("detects subset match when final payload is part of streamed content", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "Message one." });
    pipeline.enqueue({ text: "Message two." });
    pipeline.enqueue({ text: "Message three." });
    await pipeline.flush();

    // Final payload is a subset of what was streamed
    expect(pipeline.hasSentPayload({ text: "Message one." })).toBe(true);
    expect(pipeline.hasSentPayload({ text: "Message one. Message two." })).toBe(true);
  });

  it("returns false when nothing was streamed", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    // No chunks enqueued, so nothing streamed
    expect(pipeline.hasSentPayload({ text: "Some text" })).toBe(false);
  });

  it("handles empty final payload text as covered", async () => {
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {},
      timeoutMs: 5000,
    });

    pipeline.enqueue({ text: "Some content" });
    await pipeline.flush();

    // Empty text with no media is vacuously covered
    expect(pipeline.hasSentPayload({ text: "" })).toBe(true);
    expect(pipeline.hasSentPayload({ text: "   " })).toBe(true);
  });
});

describe("createBlockReplyPipeline timeout abort with content coverage", () => {
  it("detects content coverage even after pipeline aborts from timeout", async () => {
    let callCount = 0;
    const pipeline = createBlockReplyPipeline({
      onBlockReply: async () => {
        callCount++;
        if (callCount >= 2) {
          // Simulate slow delivery that causes timeout
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      },
      timeoutMs: 50,
    });

    // First chunk succeeds quickly
    pipeline.enqueue({ text: "First paragraph." });
    // Second chunk will timeout
    pipeline.enqueue({ text: "Second paragraph." });
    await pipeline.flush();

    // Pipeline should have streamed at least the first chunk
    expect(pipeline.didStream()).toBe(true);

    // hasSentPayload should detect that the first chunk covers part of the final
    expect(pipeline.hasSentPayload({ text: "First paragraph." })).toBe(true);
  });
});
