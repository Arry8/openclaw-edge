const PROMPT_INJECTION_PATTERNS = [
  /ignore (all|any|previous|above|prior) instructions/i,
  /do not follow (the )?(system|developer)/i,
  /system prompt/i,
  /<\s*(system|assistant|developer|tool|function)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
