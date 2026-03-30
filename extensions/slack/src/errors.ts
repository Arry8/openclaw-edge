interface SlackErrorShape {
  code?: string;
  retryAfter?: number;
  data?: {
    error?: string;
    needed?: string;
    provided?: string;
    response_metadata?: {
      scopes?: string[];
      acceptedScopes?: string[];
      messages?: string[];
    };
  };
}

export function formatSlackError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const { code, retryAfter, data } = err as SlackErrorShape;
  const parts: string[] = [];
  if (code) parts.push(`code=${code}`);
  if (data?.error) parts.push(`error=${data.error}`);
  if (data?.needed) parts.push(`needed=${data.needed}`);
  if (data?.provided) parts.push(`provided=${data.provided}`);
  if (retryAfter != null) parts.push(`retryAfter=${retryAfter}`);
  const meta = data?.response_metadata;
  if (meta?.scopes?.length) parts.push(`scopes=${meta.scopes.join(",")}`);
  if (meta?.acceptedScopes?.length) parts.push(`acceptedScopes=${meta.acceptedScopes.join(",")}`);
  if (meta?.messages?.length) parts.push(`messages=${meta.messages.join(" | ")}`);
  return parts.length ? `${err.message} [${parts.join(" ")}]` : err.message;
}
