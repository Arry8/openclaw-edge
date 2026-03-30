const ISO_TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T/;

// Digit-only strings with ≤12 digits are ambiguous: they could be Unix seconds
// (e.g. 1714000000) or YYYYMMDDHH shorthand (e.g. 2026031812). Promoting them
// would make 2026031812 parse as 2034-03-15 instead of 2026-03-18. Reject them
// and require ISO-8601. Accept only 13-digit values (unambiguously ms); 14+ reject.
const MIN_UNIX_MS_DIGITS = 13;
const MAX_UNIX_MS_DIGITS = 13;

function normalizeUtcIso(raw: string) {
  if (ISO_TZ_RE.test(raw)) {
    return raw;
  }
  if (ISO_DATE_RE.test(raw)) {
    return `${raw}T00:00:00Z`;
  }
  if (ISO_DATE_TIME_RE.test(raw)) {
    return `${raw}Z`;
  }
  return raw;
}

export function parseAbsoluteTimeMs(input: string): number | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      // Reject compact digit-only (≤12 digits): ambiguous between Unix seconds
      // and YYYYMMDDHH. Accept only 13-digit values (unambiguously ms); 14+ reject.
      if (raw.length >= MIN_UNIX_MS_DIGITS && raw.length <= MAX_UNIX_MS_DIGITS) {
        return Math.floor(n);
      }
      return null;
    }
  }
  const parsed = Date.parse(normalizeUtcIso(raw));
  return Number.isFinite(parsed) ? parsed : null;
}
