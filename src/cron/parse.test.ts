import { describe, expect, it } from "vitest";
import { parseAbsoluteTimeMs } from "./parse.js";

describe("parseAbsoluteTimeMs", () => {
  it("parses ISO-8601 datetime strings", () => {
    const result = parseAbsoluteTimeMs("2026-01-12T18:00:00Z");
    expect(result).toBe(Date.parse("2026-01-12T18:00:00Z"));
  });

  it("parses ISO date-only strings as midnight UTC", () => {
    const result = parseAbsoluteTimeMs("2026-01-12");
    expect(result).toBe(Date.parse("2026-01-12T00:00:00Z"));
  });

  it("parses ISO datetime without timezone suffix as UTC", () => {
    const result = parseAbsoluteTimeMs("2026-01-12T18:00:00");
    expect(result).toBe(Date.parse("2026-01-12T18:00:00Z"));
  });

  it("rejects compact digit-only timestamps to avoid YYYYMMDDHH vs Unix-seconds ambiguity", () => {
    // 2026031812 could mean YYYYMMDDHH (2026-03-18 12:00) or Unix seconds (2034).
    // Promoting would silently schedule wrong. Reject and require ISO-8601.
    expect(parseAbsoluteTimeMs("2026031812")).toBeNull();
    expect(parseAbsoluteTimeMs("1714000000")).toBeNull();
    expect(parseAbsoluteTimeMs("999999999")).toBeNull();
    expect(parseAbsoluteTimeMs("999999999999")).toBeNull(); // 12 digits also ambiguous
  });

  it("accepts 13+ digit millisecond epoch strings as-is", () => {
    const result = parseAbsoluteTimeMs("1714000000000");
    expect(result).toBe(1_714_000_000_000);
    expect(new Date(result!).getUTCFullYear()).toBe(2024);
  });

  it("accepts 13-digit millisecond timestamps for current-era dates", () => {
    const tsMs = Date.parse("2026-06-15T12:00:00Z");
    const result = parseAbsoluteTimeMs(String(tsMs));
    expect(result).toBe(tsMs);
    expect(new Date(result!).getUTCFullYear()).toBe(2026);
  });

  it("returns null for 14+ digit values (implausible epoch)", () => {
    const result = parseAbsoluteTimeMs("12345678901234");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAbsoluteTimeMs("")).toBeNull();
    expect(parseAbsoluteTimeMs("  ")).toBeNull();
  });

  it("returns null for non-date strings", () => {
    expect(parseAbsoluteTimeMs("not-a-date")).toBeNull();
    expect(parseAbsoluteTimeMs("abc123")).toBeNull();
  });
});
