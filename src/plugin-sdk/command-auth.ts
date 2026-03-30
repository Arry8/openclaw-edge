import { listAgentEntries, resolveSessionAgentId } from "../agents/agent-scope.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { buildStatusReply } from "../auto-reply/reply/commands-status.js";
import type { CommandContext } from "../auto-reply/reply/commands-types.js";
import { resolveDefaultModel } from "../auto-reply/reply/directive-handling.defaults.js";
import { resolveCurrentDirectiveLevels } from "../auto-reply/reply/directive-handling.levels.js";
import { createModelSelectionState } from "../auto-reply/reply/model-selection.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadSessionEntry } from "../gateway/session-utils.js";
import { resolveDmGroupAccessWithLists } from "../security/dm-policy-shared.js";
export {
  createPreCryptoDirectDmAuthorizer,
  resolveInboundDirectDmAccessWithRuntime,
  type DirectDmCommandAuthorizationRuntime,
  type ResolvedInboundDirectDmAccess,
} from "./direct-dm.js";

export {
  hasControlCommand,
  hasInlineCommandTokens,
  isControlCommandMessage,
  shouldComputeCommandAuthorized,
} from "../auto-reply/command-detection.js";
export {
  buildCommandText,
  buildCommandTextFromArgs,
  findCommandByNativeName,
  getCommandDetection,
  isCommandEnabled,
  isCommandMessage,
  isNativeCommandSurface,
  listChatCommands,
  listChatCommandsForConfig,
  listNativeCommandSpecs,
  listNativeCommandSpecsForConfig,
  maybeResolveTextAlias,
  normalizeCommandBody,
  parseCommandArgs,
  resolveCommandArgChoices,
  resolveCommandArgMenu,
  resolveTextCommand,
  serializeCommandArgs,
  shouldHandleTextCommands,
} from "../auto-reply/commands-registry.js";
export type {
  ChatCommandDefinition,
  CommandArgChoiceContext,
  CommandArgDefinition,
  CommandArgMenuSpec,
  CommandArgValues,
  CommandArgs,
  CommandDetection,
  CommandNormalizeOptions,
  CommandScope,
  NativeCommandSpec,
  ResolvedCommandArgChoice,
  ShouldHandleTextCommandsParams,
} from "../auto-reply/commands-registry.js";
export type { CommandArgsParsing } from "../auto-reply/commands-registry.types.js";
export {
  resolveCommandAuthorizedFromAuthorizers,
  resolveControlCommandGate,
  resolveDualTextControlCommandGate,
  type CommandAuthorizer,
  type CommandGatingModeWhenAccessGroupsOff,
} from "../channels/command-gating.js";
export {
  resolveNativeCommandSessionTargets,
  type ResolveNativeCommandSessionTargetsParams,
} from "../channels/native-command-session-targets.js";
export {
  resolveCommandAuthorization,
  type CommandAuthorization,
} from "../auto-reply/command-auth.js";
export {
  listReservedChatSlashCommandNames,
  listSkillCommandsForAgents,
  listSkillCommandsForWorkspace,
  resolveSkillCommandInvocation,
} from "../auto-reply/skill-commands.js";
export type { SkillCommandSpec } from "../agents/skills.js";
export type { CommandContext } from "../auto-reply/reply/commands-types.js";
export { buildCommandsPaginationKeyboard } from "../auto-reply/reply/commands-info.js";
export {
  buildModelsProviderData,
  formatModelsAvailableHeader,
  resolveModelsCommandReply,
} from "../auto-reply/reply/commands-models.js";
export type { ModelsProviderData } from "../auto-reply/reply/commands-models.js";
export { resolveStoredModelOverride } from "../auto-reply/reply/model-selection.js";
export type { StoredModelOverride } from "../auto-reply/reply/model-selection.js";
export {
  buildCommandsMessage,
  buildCommandsMessagePaginated,
  buildHelpMessage,
} from "../auto-reply/status.js";

export async function resolveDirectStatusReplyForSession(params: {
  cfg: OpenClawConfig;
  command: CommandContext;
  sessionKey: string;
  isGroup: boolean;
  defaultGroupActivation: () => "always" | "mention";
}): Promise<ReplyPayload | undefined> {
  const statusTargetSessionKey = params.sessionKey.trim();
  if (!statusTargetSessionKey) {
    return undefined;
  }
  const statusLoaded = loadSessionEntry(statusTargetSessionKey);
  const statusCfg = statusLoaded.cfg ?? params.cfg;
  const statusEntry = statusLoaded.entry;
  const statusAgentId = resolveSessionAgentId({
    sessionKey: statusTargetSessionKey,
    config: statusCfg,
  });
  const agentCfg = statusCfg.agents?.defaults;
  const agentEntry = listAgentEntries(statusCfg).find(
    (entry) => entry.id?.trim().toLowerCase() === statusAgentId,
  );
  const statusModel = resolveDefaultModelForAgent({
    cfg: statusCfg,
    agentId: statusAgentId,
  });
  const { defaultProvider, defaultModel } = resolveDefaultModel({
    cfg: statusCfg,
    agentId: statusAgentId,
  });
  const selectedProvider =
    statusEntry?.providerOverride?.trim() ||
    statusEntry?.modelProvider?.trim() ||
    statusModel.provider;
  const selectedModel =
    statusEntry?.modelOverride?.trim() || statusEntry?.model?.trim() || statusModel.model;
  const modelState = await createModelSelectionState({
    cfg: statusCfg,
    agentId: statusAgentId,
    agentCfg,
    sessionEntry: statusEntry,
    sessionStore: statusLoaded.store,
    sessionKey: statusTargetSessionKey,
    parentSessionKey: statusEntry?.parentSessionKey,
    storePath: statusLoaded.storePath,
    defaultProvider,
    defaultModel,
    provider: selectedProvider,
    model: selectedModel,
    hasModelDirective: false,
  });
  const {
    currentThinkLevel,
    currentFastMode,
    currentVerboseLevel,
    currentReasoningLevel,
    currentElevatedLevel,
  } = await resolveCurrentDirectiveLevels({
    sessionEntry: statusEntry,
    agentEntry,
    agentCfg,
    resolveDefaultThinkingLevel: () => modelState.resolveDefaultThinkingLevel(),
  });
  let resolvedReasoningLevel = currentReasoningLevel;
  const hasAgentReasoningDefault =
    agentEntry?.reasoningDefault !== undefined && agentEntry?.reasoningDefault !== null;
  const reasoningExplicitlySet =
    (statusEntry?.reasoningLevel !== undefined && statusEntry?.reasoningLevel !== null) ||
    hasAgentReasoningDefault;
  const thinkingActive = currentThinkLevel !== "off";
  if (!reasoningExplicitlySet && resolvedReasoningLevel === "off" && !thinkingActive) {
    resolvedReasoningLevel = await modelState.resolveDefaultReasoningLevel();
  }
  return await buildStatusReply({
    cfg: statusCfg,
    command: params.command,
    sessionEntry: statusEntry,
    sessionKey: statusTargetSessionKey,
    parentSessionKey: statusEntry?.parentSessionKey,
    sessionScope: undefined,
    storePath: statusLoaded.storePath,
    provider: selectedProvider,
    model: selectedModel,
    contextTokens: statusEntry?.contextTokens ?? 0,
    resolvedThinkLevel: currentThinkLevel,
    resolvedFastMode: currentFastMode,
    resolvedVerboseLevel: currentVerboseLevel ?? "off",
    resolvedReasoningLevel: resolvedReasoningLevel,
    resolvedElevatedLevel: currentElevatedLevel,
    resolveDefaultThinkingLevel: () => modelState.resolveDefaultThinkingLevel(),
    isGroup: params.isGroup,
    defaultGroupActivation: params.defaultGroupActivation,
  });
}

export type ResolveSenderCommandAuthorizationParams = {
  cfg: OpenClawConfig;
  rawBody: string;
  isGroup: boolean;
  dmPolicy: string;
  configuredAllowFrom: string[];
  configuredGroupAllowFrom?: string[];
  senderId: string;
  isSenderAllowed: (senderId: string, allowFrom: string[]) => boolean;
  readAllowFromStore: () => Promise<string[]>;
  shouldComputeCommandAuthorized: (rawBody: string, cfg: OpenClawConfig) => boolean;
  resolveCommandAuthorizedFromAuthorizers: (params: {
    useAccessGroups: boolean;
    authorizers: Array<{ configured: boolean; allowed: boolean }>;
  }) => boolean;
};

export type CommandAuthorizationRuntime = {
  shouldComputeCommandAuthorized: (rawBody: string, cfg: OpenClawConfig) => boolean;
  resolveCommandAuthorizedFromAuthorizers: (params: {
    useAccessGroups: boolean;
    authorizers: Array<{ configured: boolean; allowed: boolean }>;
  }) => boolean;
};

export type ResolveSenderCommandAuthorizationWithRuntimeParams = Omit<
  ResolveSenderCommandAuthorizationParams,
  "shouldComputeCommandAuthorized" | "resolveCommandAuthorizedFromAuthorizers"
> & {
  runtime: CommandAuthorizationRuntime;
};

/** Fast-path DM command authorization when only policy and sender allowlist state matter. */
export function resolveDirectDmAuthorizationOutcome(params: {
  isGroup: boolean;
  dmPolicy: string;
  senderAllowedForCommands: boolean;
}): "disabled" | "unauthorized" | "allowed" {
  if (params.isGroup) {
    return "allowed";
  }
  if (params.dmPolicy === "disabled") {
    return "disabled";
  }
  if (params.dmPolicy !== "open" && !params.senderAllowedForCommands) {
    return "unauthorized";
  }
  return "allowed";
}

/** Runtime-backed wrapper around sender command authorization for grouped helper surfaces. */
export async function resolveSenderCommandAuthorizationWithRuntime(
  params: ResolveSenderCommandAuthorizationWithRuntimeParams,
): ReturnType<typeof resolveSenderCommandAuthorization> {
  return resolveSenderCommandAuthorization({
    ...params,
    shouldComputeCommandAuthorized: params.runtime.shouldComputeCommandAuthorized,
    resolveCommandAuthorizedFromAuthorizers: params.runtime.resolveCommandAuthorizedFromAuthorizers,
  });
}

/** Compute effective allowlists and command authorization for one inbound sender. */
export async function resolveSenderCommandAuthorization(
  params: ResolveSenderCommandAuthorizationParams,
): Promise<{
  shouldComputeAuth: boolean;
  effectiveAllowFrom: string[];
  effectiveGroupAllowFrom: string[];
  senderAllowedForCommands: boolean;
  commandAuthorized: boolean | undefined;
}> {
  const shouldComputeAuth = params.shouldComputeCommandAuthorized(params.rawBody, params.cfg);
  const storeAllowFrom =
    !params.isGroup &&
    params.dmPolicy !== "allowlist" &&
    (params.dmPolicy !== "open" || shouldComputeAuth)
      ? await params.readAllowFromStore().catch(() => [])
      : [];
  const access = resolveDmGroupAccessWithLists({
    isGroup: params.isGroup,
    dmPolicy: params.dmPolicy,
    groupPolicy: "allowlist",
    allowFrom: params.configuredAllowFrom,
    groupAllowFrom: params.configuredGroupAllowFrom ?? [],
    storeAllowFrom,
    isSenderAllowed: (allowFrom) => params.isSenderAllowed(params.senderId, allowFrom),
  });
  const effectiveAllowFrom = access.effectiveAllowFrom;
  const effectiveGroupAllowFrom = access.effectiveGroupAllowFrom;
  const useAccessGroups = params.cfg.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = params.isSenderAllowed(
    params.senderId,
    params.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom,
  );
  const ownerAllowedForCommands = params.isSenderAllowed(params.senderId, effectiveAllowFrom);
  const groupAllowedForCommands = params.isSenderAllowed(params.senderId, effectiveGroupAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? params.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: ownerAllowedForCommands },
          { configured: effectiveGroupAllowFrom.length > 0, allowed: groupAllowedForCommands },
        ],
      })
    : undefined;

  return {
    shouldComputeAuth,
    effectiveAllowFrom,
    effectiveGroupAllowFrom,
    senderAllowedForCommands,
    commandAuthorized,
  };
}
