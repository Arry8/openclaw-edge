import { collectTextContentBlocks } from "../../agents/content-blocks.js";
import type { BlockReplyChunking } from "../../agents/pi-embedded-block-chunker.js";
import type { SkillCommandSpec } from "../../agents/skills.js";
import { applyOwnerOnlyToolPolicy } from "../../agents/tool-policy.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { generateSecureToken } from "../../infra/secure-random.js";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "../../shared/string-coerce.js";
import { resolveGatewayMessageChannel } from "../../utils/message-channel.js";
import {
  listReservedChatSlashCommandNames,
  resolveSkillCommandInvocation,
} from "../skill-commands-base.js";
import type { MsgContext, TemplateContext } from "../templating.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel, VerboseLevel } from "../thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import {
  readAbortCutoffFromSessionEntry,
  resolveAbortCutoffFromContext,
  shouldSkipMessageByAbortCutoff,
} from "./abort-cutoff.js";
import { getAbortMemory, isAbortRequestText } from "./abort-primitives.js";
import type { buildStatusReply, handleCommands } from "./commands.runtime.js";
import type { InlineDirectives } from "./directive-handling.parse.js";
import { isDirectiveOnly } from "./directive-handling.parse.js";
import { extractExplicitGroupId } from "./group-id.js";
import { stripMentions, stripStructuralPrefixes } from "./mentions.js";
import type { createModelSelectionState } from "./model-selection.js";
import { extractInlineSimpleCommand } from "./reply-inline.js";
import type { TypingController } from "./typing.js";

let builtinSlashCommands: Set<string> | null = null;

function getBuiltinSlashCommands(): Set<string> {
  if (builtinSlashCommands) {
    return builtinSlashCommands;
  }
  builtinSlashCommands = listReservedChatSlashCommandNames([
    "btw",
    "think",
    "verbose",
    "reasoning",
    "elevated",
    "exec",
    "model",
    "status",
    "queue",
  ]);
  return builtinSlashCommands;
}

function resolveSlashCommandName(commandBodyNormalized: string): string | null {
  const trimmed = commandBodyNormalized.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const match = trimmed.match(/^\/([^\s:]+)(?::|\s|$)/);
  const name = normalizeOptionalLowercaseString(match?.[1]) ?? "";
  return name ? name : null;
}

function expandBundleCommandPromptTemplate(template: string, args?: string): string {
  const normalizedArgs = normalizeOptionalString(args) || "";
  const rendered = template.includes("$ARGUMENTS")
    ? template.replaceAll("$ARGUMENTS", normalizedArgs)
    : template;
  if (!normalizedArgs || template.includes("$ARGUMENTS")) {
    return rendered.trim();
  }
  return `${rendered.trim()}\n\nUser input:\n${normalizedArgs}`;
}

export type InlineActionResult =
  | { kind: "reply"; reply: ReplyPayload | ReplyPayload[] | undefined }
  | {
      kind: "continue";
      directives: InlineDirectives;
      abortedLastRun: boolean;
    };

function extractTextFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }
  const parts = collectTextContentBlocks(content);
  const out = parts.join("");
  const trimmed = out.trim();
  return trimmed ? trimmed : null;
}

const CLI_ORCHESTRATOR_ACTIVATION_BLOCK = [
  "This path is only for orchestration_role=self_orchestrator.",
  "If the user wants the current visible CLI session to enter orchestration mode, you must first activate the current visible CLI session with CLI Bridge before claiming orchestration is enabled.",
  "Required order:",
  "1. Discover the current tmux identity from TMUX_PANE.",
  "2. Call POST /api/conversations/activate-adopted-orchestrator.",
  "3. Confirm the response includes conversation_id, token, and orchestrator.activation_state=activated.",
  "4. Only after that may you continue with workflow orchestration.",
  "If activation fails, do not pretend orchestration mode is active and do not continue dispatching workflow tasks.",
].join("\n");

const AMBIGUOUS_ORCHESTRATION_PATTERNS = [
  /^开启编排模式[。！!?\s]*$/u,
  /^进入编排模式[。！!?\s]*$/u,
  /^切到编排模式[。！!?\s]*$/u,
];

function requiresOrchestrationModeClarification(args?: string): boolean {
  const normalized = args?.trim();
  if (!normalized) {
    return false;
  }
  return AMBIGUOUS_ORCHESTRATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildSkillInvocationPrompt(skillName: string, args?: string): string {
  const promptParts = [
    `Use the "${skillName}" skill for this request.`,
    skillName === "cli-orchestrator" ? CLI_ORCHESTRATOR_ACTIVATION_BLOCK : null,
    skillName === "cli-orchestrator" && requiresOrchestrationModeClarification(args)
      ? [
          "If the user did not explicitly say whether to use supervisor or self_orchestrator, ask one clarification question before choosing a mode.",
          'Ask whether they want "/orchestrate" (supervisor) or "/orchestrate-self" (self_orchestrator).',
        ].join("\n")
      : null,
    args ? `User input:\n${args}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return promptParts.join("\n\n");
}

export async function handleInlineActions(params: {
  ctx: MsgContext;
  sessionCtx: TemplateContext;
  cfg: OpenClawConfig;
  agentId: string;
  agentDir?: string;
  sessionEntry?: SessionEntry;
  previousSessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
  sessionScope: Parameters<typeof buildStatusReply>[0]["sessionScope"];
  workspaceDir: string;
  isGroup: boolean;
  opts?: GetReplyOptions;
  typing: TypingController;
  allowTextCommands: boolean;
  inlineStatusRequested: boolean;
  command: Parameters<typeof handleCommands>[0]["command"];
  skillCommands?: SkillCommandSpec[];
  directives: InlineDirectives;
  cleanedBody: string;
  elevatedEnabled: boolean;
  elevatedAllowed: boolean;
  elevatedFailures: Array<{ gate: string; key: string }>;
  defaultActivation: Parameters<typeof buildStatusReply>[0]["defaultGroupActivation"];
  resolvedThinkLevel: ThinkLevel | undefined;
  resolvedVerboseLevel: VerboseLevel | undefined;
  resolvedReasoningLevel: ReasoningLevel;
  resolvedElevatedLevel: ElevatedLevel;
  blockReplyChunking?: BlockReplyChunking;
  resolvedBlockStreamingBreak?: "text_end" | "message_end";
  resolveDefaultThinkingLevel: Awaited<
    ReturnType<typeof createModelSelectionState>
  >["resolveDefaultThinkingLevel"];
  provider: string;
  model: string;
  contextTokens: number;
  directiveAck?: ReplyPayload;
  abortedLastRun: boolean;
  skillFilter?: string[];
}): Promise<InlineActionResult> {
  const {
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    workspaceDir,
    isGroup,
    opts,
    typing,
    allowTextCommands,
    inlineStatusRequested,
    command,
    directives: initialDirectives,
    cleanedBody: initialCleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    resolveDefaultThinkingLevel,
    provider,
    model,
    contextTokens,
    directiveAck,
    abortedLastRun: initialAbortedLastRun,
    skillFilter,
  } = params;

  let directives = initialDirectives;
  let cleanedBody = initialCleanedBody;

  const slashCommandName = resolveSlashCommandName(command.commandBodyNormalized);
  const shouldLoadSkillCommands =
    allowTextCommands &&
    slashCommandName !== null &&
    // `/skill …` needs the full skill command list.
    (slashCommandName === "skill" || !getBuiltinSlashCommands().has(slashCommandName));
  const skillCommands =
    shouldLoadSkillCommands && params.skillCommands
      ? params.skillCommands
      : shouldLoadSkillCommands
        ? (await import("../skill-commands.runtime.js")).listSkillCommandsForWorkspace({
            workspaceDir,
            cfg,
            agentId,
            skillFilter,
          })
        : [];

  const skillInvocation =
    allowTextCommands && skillCommands.length > 0
      ? resolveSkillCommandInvocation({
          commandBodyNormalized: command.commandBodyNormalized,
          skillCommands,
        })
      : null;
  if (skillInvocation) {
    if (!command.isAuthorizedSender) {
      logVerbose(
        `Ignoring /${skillInvocation.command.name} from unauthorized sender: ${command.senderId || "<unknown>"}`,
      );
      typing.cleanup();
      return { kind: "reply", reply: undefined };
    }

    const dispatch = skillInvocation.command.dispatch;
    if (dispatch?.kind === "tool") {
      const rawArgs = (skillInvocation.args ?? "").trim();
      const channel =
        resolveGatewayMessageChannel(ctx.Surface) ??
        resolveGatewayMessageChannel(ctx.Provider) ??
        undefined;

      const { createOpenClawTools } = await import("../../agents/openclaw-tools.runtime.js");
      const tools = createOpenClawTools({
        agentSessionKey: sessionKey,
        agentChannel: channel,
        agentAccountId: (ctx as { AccountId?: string }).AccountId,
        agentTo: ctx.OriginatingTo ?? ctx.To,
        agentThreadId: ctx.MessageThreadId ?? undefined,
        agentGroupId: extractExplicitGroupId(ctx.From),
        requesterAgentIdOverride: agentId,
        agentDir,
        workspaceDir,
        config: cfg,
        allowGatewaySubagentBinding: true,
      });
      const authorizedTools = applyOwnerOnlyToolPolicy(tools, command.senderIsOwner);

      const tool = authorizedTools.find((candidate) => candidate.name === dispatch.toolName);
      if (!tool) {
        typing.cleanup();
        return { kind: "reply", reply: { text: `❌ Tool not available: ${dispatch.toolName}` } };
      }

      const toolCallId = `cmd_${generateSecureToken(8)}`;
      try {
        const toolArgs: Parameters<NonNullable<typeof tool.execute>>[1] = {
          command: rawArgs,
          commandName: skillInvocation.command.name,
          skillName: skillInvocation.command.skillName,
        };
        const result = await tool.execute(toolCallId, toolArgs);
        const text = extractTextFromToolResult(result) ?? "✅ Done.";
        typing.cleanup();
        return { kind: "reply", reply: { text } };
      } catch (err) {
        const message = formatErrorMessage(err);
        typing.cleanup();
        return { kind: "reply", reply: { text: `❌ ${message}` } };
      }
    }

<<<<<<< HEAD
    const rewrittenBody = skillInvocation.command.promptTemplate
      ? expandBundleCommandPromptTemplate(
          skillInvocation.command.promptTemplate,
          skillInvocation.args,
        )
      : buildSkillInvocationPrompt(
          skillInvocation.command.skillName,
          skillInvocation.args,
        );
=======
    const rewrittenBody = buildSkillInvocationPrompt(
      skillInvocation.command.skillName,
      skillInvocation.args,
    );
>>>>>>> 50696a3301 (Split self orchestrator prompt rewrite routing)
    ctx.Body = rewrittenBody;
    ctx.BodyForAgent = rewrittenBody;
    sessionCtx.Body = rewrittenBody;
    sessionCtx.BodyForAgent = rewrittenBody;
    sessionCtx.BodyStripped = rewrittenBody;
    cleanedBody = rewrittenBody;
  }

  const sendInlineReply = async (reply?: ReplyPayload) => {
    if (!reply) {
      return;
    }
    if (!opts?.onBlockReply) {
      return;
    }
    await opts.onBlockReply(reply);
  };

  const isStopLikeInbound = isAbortRequestText(command.rawBodyNormalized);
  if (!isStopLikeInbound && sessionEntry) {
    const cutoff = readAbortCutoffFromSessionEntry(sessionEntry);
    const incoming = resolveAbortCutoffFromContext(ctx);
    const shouldSkip = cutoff
      ? shouldSkipMessageByAbortCutoff({
          cutoffMessageSid: cutoff.messageSid,
          cutoffTimestamp: cutoff.timestamp,
          messageSid: incoming?.messageSid,
          timestamp: incoming?.timestamp,
        })
      : false;
    if (shouldSkip) {
      typing.cleanup();
      return { kind: "reply", reply: undefined };
    }
    if (cutoff) {
      await (
        await import("./abort-cutoff.runtime.js")
      ).clearAbortCutoffInSessionRuntime({
        sessionEntry,
        sessionStore,
        sessionKey,
        storePath,
      });
    }
  }

  const inlineCommand =
    allowTextCommands && command.isAuthorizedSender
      ? extractInlineSimpleCommand(cleanedBody)
      : null;
  if (inlineCommand) {
    cleanedBody = inlineCommand.cleaned;
    sessionCtx.Body = cleanedBody;
    sessionCtx.BodyForAgent = cleanedBody;
    sessionCtx.BodyStripped = cleanedBody;
  }

  const handleInlineStatus =
    !isDirectiveOnly({
      directives,
      cleanedBody: directives.cleaned,
      ctx,
      cfg,
      agentId,
      isGroup,
    }) && inlineStatusRequested;
  let didSendInlineStatus = false;
  if (handleInlineStatus) {
    const { buildStatusReply } = await import("./commands.runtime.js");
    const inlineStatusReply = await buildStatusReply({
      cfg,
      command,
      sessionEntry,
      sessionKey,
      parentSessionKey: ctx.ParentSessionKey,
      sessionScope,
      provider,
      model,
      contextTokens,
      resolvedThinkLevel,
      resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
      resolvedReasoningLevel,
      resolvedElevatedLevel,
      resolveDefaultThinkingLevel,
      isGroup,
      defaultGroupActivation: defaultActivation,
      mediaDecisions: ctx.MediaUnderstandingDecisions,
    });
    await sendInlineReply(inlineStatusReply);
    didSendInlineStatus = true;
    directives = { ...directives, hasStatusDirective: false };
  }

  const runCommands = async (commandInput: typeof command) => {
    const { handleCommands } = await import("./commands.runtime.js");
    return handleCommands({
      // Pass sessionCtx so command handlers can mutate stripped body for same-turn continuation.
      ctx: sessionCtx,
      // Keep original finalized context in sync when command handlers need outer-dispatch side effects.
      rootCtx: ctx,
      cfg,
      command: commandInput,
      agentId,
      agentDir,
      directives,
      elevated: {
        enabled: elevatedEnabled,
        allowed: elevatedAllowed,
        defaultLevel: resolvedElevatedLevel,
        failures: elevatedFailures,
      },
      sessionEntry,
      previousSessionEntry,
      sessionStore,
      sessionKey,
      storePath,
      sessionScope,
      workspaceDir,
      opts,
      defaultGroupActivation: defaultActivation,
      resolvedThinkLevel,
      resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
      resolvedReasoningLevel,
      resolvedElevatedLevel,
      blockReplyChunking,
      resolvedBlockStreamingBreak,
      resolveDefaultThinkingLevel,
      provider,
      model,
      contextTokens,
      isGroup,
      skillCommands,
      typing,
    });
  };

  if (inlineCommand) {
    const inlineCommandContext = {
      ...command,
      rawBodyNormalized: inlineCommand.command,
      commandBodyNormalized: inlineCommand.command,
    };
    const inlineResult = await runCommands(inlineCommandContext);
    if (inlineResult.reply) {
      if (!inlineCommand.cleaned) {
        typing.cleanup();
        return { kind: "reply", reply: inlineResult.reply };
      }
      await sendInlineReply(inlineResult.reply);
    }
  }

  if (directiveAck) {
    await sendInlineReply(directiveAck);
  }

  const isEmptyConfig = Object.keys(cfg).length === 0;
  const skipWhenConfigEmpty = command.channelId
    ? Boolean(getChannelPlugin(command.channelId)?.commands?.skipWhenConfigEmpty)
    : false;
  if (
    skipWhenConfigEmpty &&
    isEmptyConfig &&
    command.from &&
    command.to &&
    command.from !== command.to
  ) {
    typing.cleanup();
    return { kind: "reply", reply: undefined };
  }

  let abortedLastRun = initialAbortedLastRun;
  if (!sessionEntry && command.abortKey) {
    abortedLastRun = getAbortMemory(command.abortKey) ?? false;
  }

  const shouldRunCommandHandlers =
    inlineCommand !== null ||
    directiveAck !== undefined ||
    inlineStatusRequested ||
    command.commandBodyNormalized.trim().startsWith("/");
  if (!shouldRunCommandHandlers) {
    return {
      kind: "continue",
      directives,
      abortedLastRun,
    };
  }
  const remainingBodyAfterInlineStatus = (() => {
    const stripped = stripStructuralPrefixes(cleanedBody);
    if (!isGroup) {
      return stripped.trim();
    }
    return stripMentions(stripped, ctx, cfg, agentId).trim();
  })();
  if (didSendInlineStatus && remainingBodyAfterInlineStatus.length === 0) {
    typing.cleanup();
    return { kind: "reply", reply: undefined };
  }

  const commandResult = await runCommands(command);
  if (!commandResult.shouldContinue) {
    typing.cleanup();
    return { kind: "reply", reply: commandResult.reply };
  }

  return {
    kind: "continue",
    directives,
    abortedLastRun,
  };
}
