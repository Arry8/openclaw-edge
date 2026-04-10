import { describe, expect, it } from "vitest";
import { resolveSessionKey } from "./session-key.js";
import { installDiscordSessionKeyNormalizerFixture, makeCtx } from "./session-key.test-helpers.js";

installDiscordSessionKeyNormalizerFixture();

describe("resolveSessionKey", () => {
  describe("Discord DM session key normalization", () => {
    it("passes through correct discord:direct keys unchanged", () => {
      const ctx = makeCtx({
        SessionKey: "agent:fina:discord:direct:123456",
        ChatType: "direct",
        From: "discord:123456",
        SenderId: "123456",
      });
      expect(resolveSessionKey("per-sender", ctx)).toBe("agent:fina:discord:direct:123456");
    });

    it("migrates legacy discord:dm: keys to discord:direct:", () => {
      const ctx = makeCtx({
        SessionKey: "agent:fina:discord:dm:123456",
        ChatType: "direct",
        From: "discord:123456",
        SenderId: "123456",
      });
      expect(resolveSessionKey("per-sender", ctx)).toBe("agent:fina:discord:direct:123456");
    });

    it("fixes phantom discord:channel:USERID keys when sender matches", () => {
      const ctx = makeCtx({
        SessionKey: "agent:fina:discord:channel:123456",
        ChatType: "direct",
        From: "discord:123456",
        SenderId: "123456",
      });
      expect(resolveSessionKey("per-sender", ctx)).toBe("agent:fina:discord:direct:123456");
    });

    it("does not rewrite discord:channel: keys for non-direct chats", () => {
      const ctx = makeCtx({
        SessionKey: "agent:fina:discord:channel:123456",
        ChatType: "channel",
        From: "discord:channel:123456",
        SenderId: "789",
      });
      expect(resolveSessionKey("per-sender", ctx)).toBe("agent:fina:discord:channel:123456");
    });

    it("does not rewrite discord:channel: keys when sender does not match", () => {
      const ctx = makeCtx({
        SessionKey: "agent:fina:discord:channel:123456",
        ChatType: "direct",
        From: "discord:789",
        SenderId: "789",
      });
      expect(resolveSessionKey("per-sender", ctx)).toBe("agent:fina:discord:channel:123456");
    });

    it("handles keys without an agent prefix", () => {
      const ctx = makeCtx({
        SessionKey: "discord:channel:123456",
        ChatType: "direct",
        From: "discord:123456",
        SenderId: "123456",
      });
      expect(resolveSessionKey("per-sender", ctx)).toBe("discord:direct:123456");
    });
  });

  describe("custom agentId parameter", () => {
    it("uses provided agentId for direct chat session keys", () => {
      const ctx = makeCtx({
        From: "telegram:123456",
      });
      const key = resolveSessionKey("per-sender", ctx, undefined, "maine-lobster");
      expect(key).toBe("agent:maine-lobster:main");
    });

    it("uses provided agentId for group session keys", () => {
      const ctx = makeCtx({
        From: "telegram:group:-100123",
        SessionKey: undefined,
        ChatType: "group",
        GroupId: "-100123",
        Channel: "telegram",
      } as Partial<MsgContext>);
      // When no explicit SessionKey is set and raw includes `:group:`,
      // the agent prefix should use the provided agentId.
      const key = resolveSessionKey("per-sender", ctx, undefined, "maine-lobster");
      expect(key).toContain("agent:maine-lobster:");
    });

    it("falls back to 'main' when agentId is not provided", () => {
      const ctx = makeCtx({
        From: "telegram:123456",
      });
      const key = resolveSessionKey("per-sender", ctx);
      expect(key).toBe("agent:main:main");
    });
  });
});
