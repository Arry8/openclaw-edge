import type { StreamFn } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createSseEmptyDataGuardWrapper } from "./sse-stream-guard.js";

// ---------------------------------------------------------------------------
// Helpers — minimal stream mocks
// ---------------------------------------------------------------------------

type MockEvent = { type: string; text?: string };

/**
 * Creates a fake StreamFn whose async iterator yields the given sequence of
 * events. If an entry is an Error, it is thrown from the iterator instead.
 */
function createMockStreamFn(sequence: Array<MockEvent | Error>): StreamFn {
  return (() => {
    let index = 0;
    const stream = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<MockEvent>> {
            if (index >= sequence.length) {
              return { done: true, value: undefined as unknown as MockEvent };
            }
            const item = sequence[index++];
            if (item instanceof Error) {
              throw item;
            }
            return { done: false, value: item };
          },
        };
      },
      result: async () => ({ role: "assistant", content: [] }),
    };
    return stream;
  }) as unknown as StreamFn;
}

async function collectEvents(streamFn: StreamFn): Promise<MockEvent[]> {
  const streamOrPromise = streamFn({} as Parameters<StreamFn>[0], {} as Parameters<StreamFn>[1]);
  const stream = streamOrPromise instanceof Promise ? await streamOrPromise : streamOrPromise;
  const events: MockEvent[] = [];
  for await (const event of stream as AsyncIterable<MockEvent>) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSseEmptyDataGuardWrapper", () => {
  it("forwards normal events untouched", async () => {
    const base = createMockStreamFn([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "done" },
    ]);

    const guarded = createSseEmptyDataGuardWrapper(base);
    const events = await collectEvents(guarded);

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "done" },
    ]);
  });

  it("skips empty JSON parse errors (Unexpected end of JSON input)", async () => {
    const base = createMockStreamFn([
      { type: "text_delta", text: "Hello" },
      new SyntaxError("Unexpected end of JSON input"),
      { type: "text_delta", text: " world" },
      { type: "done" },
    ]);

    const guarded = createSseEmptyDataGuardWrapper(base);
    const events = await collectEvents(guarded);

    // The SyntaxError should have been swallowed
    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "done" },
    ]);
  });

  it("skips multiple consecutive empty-data errors", async () => {
    const base = createMockStreamFn([
      new SyntaxError("Unexpected end of JSON input"),
      new SyntaxError("Unexpected end of JSON input"),
      { type: "text_delta", text: "recovered" },
      { type: "done" },
    ]);

    const guarded = createSseEmptyDataGuardWrapper(base);
    const events = await collectEvents(guarded);

    expect(events).toEqual([{ type: "text_delta", text: "recovered" }, { type: "done" }]);
  });

  it("re-throws non-JSON-parse errors", async () => {
    const base = createMockStreamFn([
      { type: "text_delta", text: "Hello" },
      new Error("Network connection lost"),
    ]);

    const guarded = createSseEmptyDataGuardWrapper(base);

    await expect(collectEvents(guarded)).rejects.toThrow("Network connection lost");
  });

  it("re-throws generic SyntaxError that is not about JSON parsing", async () => {
    const base = createMockStreamFn([new SyntaxError("Unexpected token < in module")]);

    const guarded = createSseEmptyDataGuardWrapper(base);

    await expect(collectEvents(guarded)).rejects.toThrow("Unexpected token < in module");
  });

  it("handles empty data with JSON Parse error message variant", async () => {
    const base = createMockStreamFn([
      { type: "text_delta", text: "data" },
      new SyntaxError("JSON Parse error: Unexpected EOF"),
      { type: "done" },
    ]);

    const guarded = createSseEmptyDataGuardWrapper(base);
    const events = await collectEvents(guarded);

    expect(events).toEqual([{ type: "text_delta", text: "data" }, { type: "done" }]);
  });

  it("preserves stream.result() passthrough", async () => {
    const base = createMockStreamFn([{ type: "done" }]);
    const guarded = createSseEmptyDataGuardWrapper(base);

    const stream = guarded({} as Parameters<StreamFn>[0], {} as Parameters<StreamFn>[1]);

    // Consume all events
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }

    // result() should still work
    const result = await (stream as { result: () => Promise<unknown> }).result();
    expect(result).toBeDefined();
  });

  it("uses streamSimple when no base streamFn is provided", () => {
    // Should not throw — just creates a wrapper around the default
    const guarded = createSseEmptyDataGuardWrapper(undefined);
    expect(typeof guarded).toBe("function");
  });

  it("handles base streamFn that returns a Promise", async () => {
    // Simulate a StreamFn whose return value is a Promise<stream>
    const asyncBase = ((..._args: unknown[]) => {
      let index = 0;
      const seq: Array<MockEvent | Error> = [
        { type: "text_delta", text: "async" },
        new SyntaxError("Unexpected end of JSON input"),
        { type: "done" },
      ];
      const stream = {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<MockEvent>> {
              if (index >= seq.length) {
                return { done: true, value: undefined as unknown as MockEvent };
              }
              const item = seq[index++];
              if (item instanceof Error) {
                throw item;
              }
              return { done: false, value: item };
            },
          };
        },
        result: async () => ({ role: "assistant", content: [] }),
      };
      return Promise.resolve(stream);
    }) as unknown as StreamFn;

    const guarded = createSseEmptyDataGuardWrapper(asyncBase);
    const events = await collectEvents(guarded);

    expect(events).toEqual([{ type: "text_delta", text: "async" }, { type: "done" }]);
  });

  it("re-throws Error with JSON-like message that is not a SyntaxError", async () => {
    // An ordinary Error whose message mentions JSON should NOT be swallowed,
    // because only SyntaxError is thrown by JSON.parse.
    const base = createMockStreamFn([new Error("Unexpected end of JSON input")]);

    const guarded = createSseEmptyDataGuardWrapper(base);
    await expect(collectEvents(guarded)).rejects.toThrow("Unexpected end of JSON input");
  });
});
