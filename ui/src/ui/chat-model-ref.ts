import type { ModelCatalogEntry } from "./types.ts";

export type ChatModelOverride =
  | {
      kind: "qualified";
      value: string;
    }
  | {
      kind: "raw";
      value: string;
    };

export type ChatModelResolutionSource = "empty" | "qualified" | "catalog" | "raw" | "server";

export type ChatModelResolutionReason = "empty" | "missing" | "ambiguous";

export type ChatModelResolution = {
  value: string;
  source: ChatModelResolutionSource;
  reason?: ChatModelResolutionReason;
};

export function buildQualifiedChatModelValue(model: string, provider?: string | null): string {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return "";
  }
  const trimmedProvider = provider?.trim();
  // Skip prefixing when the model id already starts with the provider
  // (e.g. provider="openrouter", id="openrouter/hunter-alpha")
  if (trimmedProvider && !trimmedModel.startsWith(`${trimmedProvider}/`)) {
    return `${trimmedProvider}/${trimmedModel}`;
  }
  return trimmedModel;
}

export function createChatModelOverride(value: string): ChatModelOverride | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("/")) {
    return { kind: "qualified", value: trimmed };
  }
  return { kind: "raw", value: trimmed };
}

export function normalizeChatModelOverrideValue(
  override: ChatModelOverride | null | undefined,
  catalog: ModelCatalogEntry[],
): string {
  return resolveChatModelOverride(override, catalog).value;
}

export function resolveChatModelOverride(
  override: ChatModelOverride | null | undefined,
  catalog: ModelCatalogEntry[],
): ChatModelResolution {
  if (!override) {
    return { value: "", source: "empty", reason: "empty" };
  }
  const trimmed = override?.value.trim();
  if (!trimmed) {
    return { value: "", source: "empty", reason: "empty" };
  }
  if (override.kind === "qualified") {
    return { value: trimmed, source: "qualified" };
  }

  let matchedValue = "";
  for (const entry of catalog) {
    if (entry.id.trim().toLowerCase() !== trimmed.toLowerCase()) {
      continue;
    }
    const candidate = buildQualifiedChatModelValue(entry.id, entry.provider);
    if (!matchedValue) {
      matchedValue = candidate;
      continue;
    }
    if (matchedValue.toLowerCase() !== candidate.toLowerCase()) {
      return { value: trimmed, source: "raw", reason: "ambiguous" };
    }
  }
  if (matchedValue) {
    return { value: matchedValue, source: "catalog" };
  }
  return { value: trimmed, source: "raw", reason: "missing" };
}

export function resolveServerChatModelValue(
  model?: string | null,
  provider?: string | null,
): string {
  if (typeof model !== "string") {
    return "";
  }
  return buildQualifiedChatModelValue(model, provider);
}

export function resolvePreferredServerChatModel(
  model: string | null | undefined,
  provider: string | null | undefined,
  catalog: ModelCatalogEntry[],
): ChatModelResolution {
  if (typeof model !== "string") {
    return { value: "", source: "empty", reason: "empty" };
  }
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return { value: "", source: "empty", reason: "empty" };
  }

  const overrideResolution = resolveChatModelOverride(
    createChatModelOverride(trimmedModel),
    catalog,
  );
  if (overrideResolution.source === "qualified" || overrideResolution.source === "catalog") {
    return overrideResolution;
  }

  return {
    value: resolveServerChatModelValue(trimmedModel, provider),
    source: "server",
    reason: overrideResolution.reason,
  };
}

export function resolvePreferredServerChatModelValue(
  model: string | null | undefined,
  provider: string | null | undefined,
  catalog: ModelCatalogEntry[],
): string {
  return resolvePreferredServerChatModel(model, provider, catalog).value;
}

export function formatChatModelDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const separator = trimmed.indexOf("/");
  if (separator <= 0) {
    return trimmed;
  }
  return `${trimmed.slice(separator + 1)} · ${trimmed.slice(0, separator)}`;
}

export function buildChatModelOption(entry: ModelCatalogEntry): { value: string; label: string } {
  const provider = entry.provider?.trim();
  const id = entry.id?.trim() ?? "";

  // When the provider field is populated, qualify as provider/id.
  if (provider) {
    return {
      value: buildQualifiedChatModelValue(id, provider),
      label: `${id} · ${provider}`,
    };
  }

  // Provider is missing — if the id already contains a slash it is
  // self-qualified (e.g. "xai/grok-4-1-fast"). Use it as-is and derive
  // display values from the embedded prefix.
  const slash = id.indexOf("/");
  if (slash > 0) {
    const embeddedProvider = id.slice(0, slash);
    const modelName = id.slice(slash + 1);
    return {
      value: id,
      label: `${modelName} · ${embeddedProvider}`,
    };
  }

  // No provider and no embedded prefix — return the bare id.
  return { value: id, label: id };
}
