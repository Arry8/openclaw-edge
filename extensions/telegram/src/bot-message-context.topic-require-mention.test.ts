import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../../src/config/config.js";

const { defaultRouteConfig } = vi.hoisted(() => ({
  defaultRouteConfig: {
    agents: {
      list: [{ id: "main", default: true }],
    },
    channels: { telegram: {} },
    messages: { groupChat: { mentionPatterns: [] } },
  },
}));

vi.mock("../../../src/config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => defaultRouteConfig),
  };
});

const { buildTelegramMessageContextForTest } =
  await import("./bot-message-context.test-harness.js");

describe("buildTelegramMessageContext per-topic requireMention override", () => {
  /** Forum group message without an @mention of the bot. */
  function buildForumMessage(threadId = 3) {
    return {
      message_id: 1,
      chat: {
        id: -1001234567890,
        type: "supergroup" as const,
        title: "Forum",
        is_forum: true,
      },
      date: 1700000000,
      // No @bot mention — requireMention gates whether this is processed.
      text: "hello everyone",
      message_thread_id: threadId,
      from: { id: 42, first_name: "Alice" },
    };
  }

  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue(defaultRouteConfig as never);
  });

  it("topic requireMention=false overrides group requireMention=true", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: buildForumMessage(),
      resolveGroupActivation: () => undefined,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: { requireMention: false },
      }),
    });

    // Topic says requireMention=false, so the message should be processed
    // even though group-level requireMention=true.
    expect(ctx).not.toBeNull();
  });

  it("topic requireMention=false overrides activationOverride=true", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: buildForumMessage(),
      // activationOverride returns true (meaning requireMention=true from /deactivate)
      resolveGroupActivation: () => true,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: { requireMention: false },
      }),
    });

    // Topic config should take priority over activation override —
    // topic says requireMention=false, so the message goes through.
    expect(ctx).not.toBeNull();
  });

  it("group-level requireMention still works when no topic config exists", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: buildForumMessage(),
      resolveGroupActivation: () => undefined,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: undefined,
      }),
    });

    // No topic config, group says requireMention=true, no @mention → skipped.
    expect(ctx).toBeNull();
  });

  it("activationOverride still works when no topic config is present", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: buildForumMessage(),
      // activationOverride=false → requireMention=false (from /activate)
      resolveGroupActivation: () => false,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: undefined,
      }),
    });

    // No topic config, but activation override says requireMention=false →
    // message should be processed.
    expect(ctx).not.toBeNull();
  });
});
