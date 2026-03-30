import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  getHandshakeTimeoutMs,
  MAX_HANDSHAKE_TIMEOUT_MS,
} from "./server-constants.js";

const ORIGINAL_ENV = {
  VITEST: process.env.VITEST,
  OPENCLAW_HANDSHAKE_TIMEOUT_MS: process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS,
  OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS: process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getHandshakeTimeoutMs", () => {
  const setHandshakeEnv = (params: {
    vitest?: string;
    handshake?: string;
    testHandshake?: string;
  }) => {
    if (params.vitest === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = params.vitest;
    }
    if (params.handshake === undefined) {
      delete process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS;
    } else {
      process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS = params.handshake;
    }
    if (params.testHandshake === undefined) {
      delete process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS;
    } else {
      process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS = params.testHandshake;
    }
  };

  it("defaults to 10 seconds when no overrides are set", () => {
    delete process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS;
    delete process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS;

    expect(DEFAULT_HANDSHAKE_TIMEOUT_MS).toBe(10_000);
    expect(getHandshakeTimeoutMs()).toBe(10_000);
  });

  it("honors the production handshake timeout override", () => {
    delete process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS;
    process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS = "15000";

    expect(getHandshakeTimeoutMs()).toBe(15_000);
  });

  it.each([
    {
      name: "production override",
      env: { handshake: "not-a-number" },
    },
    {
      name: "vitest override",
      env: { vitest: "1", testHandshake: "NaN-ish" },
    },
  ])("falls back to the default when the $name is non-numeric", ({ env }) => {
    setHandshakeEnv(env);

    expect(getHandshakeTimeoutMs()).toBe(DEFAULT_HANDSHAKE_TIMEOUT_MS);
  });

  it.each([
    {
      name: "production override",
      env: { handshake: "2147483648" },
    },
    {
      name: "vitest override",
      env: { vitest: "1", testHandshake: "2147483648" },
    },
  ])("clamps the $name to the max handshake timeout", ({ env }) => {
    setHandshakeEnv(env);

    expect(getHandshakeTimeoutMs()).toBe(MAX_HANDSHAKE_TIMEOUT_MS);
  });

  it("prefers the production override when both overrides are set", () => {
    process.env.VITEST = "1";
    process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS = "15000";
    process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS = "25";

    expect(getHandshakeTimeoutMs()).toBe(15_000);
  });

  it("falls back to the vitest override when the production override is empty", () => {
    process.env.VITEST = "1";
    process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS = "";
    process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS = "25";

    expect(getHandshakeTimeoutMs()).toBe(25);
  });
});
