export function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return normalizeNullableString(value) ?? undefined;
}

export function normalizeStringifiedOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeOptionalString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return normalizeOptionalString(String(value));
  }
  return undefined;
}

export function normalizeOptionalLowercaseString(value: unknown): string | undefined {
  return normalizeOptionalString(value)?.toLowerCase();
}

export function normalizeLowercaseStringOrEmpty(value: unknown): string {
  return normalizeOptionalLowercaseString(value) ?? "";
}

export function lowercasePreservingWhitespace(value: string): string {
  return value.toLowerCase();
}

export function localeLowercasePreservingWhitespace(value: string): string {
  return value.toLocaleLowerCase();
}

export function resolvePrimaryStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeOptionalString(value);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return normalizeOptionalString((value as { primary?: unknown }).primary);
}

export function normalizeOptionalThreadValue(value: unknown): string | number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }
  return normalizeOptionalString(value);
}

export function normalizeOptionalStringifiedId(value: unknown): string | undefined {
  const normalized = normalizeOptionalThreadValue(value);
  return normalized == null ? undefined : String(normalized);
}

export function hasNonEmptyString(value: unknown): value is string {
  return normalizeOptionalString(value) !== undefined;
}

/**
 * Sanitize a display name for use as the `name` field in model provider
 * chat completion messages.  OpenAI and compatible APIs restrict this
 * field to {@link https://platform.openai.com/docs/api-reference/chat/create /^[a-zA-Z0-9_-]{1,64}$/}.
 *
 * Characters outside the allowed set are replaced with `_` and the
 * result is truncated to 64 characters.  Returns `undefined` when the
 * input is empty or produces an empty sanitized string.
 */
export function sanitizeModelName(value: unknown): string | undefined {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    return undefined;
  }
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return sanitized || undefined;
}
