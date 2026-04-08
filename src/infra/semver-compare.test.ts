import { describe, expect, it } from "vitest";
import {
  compareComparableSemver,
  comparePrereleaseIdentifiers,
  normalizeLegacyDotBetaVersion,
  parseComparableSemver,
} from "./semver-compare.js";

describe("normalizeLegacyDotBetaVersion", () => {
  it("converts .beta.N to -beta.N", () => {
    expect(normalizeLegacyDotBetaVersion("1.0.0.beta.5")).toBe("1.0.0-beta.5");
  });

  it("converts .beta without suffix to -beta", () => {
    expect(normalizeLegacyDotBetaVersion("2.3.1.beta")).toBe("2.3.1-beta");
  });

  it("handles v prefix", () => {
    expect(normalizeLegacyDotBetaVersion("v1.2.3.beta.4")).toBe("v1.2.3-beta.4");
  });

  it("passes through already normalized versions unchanged", () => {
    expect(normalizeLegacyDotBetaVersion("1.0.0-beta.5")).toBe("1.0.0-beta.5");
    expect(normalizeLegacyDotBetaVersion("1.0.0")).toBe("1.0.0");
  });

  it("trims whitespace", () => {
    expect(normalizeLegacyDotBetaVersion("  1.0.0.beta.2  ")).toBe("1.0.0-beta.2");
  });
});

describe("parseComparableSemver", () => {
  it("parses standard version strings", () => {
    expect(parseComparableSemver("1.0.0")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: null,
    });
  });

  it("parses version with v prefix", () => {
    expect(parseComparableSemver("v1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
  });

  it("parses prerelease versions", () => {
    expect(parseComparableSemver("1.0.0-beta.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["beta", "1"],
    });
    expect(parseComparableSemver("1.0.0-alpha.2")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["alpha", "2"],
    });
  });

  it("strips build metadata", () => {
    const result = parseComparableSemver("1.0.0+build123");
    expect(result).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: null,
    });
  });

  it("handles prerelease with build metadata", () => {
    const result = parseComparableSemver("1.0.0-beta.1+build456");
    expect(result).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["beta", "1"],
    });
  });

  it("returns null for null/undefined/empty input", () => {
    expect(parseComparableSemver(null)).toBeNull();
    expect(parseComparableSemver(undefined)).toBeNull();
    expect(parseComparableSemver("")).toBeNull();
  });

  it("returns null for malformed inputs", () => {
    expect(parseComparableSemver("not-a-version")).toBeNull();
    expect(parseComparableSemver("1.0")).toBeNull();
    expect(parseComparableSemver("1.0.0.0")).toBeNull();
    expect(parseComparableSemver("abc.def.ghi")).toBeNull();
  });

  it("applies legacy dot-beta normalization when enabled", () => {
    expect(
      parseComparableSemver("1.0.0.beta.3", { normalizeLegacyDotBeta: true }),
    ).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["beta", "3"],
    });
  });

  it("does not apply legacy normalization by default", () => {
    // Without the option, "1.0.0.beta.3" does not match the semver regex
    expect(parseComparableSemver("1.0.0.beta.3")).toBeNull();
  });
});

describe("comparePrereleaseIdentifiers", () => {
  it("returns 0 when both are null", () => {
    expect(comparePrereleaseIdentifiers(null, null)).toBe(0);
  });

  it("returns 0 when both are empty", () => {
    expect(comparePrereleaseIdentifiers([], [])).toBe(0);
  });

  it("ranks release (null) higher than prerelease", () => {
    expect(comparePrereleaseIdentifiers(null, ["beta", "1"])).toBe(1);
    expect(comparePrereleaseIdentifiers(["beta", "1"], null)).toBe(-1);
  });

  it("compares numeric identifiers numerically", () => {
    expect(comparePrereleaseIdentifiers(["1"], ["2"])).toBe(-1);
    expect(comparePrereleaseIdentifiers(["2"], ["1"])).toBe(1);
    expect(comparePrereleaseIdentifiers(["10"], ["9"])).toBe(1);
  });

  it("compares string identifiers lexicographically", () => {
    expect(comparePrereleaseIdentifiers(["alpha"], ["beta"])).toBe(-1);
    expect(comparePrereleaseIdentifiers(["beta"], ["alpha"])).toBe(1);
  });

  it("ranks numeric identifiers lower than string identifiers", () => {
    expect(comparePrereleaseIdentifiers(["1"], ["alpha"])).toBe(-1);
    expect(comparePrereleaseIdentifiers(["alpha"], ["1"])).toBe(1);
  });

  it("compares multi-segment prerelease identifiers", () => {
    expect(comparePrereleaseIdentifiers(["beta", "1"], ["beta", "2"])).toBe(-1);
    expect(comparePrereleaseIdentifiers(["beta", "2"], ["beta", "1"])).toBe(1);
    expect(comparePrereleaseIdentifiers(["beta", "1"], ["beta", "1"])).toBe(0);
  });

  it("shorter array is lower when prefix matches", () => {
    expect(comparePrereleaseIdentifiers(["beta"], ["beta", "1"])).toBe(-1);
    expect(comparePrereleaseIdentifiers(["beta", "1"], ["beta"])).toBe(1);
  });
});

describe("compareComparableSemver", () => {
  it("returns null when either input is null", () => {
    const v = parseComparableSemver("1.0.0")!;
    expect(compareComparableSemver(null, v)).toBeNull();
    expect(compareComparableSemver(v, null)).toBeNull();
    expect(compareComparableSemver(null, null)).toBeNull();
  });

  it("returns 0 for identical versions", () => {
    const a = parseComparableSemver("1.2.3")!;
    const b = parseComparableSemver("1.2.3")!;
    expect(compareComparableSemver(a, b)).toBe(0);
  });

  it("compares by major version", () => {
    const a = parseComparableSemver("1.0.0")!;
    const b = parseComparableSemver("2.0.0")!;
    expect(compareComparableSemver(a, b)).toBe(-1);
    expect(compareComparableSemver(b, a)).toBe(1);
  });

  it("compares by minor version when major is equal", () => {
    const a = parseComparableSemver("1.1.0")!;
    const b = parseComparableSemver("1.2.0")!;
    expect(compareComparableSemver(a, b)).toBe(-1);
    expect(compareComparableSemver(b, a)).toBe(1);
  });

  it("compares by patch version when major and minor are equal", () => {
    const a = parseComparableSemver("1.0.1")!;
    const b = parseComparableSemver("1.0.2")!;
    expect(compareComparableSemver(a, b)).toBe(-1);
    expect(compareComparableSemver(b, a)).toBe(1);
  });

  it("ranks release higher than prerelease with same base", () => {
    const release = parseComparableSemver("1.0.0")!;
    const prerelease = parseComparableSemver("1.0.0-beta.1")!;
    expect(compareComparableSemver(release, prerelease)).toBe(1);
    expect(compareComparableSemver(prerelease, release)).toBe(-1);
  });

  it("compares prerelease ordering", () => {
    const beta1 = parseComparableSemver("1.0.0-beta.1")!;
    const beta2 = parseComparableSemver("1.0.0-beta.2")!;
    expect(compareComparableSemver(beta1, beta2)).toBe(-1);
    expect(compareComparableSemver(beta2, beta1)).toBe(1);
  });

  it("ranks alpha before beta", () => {
    const alpha = parseComparableSemver("1.0.0-alpha.1")!;
    const beta = parseComparableSemver("1.0.0-beta.1")!;
    expect(compareComparableSemver(alpha, beta)).toBe(-1);
    expect(compareComparableSemver(beta, alpha)).toBe(1);
  });
});
