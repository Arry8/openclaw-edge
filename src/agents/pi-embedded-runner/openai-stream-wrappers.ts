import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import { resolveProviderAttributionHeaders } from "../provider-attribution.js";
import { log } from "./logger.js";
import { streamWithPayloadPatch } from "./stream-payload-utils.js";

type OpenAIServiceTier = "auto" | "default" | "flex" | "priority";
type OpenAITextVerbosity = "low" | "medium" | "high";

const OPENAI_RESPONSES_APIS = new Set(["openai-responses", "azure-openai-responses"]);
const OPENAI_RESPONSES_PROVIDERS = new Set(["openai", "azure-openai", "azure-openai-responses"]);

function isDirectOpenAIBaseUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return false;
  }

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === "api.openai.com" || host === "chatgpt.com" || host.endsWith(".openai.azure.com")
    );
  } catch {
    const normalized = baseUrl.toLowerCase();
    return (
      normalized.includes("api.openai.com") ||
      normalized.includes("chatgpt.com") ||
      normalized.includes(".openai.azure.com")
    );
  }
}

function isOpenAIPublicApiBaseUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return false;
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return baseUrl.toLowerCase().includes("api.openai.com");
  }
}

function isOpenAICodexBaseUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return false;
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase() === "chatgpt.com";
  } catch {
    return baseUrl.toLowerCase().includes("chatgpt.com");
  }
}

function shouldApplyOpenAIAttributionHeaders(model: {
  api?: unknown;
  provider?: unknown;
  baseUrl?: unknown;
}): "openai" | "openai-codex" | undefined {
  if (
    model.provider === "openai" &&
    (model.api === "openai-completions" || model.api === "openai-responses") &&
    isOpenAIPublicApiBaseUrl(model.baseUrl)
  ) {
    return "openai";
  }
  if (
    model.provider === "openai-codex" &&
    (model.api === "openai-codex-responses" || model.api === "openai-responses") &&
    isOpenAICodexBaseUrl(model.baseUrl)
  ) {
    return "openai-codex";
  }
  return undefined;
}

function shouldApplyOpenAIServiceTier(model: {
  api?: unknown;
  provider?: unknown;
  baseUrl?: unknown;
}): boolean {
  if (
    model.provider === "openai" &&
    model.api === "openai-responses" &&
    isOpenAIPublicApiBaseUrl(model.baseUrl)
  ) {
    return true;
  }
  if (
    model.provider === "openai-codex" &&
    (model.api === "openai-codex-responses" || model.api === "openai-responses") &&
    isOpenAICodexBaseUrl(model.baseUrl)
  ) {
    return true;
  }
  return false;
}

function shouldForceResponsesStore(model: {
  api?: unknown;
  provider?: unknown;
  baseUrl?: unknown;
  compat?: { supportsStore?: boolean };
}): boolean {
  if (model.compat?.supportsStore === false) {
    return false;
  }
  if (typeof model.api !== "string" || typeof model.provider !== "string") {
    return false;
  }
  if (!OPENAI_RESPONSES_APIS.has(model.api)) {
    return false;
  }
  if (!OPENAI_RESPONSES_PROVIDERS.has(model.provider)) {
    return false;
  }
  return isDirectOpenAIBaseUrl(model.baseUrl);
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function resolveOpenAIResponsesCompactThreshold(model: { contextWindow?: unknown }): number {
  const contextWindow = parsePositiveInteger(model.contextWindow);
  if (contextWindow) {
    return Math.max(1_000, Math.floor(contextWindow * 0.7));
  }
  return 80_000;
}

function shouldEnableOpenAIResponsesServerCompaction(
  model: {
    api?: unknown;
    provider?: unknown;
    baseUrl?: unknown;
    compat?: { supportsStore?: boolean };
  },
  extraParams: Record<string, unknown> | undefined,
): boolean {
  const configured = extraParams?.responsesServerCompaction;
  if (configured === false) {
    return false;
  }
  if (!shouldForceResponsesStore(model)) {
    return false;
  }
  if (configured === true) {
    return true;
  }
  return model.provider === "openai";
}

function shouldStripResponsesStore(
  model: { api?: unknown; compat?: { supportsStore?: boolean } },
  forceStore: boolean,
): boolean {
  if (forceStore) {
    return false;
  }
  // Strip store for ANY API type when the model declares supportsStore=false.
  // Providers like Cerebras reject unknown parameters including `store` (#51058).
  return model.compat?.supportsStore === false;
}

function shouldStripResponsesPromptCache(model: { api?: unknown; baseUrl?: unknown }): boolean {
  if (typeof model.api !== "string" || !OPENAI_RESPONSES_APIS.has(model.api)) {
    return false;
  }
  // Cast needed: Model<Api>.compat is OpenAICompletionsCompat | OpenAIResponsesCompat,
  // which is not structurally assignable to { supportsPromptCache?: boolean } because
  // OpenAICompletionsCompat has extra properties. Once pi-ai adds supportsPromptCache
  // to its compat types, this cast can be removed.
  const compat = (model as { compat?: { supportsPromptCache?: boolean } }).compat;
  if (compat?.supportsPromptCache === true) {
    return false;
  }
  // Missing baseUrl means pi-ai will use the default OpenAI endpoint, so keep
  // prompt cache fields for that direct path.
  if (typeof model.baseUrl !== "string" || !model.baseUrl.trim()) {
    return false;
  }
  return !isDirectOpenAIBaseUrl(model.baseUrl);
}

function applyOpenAIResponsesPayloadOverrides(params: {
  payloadObj: Record<string, unknown>;
  forceStore: boolean;
  stripStore: boolean;
  stripPromptCache: boolean;
  useServerCompaction: boolean;
  compactThreshold: number;
}): void {
  if (params.forceStore) {
    params.payloadObj.store = true;
  }
  if (params.stripStore) {
    delete params.payloadObj.store;
  }
  if (params.stripPromptCache) {
    delete params.payloadObj.prompt_cache_key;
    delete params.payloadObj.prompt_cache_retention;
  }
  if (params.useServerCompaction && params.payloadObj.context_management === undefined) {
    params.payloadObj.context_management = [
      {
        type: "compaction",
        compact_threshold: params.compactThreshold,
      },
    ];
  }
}

function normalizeOpenAIServiceTier(value: unknown): OpenAIServiceTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "default" ||
    normalized === "flex" ||
    normalized === "priority"
  ) {
    return normalized;
  }
  return undefined;
}

export function resolveOpenAIServiceTier(
  extraParams: Record<string, unknown> | undefined,
): OpenAIServiceTier | undefined {
  const raw = extraParams?.serviceTier ?? extraParams?.service_tier;
  const normalized = normalizeOpenAIServiceTier(raw);
  if (raw !== undefined && normalized === undefined) {
    const rawSummary = typeof raw === "string" ? raw : typeof raw;
    log.warn(`ignoring invalid OpenAI service tier param: ${rawSummary}`);
  }
  return normalized;
}

function normalizeOpenAITextVerbosity(value: unknown): OpenAITextVerbosity | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return undefined;
}

export function resolveOpenAITextVerbosity(
  extraParams: Record<string, unknown> | undefined,
): OpenAITextVerbosity | undefined {
  const raw = extraParams?.textVerbosity ?? extraParams?.text_verbosity;
  const normalized = normalizeOpenAITextVerbosity(raw);
  if (raw !== undefined && normalized === undefined) {
    const rawSummary = typeof raw === "string" ? raw : typeof raw;
    log.warn(`ignoring invalid OpenAI text verbosity param: ${rawSummary}`);
  }
  return normalized;
}

function normalizeOpenAIFastMode(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "on" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "1" ||
    normalized === "fast"
  ) {
    return true;
  }
  if (
    normalized === "off" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "0" ||
    normalized === "normal"
  ) {
    return false;
  }
  return undefined;
}

export function resolveOpenAIFastMode(
  extraParams: Record<string, unknown> | undefined,
): boolean | undefined {
  const raw = extraParams?.fastMode ?? extraParams?.fast_mode;
  const normalized = normalizeOpenAIFastMode(raw);
  if (raw !== undefined && normalized === undefined) {
    const rawSummary = typeof raw === "string" ? raw : typeof raw;
    log.warn(`ignoring invalid OpenAI fast mode param: ${rawSummary}`);
  }
  return normalized;
}

function applyOpenAIFastModePayloadOverrides(params: {
  payloadObj: Record<string, unknown>;
  model: { provider?: unknown; id?: unknown; baseUrl?: unknown; api?: unknown };
}): void {
  if (params.payloadObj.service_tier === undefined && shouldApplyOpenAIServiceTier(params.model)) {
    params.payloadObj.service_tier = "priority";
  }
}

export function createOpenAIResponsesContextManagementWrapper(
  baseStreamFn: StreamFn | undefined,
  extraParams: Record<string, unknown> | undefined,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const forceStore = shouldForceResponsesStore(model);
    const useServerCompaction = shouldEnableOpenAIResponsesServerCompaction(model, extraParams);
    const stripStore = shouldStripResponsesStore(model, forceStore);
    const stripPromptCache = shouldStripResponsesPromptCache(model);
    if (!forceStore && !useServerCompaction && !stripStore && !stripPromptCache) {
      return underlying(model, context, options);
    }

    const compactThreshold =
      parsePositiveInteger(extraParams?.responsesCompactThreshold) ??
      resolveOpenAIResponsesCompactThreshold(model);
    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          applyOpenAIResponsesPayloadOverrides({
            payloadObj: payload as Record<string, unknown>,
            forceStore,
            stripStore,
            stripPromptCache,
            useServerCompaction,
            compactThreshold,
          });
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

export function createOpenAIFastModeWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    if (
      (model.api !== "openai-responses" &&
        model.api !== "openai-codex-responses" &&
        model.api !== "azure-openai-responses") ||
      (model.provider !== "openai" && model.provider !== "openai-codex")
    ) {
      return underlying(model, context, options);
    }
    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          applyOpenAIFastModePayloadOverrides({
            payloadObj: payload as Record<string, unknown>,
            model,
          });
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

export function createOpenAIServiceTierWrapper(
  baseStreamFn: StreamFn | undefined,
  serviceTier: OpenAIServiceTier,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    if (!shouldApplyOpenAIServiceTier(model)) {
      return underlying(model, context, options);
    }
    return streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
      if (payloadObj.service_tier === undefined) {
        payloadObj.service_tier = serviceTier;
      }
    });
  };
}

export function createOpenAITextVerbosityWrapper(
  baseStreamFn: StreamFn | undefined,
  verbosity: OpenAITextVerbosity,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    if (model.api !== "openai-responses" && model.api !== "openai-codex-responses") {
      return underlying(model, context, options);
    }
    const shouldOverrideExistingVerbosity = model.api === "openai-codex-responses";
    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          const payloadObj = payload as Record<string, unknown>;
          const existingText =
            payloadObj.text && typeof payloadObj.text === "object"
              ? (payloadObj.text as Record<string, unknown>)
              : {};
          if (shouldOverrideExistingVerbosity || existingText.verbosity === undefined) {
            payloadObj.text = { ...existingText, verbosity };
          }
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

export function createCodexDefaultTransportWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    underlying(model, context, {
      ...options,
      transport: options?.transport ?? "auto",
    });
}

export function createOpenAIDefaultTransportWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const typedOptions = options as
      | (SimpleStreamOptions & { openaiWsWarmup?: boolean })
      | undefined;
    const mergedOptions = {
      ...options,
      transport: options?.transport ?? "auto",
      openaiWsWarmup: typedOptions?.openaiWsWarmup ?? false,
    } as SimpleStreamOptions;
    return underlying(model, context, mergedOptions);
  };
}

export function createOpenAIAttributionHeadersWrapper(
  baseStreamFn: StreamFn | undefined,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const attributionProvider = shouldApplyOpenAIAttributionHeaders(model);
    if (!attributionProvider) {
      return underlying(model, context, options);
    }
    return underlying(model, context, {
      ...options,
      headers: {
        ...options?.headers,
        ...resolveProviderAttributionHeaders(attributionProvider),
      },
    });
  };
}

/**
 * Flatten text-only content arrays in user messages to plain strings.
 *
 * pi-ai's `convertMessages` emits user messages whose content is an array of
 * `{type:"text", text:"..."}` objects when the internal representation uses
 * Anthropic-style content blocks.  Native OpenAI endpoints tolerate this, but
 * many third-party OpenAI-compatible providers (NVIDIA NIM, Ollama, vLLM,
 * LiteLLM, etc.) reject it with HTTP 400 because they only accept the
 * standard `"content": "string"` format for text-only messages.
 *
 * This wrapper normalizes the outbound payload via `onPayload` so every
 * message (user, system, developer, assistant) whose content is an array of
 * exclusively plain `{type:"text", text:"..."}` blocks (no extra properties
 * like `cache_control`) becomes a simple concatenated string.  Messages that
 * contain non-text blocks (e.g. `image_url`) or annotated text blocks are
 * left untouched.
 */
export function createOpenAICompatContentNormalizationWrapper(
  baseStreamFn: StreamFn | undefined,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    // Only apply to openai-completions (the Chat Completions adapter path).
    // Responses API and Anthropic endpoints use different payload shapes.
    if (model.api !== "openai-completions") {
      return underlying(model, context, options);
    }

    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          normalizeOpenAICompatMessageContent(payload as Record<string, unknown>);
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

/**
 * Return true when a content block is a plain `{type:"text", text:"..."}` with
 * no extra annotation properties (e.g. `cache_control`).  Blocks that carry
 * additional metadata must remain as objects so providers that need those
 * annotations (like OpenRouter Anthropic caching) are not broken.
 */
function isPlainTextBlock(block: unknown): block is { type: "text"; text: string } {
  if (!block || typeof block !== "object") {
    return false;
  }
  const keys = Object.keys(block);
  if (keys.length !== 2) {
    return false;
  }
  const rec = block as Record<string, unknown>;
  return rec.type === "text" && typeof rec.text === "string";
}

/**
 * Walk the `messages` array in an OpenAI Chat Completions payload and
 * flatten any text-only content arrays to plain strings.
 */
function normalizeOpenAICompatMessageContent(payload: Record<string, unknown>): void {
  const messages = payload.messages;
  if (!Array.isArray(messages)) {
    return;
  }

  for (const msg of messages as Array<{ role?: string; content?: unknown }>) {
    const content = msg.content;
    if (!Array.isArray(content)) {
      continue;
    }

    // Only flatten when every block is a plain text block with no extra
    // annotation properties (e.g. cache_control added by OpenRouter).
    if (content.length === 0) {
      continue;
    }
    if (!content.every(isPlainTextBlock)) {
      continue;
    }

    // Concatenate text parts into a single string, matching the standard
    // OpenAI Chat Completions format.
    msg.content = (content as Array<{ text: string }>).map((block) => block.text).join("");
  }
}
