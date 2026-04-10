import { describe, expect, it } from "vitest";
import { formatLinkUnderstandingBody } from "./format.js";

describe("formatLinkUnderstandingBody", () => {
  it("returns empty string when body is undefined and outputs is empty", () => {
    expect(formatLinkUnderstandingBody({ outputs: [] })).toBe("");
  });

  it("returns body unchanged when outputs is empty", () => {
    expect(formatLinkUnderstandingBody({ body: "hello world", outputs: [] })).toBe("hello world");
  });

  it("returns body when outputs are only whitespace", () => {
    expect(formatLinkUnderstandingBody({ body: "hello", outputs: ["  ", "\n", ""] })).toBe("hello");
  });

  it("returns joined outputs when body is undefined", () => {
    expect(formatLinkUnderstandingBody({ outputs: ["summary A", "summary B"] })).toBe(
      "summary A\nsummary B",
    );
  });

  it("returns joined outputs when body is empty string", () => {
    expect(formatLinkUnderstandingBody({ body: "", outputs: ["summary A"] })).toBe("summary A");
  });

  it("appends outputs after body separated by double newline", () => {
    expect(
      formatLinkUnderstandingBody({ body: "check this link", outputs: ["link summary"] }),
    ).toBe("check this link\n\nlink summary");
  });

  it("trims body and output whitespace", () => {
    expect(formatLinkUnderstandingBody({ body: "  body  ", outputs: ["  output  "] })).toBe(
      "body\n\noutput",
    );
  });

  it("filters out empty outputs after trimming", () => {
    expect(formatLinkUnderstandingBody({ body: "body", outputs: ["real output", "", "  "] })).toBe(
      "body\n\nreal output",
    );
  });

  it("handles multiple non-empty outputs", () => {
    expect(
      formatLinkUnderstandingBody({
        body: "message",
        outputs: ["first", "second", "third"],
      }),
    ).toBe("message\n\nfirst\nsecond\nthird");
  });
});
