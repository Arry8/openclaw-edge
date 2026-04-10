import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMainSessionKey } from "./main-session.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveMainSessionKey", () => {
  it("returns 'global' when scope is global", () => {
    expect(resolveMainSessionKey({ session: { scope: "global" } })).toBe("global");
  });

  it("uses agents.list default: true agent", () => {
    expect(
      resolveMainSessionKey({
        agents: { list: [{ id: "reef-crawler", default: true }] },
      }),
    ).toBe("agent:reef-crawler:main");
  });

  it("uses first agent in list when no default flag", () => {
    expect(
      resolveMainSessionKey({
        agents: { list: [{ id: "lobster" }, { id: "crab" }] },
      }),
    ).toBe("agent:lobster:main");
  });

  it("respects agents.defaultAgentId when list is empty", () => {
    expect(
      resolveMainSessionKey({
        agents: { defaultAgentId: "maine-lobster", list: [] },
      }),
    ).toBe("agent:maine-lobster:main");
  });

  it("respects agents.defaultAgentId when list is missing", () => {
    expect(
      resolveMainSessionKey({
        agents: { defaultAgentId: "maine-lobster" },
      }),
    ).toBe("agent:maine-lobster:main");
  });

  it("agents.list takes precedence over defaultAgentId", () => {
    expect(
      resolveMainSessionKey({
        agents: {
          defaultAgentId: "maine-lobster",
          list: [{ id: "reef-crawler", default: true }],
        },
      }),
    ).toBe("agent:reef-crawler:main");
  });

  it("falls back to OPENCLAW_DEFAULT_AGENT_ID env var", () => {
    vi.stubEnv("OPENCLAW_DEFAULT_AGENT_ID", "env-lobster");
    expect(resolveMainSessionKey({})).toBe("agent:env-lobster:main");
  });

  it("config defaultAgentId takes precedence over env var", () => {
    vi.stubEnv("OPENCLAW_DEFAULT_AGENT_ID", "env-lobster");
    expect(
      resolveMainSessionKey({
        agents: { defaultAgentId: "config-lobster" },
      }),
    ).toBe("agent:config-lobster:main");
  });

  it("falls back to 'main' when nothing is configured", () => {
    expect(resolveMainSessionKey({})).toBe("agent:main:main");
  });

  it("respects custom mainKey", () => {
    expect(
      resolveMainSessionKey({
        session: { mainKey: "custom" },
        agents: { defaultAgentId: "maine-lobster" },
      }),
    ).toBe("agent:maine-lobster:custom");
  });
});
