import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../runtime-api.js";
import { resolveMattermostAccount } from "./accounts.js";
import {
  canFinalizeMattermostPreviewInPlace,
  evaluateMattermostMentionGate,
  resolveMattermostReactionChannelId,
  resolveMattermostEffectiveReplyToId,
  resolveMattermostReplyRootId,
  resolveMattermostThreadSessionContext,
  shouldFinalizeMattermostPreviewAfterDispatch,
  shouldClearMattermostDraftPreview,
  type MattermostMentionGateInput,
  type MattermostRequireMentionResolverInput,
} from "./monitor.js";

function resolveRequireMentionForTest(params: MattermostRequireMentionResolverInput): boolean {
  const root = params.cfg.channels?.mattermost;
  const accountGroups = (
    root?.accounts?.[params.accountId] as
      | { groups?: Record<string, { requireMention?: boolean }> }
      | undefined
  )?.groups;
  const groups = accountGroups ?? root?.groups;
  const typedGroups = groups as Record<string, { requireMention?: boolean }> | undefined;
  const groupConfig = params.groupId ? typedGroups?.[params.groupId] : undefined;
  const defaultGroupConfig = typedGroups?.["*"];
  const configMention =
    typeof groupConfig?.requireMention === "boolean"
      ? groupConfig.requireMention
      : typeof defaultGroupConfig?.requireMention === "boolean"
        ? defaultGroupConfig.requireMention
        : undefined;
  if (typeof configMention === "boolean") {
    return configMention;
  }
  if (typeof params.requireMentionOverride === "boolean") {
    return params.requireMentionOverride;
  }
  return true;
}

function evaluateMentionGateForMessage(params: { cfg: OpenClawConfig; threadRootId?: string }) {
  const account = resolveMattermostAccount({ cfg: params.cfg, accountId: "default" });
  const resolver = vi.fn(resolveRequireMentionForTest);
  const input: MattermostMentionGateInput = {
    kind: "channel",
    cfg: params.cfg,
    accountId: account.accountId,
    channelId: "chan-1",
    threadRootId: params.threadRootId,
    requireMentionOverride: account.requireMention,
    resolveRequireMention: resolver,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharEnabled: false,
    oncharTriggered: false,
    canDetectMention: true,
  };
  const decision = evaluateMattermostMentionGate(input);
  return { account, resolver, decision };
}

describe("mattermost mention gating", () => {
  it("accepts unmentioned root channel posts in onmessage mode", () => {
    const cfg: OpenClawConfig = {
      channels: {
        mattermost: {
          chatmode: "onmessage",
          groupPolicy: "open",
        },
      },
    };
    const { resolver, decision } = evaluateMentionGateForMessage({ cfg });
    expect(decision.dropReason).toBeNull();
    expect(decision.shouldRequireMention).toBe(false);
    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "default",
        groupId: "chan-1",
        requireMentionOverride: false,
      }),
    );
  });

  it("accepts unmentioned thread replies in onmessage mode", () => {
    const cfg: OpenClawConfig = {
      channels: {
        mattermost: {
          chatmode: "onmessage",
          groupPolicy: "open",
        },
      },
    };
    const { resolver, decision } = evaluateMentionGateForMessage({
      cfg,
      threadRootId: "thread-root-1",
    });
    expect(decision.dropReason).toBeNull();
    expect(decision.shouldRequireMention).toBe(false);
    const resolverCall = resolver.mock.calls.at(-1)?.[0];
    expect(resolverCall?.groupId).toBe("chan-1");
    expect(resolverCall?.groupId).not.toBe("thread-root-1");
  });

  it("rejects unmentioned channel posts in oncall mode", () => {
    const cfg: OpenClawConfig = {
      channels: {
        mattermost: {
          chatmode: "oncall",
          groupPolicy: "open",
        },
      },
    };
    const { decision, account } = evaluateMentionGateForMessage({ cfg });
    expect(account.requireMention).toBe(true);
    expect(decision.shouldRequireMention).toBe(true);
    expect(decision.dropReason).toBe("missing-mention");
  });
});

describe("resolveMattermostReplyRootId with block streaming payloads", () => {
  it("uses threadRootId for block-streamed payloads with replyToId", () => {
    // When block streaming sends a payload with replyToId from the threading
    // mode, the deliver callback should still use the existing threadRootId.
    expect(
      resolveMattermostReplyRootId({
        threadRootId: "thread-root-1",
        replyToId: "streamed-reply-id",
      }),
    ).toBe("thread-root-1");
  });

  it("falls back to payload replyToId when no threadRootId in block streaming", () => {
    // Top-level channel message: no threadRootId, payload carries the
    // inbound post id as replyToId from the "all" threading mode.
    expect(
      resolveMattermostReplyRootId({
        replyToId: "inbound-post-for-threading",
      }),
    ).toBe("inbound-post-for-threading");
  });
});

describe("resolveMattermostReplyRootId", () => {
  it("uses replyToId for top-level replies", () => {
    expect(
      resolveMattermostReplyRootId({
        replyToId: "inbound-post-123",
      }),
    ).toBe("inbound-post-123");
  });

  it("keeps the thread root when replying inside an existing thread", () => {
    expect(
      resolveMattermostReplyRootId({
        threadRootId: "thread-root-456",
        replyToId: "child-post-789",
      }),
    ).toBe("thread-root-456");
  });

  it("falls back to undefined when neither reply target is available", () => {
    expect(resolveMattermostReplyRootId({})).toBeUndefined();
  });
});

describe("canFinalizeMattermostPreviewInPlace", () => {
  it("allows in-place finalization when the final reply target matches the preview thread", () => {
    expect(
      canFinalizeMattermostPreviewInPlace({
        previewRootId: "thread-root-456",
        threadRootId: "thread-root-456",
        replyToId: "child-post-789",
      }),
    ).toBe(true);
  });

  it("prevents in-place finalization when a top-level preview would become a threaded reply", () => {
    expect(
      canFinalizeMattermostPreviewInPlace({
        replyToId: "child-post-789",
      }),
    ).toBe(false);
  });
});

describe("shouldClearMattermostDraftPreview", () => {
  it("clears a stale preview when no final reply was delivered", () => {
    expect(
      shouldClearMattermostDraftPreview({
        finalizedViaPreviewPost: false,
        finalReplyDelivered: false,
      }),
    ).toBe(true);
  });

  it("keeps the preview when the final reply was delivered normally", () => {
    expect(
      shouldClearMattermostDraftPreview({
        finalizedViaPreviewPost: false,
        finalReplyDelivered: true,
      }),
    ).toBe(false);
  });

  it("keeps the preview when it already became the final reply", () => {
    expect(
      shouldClearMattermostDraftPreview({
        finalizedViaPreviewPost: true,
        finalReplyDelivered: false,
      }),
    ).toBe(false);
  });
});

describe("shouldFinalizeMattermostPreviewAfterDispatch", () => {
  it("reuses the preview only for a single eligible final payload", () => {
    expect(
      shouldFinalizeMattermostPreviewAfterDispatch({
        finalCount: 1,
        canFinalizeInPlace: true,
      }),
    ).toBe(true);
  });

  it("falls back to normal sends for multi-payload finals", () => {
    expect(
      shouldFinalizeMattermostPreviewAfterDispatch({
        finalCount: 2,
        canFinalizeInPlace: true,
      }),
    ).toBe(false);
  });

  it("falls back to normal sends when the final cannot be edited into the preview", () => {
    expect(
      shouldFinalizeMattermostPreviewAfterDispatch({
        finalCount: 1,
        canFinalizeInPlace: false,
      }),
    ).toBe(false);
  });
});

describe("resolveMattermostEffectiveReplyToId", () => {
  it("keeps an existing thread root", () => {
    expect(
      resolveMattermostEffectiveReplyToId({
        kind: "channel",
        postId: "post-123",
        replyToMode: "all",
        threadRootId: "thread-root-456",
      }),
    ).toBe("thread-root-456");
  });

  it("suppresses existing thread roots when replyToMode is off", () => {
    expect(
      resolveMattermostEffectiveReplyToId({
        kind: "channel",
        postId: "post-123",
        replyToMode: "off",
        threadRootId: "thread-root-456",
      }),
    ).toBeUndefined();
  });

  it("starts a thread for top-level channel messages when replyToMode is all", () => {
    expect(
      resolveMattermostEffectiveReplyToId({
        kind: "channel",
        postId: "post-123",
        replyToMode: "all",
      }),
    ).toBe("post-123");
  });

  it("starts a thread for top-level group messages when replyToMode is first", () => {
    expect(
      resolveMattermostEffectiveReplyToId({
        kind: "group",
        postId: "post-123",
        replyToMode: "first",
      }),
    ).toBe("post-123");
  });

  it("keeps direct messages non-threaded", () => {
    expect(
      resolveMattermostEffectiveReplyToId({
        kind: "direct",
        postId: "post-123",
        replyToMode: "all",
      }),
    ).toBeUndefined();
  });
});

describe("resolveMattermostThreadSessionContext", () => {
  it("forks channel sessions by top-level post when replyToMode is all", () => {
    expect(
      resolveMattermostThreadSessionContext({
        baseSessionKey: "agent:main:mattermost:default:chan-1",
        kind: "channel",
        postId: "post-123",
        replyToMode: "all",
      }),
    ).toEqual({
      effectiveReplyToId: "post-123",
      sessionKey: "agent:main:mattermost:default:chan-1:thread:post-123",
      parentSessionKey: "agent:main:mattermost:default:chan-1",
    });
  });

  it("keeps existing thread roots for threaded follow-ups", () => {
    expect(
      resolveMattermostThreadSessionContext({
        baseSessionKey: "agent:main:mattermost:default:chan-1",
        kind: "group",
        postId: "post-123",
        replyToMode: "first",
        threadRootId: "root-456",
      }),
    ).toEqual({
      effectiveReplyToId: "root-456",
      sessionKey: "agent:main:mattermost:default:chan-1:thread:root-456",
      parentSessionKey: "agent:main:mattermost:default:chan-1",
    });
  });

  it("keeps threaded messages top-level when replyToMode is off", () => {
    expect(
      resolveMattermostThreadSessionContext({
        baseSessionKey: "agent:main:mattermost:default:chan-1",
        kind: "group",
        postId: "post-123",
        replyToMode: "off",
        threadRootId: "root-456",
      }),
    ).toEqual({
      effectiveReplyToId: undefined,
      sessionKey: "agent:main:mattermost:default:chan-1",
      parentSessionKey: undefined,
    });
  });

  it("keeps direct-message sessions linear", () => {
    expect(
      resolveMattermostThreadSessionContext({
        baseSessionKey: "agent:main:mattermost:default:user-1",
        kind: "direct",
        postId: "post-123",
        replyToMode: "all",
      }),
    ).toEqual({
      effectiveReplyToId: undefined,
      sessionKey: "agent:main:mattermost:default:user-1",
      parentSessionKey: undefined,
    });
  });
});

describe("resolveMattermostReactionChannelId", () => {
  it("prefers broadcast channel_id when present", () => {
    expect(
      resolveMattermostReactionChannelId({
        broadcast: { channel_id: "chan-broadcast" },
        data: { channel_id: "chan-data" },
      }),
    ).toBe("chan-broadcast");
  });

  it("falls back to data.channel_id when broadcast channel_id is missing", () => {
    expect(
      resolveMattermostReactionChannelId({
        data: { channel_id: "chan-data" },
      }),
    ).toBe("chan-data");
  });

  it("returns undefined when neither payload location includes channel_id", () => {
    expect(resolveMattermostReactionChannelId({})).toBeUndefined();
  });
});
