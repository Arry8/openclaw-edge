/**
 * Check if a suffix looks like a version string rather than an auth profile.
 * Version suffixes are typically numeric dates (20251001) or semver-like (v1.2.3).
 * Auth profiles are alphanumeric names like "work", "default", or "cf:default".
 *
 * Note: A purely numeric auth profile (e.g., @1234) would be mistakenly treated as
 * a version, but this is an unlikely edge case in practice.
 */
function looksLikeVersionSuffix(suffix: string): boolean {
  // Semver-like patterns: v1, v1.2, v1.2.3, 1.2.3, or pure numeric (e.g., "20251001" for dates)
  // Pure numeric strings match this pattern via the single \d+ group with optional parts absent.
  return /^v?\d+(\.\d+)*(-[\w.]+)?(\+[\w.]+)?$/.test(suffix);
}

export function splitTrailingAuthProfile(raw: string): {
  model: string;
  profile?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { model: "" };
  }

  const lastSlash = trimmed.lastIndexOf("/");
  let profileDelimiter = trimmed.indexOf("@", lastSlash + 1);
  if (profileDelimiter <= 0) {
    return { model: trimmed };
  }

  const suffixAfterDelimiter = () => trimmed.slice(profileDelimiter + 1);

  // Keep well-known "version" suffixes (ex: @20251001) as part of the model id,
  // but allow an auth profile suffix *after* them (ex: ...@20251001@work).
  if (/^\d{8}(?:@|$)/.test(suffixAfterDelimiter())) {
    const nextDelimiter = trimmed.indexOf("@", profileDelimiter + 9);
    if (nextDelimiter < 0) {
      return { model: trimmed };
    }
    profileDelimiter = nextDelimiter;
  }

  // Keep local model quant suffixes (common in LM Studio/Ollama catalogs) as part
  // of the model id. These often use '@' (ex: gemma-4-31b-it@q8_0) which would
  // otherwise be misinterpreted as an auth profile delimiter.
  //
  // If an auth profile is needed, it can still be specified as a second suffix:
  //   lmstudio/foo@q8_0@work
  if (/^(?:q\d+(?:_[a-z0-9]+)*|\d+bit)(?:@|$)/i.test(suffixAfterDelimiter())) {
    const nextDelimiter = trimmed.indexOf("@", profileDelimiter + 1);
    if (nextDelimiter < 0) {
      return { model: trimmed };
    }
    profileDelimiter = nextDelimiter;
  }

  const model = trimmed.slice(0, profileDelimiter).trim();
  const profile = trimmed.slice(profileDelimiter + 1).trim();
  if (!model || !profile) {
    return { model: trimmed };
  }

  // Don't split if the suffix looks like a version rather than an auth profile
  if (looksLikeVersionSuffix(profile)) {
    return { model: trimmed };
  }

  return { model, profile };
}
