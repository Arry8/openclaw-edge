import {
  serializePayload,
  type MessagePayloadFile,
  type MessagePayloadObject,
  type RequestClient,
} from "@buape/carbon";
import { ChannelType, Routes } from "discord-api-types/v10";
import { recordChannelActivity } from "openclaw/plugin-sdk/channel-runtime";
import { loadConfig, type OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { loadWebMedia } from "openclaw/plugin-sdk/web-media";
import { resolveDiscordAccount } from "./accounts.js";
import { registerDiscordComponentEntries } from "./components-registry.js";
import {
  buildDiscordComponentMessage,
  buildDiscordComponentMessageFlags,
  resolveDiscordComponentAttachmentName,
  type DiscordComponentBuildResult,
  type DiscordComponentMessageSpec,
} from "./components.js";
import {
  buildDiscordSendError,
  createDiscordClient,
  parseAndResolveRecipient,
  resolveChannelId,
  resolveDiscordChannelType,
  toDiscordFileBlob,
  stripUndefinedFields,
  SUPPRESS_NOTIFICATIONS_FLAG,
} from "./send.shared.js";
import type { DiscordSendResult } from "./send.types.js";

const DISCORD_FORUM_LIKE_TYPES = new Set<number>([ChannelType.GuildForum, ChannelType.GuildMedia]);

function extractComponentAttachmentNames(spec: DiscordComponentMessageSpec): string[] {
  const names: string[] = [];
  for (const block of spec.blocks ?? []) {
    if (block.type === "file") {
      names.push(resolveDiscordComponentAttachmentName(block.file));
    }
  }
  return names;
}

/** Build a plain-text representation of a component message for session transcript context. */
export function buildComponentTranscriptText(spec: DiscordComponentMessageSpec): string {
  const parts: string[] = [];
  if (spec.text?.trim()) {
    parts.push(spec.text.trim());
  }
  for (const block of spec.blocks ?? []) {
    switch (block.type) {
      case "text":
        if (block.text?.trim()) parts.push(block.text.trim());
        break;
      case "section":
        if (block.text?.trim()) parts.push(block.text.trim());
        for (const t of block.texts ?? []) {
          if (t?.trim()) parts.push(t.trim());
        }
        if (block.accessory?.type === "button" && block.accessory.button.label) {
          parts.push(`[${block.accessory.button.label}]`);
        }
        break;
      case "actions":
        if (block.buttons?.length) {
          parts.push(block.buttons.map((b) => `[${b.label}]`).join(" "));
        }
        if (block.select) {
          const opts = block.select.options;
          if (opts?.length) {
            parts.push(opts.map((o) => `[${o.label}]`).join(" "));
          } else {
            parts.push(`[${block.select.placeholder ?? "select"}]`);
          }
        }
        break;
      // media-gallery, file, and separator blocks carry no meaningful text
      // content, so they are intentionally omitted from the transcript summary.
      default:
        break;
    }
  }
  if (spec.modal) {
    const label = spec.modal.triggerLabel?.trim() || "Open form";
    parts.push(`[${label}]`);
  }
  return parts.join("\n");
}

type DiscordComponentSendOpts = {
  cfg?: OpenClawConfig;
  accountId?: string;
  token?: string;
  rest?: RequestClient;
  silent?: boolean;
  replyTo?: string;
  /** Used by buildDiscordComponentMessage to bind interaction callbacks to the agent session. */
  sessionKey?: string;
  /** Used by buildDiscordComponentMessage to bind interaction callbacks to the agent session. */
  agentId?: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  filename?: string;
};

export function registerBuiltDiscordComponentMessage(params: {
  buildResult: DiscordComponentBuildResult;
  messageId: string;
}): void {
  registerDiscordComponentEntries({
    entries: params.buildResult.entries,
    modals: params.buildResult.modals,
    messageId: params.messageId,
  });
}

async function buildDiscordComponentPayload(params: {
  spec: DiscordComponentMessageSpec;
  opts: DiscordComponentSendOpts;
  accountId: string;
}): Promise<{
  body: ReturnType<typeof stripUndefinedFields>;
  buildResult: ReturnType<typeof buildDiscordComponentMessage>;
}> {
  const buildResult = buildDiscordComponentMessage({
    spec: params.spec,
    sessionKey: params.opts.sessionKey,
    agentId: params.opts.agentId,
    accountId: params.accountId,
  });
  const flags = buildDiscordComponentMessageFlags(buildResult.components);
  const finalFlags = params.opts.silent
    ? (flags ?? 0) | SUPPRESS_NOTIFICATIONS_FLAG
    : (flags ?? undefined);
  const messageReference = params.opts.replyTo
    ? { message_id: params.opts.replyTo, fail_if_not_exists: false }
    : undefined;

  const attachmentNames = extractComponentAttachmentNames(params.spec);
  const uniqueAttachmentNames = [...new Set(attachmentNames)];
  if (uniqueAttachmentNames.length > 1) {
    throw new Error(
      "Discord component attachments currently support a single file. Use media-gallery for multiple files.",
    );
  }
  const expectedAttachmentName = uniqueAttachmentNames[0];
  let files: MessagePayloadFile[] | undefined;
  if (params.opts.mediaUrl) {
    const media = await loadWebMedia(params.opts.mediaUrl, {
      localRoots: params.opts.mediaLocalRoots,
    });
    const filenameOverride = params.opts.filename?.trim();
    const fileName = filenameOverride || media.fileName || "upload";
    if (expectedAttachmentName && expectedAttachmentName !== fileName) {
      throw new Error(
        `Component file block expects attachment "${expectedAttachmentName}", but the uploaded file is "${fileName}". Update components.blocks[].file or provide a matching filename.`,
      );
    }
    const fileData = toDiscordFileBlob(media.buffer);
    files = [{ data: fileData, name: fileName }];
  } else if (expectedAttachmentName) {
    throw new Error(
      "Discord component file blocks require a media attachment (media/path/filePath).",
    );
  }

  const payload: MessagePayloadObject = {
    components: buildResult.components,
    ...(finalFlags ? { flags: finalFlags } : {}),
    ...(files ? { files } : {}),
  };
  const body = stripUndefinedFields({
    ...serializePayload(payload),
    ...(messageReference ? { message_reference: messageReference } : {}),
  });

  return { body, buildResult };
}

export async function sendDiscordComponentMessage(
  to: string,
  spec: DiscordComponentMessageSpec,
  opts: DiscordComponentSendOpts = {},
): Promise<DiscordSendResult> {
  const cfg = opts.cfg ?? loadConfig();
  const accountInfo = resolveDiscordAccount({ cfg, accountId: opts.accountId });
  const { token, rest, request } = createDiscordClient(opts, cfg);
  const recipient = await parseAndResolveRecipient(to, opts.accountId, cfg);
  const { channelId } = await resolveChannelId(rest, recipient, request);

  const channelType = await resolveDiscordChannelType(rest, channelId);

  if (channelType && DISCORD_FORUM_LIKE_TYPES.has(channelType)) {
    throw new Error("Discord components are not supported in forum-style channels");
  }

  const { body, buildResult } = await buildDiscordComponentPayload({
    spec,
    opts,
    accountId: accountInfo.accountId,
  });

  let result: { id: string; channel_id: string };
  try {
    result = (await request(
      () =>
        rest.post(Routes.channelMessages(channelId), {
          body,
        }) as Promise<{ id: string; channel_id: string }>,
      "components",
    )) as { id: string; channel_id: string };
  } catch (err) {
    throw await buildDiscordSendError(err, {
      channelId,
      rest,
      token,
      hasMedia: Boolean(opts.mediaUrl),
    });
  }

  registerBuiltDiscordComponentMessage({
    buildResult,
    messageId: result.id,
  });

  recordChannelActivity({
    channel: "discord",
    accountId: accountInfo.accountId,
    direction: "outbound",
  });

  return {
    messageId: result.id ?? "unknown",
    channelId: result.channel_id ?? channelId,
  };
}

export async function editDiscordComponentMessage(
  to: string,
  messageId: string,
  spec: DiscordComponentMessageSpec,
  opts: DiscordComponentSendOpts = {},
): Promise<DiscordSendResult> {
  const cfg = opts.cfg ?? loadConfig();
  const accountInfo = resolveDiscordAccount({ cfg, accountId: opts.accountId });
  const { token, rest, request } = createDiscordClient(opts, cfg);
  const recipient = await parseAndResolveRecipient(to, opts.accountId, cfg);
  const { channelId } = await resolveChannelId(rest, recipient, request);
  const { body, buildResult } = await buildDiscordComponentPayload({
    spec,
    opts,
    accountId: accountInfo.accountId,
  });

  let result: { id: string; channel_id: string };
  try {
    result = (await request(
      () =>
        rest.patch(Routes.channelMessage(channelId, messageId), {
          body,
        }) as Promise<{ id: string; channel_id: string }>,
      "components",
    )) as { id: string; channel_id: string };
  } catch (err) {
    throw await buildDiscordSendError(err, {
      channelId,
      rest,
      token,
      hasMedia: Boolean(opts.mediaUrl),
    });
  }

  registerBuiltDiscordComponentMessage({
    buildResult,
    messageId: result.id ?? messageId,
  });

  recordChannelActivity({
    channel: "discord",
    accountId: accountInfo.accountId,
    direction: "outbound",
  });

  return {
    messageId: result.id ?? messageId,
    channelId: result.channel_id ?? channelId,
  };
}
