import { describe, expect, it } from "vitest";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import {
  CRITICAL_THRESHOLD,
  GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  TOOL_CALL_HISTORY_SIZE,
  UNKNOWN_TOOL_REPEAT_THRESHOLD,
  WARNING_THRESHOLD,
  detectRepeatedUnknownToolCall,
  detectToolCallLoop,
  getToolCallStats,
  hashToolCall,
  recordToolCall,
  recordToolCallOutcome,
} from "./tool-loop-detection.js";

function createState(): SessionState {
  return {
    lastActivity: Date.now(),
    state: "processing",
    queueDepth: 0,
  };
}

const enabledLoopDetectionConfig: ToolLoopDetectionConfig = { enabled: true };

const shortHistoryLoopConfig: ToolLoopDetectionConfig = {
  enabled: true,
  historySize: 4,
};

function recordSuccessfulCall(
  state: SessionState,
  toolName: string,
  params: unknown,
  result: unknown,
  index: number,
): void {
  const toolCallId = `${toolName}-${index}`;
  recordToolCall(state, toolName, params, toolCallId);
  recordToolCallOutcome(state, {
    toolName,
    toolParams: params,
    toolCallId,
    result,
  });
}

function recordFailedCall(
  state: SessionState,
  toolName: string,
  params: unknown,
  error: unknown,
  index: number,
): void {
  const toolCallId = `${toolName}-err-${index}`;
  recordToolCall(state, toolName, params, toolCallId);
  recordToolCallOutcome(state, {
    toolName,
    toolParams: params,
    toolCallId,
    error,
  });
}

function recordRepeatedSuccessfulCalls(params: {
  state: SessionState;
  toolName: string;
  toolParams: unknown;
  result: unknown;
  count: number;
  startIndex?: number;
}) {
  const startIndex = params.startIndex ?? 0;
  for (let i = 0; i < params.count; i += 1) {
    recordSuccessfulCall(
      params.state,
      params.toolName,
      params.toolParams,
      params.result,
      startIndex + i,
    );
  }
}

function createNoProgressPollFixture(sessionId: string) {
  return {
    params: { action: "poll", sessionId },
    result: {
      content: [{ type: "text", text: "(no new output)\n\nProcess still running." }],
      details: { status: "running", aggregated: "steady" },
    },
  };
}

function createReadNoProgressFixture() {
  return {
    toolName: "read",
    params: { path: "/same.txt" },
    result: {
      content: [{ type: "text", text: "same output" }],
      details: { ok: true },
    },
  } as const;
}

function createPingPongFixture() {
  return {
    state: createState(),
    readParams: { path: "/a.txt" },
    listParams: { dir: "/workspace" },
  };
}

function detectLoopAfterRepeatedCalls(params: {
  toolName: string;
  toolParams: unknown;
  result: unknown;
  count: number;
  config?: ToolLoopDetectionConfig;
}) {
  const state = createState();
  recordRepeatedSuccessfulCalls({
    state,
    toolName: params.toolName,
    toolParams: params.toolParams,
    result: params.result,
    count: params.count,
  });
  return detectToolCallLoop(
    state,
    params.toolName,
    params.toolParams,
    params.config ?? enabledLoopDetectionConfig,
  );
}

function recordSuccessfulPingPongCalls(params: {
  state: SessionState;
  readParams: { path: string };
  listParams: { dir: string };
  count: number;
  textAtIndex: (toolName: "read" | "list", index: number) => string;
}) {
  for (let i = 0; i < params.count; i += 1) {
    if (i % 2 === 0) {
      recordSuccessfulCall(
        params.state,
        "read",
        params.readParams,
        { content: [{ type: "text", text: params.textAtIndex("read", i) }], details: { ok: true } },
        i,
      );
    } else {
      recordSuccessfulCall(
        params.state,
        "list",
        params.listParams,
        { content: [{ type: "text", text: params.textAtIndex("list", i) }], details: { ok: true } },
        i,
      );
    }
  }
}

function expectPingPongLoop(
  loopResult: ReturnType<typeof detectToolCallLoop>,
  expected: { level: "warning" | "critical"; count: number; expectCriticalText?: boolean },
) {
  expect(loopResult.stuck).toBe(true);
  if (!loopResult.stuck) {
    return;
  }
  expect(loopResult.level).toBe(expected.level);
  expect(loopResult.detector).toBe("ping_pong");
  expect(loopResult.count).toBe(expected.count);
  if (expected.expectCriticalText) {
    expect(loopResult.message).toContain("CRITICAL");
  }
}

describe("tool-loop-detection", () => {
  describe("hashToolCall", () => {
    it("creates consistent hash for same tool and params", () => {
      const hash1 = hashToolCall("read", { path: "/file.txt" });
      const hash2 = hashToolCall("read", { path: "/file.txt" });
      expect(hash1).toBe(hash2);
    });

    it("creates different hashes for different params", () => {
      const hash1 = hashToolCall("read", { path: "/file1.txt" });
      const hash2 = hashToolCall("read", { path: "/file2.txt" });
      expect(hash1).not.toBe(hash2);
    });

    it("creates different hashes for different tools", () => {
      const hash1 = hashToolCall("read", { path: "/file.txt" });
      const hash2 = hashToolCall("write", { path: "/file.txt" });
      expect(hash1).not.toBe(hash2);
    });

    it("handles non-object params", () => {
      expect(() => hashToolCall("tool", "string-param")).not.toThrow();
      expect(() => hashToolCall("tool", 123)).not.toThrow();
      expect(() => hashToolCall("tool", null)).not.toThrow();
    });

    it("produces deterministic hashes regardless of key order", () => {
      const hash1 = hashToolCall("tool", { a: 1, b: 2 });
      const hash2 = hashToolCall("tool", { b: 2, a: 1 });
      expect(hash1).toBe(hash2);
    });

    it("keeps hashes fixed-size even for large params", () => {
      const payload = { data: "x".repeat(20_000) };
      const hash = hashToolCall("read", payload);
      expect(hash.startsWith("read:")).toBe(true);
      expect(hash.length).toBe("read:".length + 64);
    });
  });

  describe("recordToolCall", () => {
    it("adds tool call to empty history", () => {
      const state = createState();

      recordToolCall(state, "read", { path: "/file.txt" }, "call-1");

      expect(state.toolCallHistory).toHaveLength(1);
      expect(state.toolCallHistory?.[0]?.toolName).toBe("read");
      expect(state.toolCallHistory?.[0]?.toolCallId).toBe("call-1");
    });

    it("maintains sliding window of last N calls", () => {
      const state = createState();

      for (let i = 0; i < TOOL_CALL_HISTORY_SIZE + 10; i += 1) {
        recordToolCall(state, "tool", { iteration: i }, `call-${i}`);
      }

      expect(state.toolCallHistory).toHaveLength(TOOL_CALL_HISTORY_SIZE);

      const oldestCall = state.toolCallHistory?.[0];
      expect(oldestCall?.argsHash).toBe(hashToolCall("tool", { iteration: 10 }));
    });

    it("records timestamp for each call", () => {
      const state = createState();
      const before = Date.now();
      recordToolCall(state, "tool", { arg: 1 }, "call-ts");
      const after = Date.now();

      const timestamp = state.toolCallHistory?.[0]?.timestamp ?? 0;
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it("does not clear stale history on its own (ownership is in detectToolCallLoop)", () => {
      const state = createState();

      // Record some calls with timestamps in the past (>60s ago)
      recordToolCall(state, "read", { path: "/file.txt" }, "old-1");
      recordToolCall(state, "read", { path: "/file.txt" }, "old-2");
      recordToolCall(state, "read", { path: "/file.txt" }, "old-3");
      expect(state.toolCallHistory).toHaveLength(3);

      // Manually backdate all entries to 2 minutes ago
      for (const call of state.toolCallHistory!) {
        call.timestamp = Date.now() - 120_000;
      }

      // recordToolCall no longer clears stale history — that responsibility
      // belongs to detectToolCallLoop which always runs first in production.
      recordToolCall(state, "read", { path: "/file.txt" }, "new-1");
      expect(state.toolCallHistory).toHaveLength(4);
    });

    it("does not clear history when last entry is recent", () => {
      const state = createState();

      recordToolCall(state, "read", { path: "/file.txt" }, "recent-1");
      recordToolCall(state, "read", { path: "/file.txt" }, "recent-2");
      expect(state.toolCallHistory).toHaveLength(2);

      // Record another call immediately — history should be preserved
      recordToolCall(state, "read", { path: "/file.txt" }, "recent-3");
      expect(state.toolCallHistory).toHaveLength(3);
    });

    it("respects configured historySize", () => {
      const state = createState();

      for (let i = 0; i < 10; i += 1) {
        recordToolCall(state, "tool", { iteration: i }, `call-${i}`, shortHistoryLoopConfig);
      }

      expect(state.toolCallHistory).toHaveLength(4);
      expect(state.toolCallHistory?.[0]?.argsHash).toBe(hashToolCall("tool", { iteration: 6 }));
    });
  });

  describe("detectToolCallLoop", () => {
    const execThresholdConfig: ToolLoopDetectionConfig = {
      enabled: true,
      warningThreshold: 3,
      criticalThreshold: 6,
      detectors: {
        genericRepeat: true,
        knownPollNoProgress: true,
        pingPong: true,
      },
    };

    it("is disabled by default", () => {
      const state = createState();

      for (let i = 0; i < 20; i += 1) {
        recordToolCall(state, "read", { path: "/same.txt" }, `default-${i}`);
      }

      const loopResult = detectToolCallLoop(state, "read", { path: "/same.txt" });
      expect(loopResult.stuck).toBe(false);
    });

    it("clears stale history before checking for loops", () => {
      const state = createState();

      // Simulate a previous heartbeat cycle with repeated calls that would
      // normally trigger a warning.
      for (let i = 0; i < WARNING_THRESHOLD; i += 1) {
        recordToolCall(state, "read", { path: "/same.txt" }, `old-${i}`);
      }
      expect(state.toolCallHistory).toHaveLength(WARNING_THRESHOLD);

      // Backdate all entries to 2 minutes ago (stale)
      for (const call of state.toolCallHistory!) {
        call.timestamp = Date.now() - 120_000;
      }

      // detectToolCallLoop should clear stale history before checking,
      // so the same tool+args should NOT trigger a warning.
      const result = detectToolCallLoop(
        state,
        "read",
        { path: "/same.txt" },
        enabledLoopDetectionConfig,
      );
      expect(result.stuck).toBe(false);
      expect(state.toolCallHistory).toHaveLength(0);
    });

    it("respects configurable staleThresholdMs", () => {
      const state = createState();

      for (let i = 0; i < WARNING_THRESHOLD; i += 1) {
        recordToolCall(state, "read", { path: "/same.txt" }, `old-${i}`);
      }

      // Backdate entries to 90 seconds ago — stale under default 60s but
      // fresh under a custom 120s threshold.
      for (const call of state.toolCallHistory!) {
        call.timestamp = Date.now() - 90_000;
      }

      // With a 120s threshold the history is still "fresh", so the loop
      // detector should see all the repeated calls and fire a warning.
      const result = detectToolCallLoop(
        state,
        "read",
        { path: "/same.txt" },
        { enabled: true, staleThresholdMs: 120_000 },
      );
      expect(result.stuck).toBe(true);
      expect(state.toolCallHistory).toHaveLength(WARNING_THRESHOLD);
    });

    it("detectToolCallLoop does not flag a loop on the first call of a new heartbeat cycle", () => {
      const state = createState();
      // Build up history to WARNING_THRESHOLD
      for (let i = 0; i < WARNING_THRESHOLD; i += 1) {
        recordToolCall(state, "read", { path: "/file.txt" }, `old-${i}`);
      }
      // Backdate all entries
      for (const call of state.toolCallHistory!) {
        call.timestamp = Date.now() - 120_000;
      }
      // Production order: detect THEN record
      const result = detectToolCallLoop(
        state,
        "read",
        { path: "/file.txt" },
        enabledLoopDetectionConfig,
      );
      expect(result.stuck).toBe(false);
      recordToolCall(state, "read", { path: "/file.txt" }, "new-1");
      expect(state.toolCallHistory).toHaveLength(1);
    });

    it("does not flag unique tool calls", () => {
      const state = createState();

      for (let i = 0; i < 15; i += 1) {
        recordToolCall(state, "read", { path: `/file${i}.txt` }, `call-${i}`);
      }

      const result = detectToolCallLoop(
        state,
        "read",
        { path: "/new-file.txt" },
        enabledLoopDetectionConfig,
      );
      expect(result.stuck).toBe(false);
    });

    it("warns for repeated exec calls at repeat threshold", () => {
      const result = detectLoopAfterRepeatedCalls({
        toolName: "exec",
        toolParams: { command: "ls /tmp" },
        result: {
          content: [{ type: "text", text: "file-a\nfile-b" }],
          details: { status: "completed", exitCode: 0 },
        },
        count: 3,
        config: execThresholdConfig,
      });

      expect(result.stuck).toBe(true);
      if (result.stuck) {
        expect(result.level).toBe("warning");
        expect(result.detector).toBe("generic_repeat");
      }
    });

    it("escalates exec to critical at criticalThreshold", () => {
      const result = detectLoopAfterRepeatedCalls({
        toolName: "exec",
        toolParams: { command: "ls /tmp" },
        result: {
          content: [{ type: "text", text: "file-a\nfile-b" }],
          details: { status: "completed", exitCode: 0 },
        },
        count: 6,
        config: execThresholdConfig,
      });
      expect(result.stuck).toBe(true);
      if (result.stuck) {
        expect(result.level).toBe("critical");
        expect(result.detector).toBe("generic_repeat");
        expect(result.message).toContain("CRITICAL");
      }
    });

    it("does not warn for different exec commands", () => {
      const state = createState();
      recordSuccessfulCall(
        state,
        "exec",
        { command: "ls" },
        { content: [{ type: "text", text: "a" }], details: { status: "completed", exitCode: 0 } },
        1,
      );
      recordSuccessfulCall(
        state,
        "exec",
        { command: "pwd" },
        {
          content: [{ type: "text", text: "/workspace" }],
          details: { status: "completed", exitCode: 0 },
        },
        2,
      );
      recordSuccessfulCall(
        state,
        "exec",
        { command: "whoami" },
        {
          content: [{ type: "text", text: "openclaw" }],
          details: { status: "completed", exitCode: 0 },
        },
        3,
      );

      const result = detectToolCallLoop(state, "exec", { command: "date" }, execThresholdConfig);
      expect(result.stuck).toBe(false);
    });

    it("does not warn for exec calls below threshold", () => {
      const result = detectLoopAfterRepeatedCalls({
        toolName: "exec",
        toolParams: { command: "ls" },
        result: {
          content: [{ type: "text", text: "a\nb" }],
          details: { status: "completed", exitCode: 0 },
        },
        count: 2,
        config: execThresholdConfig,
      });

      expect(result.stuck).toBe(false);
    });

    it("keeps non-exec generic loop detection behavior unchanged", () => {
      const result = detectLoopAfterRepeatedCalls({
        toolName: "read",
        toolParams: { path: "a.txt" },
        result: {
          content: [{ type: "text", text: "same file data" }],
          details: { ok: true },
        },
        count: 4,
        config: execThresholdConfig,
      });

      expect(result.stuck).toBe(true);
      if (result.stuck) {
        expect(result.level).toBe("warning");
        expect(result.detector).toBe("generic_repeat");
      }
    });

    it("warns on generic repeated tool+args calls", () => {
      const state = createState();
      for (let i = 0; i < WARNING_THRESHOLD; i += 1) {
        recordToolCall(state, "read", { path: "/same.txt" }, `warn-${i}`);
      }

      const result = detectToolCallLoop(
        state,
        "read",
        { path: "/same.txt" },
        enabledLoopDetectionConfig,
      );

      expect(result.stuck).toBe(true);
      if (result.stuck) {
        expect(result.level).toBe("warning");
        expect(result.detector).toBe("generic_repeat");
        expect(result.count).toBe(WARNING_THRESHOLD);
        expect(result.message).toContain("WARNING");
        expect(result.message).toContain(`${WARNING_THRESHOLD} times`);
      }
    });

    it("keeps generic loops warn-only below global breaker threshold", () => {
      const fixture = createReadNoProgressFixture();
      const loopResult = detectLoopAfterRepeatedCalls({
        toolName: fixture.toolName,
        toolParams: fixture.params,
        result: fixture.result,
        count: CRITICAL_THRESHOLD,
      });
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("warning");
      }
    });

    it("blocks repeated unknown tool failures after two consecutive misses", () => {
      const state = createState();
      const toolName = "some_non_existent_tool";
      const params = { query: "test" };
      const error = new Error("Tool some_non_existent_tool not found");

      recordFailedCall(state, toolName, params, error, 0);
      expect(detectRepeatedUnknownToolCall(state, toolName, params)).toEqual({ stuck: false });

      recordFailedCall(state, toolName, params, error, 1);
      const loopResult = detectRepeatedUnknownToolCall(state, toolName, params);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("critical");
        expect(loopResult.detector).toBe("unknown_tool_repeat");
        expect(loopResult.count).toBe(UNKNOWN_TOOL_REPEAT_THRESHOLD);
        expect(loopResult.message).toContain("not an available tool");
      }
    });

    it("does not block unknown tool failures for a different tool name", () => {
      const state = createState();
      const params = { query: "test" };

      recordFailedCall(
        state,
        "read",
        params,
        new Error("Tool some_non_existent_tool not found"),
        0,
      );
      recordFailedCall(
        state,
        "read",
        params,
        new Error("Tool some_non_existent_tool not found"),
        1,
      );

      expect(detectRepeatedUnknownToolCall(state, "read", params)).toEqual({ stuck: false });
    });

    it("recognizes dotted unknown tool names", () => {
      const state = createState();
      const toolName = "matrix.send";
      const params = { roomId: "!abc:matrix.org" };
      const error = new Error("Tool matrix.send not found");

      recordFailedCall(state, toolName, params, error, 0);
      recordFailedCall(state, toolName, params, error, 1);

      const loopResult = detectRepeatedUnknownToolCall(state, toolName, params);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.detector).toBe("unknown_tool_repeat");
        expect(loopResult.message).toContain("matrix.send");
      }
    });

    it("recognizes namespaced unknown tool names with colons", () => {
      const state = createState();
      const toolName = "my.server:some_tool";
      const params = { query: "status" };
      const error = new Error("Tool my.server:some_tool not found");

      recordFailedCall(state, toolName, params, error, 0);
      recordFailedCall(state, toolName, params, error, 1);

      const loopResult = detectRepeatedUnknownToolCall(state, toolName, params);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.detector).toBe("unknown_tool_repeat");
        expect(loopResult.message).toContain("my.server:some_tool");
      }
    });

    it("ignores trailing sentence punctuation in unknown tool errors", () => {
      const state = createState();
      const toolName = "my.server:some_tool";
      const params = { query: "status" };
      const error = new Error("Unknown tool: my.server:some_tool.");

      recordFailedCall(state, toolName, params, error, 0);
      recordFailedCall(state, toolName, params, error, 1);

      const loopResult = detectRepeatedUnknownToolCall(state, toolName, params);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.detector).toBe("unknown_tool_repeat");
        expect(loopResult.message).toContain("my.server:some_tool");
      }
    });

    it("applies custom thresholds when detection is enabled", () => {
      const state = createState();
      const { params, result } = createNoProgressPollFixture("sess-custom");
      const config: ToolLoopDetectionConfig = {
        enabled: true,
        warningThreshold: 2,
        criticalThreshold: 4,
        detectors: {
          genericRepeat: false,
          knownPollNoProgress: true,
          pingPong: false,
        },
      };

      recordRepeatedSuccessfulCalls({
        state,
        toolName: "process",
        toolParams: params,
        result,
        count: 2,
      });
      const warningResult = detectToolCallLoop(state, "process", params, config);
      expect(warningResult.stuck).toBe(true);
      if (warningResult.stuck) {
        expect(warningResult.level).toBe("warning");
      }

      recordRepeatedSuccessfulCalls({
        state,
        toolName: "process",
        toolParams: params,
        result,
        count: 2,
        startIndex: 2,
      });
      const criticalResult = detectToolCallLoop(state, "process", params, config);
      expect(criticalResult.stuck).toBe(true);
      if (criticalResult.stuck) {
        expect(criticalResult.level).toBe("critical");
        expect(criticalResult.detector).toBe("known_poll_no_progress");
      }
    });

    it("can disable specific detectors", () => {
      const state = createState();
      const { params, result } = createNoProgressPollFixture("sess-no-detectors");
      const config: ToolLoopDetectionConfig = {
        enabled: true,
        detectors: {
          genericRepeat: false,
          knownPollNoProgress: false,
          pingPong: false,
        },
      };

      recordRepeatedSuccessfulCalls({
        state,
        toolName: "process",
        toolParams: params,
        result,
        count: CRITICAL_THRESHOLD,
      });

      const loopResult = detectToolCallLoop(state, "process", params, config);
      expect(loopResult.stuck).toBe(false);
    });

    it("warns for known polling no-progress loops", () => {
      const { params, result } = createNoProgressPollFixture("sess-1");
      const loopResult = detectLoopAfterRepeatedCalls({
        toolName: "process",
        toolParams: params,
        result,
        count: WARNING_THRESHOLD,
      });
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("warning");
        expect(loopResult.detector).toBe("known_poll_no_progress");
        expect(loopResult.message).toContain("no progress");
      }
    });

    it("blocks known polling no-progress loops at critical threshold", () => {
      const { params, result } = createNoProgressPollFixture("sess-1");
      const loopResult = detectLoopAfterRepeatedCalls({
        toolName: "process",
        toolParams: params,
        result,
        count: CRITICAL_THRESHOLD,
      });
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("critical");
        expect(loopResult.detector).toBe("known_poll_no_progress");
        expect(loopResult.message).toContain("CRITICAL");
      }
    });

    it("does not block known polling when output progresses", () => {
      const state = createState();
      const params = { action: "poll", sessionId: "sess-1" };

      for (let i = 0; i < CRITICAL_THRESHOLD + 5; i += 1) {
        const result = {
          content: [{ type: "text", text: `line ${i}` }],
          details: { status: "running", aggregated: `line ${i}` },
        };
        recordSuccessfulCall(state, "process", params, result, i);
      }

      const loopResult = detectToolCallLoop(state, "process", params, enabledLoopDetectionConfig);
      expect(loopResult.stuck).toBe(false);
    });

    it("blocks any tool with global no-progress breaker at 30", () => {
      const fixture = createReadNoProgressFixture();
      const loopResult = detectLoopAfterRepeatedCalls({
        toolName: fixture.toolName,
        toolParams: fixture.params,
        result: fixture.result,
        count: GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
      });
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("critical");
        expect(loopResult.detector).toBe("global_circuit_breaker");
        expect(loopResult.message).toContain("global circuit breaker");
      }
    });

    it("warns on ping-pong alternating patterns", () => {
      const state = createState();
      const readParams = { path: "/a.txt" };
      const listParams = { dir: "/workspace" };

      for (let i = 0; i < WARNING_THRESHOLD - 1; i += 1) {
        if (i % 2 === 0) {
          recordToolCall(state, "read", readParams, `read-${i}`);
        } else {
          recordToolCall(state, "list", listParams, `list-${i}`);
        }
      }

      const loopResult = detectToolCallLoop(state, "list", listParams, enabledLoopDetectionConfig);
      expectPingPongLoop(loopResult, { level: "warning", count: WARNING_THRESHOLD });
      if (loopResult.stuck) {
        expect(loopResult.message).toContain("ping-pong loop");
      }
    });

    it("blocks ping-pong alternating patterns at critical threshold", () => {
      const { state, readParams, listParams } = createPingPongFixture();

      recordSuccessfulPingPongCalls({
        state,
        readParams,
        listParams,
        count: CRITICAL_THRESHOLD - 1,
        textAtIndex: (toolName) => (toolName === "read" ? "read stable" : "list stable"),
      });

      const loopResult = detectToolCallLoop(state, "list", listParams, enabledLoopDetectionConfig);
      expectPingPongLoop(loopResult, {
        level: "critical",
        count: CRITICAL_THRESHOLD,
        expectCriticalText: true,
      });
      if (loopResult.stuck) {
        expect(loopResult.message).toContain("ping-pong loop");
      }
    });

    it("does not block ping-pong at critical threshold when outcomes are progressing", () => {
      const { state, readParams, listParams } = createPingPongFixture();

      recordSuccessfulPingPongCalls({
        state,
        readParams,
        listParams,
        count: CRITICAL_THRESHOLD - 1,
        textAtIndex: (toolName, index) => `${toolName} ${index}`,
      });

      const loopResult = detectToolCallLoop(state, "list", listParams, enabledLoopDetectionConfig);
      expectPingPongLoop(loopResult, { level: "warning", count: CRITICAL_THRESHOLD });
    });

    it("does not flag ping-pong when alternation is broken", () => {
      const state = createState();
      recordToolCall(state, "read", { path: "/a.txt" }, "a1");
      recordToolCall(state, "list", { dir: "/workspace" }, "b1");
      recordToolCall(state, "read", { path: "/a.txt" }, "a2");
      recordToolCall(state, "write", { path: "/tmp/out.txt" }, "c1"); // breaks alternation

      const loopResult = detectToolCallLoop(
        state,
        "list",
        { dir: "/workspace" },
        enabledLoopDetectionConfig,
      );
      expect(loopResult.stuck).toBe(false);
    });

    it("records fixed-size result hashes for large tool outputs", () => {
      const state = createState();
      const params = { action: "log", sessionId: "sess-big" };
      const toolCallId = "log-big";
      recordToolCall(state, "process", params, toolCallId);
      recordToolCallOutcome(state, {
        toolName: "process",
        toolParams: params,
        toolCallId,
        result: {
          content: [{ type: "text", text: "y".repeat(40_000) }],
          details: { status: "running", totalLines: 1, totalChars: 40_000 },
        },
      });

      const entry = state.toolCallHistory?.find((call) => call.toolCallId === toolCallId);
      expect(typeof entry?.resultHash).toBe("string");
      expect(entry?.resultHash?.length).toBe(64);
    });

    it("handles empty history", () => {
      const state = createState();

      const result = detectToolCallLoop(state, "tool", { arg: 1 }, enabledLoopDetectionConfig);
      expect(result.stuck).toBe(false);
    });

    it("detects repeated exec calls with volatile details fields (#34574)", () => {
      const state = createState();
      const execParams = { command: "echo hello", cwd: "/workspace" };

      for (let i = 0; i < WARNING_THRESHOLD; i += 1) {
        const toolCallId = `exec-${i}`;
        recordToolCall(state, "exec", execParams, toolCallId);
        recordToolCallOutcome(state, {
          toolName: "exec",
          toolParams: execParams,
          toolCallId,
          result: {
            content: [{ type: "text", text: "hello" }],
            details: {
              status: "completed",
              exitCode: 0,
              durationMs: 100 + i * 7,
              aggregated: "hello",
              cwd: "/workspace",
            },
          },
        });
      }

      const loopResult = detectToolCallLoop(state, "exec", execParams, enabledLoopDetectionConfig);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("warning");
      }
    });

    it("does not flag exec calls with different commands", () => {
      const state = createState();

      for (let i = 0; i < WARNING_THRESHOLD + 5; i += 1) {
        const execParams = { command: `cmd-${i}`, cwd: "/workspace" };
        const toolCallId = `exec-${i}`;
        recordToolCall(state, "exec", execParams, toolCallId);
        recordToolCallOutcome(state, {
          toolName: "exec",
          toolParams: execParams,
          toolCallId,
          result: {
            content: [{ type: "text", text: `output ${i}` }],
            details: {
              status: "completed",
              exitCode: 0,
              durationMs: 50 + i,
              aggregated: `output ${i}`,
              cwd: "/workspace",
            },
          },
        });
      }

      const loopResult = detectToolCallLoop(
        state,
        "exec",
        { command: "cmd-new", cwd: "/workspace" },
        enabledLoopDetectionConfig,
      );
      expect(loopResult.stuck).toBe(false);
    });

    it("warns for exec calls repeated past warning threshold (#34574)", () => {
      const state = createState();
      const execParams = { command: "cat /tmp/status", cwd: "/workspace" };

      for (let i = 0; i < CRITICAL_THRESHOLD; i += 1) {
        const toolCallId = `exec-crit-${i}`;
        recordToolCall(state, "exec", execParams, toolCallId);
        recordToolCallOutcome(state, {
          toolName: "exec",
          toolParams: execParams,
          toolCallId,
          result: {
            content: [{ type: "text", text: "same output" }],
            details: {
              status: "completed",
              exitCode: 0,
              durationMs: 200 + i * 3,
              aggregated: "same output",
              cwd: "/workspace",
            },
          },
        });
      }

      const loopResult = detectToolCallLoop(state, "exec", execParams, enabledLoopDetectionConfig);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("warning");
      }
    });

    it("triggers global circuit breaker for exec at 30 repetitions (#34574)", () => {
      const state = createState();
      const execParams = { command: "cat /tmp/status", cwd: "/workspace" };

      for (let i = 0; i < GLOBAL_CIRCUIT_BREAKER_THRESHOLD; i += 1) {
        const toolCallId = `exec-gcb-${i}`;
        recordToolCall(state, "exec", execParams, toolCallId);
        recordToolCallOutcome(state, {
          toolName: "exec",
          toolParams: execParams,
          toolCallId,
          result: {
            content: [{ type: "text", text: "same output" }],
            details: {
              status: "completed",
              exitCode: 0,
              durationMs: 300 + i * 5,
              aggregated: "same output",
              cwd: "/workspace",
            },
          },
        });
      }

      const loopResult = detectToolCallLoop(state, "exec", execParams, enabledLoopDetectionConfig);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("critical");
        expect(loopResult.detector).toBe("global_circuit_breaker");
      }
    });

    it("detects exec loop even with varying pid and startedAt (#34574)", () => {
      const state = createState();
      const execParams = { command: "sleep 1 &", cwd: "/workspace" };

      for (let i = 0; i < WARNING_THRESHOLD; i += 1) {
        const toolCallId = `exec-bg-${i}`;
        recordToolCall(state, "exec", execParams, toolCallId);
        recordToolCallOutcome(state, {
          toolName: "exec",
          toolParams: execParams,
          toolCallId,
          result: {
            // Real exec embeds volatile session/pid in content text
            content: [
              {
                type: "text",
                text: `Command still running (session sess-${1000 + i}, pid ${40000 + i}). Use process for follow-up.`,
              },
            ],
            details: {
              status: "running",
              sessionId: `sess-${1000 + i}`,
              pid: 40000 + i,
              startedAt: Date.now() + i * 1000,
              cwd: "/workspace",
            },
          },
        });
      }

      const loopResult = detectToolCallLoop(state, "exec", execParams, enabledLoopDetectionConfig);
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("warning");
      }
    });

    it("does not flag running exec loop when tail output progresses (#34574)", () => {
      const state = createState();
      const execParams = { command: "make build", cwd: "/workspace" };

      for (let i = 0; i < GLOBAL_CIRCUIT_BREAKER_THRESHOLD; i += 1) {
        const toolCallId = `exec-tail-${i}`;
        recordToolCall(state, "exec", execParams, toolCallId);
        recordToolCallOutcome(state, {
          toolName: "exec",
          toolParams: execParams,
          toolCallId,
          result: {
            content: [
              {
                type: "text",
                text: `Command still running (session sess-${i}, pid ${50000 + i}).`,
              },
            ],
            details: {
              status: "running",
              sessionId: `sess-${i}`,
              pid: 50000 + i,
              startedAt: Date.now() + i * 1000,
              cwd: "/workspace",
              tail: `Compiling module ${i}...`,
            },
          },
        });
      }

      const loopResult = detectToolCallLoop(state, "exec", execParams, enabledLoopDetectionConfig);
      // generic_repeat fires on args, but no-progress streak should not
      // escalate to critical because tail output is progressing
      expect(loopResult.stuck).toBe(true);
      if (loopResult.stuck) {
        expect(loopResult.level).toBe("warning");
        expect(loopResult.detector).not.toBe("global_circuit_breaker");
      }
    });
  });

  describe("getToolCallStats", () => {
    it("returns zero stats for empty history", () => {
      const state = createState();

      const stats = getToolCallStats(state);
      expect(stats.totalCalls).toBe(0);
      expect(stats.uniquePatterns).toBe(0);
      expect(stats.mostFrequent).toBeNull();
    });

    it("counts total calls and unique patterns", () => {
      const state = createState();

      for (let i = 0; i < 5; i += 1) {
        recordToolCall(state, "read", { path: "/file.txt" }, `same-${i}`);
      }

      recordToolCall(state, "write", { path: "/output.txt" }, "write-1");
      recordToolCall(state, "list", { dir: "/home" }, "list-1");
      recordToolCall(state, "read", { path: "/other.txt" }, "read-other");

      const stats = getToolCallStats(state);
      expect(stats.totalCalls).toBe(8);
      expect(stats.uniquePatterns).toBe(4);
    });

    it("identifies most frequent pattern", () => {
      const state = createState();

      for (let i = 0; i < 3; i += 1) {
        recordToolCall(state, "read", { path: "/file1.txt" }, `p1-${i}`);
      }

      for (let i = 0; i < 7; i += 1) {
        recordToolCall(state, "read", { path: "/file2.txt" }, `p2-${i}`);
      }

      for (let i = 0; i < 2; i += 1) {
        recordToolCall(state, "write", { path: "/output.txt" }, `p3-${i}`);
      }

      const stats = getToolCallStats(state);
      expect(stats.mostFrequent?.toolName).toBe("read");
      expect(stats.mostFrequent?.count).toBe(7);
    });
  });
});
