import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeMessage,
  normalizeRoleForGrouping,
  isToolResultMessage,
  isInternalExecNotification,
} from "./message-normalizer.ts";

describe("message-normalizer", () => {
  describe("normalizeMessage", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("normalizes message with string content", () => {
      const result = normalizeMessage({
        role: "user",
        content: "Hello world",
        timestamp: 1000,
        id: "msg-1",
      });

      expect(result).toEqual({
        role: "user",
        content: [{ type: "text", text: "Hello world" }],
        timestamp: 1000,
        id: "msg-1",
        senderLabel: null,
      });
    });

    it("normalizes message with array content", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: [
          { type: "text", text: "Here is the result" },
          { type: "tool_use", name: "bash", args: { command: "ls" } },
        ],
        timestamp: 2000,
      });

      expect(result.role).toBe("toolResult");
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Here is the result",
        name: undefined,
        args: undefined,
      });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        text: undefined,
        name: "bash",
        args: { command: "ls" },
      });
    });

    it("normalizes message with text field (alternative format)", () => {
      const result = normalizeMessage({
        role: "user",
        text: "Alternative format",
      });

      expect(result.content).toEqual([{ type: "text", text: "Alternative format" }]);
    });

    it("detects tool result by toolCallId", () => {
      const result = normalizeMessage({
        role: "assistant",
        toolCallId: "call-123",
        content: "Tool output",
      });

      expect(result.role).toBe("toolResult");
    });

    it("detects tool result by tool_call_id (snake_case)", () => {
      const result = normalizeMessage({
        role: "assistant",
        tool_call_id: "call-456",
        content: "Tool output",
      });

      expect(result.role).toBe("toolResult");
    });

    it("detects tool messages by toolcall content blocks", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: [{ type: "toolcall", name: "Bash", arguments: { command: "pwd" } }],
      });

      expect(result.role).toBe("toolResult");
      expect(result.content[0]).toEqual({
        type: "toolcall",
        text: undefined,
        name: "Bash",
        args: { command: "pwd" },
      });
    });

    it("handles missing role", () => {
      const result = normalizeMessage({ content: "No role" });
      expect(result.role).toBe("unknown");
    });

    it("handles missing content", () => {
      const result = normalizeMessage({ role: "user" });
      expect(result.content).toEqual([]);
    });

    it("uses current timestamp when not provided", () => {
      const result = normalizeMessage({ role: "user", content: "Test" });
      expect(result.timestamp).toBe(Date.now());
    });

    it("handles arguments field (alternative to args)", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: [{ type: "tool_use", name: "test", arguments: { foo: "bar" } }],
      });

      expect(result.content[0].args).toEqual({ foo: "bar" });
    });

    it("handles input field for anthropic tool_use blocks", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash", input: { command: "pwd" } }],
      });

      expect(result.content[0].args).toEqual({ command: "pwd" });
    });

    it("preserves top-level sender labels", () => {
      const result = normalizeMessage({
        role: "user",
        content: "Hello from Telegram",
        senderLabel: "Iris",
      });

      expect(result.senderLabel).toBe("Iris");
    });
  });

  describe("normalizeRoleForGrouping", () => {
    it("returns tool for toolresult", () => {
      expect(normalizeRoleForGrouping("toolresult")).toBe("tool");
      expect(normalizeRoleForGrouping("toolResult")).toBe("tool");
      expect(normalizeRoleForGrouping("TOOLRESULT")).toBe("tool");
    });

    it("returns tool for tool_result", () => {
      expect(normalizeRoleForGrouping("tool_result")).toBe("tool");
      expect(normalizeRoleForGrouping("TOOL_RESULT")).toBe("tool");
    });

    it("returns tool for tool", () => {
      expect(normalizeRoleForGrouping("tool")).toBe("tool");
      expect(normalizeRoleForGrouping("Tool")).toBe("tool");
    });

    it("returns tool for function", () => {
      expect(normalizeRoleForGrouping("function")).toBe("tool");
      expect(normalizeRoleForGrouping("Function")).toBe("tool");
    });

    it("preserves user role", () => {
      expect(normalizeRoleForGrouping("user")).toBe("user");
      expect(normalizeRoleForGrouping("User")).toBe("User");
    });

    it("preserves assistant role", () => {
      expect(normalizeRoleForGrouping("assistant")).toBe("assistant");
    });

    it("preserves system role", () => {
      expect(normalizeRoleForGrouping("system")).toBe("system");
    });
  });

  describe("isToolResultMessage", () => {
    it("returns true for toolresult role", () => {
      expect(isToolResultMessage({ role: "toolresult" })).toBe(true);
      expect(isToolResultMessage({ role: "toolResult" })).toBe(true);
      expect(isToolResultMessage({ role: "TOOLRESULT" })).toBe(true);
    });

    it("returns true for tool_result role", () => {
      expect(isToolResultMessage({ role: "tool_result" })).toBe(true);
      expect(isToolResultMessage({ role: "TOOL_RESULT" })).toBe(true);
    });

    it("returns false for other roles", () => {
      expect(isToolResultMessage({ role: "user" })).toBe(false);
      expect(isToolResultMessage({ role: "assistant" })).toBe(false);
      expect(isToolResultMessage({ role: "tool" })).toBe(false);
    });

    it("returns false for missing role", () => {
      expect(isToolResultMessage({})).toBe(false);
      expect(isToolResultMessage({ content: "test" })).toBe(false);
    });

    it("returns false for non-string role", () => {
      expect(isToolResultMessage({ role: 123 })).toBe(false);
      expect(isToolResultMessage({ role: null })).toBe(false);
    });
  });

  describe("isInternalExecNotification", () => {
    it("detects trusted exec completed notification", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content: "System: [2026-04-07 10:30:00] Exec completed (nova-rid, code 0) :: ls -la",
        }),
      ).toBe(true);
    });

    it("detects untrusted exec failed notification", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content:
            "System (untrusted): [2026-04-07 10:30:01] Exec failed (wild-sho, signal SIGKILL)",
        }),
      ).toBe(true);
    });

    it("detects exec denied notification", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content: "System: [2026-04-07 10:30:02] Exec denied (abc-def, policy)",
        }),
      ).toBe(true);
    });

    it("detects exec timed out notification", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content: "System (untrusted): [2026-04-07 10:30:03] Exec timed out (xyz-123, timeout)",
        }),
      ).toBe(true);
    });

    it("detects multi-line exec notifications", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content: [
            "System (untrusted): [2026-04-07 10:30:00] Exec completed (aaa-bbb, code 0) :: cmd1",
            "System (untrusted): [2026-04-07 10:30:01] Exec failed (ccc-ddd, code 1)",
          ].join("\n"),
        }),
      ).toBe(true);
    });

    it("returns false for non-system role", () => {
      expect(
        isInternalExecNotification({
          role: "user",
          content: "System: [2026-04-07 10:30:00] Exec completed (nova-rid, code 0)",
        }),
      ).toBe(false);
      expect(
        isInternalExecNotification({
          role: "assistant",
          content: "System: [2026-04-07 10:30:00] Exec completed (nova-rid, code 0)",
        }),
      ).toBe(false);
    });

    it("returns false for channel summary system messages", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content: "System: Connected channels: telegram, discord",
        }),
      ).toBe(false);
    });

    it("returns false for mixed exec and non-exec content", () => {
      expect(
        isInternalExecNotification({
          role: "system",
          content: [
            "System: Connected channels: telegram",
            "System (untrusted): [2026-04-07 10:30:00] Exec completed (aaa-bbb, code 0)",
          ].join("\n"),
        }),
      ).toBe(false);
    });

    it("returns false for empty content", () => {
      expect(isInternalExecNotification({ role: "system", content: "" })).toBe(false);
      expect(isInternalExecNotification({ role: "system", content: "  \n  " })).toBe(false);
    });

    it("returns false for missing role or content", () => {
      expect(isInternalExecNotification({})).toBe(false);
      expect(isInternalExecNotification({ role: "system" })).toBe(false);
    });

    it("returns false for non-string content", () => {
      expect(isInternalExecNotification({ role: "system", content: 123 })).toBe(false);
      expect(isInternalExecNotification({ role: "system", content: null })).toBe(false);
    });
  });
});
