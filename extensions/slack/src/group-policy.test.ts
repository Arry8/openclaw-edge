import { describe, expect, it } from "vitest";
import { resolveSlackGroupRequireMention, resolveSlackGroupToolPolicy } from "./group-policy.js";

const cfg = {
  channels: {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      channels: {
        alerts: {
          requireMention: false,
          tools: { allow: ["message.send"] },
          toolsBySender: {
            "id:user:alice": { allow: ["sessions.list"] },
          },
        },
        "*": {
          requireMention: true,
          tools: { deny: ["exec"] },
        },
      },
    },
  },
} as any;

const cfgWithMixedCaseChannelId = {
  channels: {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      channels: {
        C123Abc456: {
          requireMention: false,
          tools: { allow: ["message.send"] },
        },
        "*": {
          requireMention: true,
          tools: { deny: ["exec"] },
        },
      },
    },
  },
} as any;

describe("slack group policy", () => {
  it("uses matched channel requireMention and wildcard fallback", () => {
    expect(resolveSlackGroupRequireMention({ cfg, groupChannel: "#alerts" })).toBe(false);
    expect(resolveSlackGroupRequireMention({ cfg, groupChannel: "#missing" })).toBe(true);
  });

  it("matches channel IDs case-insensitively like other Slack channel config lookups", () => {
    expect(
      resolveSlackGroupRequireMention({
        cfg: cfgWithMixedCaseChannelId,
        groupId: "C123ABC456",
      }),
    ).toBe(false);

    expect(
      resolveSlackGroupToolPolicy({
        cfg: cfgWithMixedCaseChannelId,
        groupId: "C123ABC456",
        senderId: "user:bob",
      }),
    ).toEqual({ allow: ["message.send"] });
  });

  it("resolves sender override, then channel tools, then wildcard tools", () => {
    const senderOverride = resolveSlackGroupToolPolicy({
      cfg,
      groupChannel: "#alerts",
      senderId: "user:alice",
    });
    expect(senderOverride).toEqual({ allow: ["sessions.list"] });

    const channelTools = resolveSlackGroupToolPolicy({
      cfg,
      groupChannel: "#alerts",
      senderId: "user:bob",
    });
    expect(channelTools).toEqual({ allow: ["message.send"] });

    const wildcardTools = resolveSlackGroupToolPolicy({
      cfg,
      groupChannel: "#missing",
      senderId: "user:bob",
    });
    expect(wildcardTools).toEqual({ deny: ["exec"] });
  });
});
