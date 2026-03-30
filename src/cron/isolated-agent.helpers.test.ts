import { describe, expect, it } from "vitest";
import { resolveCronPayloadOutcome } from "./isolated-agent/helpers.js";

describe("resolveCronPayloadOutcome", () => {
  it("uses the last non-empty non-error payload as summary and output", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [{ text: "first" }, { text: " " }, { text: " last " }],
    });

    expect(result.summary).toBe("last");
    expect(result.outputText).toBe("last");
    expect(result.hasFatalErrorPayload).toBe(false);
  });

  it("returns a fatal error from the last error payload when no success follows", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [
        {
          text: "⚠️ 🛠️ Exec failed: /bin/bash: line 1: python: command not found",
          isError: true,
        },
      ],
    });

    expect(result.hasFatalErrorPayload).toBe(true);
    expect(result.embeddedRunError).toContain("command not found");
    expect(result.summary).toContain("Exec failed");
  });

  it("treats transient error payloads as non-fatal when a later success exists", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [
        { text: "⚠️ ✍️ Write: failed", isError: true },
        { text: "Write completed successfully.", isError: false },
      ],
    });

    expect(result.hasFatalErrorPayload).toBe(false);
    expect(result.summary).toBe("Write completed successfully.");
  });

  it("treats an error as fatal when no non-error payload follows it", () => {
    // Without a recovery payload after the error, hasFatalErrorPayload must remain true
    // regardless of what appears before. The pre-error recovery branch was removed because
    // pickLastDeliverablePayload considers any non-empty text deliverable — including short
    // status lines like "Starting digest…" — making it unsound as a recovery signal.
    const result = resolveCronPayloadOutcome({
      payloads: [
        { text: "Done. Intake complete.", isError: false },
        { text: "⚠️ ✉️ Message failed", isError: true },
      ],
    });

    expect(result.hasFatalErrorPayload).toBe(true);
    expect(result.embeddedRunError).toContain("Message failed");
  });

  it("keeps error payloads fatal when the run also reported a run-level error", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [
        { text: "Model context overflow", isError: true },
        { text: "Partial assistant text before error" },
      ],
      runLevelError: { kind: "context_overflow", message: "exceeded context window" },
    });

    expect(result.hasFatalErrorPayload).toBe(true);
    expect(result.embeddedRunError).toContain("Model context overflow");
  });

  it("truncates long summaries", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [{ text: "a".repeat(2001) }],
    });

    expect(String(result.summary ?? "")).toMatch(/…$/);
  });

  it("preserves all successful deliverable payloads for announce delivery", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [
        { text: "line 1" },
        { text: "temporary error", isError: true },
        { text: "line 2" },
      ],
    });

    expect(result.deliveryPayloads).toEqual([{ text: "line 1" }, { text: "line 2" }]);
    expect(result.deliveryPayload).toEqual({ text: "line 2" });
  });

  it("keeps structured-content detection scoped to the last delivery payload", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [{ mediaUrl: "https://example.com/report.png" }, { text: "final text" }],
    });

    expect(result.deliveryPayloads).toEqual([
      { mediaUrl: "https://example.com/report.png" },
      { text: "final text" },
    ]);
    expect(result.deliveryPayloadHasStructuredContent).toBe(false);
  });

  it("returns only the last error payload when all payloads are errors", () => {
    const result = resolveCronPayloadOutcome({
      payloads: [
        { text: "first error", isError: true },
        { text: "last error", isError: true },
      ],
    });

    expect(result.deliveryPayloads).toEqual([{ text: "last error", isError: true }]);
    expect(result.deliveryPayload).toEqual({ text: "last error", isError: true });
  });
});
