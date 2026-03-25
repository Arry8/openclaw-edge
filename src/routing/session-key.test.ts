import { describe, expect, it } from "vitest";
import {
  deriveSessionChatType,
  getSubagentDepth,
  isCronSessionKey,
} from "../sessions/session-key-utils.js";
import {
  classifySessionKeyShape,
  isValidAgentId,
  parseAgentSessionKey,
  resolveEventSessionKey,
  scopedHeartbeatWakeOptions,
  toAgentStoreSessionKey,
} from "./session-key.js";

describe("classifySessionKeyShape", () => {
  it.each([
    { input: undefined, expected: "missing" },
    { input: "   ", expected: "missing" },
    { input: "agent:main:main", expected: "agent" },
    { input: "agent:research:subagent:worker", expected: "agent" },
    { input: "agent::broken", expected: "malformed_agent" },
    { input: "agent:main", expected: "malformed_agent" },
    { input: "main", expected: "legacy_or_alias" },
    { input: "custom-main", expected: "legacy_or_alias" },
    { input: "subagent:worker", expected: "legacy_or_alias" },
  ] as const)("classifies %j as $expected", ({ input, expected }) => {
    expect(classifySessionKeyShape(input)).toBe(expected);
  });
});

describe("session key backward compatibility", () => {
  function expectBackwardCompatibleDirectSessionKey(key: string) {
    expect(classifySessionKeyShape(key)).toBe("agent");
  }

  it.each([
    "agent:main:telegram:dm:123456",
    "agent:main:whatsapp:dm:+15551234567",
    "agent:main:discord:dm:user123",
    "agent:main:telegram:direct:123456",
    "agent:main:whatsapp:direct:+15551234567",
    "agent:main:discord:direct:user123",
  ] as const)("classifies backward-compatible direct session key %s as valid", (key) => {
    expectBackwardCompatibleDirectSessionKey(key);
  });
});

describe("getSubagentDepth", () => {
  it.each([
    { key: "agent:main:main", expected: 0 },
    { key: "main", expected: 0 },
    { key: undefined, expected: 0 },
    { key: "agent:main:subagent:parent:subagent:child", expected: 2 },
  ] as const)("returns $expected for session key %j", ({ key, expected }) => {
    expect(getSubagentDepth(key)).toBe(expected);
  });
});

describe("isCronSessionKey", () => {
  it.each([
    { key: "agent:main:cron:job-1", expected: true },
    { key: "agent:main:cron:job-1:run:run-1", expected: true },
    { key: "agent:main:main", expected: false },
    { key: "agent:main:subagent:worker", expected: false },
    { key: "cron:job-1", expected: false },
    { key: undefined, expected: false },
  ] as const)("matches cron key %j => $expected", ({ key, expected }) => {
    expect(isCronSessionKey(key)).toBe(expected);
  });
});

describe("deriveSessionChatType", () => {
  it.each([
    { key: "agent:main:discord:direct:user1", expected: "direct" },
    { key: "agent:main:telegram:group:g1", expected: "group" },
    { key: "agent:main:discord:channel:c1", expected: "channel" },
    { key: "agent:main:telegram:dm:123456", expected: "direct" },
    { key: "telegram:dm:123456", expected: "direct" },
    { key: "discord:acc-1:guild-123:channel-456", expected: "channel" },
    { key: "agent:main:main", expected: "unknown" },
    { key: "agent:main", expected: "unknown" },
    { key: "", expected: "unknown" },
  ] as const)("derives chat type for %j => $expected", ({ key, expected }) => {
    expect(deriveSessionChatType(key)).toBe(expected);
  });
});

describe("session key canonicalization", () => {
  function expectSessionKeyCanonicalizationCase(params: { run: () => void }) {
    params.run();
  }

  it.each([
    {
      name: "parses agent keys case-insensitively and returns lowercase tokens",
      run: () =>
        expect(parseAgentSessionKey("AGENT:Main:Hook:Webhook:42")).toEqual({
          agentId: "main",
          rest: "hook:webhook:42",
        }),
    },
    {
      name: "does not double-prefix already-qualified agent keys",
      run: () =>
        expect(
          toAgentStoreSessionKey({
            agentId: "main",
            requestKey: "agent:main:main",
          }),
        ).toBe("agent:main:main"),
    },
  ] as const)("$name", ({ run }) => {
    expectSessionKeyCanonicalizationCase({ run });
  });
});

describe("scopedHeartbeatWakeOptions", () => {
  it("scopes cron sessions to agent main key instead of transient cron key", () => {
    const result = scopedHeartbeatWakeOptions("agent:main:cron:backup:run:abc", {
      reason: "exec:123:exit",
    });
    expect(result).toEqual({ reason: "exec:123:exit", sessionKey: "agent:main:main" });
  });

  it("preserves sessionKey for regular agent sessions", () => {
    const result = scopedHeartbeatWakeOptions("agent:main:main", {
      reason: "exec:123:exit",
    });
    expect(result).toEqual({ reason: "exec:123:exit", sessionKey: "agent:main:main" });
  });

  it("strips sessionKey for non-agent keys", () => {
    const result = scopedHeartbeatWakeOptions("main", { reason: "test" });
    expect(result).toEqual({ reason: "test" });
    expect("sessionKey" in result).toBe(false);
  });

  it("strips sessionKey for global-scope sessions to preserve unscoped wake behavior", () => {
    // In session.scope = "global" setups, resolveMainSessionKeyFromConfig() returns "global".
    // Passing "global" as sessionKey into requestHeartbeatNow would create a targeted wake
    // that can fail to resolve, breaking hook-triggered heartbeats. scopedHeartbeatWakeOptions
    // must strip it to preserve the old unscoped behavior.
    const result = scopedHeartbeatWakeOptions("global", { reason: "hook:wake" });
    expect(result).toEqual({ reason: "hook:wake" });
    expect("sessionKey" in result).toBe(false);
  });
});

describe("resolveEventSessionKey", () => {
  it("remaps cron session keys to agent main session key", () => {
    expect(resolveEventSessionKey("agent:main:cron:backup:run:abc123")).toBe("agent:main:main");
    expect(resolveEventSessionKey("agent:einstein:cron:job-1")).toBe("agent:einstein:main");
  });

  it("passes through non-cron session keys unchanged", () => {
    expect(resolveEventSessionKey("agent:main:main")).toBe("agent:main:main");
    expect(resolveEventSessionKey("agent:main:discord:direct:user1")).toBe(
      "agent:main:discord:direct:user1",
    );
  });

  it("passes through non-agent keys unchanged", () => {
    expect(resolveEventSessionKey("main")).toBe("main");
    expect(resolveEventSessionKey("global")).toBe("global");
  });
});

describe("isValidAgentId", () => {
  it.each([
    { input: "main", expected: true },
    { input: "my-research_agent01", expected: true },
    { input: "", expected: false },
    { input: "Agent not found: xyz", expected: false },
    { input: "../../../etc/passwd", expected: false },
    { input: "a".repeat(65), expected: false },
  ] as const)("validates agent id %j => $expected", ({ input, expected }) => {
    expect(isValidAgentId(input)).toBe(expected);
  });
});
